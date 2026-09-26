--!strict
--[[
	AssetLoader (client)

	Rebuilds the blocky brainrot models and the icons that tools/build_assets.py
	packed into ReplicatedStorage.Assets, using EditableMesh and EditableImage.
	This avoids uploading any assets to a Roblox account first.

	Editable meshes and images only exist on the machine that creates them, so
	each client builds its own copy. Every function returns nil when the data or
	the Editable APIs aren't available, and callers keep their simple fallback.
]]

local AssetService = game:GetService("AssetService")
local EncodingService = game:GetService("EncodingService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local MESH_FORMAT = 2
local ICON_FORMAT = 1
local QUAD_BYTES = 7

export type BrainrotAsset = {
	Mesh: EditableMesh,
	-- Bounding box of the model when it is 1 stud tall.
	Size: Vector3,
	-- Palette colour IDs in the mesh and their untinted colours (for Rainbow).
	ColorIds: { number },
	BaseColors: { Color3 },
}

local AssetLoader = {}

local brainrotCache: { [string]: BrainrotAsset } = {}
local iconCache: { [string]: EditableImage } = {}
-- Names that were already tried and failed, so they aren't rebuilt every time.
local failed: { [string]: boolean } = {}
local warned = false

local function warnOnce(message: string)
	if not warned then
		warned = true
		warn("[AssetLoader] " .. message .. " Falling back to simple figures and icons.")
	end
end

local function getModule(folderName: string, name: string): ModuleScript?
	local assets = ReplicatedStorage:FindFirstChild("Assets")
	local folder = if assets then assets:FindFirstChild(folderName) else nil
	local module = if folder then folder:FindFirstChild(name) else nil
	if module and module:IsA("ModuleScript") then
		return module
	end
	return nil
end

local function decode(encoded: string): buffer
	local compressed = EncodingService:Base64Decode(buffer.fromstring(encoded))
	return EncodingService:DecompressBuffer(compressed, Enum.CompressionAlgorithm.Zstd)
end

--------------------------------------------------------------------------------
-- Mutation colours
--------------------------------------------------------------------------------

local function luminance(colour: Color3): number
	return 0.299 * colour.R + 0.587 * colour.G + 0.114 * colour.B
end

local TINTS: { [string]: { Dark: Color3, Light: Color3 } } = {
	Gold = { Dark = Color3.fromRGB(150, 90, 10), Light = Color3.fromRGB(255, 232, 120) },
	Diamond = { Dark = Color3.fromRGB(30, 120, 220), Light = Color3.fromRGB(215, 250, 255) },
}

-- Recolours a palette entry for a mutation, keeping a little of the original.
local function tint(colour: Color3, mutation: string?): Color3
	local ramp = if mutation then TINTS[mutation] else nil
	if ramp == nil then
		return colour
	end
	local shade = ramp.Dark:Lerp(ramp.Light, math.clamp(luminance(colour) * 1.2, 0, 1))
	return shade:Lerp(colour, 0.15)
end

-- Colour of a Rainbow palette entry at time `t`.
function AssetLoader.rainbowColor(base: Color3, index: number, t: number): Color3
	local _, saturation, value = base:ToHSV()
	local hue = (t * 0.25 + index * 0.03) % 1
	return Color3.fromHSV(hue, math.max(saturation, 0.65), math.max(value, 0.8))
end

--------------------------------------------------------------------------------
-- Blocky meshes
--------------------------------------------------------------------------------

local function createBlockyMesh(data: { [string]: any }, mutation: string?): BrainrotAsset
	local dims = data.Dims
	local gridX: number, gridY: number, gridZ: number = dims[1], dims[2], dims[3]
	local quadCount: number = data.QuadCount
	local quads = decode(data.Quads)
	if buffer.len(quads) ~= quadCount * QUAD_BYTES then
		error("quad data does not match its header")
	end

	local mesh = AssetService:CreateEditableMesh()
	if mesh == nil then
		error("the editable memory budget is exhausted")
	end

	local colorIds: { number } = {}
	local baseColors: { Color3 } = {}
	for index, hex in data.Palette do
		local base = Color3.fromRGB(bit32.rshift(hex, 16), bit32.band(bit32.rshift(hex, 8), 255), bit32.band(hex, 255))
		baseColors[index] = base
		colorIds[index] = mesh:AddColor(tint(base, mutation), 1)
	end

	-- One flat normal per face direction: axis * 2 + positive.
	local normalIds: { number } = {}
	for axis = 0, 2 do
		for positive = 0, 1 do
			local direction = if positive == 1 then 1 else -1
			local normal = if axis == 0
				then Vector3.new(direction, 0, 0)
				elseif axis == 1 then Vector3.new(0, direction, 0)
				else Vector3.new(0, 0, direction)
			normalIds[axis * 2 + positive + 1] = mesh:AddNormal(normal)
		end
	end

	-- Corners are shared between quads; normals and colours are per face.
	local vertexIds: { [number]: number } = {}
	local low = Vector3.new(math.huge, math.huge, math.huge)
	local high = -low
	local function vertex(x: number, y: number, z: number): number
		local key = (x * 256 + y) * 256 + z
		local id = vertexIds[key]
		if id == nil then
			local position = Vector3.new((x - gridX / 2) / gridY, (y - gridY / 2) / gridY, (z - gridZ / 2) / gridY)
			low = low:Min(position)
			high = high:Max(position)
			id = mesh:AddVertex(position)
			vertexIds[key] = id
		end
		return id
	end

	local corner = { 0, 0, 0 }
	local function cornerVertex(axis: number, plane: number, u: number, v: number): number
		corner[axis + 1] = plane
		corner[(axis + 1) % 3 + 1] = u
		corner[(axis + 2) % 3 + 1] = v
		return vertex(corner[1], corner[2], corner[3])
	end

	for quad = 0, quadCount - 1 do
		local offset = quad * QUAD_BYTES
		local axisDirection = buffer.readu8(quads, offset)
		local axis = axisDirection // 2
		local positive = axisDirection % 2
		local plane = buffer.readu8(quads, offset + 1) + positive
		local u0 = buffer.readu8(quads, offset + 2)
		local v0 = buffer.readu8(quads, offset + 3)
		local u1 = u0 + buffer.readu8(quads, offset + 4)
		local v1 = v0 + buffer.readu8(quads, offset + 5)
		local colorId = colorIds[buffer.readu8(quads, offset + 6) + 1]
		local normalId = normalIds[axisDirection + 1]

		-- Counter-clockwise seen from outside the block.
		local a = cornerVertex(axis, plane, u0, v0)
		local b = cornerVertex(axis, plane, u1, v0)
		local c = cornerVertex(axis, plane, u1, v1)
		local d = cornerVertex(axis, plane, u0, v1)
		if positive == 0 then
			a, b, c, d = d, c, b, a
		end
		for _, face in { mesh:AddTriangle(a, b, c), mesh:AddTriangle(a, c, d) } do
			mesh:SetFaceNormals(face, { normalId, normalId, normalId })
			mesh:SetFaceColors(face, { colorId, colorId, colorId })
		end
	end

	local size = high - low
	return {
		Mesh = mesh,
		Size = size / size.Y,
		ColorIds = colorIds,
		BaseColors = baseColors,
	}
end

-- Returns the shared mesh for a brainrot and mutation, building it on first use.
function AssetLoader.getBrainrot(brainrotId: string, mutation: string?): BrainrotAsset?
	local key = brainrotId .. "|" .. (mutation or "")
	local cached = brainrotCache[key]
	if cached or failed["Brainrot:" .. key] then
		return cached
	end
	failed["Brainrot:" .. key] = true

	local module = getModule("Brainrots", brainrotId)
	if module == nil then
		return nil
	end
	local ok, result = pcall(function(): BrainrotAsset
		local data = require(module) :: any
		if data.Format ~= MESH_FORMAT then
			error("unsupported data format " .. tostring(data.Format))
		end
		return createBlockyMesh(data, mutation)
	end)
	if not ok then
		warnOnce(string.format("Could not build the %s model (%s).", brainrotId, tostring(result)))
		return nil
	end
	failed["Brainrot:" .. key] = nil
	brainrotCache[key] = result
	return result
end

-- Creates a MeshPart of the brainrot, `height` studs tall, centred on its
-- origin. Yields. The caller positions and parents it.
function AssetLoader.createBrainrotPart(brainrotId: string, mutation: string?, height: number): (MeshPart?, BrainrotAsset?)
	local asset = AssetLoader.getBrainrot(brainrotId, mutation)
	if asset == nil then
		return nil, nil
	end
	local ok, result = pcall(function(): MeshPart
		local part = AssetService:CreateMeshPartAsync(Content.fromObject(asset.Mesh), {
			CollisionFidelity = Enum.CollisionFidelity.Box,
		})
		-- White so the vertex colours show unchanged.
		part.Color = Color3.new(1, 1, 1)
		part.Material = Enum.Material.SmoothPlastic
		part.Size = asset.Size * height
		return part
	end)
	if not ok then
		warnOnce(string.format("Could not create the %s mesh part (%s).", brainrotId, tostring(result)))
		return nil, nil
	end
	return result, asset
end

-- Recolours a Rainbow mesh; every MeshPart that shares it updates at once.
function AssetLoader.animateRainbow(asset: BrainrotAsset, t: number)
	for index, colorId in asset.ColorIds do
		asset.Mesh:SetColor(colorId, AssetLoader.rainbowColor(asset.BaseColors[index], index, t))
	end
end

--------------------------------------------------------------------------------
-- Icons
--------------------------------------------------------------------------------

local function getIcon(folderName: string, name: string): EditableImage?
	local key = folderName .. "/" .. name
	local cached = iconCache[key]
	if cached or failed["Icon:" .. key] then
		return cached
	end
	failed["Icon:" .. key] = true

	local module = getModule(folderName, name)
	if module == nil then
		return nil
	end
	local ok, result = pcall(function(): EditableImage
		local data = require(module) :: any
		if data.Format ~= ICON_FORMAT then
			error("unsupported data format " .. tostring(data.Format))
		end
		local size: number = data.Size
		local pixels = decode(data.Pixels)
		if buffer.len(pixels) ~= size * size * 4 then
			error("pixel data does not match the image size")
		end
		local image = AssetService:CreateEditableImage({ Size = Vector2.new(size, size) })
		if image == nil then
			error("the editable memory budget is exhausted")
		end
		image:WritePixelsBuffer(Vector2.zero, Vector2.new(size, size), pixels)
		return image
	end)
	if not ok then
		warnOnce(string.format("Could not build the %s icon (%s).", key, tostring(result)))
		return nil
	end
	failed["Icon:" .. key] = nil
	iconCache[key] = result
	return result
end

-- Developer product icon, such as "SmallCashBundle".
function AssetLoader.getProductIcon(key: string): EditableImage?
	return getIcon("ProductIcons", key)
end

-- HUD button icon: "Shop", "Rebirth" or "Index".
function AssetLoader.getUIIcon(name: string): EditableImage?
	return getIcon("UIIcons", name)
end

return table.freeze(AssetLoader)

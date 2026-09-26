--!strict
--[[
	AssetLoader (client)

	Rebuilds the brainrot 3D models and product icons that tools/build_assets.py
	packed into ReplicatedStorage.Assets, using EditableMesh and EditableImage.
	This avoids uploading any assets to a Roblox account first.

	Editable meshes and images only exist on the machine that creates them, so
	each client builds its own copy. Every function returns nil when the data or
	the Editable APIs aren't available, and callers keep their simple fallback.
]]

local AssetService = game:GetService("AssetService")
local EncodingService = game:GetService("EncodingService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local FORMAT_VERSION = 1

export type BrainrotAsset = {
	Mesh: EditableMesh,
	Texture: EditableImage,
	-- Bounding box of the model when it is 1 stud tall.
	Size: Vector3,
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

local function createImage(size: number, pixels: buffer): EditableImage
	if buffer.len(pixels) ~= size * size * 4 then
		error("pixel data does not match the image size")
	end
	local image = AssetService:CreateEditableImage({ Size = Vector2.new(size, size) })
	if image == nil then
		error("the editable memory budget is exhausted")
	end
	image:WritePixelsBuffer(Vector2.zero, Vector2.new(size, size), pixels)
	return image
end

local function createMesh(data: { [string]: any }, meshData: buffer): (EditableMesh, Vector3)
	local positionCount: number = data.PositionCount
	local uvCount: number = data.UVCount
	local triangleCount: number = data.TriangleCount
	local size = Vector3.new(data.Size[1], data.Size[2], data.Size[3])
	if buffer.len(meshData) ~= (positionCount * 3 + uvCount * 2 + triangleCount * 6) * 2 then
		error("mesh data does not match its header")
	end

	local mesh = AssetService:CreateEditableMesh()
	if mesh == nil then
		error("the editable memory budget is exhausted")
	end

	local offset = 0
	local vertexIds = table.create(positionCount)
	local normalIds = table.create(positionCount)
	for index = 1, positionCount do
		local x = buffer.readu16(meshData, offset) / 65535 - 0.5
		local y = buffer.readu16(meshData, offset + 2) / 65535 - 0.5
		local z = buffer.readu16(meshData, offset + 4) / 65535 - 0.5
		offset += 6
		vertexIds[index] = mesh:AddVertex(Vector3.new(x * size.X, y * size.Y, z * size.Z))
		-- No argument: Roblox computes a smooth normal from the surrounding faces.
		normalIds[index] = mesh:AddNormal()
	end

	local uvIds = table.create(uvCount)
	for index = 1, uvCount do
		local u = buffer.readu16(meshData, offset) / 65535
		local v = buffer.readu16(meshData, offset + 2) / 65535
		offset += 4
		uvIds[index] = mesh:AddUV(Vector2.new(u, v))
	end

	local faceOffset = offset
	local faceUVOffset = offset + triangleCount * 6
	for triangle = 0, triangleCount - 1 do
		local f = faceOffset + triangle * 6
		local t = faceUVOffset + triangle * 6
		local a = buffer.readu16(meshData, f) + 1
		local b = buffer.readu16(meshData, f + 2) + 1
		local c = buffer.readu16(meshData, f + 4) + 1
		local faceId = mesh:AddTriangle(vertexIds[a], vertexIds[b], vertexIds[c])
		mesh:SetFaceNormals(faceId, { normalIds[a], normalIds[b], normalIds[c] })
		mesh:SetFaceUVs(faceId, {
			uvIds[buffer.readu16(meshData, t) + 1],
			uvIds[buffer.readu16(meshData, t + 2) + 1],
			uvIds[buffer.readu16(meshData, t + 4) + 1],
		})
	end

	return mesh, size
end

-- Returns the shared mesh and texture for a brainrot, building them on first use.
function AssetLoader.getBrainrot(brainrotId: string): BrainrotAsset?
	local cached = brainrotCache[brainrotId]
	if cached or failed["Brainrot:" .. brainrotId] then
		return cached
	end
	failed["Brainrot:" .. brainrotId] = true

	local module = getModule("Brainrots", brainrotId)
	if module == nil then
		return nil
	end
	local ok, result = pcall(function(): BrainrotAsset
		local data = require(module) :: any
		if data.Format ~= FORMAT_VERSION then
			error("unsupported data format " .. tostring(data.Format))
		end
		local mesh, size = createMesh(data, decode(data.Mesh))
		local texture = createImage(data.TextureSize, decode(data.Texture))
		return { Mesh = mesh, Texture = texture, Size = size }
	end)
	if not ok then
		warnOnce(string.format("Could not build the %s model (%s).", brainrotId, tostring(result)))
		return nil
	end
	failed["Brainrot:" .. brainrotId] = nil
	brainrotCache[brainrotId] = result
	return result
end

-- Creates a MeshPart of the brainrot, `height` studs tall, centred on its origin.
-- Yields. The caller positions and parents it.
function AssetLoader.createBrainrotPart(brainrotId: string, height: number): MeshPart?
	local asset = AssetLoader.getBrainrot(brainrotId)
	if asset == nil then
		return nil
	end
	local ok, result = pcall(function(): MeshPart
		local part = AssetService:CreateMeshPartAsync(Content.fromObject(asset.Mesh), {
			CollisionFidelity = Enum.CollisionFidelity.Box,
		})
		part.TextureContent = Content.fromObject(asset.Texture)
		part.Size = asset.Size * height
		return part
	end)
	if not ok then
		warnOnce(string.format("Could not create the %s mesh part (%s).", brainrotId, tostring(result)))
		return nil
	end
	return result
end

-- Returns the icon image for a developer product key such as "SmallCashBundle".
function AssetLoader.getProductIcon(key: string): EditableImage?
	local cached = iconCache[key]
	if cached or failed["Icon:" .. key] then
		return cached
	end
	failed["Icon:" .. key] = true

	local module = getModule("ProductIcons", key)
	if module == nil then
		return nil
	end
	local ok, result = pcall(function(): EditableImage
		local data = require(module) :: any
		if data.Format ~= FORMAT_VERSION then
			error("unsupported data format " .. tostring(data.Format))
		end
		return createImage(data.Size, decode(data.Pixels))
	end)
	if not ok then
		warnOnce(string.format("Could not build the %s icon (%s).", key, tostring(result)))
		return nil
	end
	failed["Icon:" .. key] = nil
	iconCache[key] = result
	return result
end

return table.freeze(AssetLoader)

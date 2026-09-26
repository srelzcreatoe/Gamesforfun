--!strict
--[[
	AssetLoader (client)

	Rebuilds the blocky brainrot models (a body and its legs, so they can walk)
	and the icons that tools/build_assets.py packed into ReplicatedStorage.Assets,
	using EditableMesh and EditableImage. This avoids uploading any assets to a
	Roblox account first.

	Editable meshes and images only exist on the machine that creates them, so
	each client builds its own copy. Every function returns nil when the data or
	the Editable APIs aren't available, and callers keep their simple fallback.

	Speed: each brainrot's meshes are built once, a few milliseconds per frame
	so the game never freezes, and turned into template MeshParts. Every
	brainrot after that is a clone of the templates, which is instant.
	preloadBrainrot builds models in the background before they are needed;
	models someone is waiting for go first.
]]

local AssetService = game:GetService("AssetService")
local EncodingService = game:GetService("EncodingService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local MESH_FORMAT = 3
local ICON_FORMAT = 1
local QUAD_BYTES = 7
-- CreateMeshPartAsync calls running at once, and tries per mesh part.
local MAX_CONCURRENT_PARTS = 4
local PART_ATTEMPTS = 4
-- Building meshes stops for the next frame after this long.
local BUILD_SLICE_SECONDS = 0.004
-- A model that failed to build is tried again after this long.
local RETRY_SECONDS = 20

-- One mesh of a brainrot: its body or one leg. Sizes and positions are for a
-- model 1 stud tall, relative to the model's centre.
export type Piece = {
	Kind: string,
	Mesh: EditableMesh,
	ColorIds: { number },
	Size: Vector3,
	Offset: Vector3,
	-- Legs swing about their hip; legs with different phases step in turn.
	Pivot: Vector3,
	Phase: number,
}

export type BrainrotAsset = {
	Pieces: { Piece },
	-- One MeshPart per piece; brainrots are clones of these.
	Templates: { MeshPart },
	-- Bounding box of the whole model when it is 1 stud tall.
	Size: Vector3,
	HasLegs: boolean,
	-- Untinted palette colours (for Rainbow).
	BaseColors: { Color3 },
}

-- A MeshPart built for one piece, `height` studs tall overall.
export type BuiltPiece = {
	Part: MeshPart,
	Piece: Piece,
	-- Rest position relative to the model's centre, in studs.
	Offset: Vector3,
	Pivot: Vector3,
}

local AssetLoader = {}

local brainrotCache: { [string]: BrainrotAsset } = {}
local iconCache: { [string]: EditableImage } = {}
-- Names that were already tried and failed, so they aren't rebuilt every
-- time: brainrots until a retry time, icons for good.
local failed: { [string]: boolean } = {}
local brainrotRetryAt: { [string]: number } = {}
-- Brainrot models being built right now.
local building: { [string]: boolean } = {}
-- Only one model is built at a time; requests someone is waiting for go
-- before background preloading.
local buildBusy = false
local urgentWaiting = 0
local sliceStart = os.clock()
local warnings = 0
local partsInFlight = 0

local function warnLimited(message: string)
	-- A few warnings help find the cause; after that they'd only spam Output.
	if warnings < 5 then
		warnings += 1
		warn("[AssetLoader] " .. message .. " Falling back to simple figures and icons where needed.")
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
	Bloodrot = { Dark = Color3.fromRGB(70, 0, 10), Light = Color3.fromRGB(255, 80, 90) },
	Galaxy = { Dark = Color3.fromRGB(35, 10, 90), Light = Color3.fromRGB(230, 150, 255) },
	Lava = { Dark = Color3.fromRGB(90, 20, 10), Light = Color3.fromRGB(255, 190, 60) },
	Frozen = { Dark = Color3.fromRGB(70, 150, 220), Light = Color3.fromRGB(235, 250, 255) },
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

type Quad = {
	Axis: number,
	Positive: number,
	Plane: number,
	U0: number,
	V0: number,
	U1: number,
	V1: number,
	Colour: number,
}

local function readQuads(encoded: string, quadCount: number): { Quad }
	local data = decode(encoded)
	if buffer.len(data) ~= quadCount * QUAD_BYTES then
		error("quad data does not match its header")
	end
	local quads: { Quad } = table.create(quadCount)
	for quad = 0, quadCount - 1 do
		local offset = quad * QUAD_BYTES
		local axisDirection = buffer.readu8(data, offset)
		local positive = axisDirection % 2
		local u0 = buffer.readu8(data, offset + 2)
		local v0 = buffer.readu8(data, offset + 3)
		quads[quad + 1] = {
			Axis = axisDirection // 2,
			Positive = positive,
			Plane = buffer.readu8(data, offset + 1) + positive,
			U0 = u0,
			V0 = v0,
			U1 = u0 + buffer.readu8(data, offset + 4),
			V1 = v0 + buffer.readu8(data, offset + 5),
			Colour = buffer.readu8(data, offset + 6),
		}
	end
	return quads
end

-- Corner of a quad in block units.
local function cornerOf(axis: number, plane: number, u: number, v: number): Vector3
	local corner = { 0, 0, 0 }
	corner[axis + 1] = plane
	corner[(axis + 1) % 3 + 1] = u
	corner[(axis + 2) % 3 + 1] = v
	return Vector3.new(corner[1], corner[2], corner[3])
end

local function quadBounds(quads: { Quad }): (Vector3, Vector3)
	local low = Vector3.new(math.huge, math.huge, math.huge)
	local high = -low
	for _, quad in quads do
		local a = cornerOf(quad.Axis, quad.Plane, quad.U0, quad.V0)
		local b = cornerOf(quad.Axis, quad.Plane, quad.U1, quad.V1)
		low = low:Min(a):Min(b)
		high = high:Max(a):Max(b)
	end
	return low, high
end

-- Builds one piece's mesh with its vertices centred on the piece, so the
-- MeshPart's origin is the middle of the piece.
local function buildMesh(quads: { Quad }, centre: Vector3, scale: number, colours: { Color3 }): (EditableMesh, { number })
	local mesh = AssetService:CreateEditableMesh()
	if mesh == nil then
		error("the editable memory budget is exhausted")
	end

	local colorIds: { number } = {}
	for index, colour in colours do
		colorIds[index] = mesh:AddColor(colour, 1)
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
	local function vertex(corner: Vector3): number
		local key = (corner.X * 256 + corner.Y) * 256 + corner.Z
		local id = vertexIds[key]
		if id == nil then
			id = mesh:AddVertex((corner - centre) * scale)
			vertexIds[key] = id
		end
		return id
	end

	for index, quad in quads do
		if index % 64 == 0 and os.clock() - sliceStart > BUILD_SLICE_SECONDS then
			task.wait()
			sliceStart = os.clock()
		end
		local axis, plane = quad.Axis, quad.Plane
		-- Counter-clockwise seen from outside the block.
		local a = vertex(cornerOf(axis, plane, quad.U0, quad.V0))
		local b = vertex(cornerOf(axis, plane, quad.U1, quad.V0))
		local c = vertex(cornerOf(axis, plane, quad.U1, quad.V1))
		local d = vertex(cornerOf(axis, plane, quad.U0, quad.V1))
		if quad.Positive == 0 then
			a, b, c, d = d, c, b, a
		end
		local normalId = normalIds[axis * 2 + quad.Positive + 1]
		local colorId = colorIds[quad.Colour + 1]
		for _, face in { mesh:AddTriangle(a, b, c), mesh:AddTriangle(a, c, d) } do
			mesh:SetFaceNormals(face, { normalId, normalId, normalId })
			mesh:SetFaceColors(face, { colorId, colorId, colorId })
		end
	end
	return mesh, colorIds
end

local function createBlockyAsset(data: { [string]: any }, mutation: string?): BrainrotAsset
	local baseColors: { Color3 } = {}
	local tinted: { Color3 } = {}
	for index, hex in data.Palette do
		local base = Color3.fromRGB(bit32.rshift(hex, 16), bit32.band(bit32.rshift(hex, 8), 255), bit32.band(hex, 255))
		baseColors[index] = base
		tinted[index] = tint(base, mutation)
	end

	local partData: { { [string]: any } } = data.Parts
	local partQuads: { { Quad } } = {}
	local low = Vector3.new(math.huge, math.huge, math.huge)
	local high = -low
	for index, part in partData do
		local quads = readQuads(part.Quads, part.QuadCount)
		partQuads[index] = quads
		local partLow, partHigh = quadBounds(quads)
		low = low:Min(partLow)
		high = high:Max(partHigh)
	end
	local modelSize = high - low
	if modelSize.Y <= 0 then
		error("the model is empty")
	end
	local modelCentre = (low + high) / 2
	local scale = 1 / modelSize.Y

	local pieces: { Piece } = {}
	local created: { EditableMesh } = {}
	local ok, err = pcall(function()
		for index, part in partData do
			local partLow, partHigh = quadBounds(partQuads[index])
			local centre = (partLow + partHigh) / 2
			local mesh, colorIds = buildMesh(partQuads[index], centre, scale, tinted)
			table.insert(created, mesh)
			local pivot = part.Pivot
			table.insert(pieces, {
				Kind = if part.Kind == "Leg" then "Leg" else "Body",
				Mesh = mesh,
				ColorIds = colorIds,
				Size = (partHigh - partLow) * scale,
				Offset = (centre - modelCentre) * scale,
				Pivot = if typeof(pivot) == "table"
					then (Vector3.new(pivot[1], pivot[2], pivot[3]) - modelCentre) * scale
					else Vector3.zero,
				Phase = if part.Phase == 1 then 1 else 0,
			})
		end
	end)
	if not ok then
		for _, mesh in created do
			mesh:Destroy()
		end
		error(err, 0)
	end

	local hasLegs = false
	for _, piece in pieces do
		hasLegs = hasLegs or piece.Kind == "Leg"
	end
	return {
		Pieces = pieces,
		Templates = {},
		Size = modelSize * scale,
		HasLegs = hasLegs,
		BaseColors = baseColors,
	}
end

-- CreateMeshPartAsync can fail when many parts are made at once (for example
-- when a player joins a full server), so only a few run at a time and each is
-- retried with a growing delay.
local function createMeshPart(mesh: EditableMesh): MeshPart
	local lastError: any = nil
	for attempt = 1, PART_ATTEMPTS do
		while partsInFlight >= MAX_CONCURRENT_PARTS do
			task.wait()
		end
		partsInFlight += 1
		local ok, result = pcall(function(): MeshPart
			return AssetService:CreateMeshPartAsync(Content.fromObject(mesh), {
				CollisionFidelity = Enum.CollisionFidelity.Box,
			})
		end)
		partsInFlight -= 1
		if ok then
			return result
		end
		lastError = result
		if attempt < PART_ATTEMPTS then
			task.wait(0.5 * 2 ^ (attempt - 1))
		end
	end
	error(lastError, 0)
end

local function acquireBuild(urgent: boolean)
	if urgent then
		urgentWaiting += 1
	end
	while buildBusy or (not urgent and urgentWaiting > 0) do
		task.wait()
	end
	if urgent then
		urgentWaiting -= 1
	end
	buildBusy = true
	sliceStart = os.clock()
end

local function releaseBuild()
	buildBusy = false
end

local function buildAsset(brainrotId: string, mutation: string?): BrainrotAsset
	local module = getModule("Brainrots", brainrotId)
	if module == nil then
		error("no model data")
	end
	local data = require(module) :: any
	if data.Format ~= MESH_FORMAT then
		error("unsupported data format " .. tostring(data.Format))
	end
	local asset = createBlockyAsset(data, mutation)
	local ok, err = pcall(function()
		for _, piece in asset.Pieces do
			local template = createMeshPart(piece.Mesh)
			-- White so the vertex colours show unchanged.
			template.Color = Color3.new(1, 1, 1)
			template.Material = Enum.Material.SmoothPlastic
			template.Name = if piece.Kind == "Leg" then "Leg" else "Body"
			table.insert(asset.Templates, template)
		end
	end)
	if not ok then
		for _, template in asset.Templates do
			template:Destroy()
		end
		for _, piece in asset.Pieces do
			piece.Mesh:Destroy()
		end
		error(err, 0)
	end
	return asset
end

-- Returns a brainrot's shared meshes and template parts for a mutation,
-- building them on first use. Yields while building. `urgent` is for a model
-- someone is waiting to see; background preloading passes false.
function AssetLoader.getBrainrot(brainrotId: string, mutation: string?, urgent: boolean?): BrainrotAsset?
	local key = brainrotId .. "|" .. (mutation or "")
	while building[key] do
		task.wait()
	end
	local cached = brainrotCache[key]
	if cached then
		return cached
	end
	if os.clock() < (brainrotRetryAt[key] or 0) then
		return nil
	end

	building[key] = true
	acquireBuild(urgent ~= false)
	local ok, result = pcall(buildAsset, brainrotId, mutation)
	releaseBuild()
	building[key] = nil
	if not ok then
		brainrotRetryAt[key] = os.clock() + RETRY_SECONDS
		warnLimited(string.format("Could not build the %s model (%s).", brainrotId, tostring(result)))
		return nil
	end
	brainrotRetryAt[key] = nil
	brainrotCache[key] = result
	return result
end

-- Builds a brainrot's plain model in the background, so it shows instantly
-- when it's needed. Yields.
function AssetLoader.preloadBrainrot(brainrotId: string)
	AssetLoader.getBrainrot(brainrotId, nil, false)
end

function AssetLoader.isLoaded(brainrotId: string, mutation: string?): boolean
	return brainrotCache[brainrotId .. "|" .. (mutation or "")] ~= nil
end

-- A copy of a template part. Clones share the template's EditableMesh; if
-- this device doesn't carry the mesh over, a new part is made from it.
local function copyTemplate(template: MeshPart, mesh: EditableMesh): MeshPart
	local ok, clone = pcall(function(): MeshPart?
		local copy = template:Clone()
		local content = (copy :: any).MeshContent
		if content == nil or content.Object == nil then
			copy:Destroy()
			return nil
		end
		return copy
	end)
	if ok and clone then
		return clone
	end
	local part = createMeshPart(mesh)
	part.Color = template.Color
	part.Material = template.Material
	part.Name = template.Name
	return part
end

-- Creates the brainrot's MeshParts (body and legs), `height` studs tall,
-- unparented and unpositioned. Yields until the model is built (instant once
-- it is). Returns nil if it can't be built.
function AssetLoader.createBrainrotParts(brainrotId: string, mutation: string?, height: number): ({ BuiltPiece }?, BrainrotAsset?)
	local asset = AssetLoader.getBrainrot(brainrotId, mutation, true)
	if asset == nil then
		return nil, nil
	end
	local built: { BuiltPiece } = {}
	local ok, err = pcall(function()
		for index, piece in asset.Pieces do
			local part = copyTemplate(asset.Templates[index], piece.Mesh)
			part.Size = piece.Size * height
			table.insert(built, {
				Part = part,
				Piece = piece,
				Offset = piece.Offset * height,
				Pivot = piece.Pivot * height,
			})
		end
	end)
	if not ok then
		for _, entry in built do
			entry.Part:Destroy()
		end
		warnLimited(string.format("Could not create the %s mesh parts (%s).", brainrotId, tostring(err)))
		return nil, nil
	end
	return built, asset
end

-- An anchored Model of the brainrot standing still, centred on its pivot, for
-- previews. Yields.
function AssetLoader.createBrainrotModel(brainrotId: string, mutation: string?, height: number): Model?
	local built = AssetLoader.createBrainrotParts(brainrotId, mutation, height)
	if built == nil then
		return nil
	end
	local model = Instance.new("Model")
	model.Name = brainrotId
	for _, entry in built do
		entry.Part.Anchored = true
		entry.Part.CFrame = CFrame.new(entry.Offset)
		entry.Part.Parent = model
		if entry.Piece.Kind == "Body" then
			model.PrimaryPart = entry.Part
		end
	end
	model.WorldPivot = CFrame.identity
	return model
end

-- Recolours a Rainbow brainrot; every MeshPart that shares it updates at once.
function AssetLoader.animateRainbow(asset: BrainrotAsset, t: number)
	for _, piece in asset.Pieces do
		for index, colorId in piece.ColorIds do
			piece.Mesh:SetColor(colorId, AssetLoader.rainbowColor(asset.BaseColors[index], index, t))
		end
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
		warnLimited(string.format("Could not build the %s icon (%s).", key, tostring(result)))
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

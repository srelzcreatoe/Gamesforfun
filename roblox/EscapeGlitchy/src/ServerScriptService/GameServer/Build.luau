-- Small helpers for building things out of parts. Used by the lobby and the
-- chapter builder.

local Build = {}

function Build.Part(
	parent: Instance,
	name: string,
	size: Vector3,
	placement: CFrame | Vector3,
	color: Color3?,
	material: Enum.Material?
): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Anchored = true
	part.Size = size
	part.CFrame = if typeof(placement) == "Vector3" then CFrame.new(placement) else placement
	part.Color = color or Color3.fromRGB(200, 200, 200)
	part.Material = material or Enum.Material.SmoothPlastic
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Parent = parent
	return part
end

-- An invisible part that only marks a position (spawns, waypoints, ...).
function Build.Marker(parent: Instance, name: string, position: Vector3): Part
	local part = Build.Part(parent, name, Vector3.new(1, 1, 1), position)
	part.Transparency = 1
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	return part
end

function Build.Folder(parent: Instance, name: string): Folder
	local folder = Instance.new("Folder")
	folder.Name = name
	folder.Parent = parent
	return folder
end

function Build.Model(parent: Instance?, name: string): Model
	local model = Instance.new("Model")
	model.Name = name
	model.Parent = parent
	return model
end

function Build.Light(part: BasePart, range: number, brightness: number, color: Color3?): PointLight
	local light = Instance.new("PointLight")
	light.Range = range
	light.Brightness = brightness
	light.Color = color or Color3.fromRGB(255, 220, 180)
	light.Parent = part
	return light
end

-- Text on one face of a part.
function Build.Label(
	part: BasePart,
	face: Enum.NormalId,
	text: string,
	options: { Color: Color3?, Font: Enum.Font?, Background: Color3?, PixelsPerStud: number? }?
): TextLabel
	local opts = options or {}
	local surface = Instance.new("SurfaceGui")
	surface.Face = face
	surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	surface.PixelsPerStud = opts.PixelsPerStud or 40
	surface.Parent = part
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundColor3 = opts.Background or Color3.new(0, 0, 0)
	label.BackgroundTransparency = if opts.Background then 0 else 1
	label.Font = opts.Font or Enum.Font.GothamBold
	label.TextColor3 = opts.Color or Color3.new(1, 1, 1)
	label.TextScaled = true
	label.TextWrapped = true
	label.Text = text
	label.Parent = surface
	return label
end

return Build

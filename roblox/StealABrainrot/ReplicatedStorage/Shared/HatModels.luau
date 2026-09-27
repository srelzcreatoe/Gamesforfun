--!strict
--[[
	HatModels (client)

	Builds each hat in ExtrasConfig.Hats out of blocks, in the same chunky
	style as the brainrots: a Model `width` studs across, sitting on the
	origin (its base at y = 0) and facing -Z. BrainrotVisuals puts them on
	top of brainrots; the menus show them in ViewportFrames.
]]

local HatModels = {}

local rgb = Color3.fromRGB

local function block(model: Model, name: string, size: Vector3, position: Vector3, color: Color3, material: Enum.Material?, shape: Enum.PartType?): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Size = size
	part.CFrame = CFrame.new(position)
	part.Color = color
	part.Material = material or Enum.Material.SmoothPlastic
	part.Shape = shape or Enum.PartType.Block
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Massless = true
	part.CastShadow = false
	part.Parent = model
	return part
end

-- Each builder works in "hat units": 1 = the hat's width.
local BUILDERS: { [string]: (model: Model, s: number) -> () } = {}

BUILDERS.PartyHat = function(model: Model, s: number)
	local colours = { rgb(255, 80, 170), rgb(255, 220, 60), rgb(70, 190, 255), rgb(120, 230, 110) }
	local y = 0
	for index, width in { 0.8, 0.62, 0.44, 0.28 } do
		local height = 0.24 * s
		block(model, "Layer" .. index, Vector3.new(width * s, height, width * s), Vector3.new(0, y + height / 2, 0), colours[index])
		y += height
	end
	block(model, "PomPom", Vector3.one * 0.2 * s, Vector3.new(0, y + 0.08 * s, 0), rgb(255, 255, 255))
end

BUILDERS.ChefHat = function(model: Model, s: number)
	local white = rgb(248, 248, 250)
	block(model, "Band", Vector3.new(0.7 * s, 0.28 * s, 0.7 * s), Vector3.new(0, 0.14 * s, 0), rgb(232, 232, 238))
	block(model, "Puff", Vector3.new(0.95 * s, 0.42 * s, 0.95 * s), Vector3.new(0, 0.49 * s, 0), white)
	block(model, "PuffTop", Vector3.new(0.7 * s, 0.18 * s, 0.7 * s), Vector3.new(0, 0.79 * s, 0), white)
end

BUILDERS.CowboyHat = function(model: Model, s: number)
	local brown, dark = rgb(170, 110, 60), rgb(110, 68, 34)
	block(model, "Brim", Vector3.new(1.3 * s, 0.08 * s, 1.1 * s), Vector3.new(0, 0.04 * s, 0), brown)
	block(model, "BrimLeft", Vector3.new(0.14 * s, 0.14 * s, 1.1 * s), Vector3.new(-0.62 * s, 0.1 * s, 0), brown)
	block(model, "BrimRight", Vector3.new(0.14 * s, 0.14 * s, 1.1 * s), Vector3.new(0.62 * s, 0.1 * s, 0), brown)
	block(model, "Crown", Vector3.new(0.66 * s, 0.4 * s, 0.6 * s), Vector3.new(0, 0.28 * s, 0), brown)
	block(model, "Dent", Vector3.new(0.2 * s, 0.06 * s, 0.4 * s), Vector3.new(0, 0.49 * s, 0), dark)
	block(model, "Band", Vector3.new(0.68 * s, 0.08 * s, 0.62 * s), Vector3.new(0, 0.14 * s, 0), dark)
end

BUILDERS.TopHat = function(model: Model, s: number)
	local black = rgb(28, 28, 32)
	block(model, "Brim", Vector3.new(1.05 * s, 0.07 * s, 1.05 * s), Vector3.new(0, 0.035 * s, 0), black)
	block(model, "Tube", Vector3.new(0.66 * s, 0.78 * s, 0.66 * s), Vector3.new(0, 0.46 * s, 0), black)
	block(model, "Band", Vector3.new(0.68 * s, 0.13 * s, 0.68 * s), Vector3.new(0, 0.16 * s, 0), rgb(200, 30, 45))
end

BUILDERS.VikingHelmet = function(model: Model, s: number)
	local steel, dark, horn = rgb(190, 195, 205), rgb(120, 125, 135), rgb(245, 235, 205)
	block(model, "Rim", Vector3.new(0.9 * s, 0.14 * s, 0.9 * s), Vector3.new(0, 0.07 * s, 0), dark)
	block(model, "Dome", Vector3.new(0.8 * s, 0.3 * s, 0.8 * s), Vector3.new(0, 0.29 * s, 0), steel, Enum.Material.Metal)
	block(model, "DomeTop", Vector3.new(0.5 * s, 0.14 * s, 0.5 * s), Vector3.new(0, 0.51 * s, 0), steel, Enum.Material.Metal)
	block(model, "Ridge", Vector3.new(0.1 * s, 0.1 * s, 0.84 * s), Vector3.new(0, 0.6 * s, 0), dark, Enum.Material.Metal)
	for _, side in { -1, 1 } do
		block(model, "HornBase", Vector3.new(0.18 * s, 0.18 * s, 0.18 * s), Vector3.new(side * 0.48 * s, 0.3 * s, 0), horn)
		block(model, "HornMid", Vector3.new(0.14 * s, 0.22 * s, 0.14 * s), Vector3.new(side * 0.6 * s, 0.46 * s, 0), horn)
		block(model, "HornTip", Vector3.new(0.1 * s, 0.18 * s, 0.1 * s), Vector3.new(side * 0.66 * s, 0.64 * s, 0), horn)
	end
end

BUILDERS.WizardHat = function(model: Model, s: number)
	local purple, dark = rgb(100, 60, 210), rgb(70, 40, 150)
	block(model, "Brim", Vector3.new(1.15 * s, 0.07 * s, 1.15 * s), Vector3.new(0, 0.035 * s, 0), dark)
	local y = 0.07 * s
	for index, width in { 0.7, 0.54, 0.4, 0.28, 0.18 } do
		local height = 0.24 * s
		block(model, "Cone" .. index, Vector3.new(width * s, height, width * s), Vector3.new(0.03 * index * s, y + height / 2, 0), purple)
		y += height
	end
	block(model, "Star", Vector3.new(0.18 * s, 0.18 * s, 0.05 * s), Vector3.new(0, 0.5 * s, -0.3 * s), rgb(255, 225, 80), Enum.Material.Neon)
end

BUILDERS.Halo = function(model: Model, s: number)
	local gold = rgb(255, 232, 120)
	local radius = 0.42 * s
	for index = 1, 12 do
		local angle = (index - 1) / 12 * math.pi * 2
		local part = block(model, "Ring" .. index, Vector3.new(0.24 * s, 0.07 * s, 0.1 * s), Vector3.new(math.cos(angle) * radius, 0.4 * s, math.sin(angle) * radius), gold, Enum.Material.Neon)
		part.CFrame = CFrame.new(part.Position) * CFrame.Angles(0, -angle + math.pi / 2, 0)
	end
	local light = Instance.new("PointLight")
	light.Color = gold
	light.Brightness = 1.2
	light.Range = 6
	light.Parent = model:FindFirstChild("Ring1")
end

BUILDERS.Crown = function(model: Model, s: number)
	local gold, dark = rgb(255, 205, 50), rgb(210, 150, 20)
	block(model, "Band", Vector3.new(0.8 * s, 0.22 * s, 0.8 * s), Vector3.new(0, 0.11 * s, 0), gold, Enum.Material.Metal)
	block(model, "BandTrim", Vector3.new(0.84 * s, 0.06 * s, 0.84 * s), Vector3.new(0, 0.03 * s, 0), dark, Enum.Material.Metal)
	for _, offset in { Vector3.new(-0.3, 0, -0.3), Vector3.new(0.3, 0, -0.3), Vector3.new(-0.3, 0, 0.3), Vector3.new(0.3, 0, 0.3), Vector3.new(0, 0, -0.34) } do
		block(model, "Spike", Vector3.new(0.16 * s, 0.26 * s, 0.16 * s), Vector3.new(offset.X * s, 0.34 * s, offset.Z * s), gold, Enum.Material.Metal)
		block(model, "SpikeTip", Vector3.new(0.08 * s, 0.1 * s, 0.08 * s), Vector3.new(offset.X * s, 0.52 * s, offset.Z * s), gold, Enum.Material.Metal)
	end
	block(model, "Gem", Vector3.new(0.16 * s, 0.14 * s, 0.05 * s), Vector3.new(0, 0.12 * s, -0.42 * s), rgb(230, 30, 60), Enum.Material.Neon)
	block(model, "GemLeft", Vector3.new(0.1 * s, 0.1 * s, 0.05 * s), Vector3.new(-0.24 * s, 0.12 * s, -0.42 * s), rgb(60, 140, 255), Enum.Material.Neon)
	block(model, "GemRight", Vector3.new(0.1 * s, 0.1 * s, 0.05 * s), Vector3.new(0.24 * s, 0.12 * s, -0.42 * s), rgb(60, 220, 110), Enum.Material.Neon)
end

-- A hat model `width` studs across, or nil for an unknown hat.
function HatModels.build(hatName: string, width: number): Model?
	local builder = BUILDERS[hatName]
	if builder == nil then
		return nil
	end
	local model = Instance.new("Model")
	model.Name = "Hat"
	builder(model, width)
	model.WorldPivot = CFrame.identity
	return model
end

return HatModels

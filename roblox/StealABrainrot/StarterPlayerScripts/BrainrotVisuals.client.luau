--!strict
--[[
	BrainrotVisuals
	Location: StarterPlayer.StarterPlayerScripts (LocalScript)

	On this client, swaps each brainrot's simple server-side block figure for its
	blocky Higgsfield model (rebuilt by AssetLoader), then:
	  * adds rarity effects: glow light, sparkles and a rising aura for the
	    rarest, a pulsing light for Mythic, and extra shine
	  * adds mutation effects: Gold and Diamond recolour the model and sparkle
	    in their colour, Rainbow cycles through every colour
	  * animates it: a waddle while walking the conveyor or to its pedestal, a
	    gentle bob and sway while idle, and a wriggle while being carried

	If a model can't be built, the block figure simply stays visible. Nothing
	here affects gameplay; it is all local to this client.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local AssetLoader = require(Shared:WaitForChild("AssetLoader"))
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))

local MODEL_NAME = "HiggsfieldModel"
local ANIMATION_DISTANCE = 220
local RAINBOW_INTERVAL = 1 / 15

type RarityEffect = {
	Light: number,
	Range: number,
	Sparkles: number,
	Aura: boolean,
	Pulse: boolean,
	Reflectance: number,
}

type Visual = {
	Model: Model,
	Root: BasePart,
	Part: MeshPart,
	Weld: Weld,
	Height: number,
	Phase: number,
	Light: PointLight?,
	BaseBrightness: number,
	Pulse: boolean,
	Rainbow: boolean,
}

local RARITY_EFFECTS: { [string]: RarityEffect } = {
	Common = { Light = 0, Range = 0, Sparkles = 0, Aura = false, Pulse = false, Reflectance = 0 },
	Rare = { Light = 0.8, Range = 8, Sparkles = 2, Aura = false, Pulse = false, Reflectance = 0.02 },
	Epic = { Light = 1.3, Range = 10, Sparkles = 4, Aura = false, Pulse = false, Reflectance = 0.05 },
	Legendary = { Light = 2, Range = 13, Sparkles = 7, Aura = true, Pulse = false, Reflectance = 0.1 },
	Mythic = { Light = 3, Range = 16, Sparkles = 11, Aura = true, Pulse = true, Reflectance = 0.14 },
}

local MUTATION_REFLECTANCE: { [string]: number } = {
	Gold = 0.22,
	Diamond = 0.3,
	Rainbow = 0.15,
}

local RAINBOW_SEQUENCE = ColorSequence.new({
	ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 70, 70)),
	ColorSequenceKeypoint.new(0.25, Color3.fromRGB(255, 220, 60)),
	ColorSequenceKeypoint.new(0.5, Color3.fromRGB(80, 255, 120)),
	ColorSequenceKeypoint.new(0.75, Color3.fromRGB(60, 170, 255)),
	ColorSequenceKeypoint.new(1, Color3.fromRGB(230, 90, 255)),
})

local map = Workspace:WaitForChild("Map")
local brainrotsFolder = map:WaitForChild("Brainrots")

local visuals: { [Model]: Visual } = {}
local rainbowAssets: { [AssetLoader.BrainrotAsset]: boolean } = {}

--------------------------------------------------------------------------------
-- Effects
--------------------------------------------------------------------------------

local function sparkles(part: BasePart, name: string, rate: number, colour: ColorSequence, size: number, rising: boolean)
	local emitter = Instance.new("ParticleEmitter")
	emitter.Name = name
	-- Default texture: Roblox's built-in sparkle, no upload needed.
	emitter.Rate = rate
	emitter.Color = colour
	emitter.LightEmission = 1
	emitter.LightInfluence = 0
	emitter.Lifetime = NumberRange.new(0.8, 1.6)
	emitter.Speed = if rising then NumberRange.new(1.5, 3) else NumberRange.new(0.3, 1.2)
	emitter.SpreadAngle = if rising then Vector2.new(25, 25) else Vector2.new(180, 180)
	emitter.EmissionDirection = Enum.NormalId.Top
	emitter.Acceleration = if rising then Vector3.new(0, 1.5, 0) else Vector3.zero
	emitter.RotSpeed = NumberRange.new(-90, 90)
	emitter.Size = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0),
		NumberSequenceKeypoint.new(0.3, size),
		NumberSequenceKeypoint.new(1, 0),
	})
	emitter.Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.1),
		NumberSequenceKeypoint.new(1, 0.8),
	})
	emitter.Parent = part
end

local function addEffects(visual: Visual, rarityName: string?, mutationName: string?)
	local part = visual.Part
	local effect = if rarityName then RARITY_EFFECTS[rarityName] else nil
	local rarity = if rarityName then BrainrotConfig.RarityByName[rarityName] else nil
	local mutation = if mutationName then BrainrotConfig.MutationByName[mutationName] else nil
	local scale = visual.Height / 5

	local glowColour = if mutation then mutation.Color elseif rarity then rarity.Color else Color3.new(1, 1, 1)
	local brightness = if effect then effect.Light else 0
	local range = if effect then effect.Range else 0
	if mutation then
		brightness = math.max(brightness, 1.6)
		range = math.max(range, 12)
	end

	part.Reflectance = math.max(
		if effect then effect.Reflectance else 0,
		if mutationName then MUTATION_REFLECTANCE[mutationName] or 0 else 0
	)

	if brightness > 0 then
		local light = Instance.new("PointLight")
		light.Name = "Glow"
		light.Color = glowColour
		light.Brightness = brightness
		light.Range = range * math.max(scale, 1)
		light.Shadows = false
		light.Parent = part
		visual.Light = light
		visual.BaseBrightness = brightness
	end

	if effect and effect.Sparkles > 0 and rarity then
		sparkles(part, "RaritySparkles", effect.Sparkles, ColorSequence.new(rarity.Color), 0.45 * scale, false)
	end
	if effect and effect.Aura and rarity then
		sparkles(part, "Aura", 6, ColorSequence.new(Color3.new(1, 1, 1), rarity.Color), 0.6 * scale, true)
	end
	visual.Pulse = effect ~= nil and effect.Pulse

	if mutation then
		local colours = if mutation.Name == "Rainbow" then RAINBOW_SEQUENCE else ColorSequence.new(mutation.Color, Color3.new(1, 1, 1))
		sparkles(part, "MutationSparkles", 10, colours, 0.55 * scale, false)
		sparkles(part, "MutationAura", 5, colours, 0.7 * scale, true)
	end
end

--------------------------------------------------------------------------------
-- Attaching models
--------------------------------------------------------------------------------

local function attachModel(instance: Instance)
	if not instance:IsA("Model") or instance:GetAttribute("CustomModel") == true then
		return
	end
	local brainrotId = instance:GetAttribute("BrainrotId")
	local height = instance:GetAttribute("FigureHeight")
	local mutationAttribute = instance:GetAttribute("Mutation")
	local rarityAttribute = instance:GetAttribute("Rarity")
	if typeof(brainrotId) ~= "string" or typeof(height) ~= "number" or instance:FindFirstChild(MODEL_NAME) then
		return
	end
	local mutation = if typeof(mutationAttribute) == "string" then mutationAttribute else nil
	local rarity = if typeof(rarityAttribute) == "string" then rarityAttribute else nil
	local root = instance:WaitForChild("Root", 10)
	if root == nil or not root:IsA("BasePart") then
		return
	end

	local part, asset = AssetLoader.createBrainrotPart(brainrotId, mutation, height)
	if part == nil or asset == nil then
		return
	end
	if instance.Parent == nil or root.Parent ~= instance then
		part:Destroy()
		return
	end

	part.Name = MODEL_NAME
	part.Anchored = false
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Massless = true

	-- A Weld (not WeldConstraint) so the animation can move the model via C0.
	local weld = Instance.new("Weld")
	weld.Part0 = root
	weld.Part1 = part
	weld.C0 = CFrame.new(0, height / 2, 0)
	weld.Parent = part

	local visual: Visual = {
		Model = instance,
		Root = root,
		Part = part,
		Weld = weld,
		Height = height,
		Phase = math.random() * math.pi * 2,
		Light = nil,
		BaseBrightness = 0,
		Pulse = false,
		Rainbow = mutation == "Rainbow",
	}
	addEffects(visual, rarity, mutation)
	part.Parent = instance

	-- Hide the block figure on this client only.
	for _, descendant in instance:GetDescendants() do
		if descendant:IsA("BasePart") and descendant ~= root and descendant ~= part then
			descendant.LocalTransparencyModifier = 1
		end
	end

	visuals[instance] = visual
	if visual.Rainbow then
		rainbowAssets[asset] = true
	end
	instance.Destroying:Connect(function()
		visuals[instance] = nil
	end)
end

brainrotsFolder.ChildAdded:Connect(function(child: Instance)
	task.spawn(attachModel, child)
end)
brainrotsFolder.ChildRemoved:Connect(function(child: Instance)
	if child:IsA("Model") then
		visuals[child] = nil
	end
end)
for _, child in brainrotsFolder:GetChildren() do
	task.spawn(attachModel, child)
end

--------------------------------------------------------------------------------
-- Animation
--------------------------------------------------------------------------------

-- Offset of the model from its Root (the brainrot's feet) for a state.
local function animationOffset(visual: Visual, state: any, t: number): CFrame
	local height = visual.Height
	local phase = t + visual.Phase
	local centre = CFrame.new(0, height / 2, 0)

	if state == "Conveyor" or state == "Walking" then
		-- Waddle: little hops while rocking side to side, pivoting at the feet.
		local step = phase * 9
		local hop = math.abs(math.sin(step)) * 0.08 * height
		local rock = math.sin(step) * math.rad(9)
		return CFrame.new(0, hop, 0) * CFrame.Angles(0, 0, rock) * centre
	elseif state == "Carried" then
		local wiggle = phase * 12
		return centre * CFrame.Angles(math.sin(wiggle) * math.rad(10), 0, math.cos(wiggle * 0.7) * math.rad(14))
	end

	-- Idle: gentle bob and sway, with a small hop every few seconds.
	local bob = (math.sin(phase * 2) * 0.5 + 0.5) * 0.05 * height
	local cycle = (phase * 0.5) % (math.pi * 2)
	local hop = if cycle < 0.6 then math.sin(cycle / 0.6 * math.pi) * 0.12 * height else 0
	local sway = math.sin(phase * 1.1) * math.rad(8)
	return CFrame.new(0, bob + hop, 0) * centre * CFrame.Angles(0, sway, math.sin(phase * 2) * math.rad(2))
end

local lastRainbowUpdate = 0

RunService.RenderStepped:Connect(function()
	local t = os.clock()
	local camera = Workspace.CurrentCamera
	local cameraPosition = if camera then camera.CFrame.Position else Vector3.zero

	for model, visual in visuals do
		if model.Parent == nil then
			visuals[model] = nil
			continue
		end
		if (visual.Root.Position - cameraPosition).Magnitude > ANIMATION_DISTANCE then
			continue
		end
		visual.Weld.C0 = animationOffset(visual, model:GetAttribute("State"), t)

		local light = visual.Light
		if light then
			if visual.Pulse then
				light.Brightness = visual.BaseBrightness * (0.7 + 0.3 * math.sin(t * 4 + visual.Phase))
			end
			if visual.Rainbow then
				light.Color = Color3.fromHSV((t * 0.25) % 1, 0.8, 1)
			end
		end
	end

	if t - lastRainbowUpdate >= RAINBOW_INTERVAL and next(rainbowAssets) ~= nil then
		lastRainbowUpdate = t
		for asset in rainbowAssets do
			AssetLoader.animateRainbow(asset, t)
		end
	end
end)

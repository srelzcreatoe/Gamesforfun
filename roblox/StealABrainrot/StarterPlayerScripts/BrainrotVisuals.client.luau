--!strict
--[[
	BrainrotVisuals
	Location: StarterPlayer.StarterPlayerScripts (LocalScript)

	On this client, swaps each brainrot's simple server-side block figure for its
	blocky Higgsfield model (rebuilt by AssetLoader as a body plus legs), then:
	  * adds rarity effects: glow light, sparkles and a rising aura for the
	    rarest, a pulsing light for Mythic, and extra shine
	  * adds mutation effects: Gold and Diamond recolour the model and sparkle
	    in their colour, Rainbow cycles through every colour
	  * animates it: a real walk (legs stepping in turn, body bobbing and
	    leaning) matched to how fast it moves, a gentle bob and sway while idle,
	    and a wriggle while being carried. Models without two legs pirouette.

	If a model can't be built, the block figure simply stays visible. When a
	brainrot streams out and back in, its model is rebuilt. Nothing here affects
	gameplay; it is all local to this client.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local AssetLoader = require(Shared:WaitForChild("AssetLoader"))
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))

local PIECE_ATTRIBUTE = "HiggsfieldPiece"
local ANIMATION_DISTANCE = 220
local RAINBOW_INTERVAL = 1 / 15
-- Walk cycle
local LEG_SWING = math.rad(32)
local WALK_LEAN = math.rad(5)
local WALK_ROLL = math.rad(5)
local MIN_WALK_SPEED = 0.4

type RarityEffect = {
	Light: number,
	Range: number,
	Sparkles: number,
	Aura: boolean,
	Pulse: boolean,
	Reflectance: number,
}

type PieceVisual = {
	Part: MeshPart,
	Weld: Weld,
	IsLeg: boolean,
	Offset: Vector3,
	Pivot: Vector3,
	-- +1 or -1: which way this leg swings on the first step.
	Direction: number,
}

type Visual = {
	Model: Model,
	Root: BasePart,
	Body: MeshPart,
	Pieces: { PieceVisual },
	HasLegs: boolean,
	Height: number,
	Phase: number,
	Light: PointLight?,
	BaseBrightness: number,
	Pulse: boolean,
	Rainbow: boolean,
	LastPosition: Vector3,
	Speed: number,
	Stride: number,
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
local attaching: { [Model]: boolean } = {}
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
	local part = visual.Body
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

	local reflectance = math.max(
		if effect then effect.Reflectance else 0,
		if mutationName then MUTATION_REFLECTANCE[mutationName] or 0 else 0
	)
	for _, piece in visual.Pieces do
		piece.Part.Reflectance = reflectance
	end

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

local function isOwnPiece(instance: Instance): boolean
	return instance:GetAttribute(PIECE_ATTRIBUTE) == true
end

-- Hides a part of the server's block figure on this client only.
local function hideFallback(visual: Visual, instance: Instance)
	if instance:IsA("BasePart") and instance ~= visual.Root and not isOwnPiece(instance) then
		instance.LocalTransparencyModifier = 1
	end
end

local function detach(instance: Model)
	local visual = visuals[instance]
	if visual == nil then
		return
	end
	visuals[instance] = nil
	for _, piece in visual.Pieces do
		piece.Part:Destroy()
	end
end

local function attachModel(instance: Instance)
	if not instance:IsA("Model") or instance:GetAttribute("CustomModel") == true or attaching[instance] then
		return
	end
	local brainrotId = instance:GetAttribute("BrainrotId")
	local height = instance:GetAttribute("FigureHeight")
	local mutationAttribute = instance:GetAttribute("Mutation")
	local rarityAttribute = instance:GetAttribute("Rarity")
	if typeof(brainrotId) ~= "string" or typeof(height) ~= "number" then
		return
	end
	local root = instance:FindFirstChild("Root")
	local existing = visuals[instance]
	if existing and existing.Root == root and existing.Body.Parent ~= nil then
		return
	end
	detach(instance)

	attaching[instance] = true
	xpcall(function()
		local rootInstance = root or instance:WaitForChild("Root", 30)
		if rootInstance == nil or not rootInstance:IsA("BasePart") then
			return
		end
		local mutation = if typeof(mutationAttribute) == "string" then mutationAttribute else nil
		local rarity = if typeof(rarityAttribute) == "string" then rarityAttribute else nil

		local built, asset = AssetLoader.createBrainrotParts(brainrotId, mutation, height)
		if built == nil or asset == nil then
			return
		end
		if instance.Parent == nil or rootInstance.Parent ~= instance then
			for _, entry in built do
				entry.Part:Destroy()
			end
			return
		end

		local pieces: { PieceVisual } = {}
		local body: MeshPart? = nil
		local centre = CFrame.new(0, height / 2, 0)
		for _, entry in built do
			local part = entry.Part
			part:SetAttribute(PIECE_ATTRIBUTE, true)
			part.Anchored = false
			part.CanCollide = false
			part.CanQuery = false
			part.CanTouch = false
			part.Massless = true

			-- A Weld (not WeldConstraint) so the animation can move it via C0.
			local weld = Instance.new("Weld")
			weld.Part0 = rootInstance
			weld.Part1 = part
			weld.C0 = centre * CFrame.new(entry.Offset)
			weld.Parent = part

			local isLeg = entry.Piece.Kind == "Leg"
			table.insert(pieces, {
				Part = part,
				Weld = weld,
				IsLeg = isLeg,
				Offset = entry.Offset,
				Pivot = entry.Pivot,
				Direction = if entry.Piece.Phase == 1 then -1 else 1,
			})
			if not isLeg then
				body = part
			end
		end
		if body == nil then
			for _, entry in built do
				entry.Part:Destroy()
			end
			return
		end

		local visual: Visual = {
			Model = instance,
			Root = rootInstance,
			Body = body,
			Pieces = pieces,
			HasLegs = asset.HasLegs,
			Height = height,
			Phase = math.random() * math.pi * 2,
			Light = nil,
			BaseBrightness = 0,
			Pulse = false,
			Rainbow = mutation == "Rainbow",
			LastPosition = rootInstance.Position,
			Speed = 0,
			Stride = math.random() * math.pi * 2,
		}
		addEffects(visual, rarity, mutation)
		-- Parented under the Root, so they leave with it if it streams out.
		for _, piece in pieces do
			piece.Part.Parent = rootInstance
		end
		for _, descendant in instance:GetDescendants() do
			hideFallback(visual, descendant)
		end

		visuals[instance] = visual
		if visual.Rainbow then
			rainbowAssets[asset] = true
		end
	end, function(err: any)
		warn("[BrainrotVisuals] Could not attach a model: " .. tostring(err))
	end)
	attaching[instance] = nil
end

local function track(instance: Instance)
	if not instance:IsA("Model") then
		return
	end
	task.spawn(attachModel, instance)
	instance.ChildAdded:Connect(function(child: Instance)
		if child.Name == "Root" then
			-- The Root streamed back in: build the model again.
			task.spawn(attachModel, instance)
		end
	end)
	instance.DescendantAdded:Connect(function(descendant: Instance)
		local visual = visuals[instance]
		if visual then
			hideFallback(visual, descendant)
		end
	end)
	instance.ChildRemoved:Connect(function(child: Instance)
		local visual = visuals[instance]
		if visual and child == visual.Root then
			detach(instance)
		end
	end)
end

brainrotsFolder.ChildAdded:Connect(track)
brainrotsFolder.ChildRemoved:Connect(function(child: Instance)
	if child:IsA("Model") then
		detach(child)
	end
end)
for _, child in brainrotsFolder:GetChildren() do
	track(child)
end

--------------------------------------------------------------------------------
-- Animation
--------------------------------------------------------------------------------

-- How far each leg swings, and the whole model's offset from its Root (the
-- brainrot's feet), for the current state.
local function animate(visual: Visual, state: any, t: number, dt: number)
	local height = visual.Height
	local phase = t + visual.Phase
	local centre = CFrame.new(0, height / 2, 0)

	-- Walking speed from how far the Root moved, so the steps match the
	-- conveyor, the walk home and anything else that moves it.
	local position = visual.Root.Position
	local moved = position - visual.LastPosition
	visual.LastPosition = position
	local speed = if dt > 0 then Vector3.new(moved.X, 0, moved.Z).Magnitude / dt else 0
	if speed > 60 then
		speed = 0 -- teleported
	end
	visual.Speed += (speed - visual.Speed) * math.min(1, dt * 8)

	local swing = 0
	local modelOffset: CFrame
	if state == "Carried" then
		local wiggle = phase * 12
		swing = math.sin(phase * 16) * math.rad(35)
		modelOffset = centre * CFrame.Angles(math.sin(wiggle) * math.rad(10), 0, math.cos(wiggle * 0.7) * math.rad(14))
	elseif visual.Speed > MIN_WALK_SPEED then
		local blend = math.clamp(visual.Speed / 3, 0, 1)
		local stepsPerSecond = math.clamp(visual.Speed / (height * 1.1), 0.8, 2.4)
		visual.Stride += dt * stepsPerSecond * math.pi * 2
		local stride = visual.Stride
		if visual.HasLegs then
			-- Highest as the legs pass each other, leaning into the walk.
			swing = math.sin(stride) * LEG_SWING * blend
			local bob = (0.5 + 0.5 * math.cos(stride * 2)) * 0.05 * height * blend
			local roll = math.sin(stride) * WALK_ROLL * blend
			modelOffset = CFrame.new(0, bob, 0) * centre * CFrame.Angles(-WALK_LEAN * blend, 0, roll)
		else
			-- No legs to walk on: pirouette along with little hops.
			local hop = math.abs(math.sin(stride)) * 0.08 * height * blend
			modelOffset = CFrame.new(0, hop, 0) * centre * CFrame.Angles(0, stride * 0.5, 0)
		end
	else
		-- Idle: gentle bob and sway, with a small hop every few seconds.
		local bob = (math.sin(phase * 2) * 0.5 + 0.5) * 0.04 * height
		local cycle = (phase * 0.5) % (math.pi * 2)
		local hop = if cycle < 0.5 then math.sin(cycle / 0.5 * math.pi) * 0.06 * height else 0
		local sway = math.sin(phase * 1.1) * math.rad(8)
		modelOffset = CFrame.new(0, bob + hop, 0) * centre * CFrame.Angles(0, sway, math.sin(phase * 2) * math.rad(2))
	end

	for _, piece in visual.Pieces do
		if piece.IsLeg then
			piece.Weld.C0 = modelOffset
				* CFrame.new(piece.Pivot)
				* CFrame.Angles(swing * piece.Direction, 0, 0)
				* CFrame.new(piece.Offset - piece.Pivot)
		else
			piece.Weld.C0 = modelOffset * CFrame.new(piece.Offset)
		end
	end
end

local lastRainbowUpdate = 0
local lastFrame = os.clock()

RunService.RenderStepped:Connect(function()
	local t = os.clock()
	local dt = math.min(t - lastFrame, 0.1)
	lastFrame = t
	local camera = Workspace.CurrentCamera
	local cameraPosition = if camera then camera.CFrame.Position else Vector3.zero

	for model, visual in visuals do
		if model.Parent == nil or visual.Root.Parent ~= model then
			detach(model)
			continue
		end
		if (visual.Root.Position - cameraPosition).Magnitude > ANIMATION_DISTANCE then
			visual.LastPosition = visual.Root.Position
			continue
		end
		animate(visual, model:GetAttribute("State"), t, dt)

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

--!strict
--[[
	BrainrotVisuals
	Location: StarterPlayer.StarterPlayerScripts (LocalScript)

	Brainrots with an imported model (see GameplayManager's
	prepareImportedModels) arrive with their real meshes, jointed by Welds;
	this script animates them. For the others it swaps the server's simple
	block figure for the blocky model rebuilt by AssetLoader (a body plus legs).
	Then for both:
	  * adds rarity effects: glow light, sparkles and a rising aura for the
	    rarest, a pulsing light for Mythic, a rainbow glow for Brainrot Gods and
	    a dark aura with white sparks for Secrets, and extra shine
	  * adds mutation effects: each mutation recolours the model and sparkles
	    in its colour (Rainbow cycles through every colour, Lava smokes and
	    throws embers, Bloodrot drips, Frozen and Galaxy shimmer)
	  * adds trait effects: Fire burns, Glitched flickers and jumps about,
	    Nyan leaves a rainbow trail (Tiny and Giant are just their size)
	  * animates it: anything with two legs really walks (legs stepping in
	    turn, a small bob and lean) matched to how fast it moves; block-built
	    brainrots also swing their arms, flap their wings, wag their tails,
	    nod and look around, and spin their propellers and wheels; brainrots
	    without legs waddle side to side with each step; Fly hovers and banks
	    and Drive rolls along with little bumps. Idle brainrots bob and sway
	    (Spin ones twirl, Hop ones bounce a little), and carried ones wriggle.
	    Lucky blocks float and turn, hop home, and shake before they pop.
	  * a sparkle burst when a brainrot arrives out of nowhere (a gift, a
	    trade, a fuse or an opened lucky block)
	  * hats (the Hat attribute) on top of the head, and glowing blocks that
	    orbit every mutated brainrot
	  * guards, pets and bosses (State Guard, Pet, Boss) walk like any other;
	    a beaten boss (State Defeated) topples over

	Every model is built once in the background (a few milliseconds a frame)
	and each brainrot gets a copy, so they appear straight away. If a model
	can't be built, the block figure simply stays visible. When a brainrot
	streams out and back in, its model is attached again. Nothing here affects
	gameplay; it is all local to this client.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local AssetLoader = require(Shared:WaitForChild("AssetLoader"))
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))
local HatModels = require(Shared:WaitForChild("HatModels"))
local HatAnchors = require(Shared:WaitForChild("HatAnchors"))
local BrainrotFlair = require(Shared:WaitForChild("BrainrotFlair"))

local PIECE_ATTRIBUTE = "HiggsfieldPiece"
local ANIMATION_DISTANCE = 220
local RAINBOW_INTERVAL = 1 / 15
-- Walk cycle
local LEG_SWING = math.rad(30)
local WALK_LEAN = math.rad(4)
local WALK_ROLL = math.rad(3)
-- Up-and-down per step, as a fraction of the brainrot's height (kept small
-- so they don't bounce like balls).
local WALK_BOB = 0.022
-- Brainrots without legs waddle: a side-to-side rock with each step.
local WADDLE_ROLL = math.rad(9)
local WADDLE_TURN = math.rad(6)
local MIN_WALK_SPEED = 0.4
-- Arms swing a little less than legs; propellers turn this fast (radians a second).
local ARM_SWING = math.rad(26)
local PROP_SPIN = 16
-- Skaters pop a trick this often (seconds; slower when parked), in the air
-- this long and this high (share of their height).
local SKATE_TRICK_EVERY = 3.4
local SKATE_AIR_TIME = 0.8
local SKATE_POP = 0.28

type RarityEffect = {
	Light: number,
	Range: number,
	Sparkles: number,
	Aura: boolean,
	Pulse: boolean,
	Reflectance: number,
	-- Brainrot God: the glow cycles through the rainbow.
	RainbowLight: boolean?,
	-- Secret: dark smoke and white sparks.
	Dark: boolean?,
}

type PieceVisual = {
	Part: BasePart,
	Weld: Weld,
	-- "Body", "Leg", "Arm", "Wing", "Tail", "Head", "Prop", "Ear" or "Board".
	Kind: string,
	-- Rest pose relative to the Root (the brainrot's feet).
	Base: CFrame,
	-- What it moves about (a leg's hip, an arm's shoulder, ...), relative to the Root.
	Hip: Vector3,
	-- +1 or -1: which way it swings on the first step (wings: which side).
	Direction: number,
	-- A Prop spins about this axis.
	Axis: Vector3,
}

type Visual = {
	Model: Model,
	Root: BasePart,
	Body: BasePart,
	-- Imported models belong to the server; blocky ones were made here.
	Imported: boolean,
	-- Tints an imported model in its mutation's colour.
	Highlight: Highlight?,
	Pieces: { PieceVisual },
	HasLegs: boolean,
	Height: number,
	Phase: number,
	Light: PointLight?,
	BaseBrightness: number,
	Pulse: boolean,
	Rainbow: boolean,
	RainbowLight: boolean,
	Motion: string,
	LastPosition: Vector3,
	Speed: number,
	Stride: number,
	-- How far wheels and propellers have turned.
	Spin: number,
	-- A lucky block (floats and turns, shakes while opening).
	Block: boolean,
	-- The Glitched trait: flickers and jumps about.
	Glitch: boolean,
	-- Its hat, if it wears one.
	Hat: Model?,
	-- Glowing blocks circling a mutated brainrot.
	Orbiters: { BasePart },
	OrbitRadius: number,
	-- Glowing squares rising off the rarest brainrots (BrainrotFlair), each
	-- with a seed for where and when it rises, how far out they start and
	-- how big they are.
	Squares: { BasePart },
	SquareSeeds: { number },
	SquareSpread: number,
	SquareSize: number,
	-- When the current State began (for the boss falling over).
	StateSince: number,
	LastState: any,
}

local RARITY_EFFECTS: { [string]: RarityEffect } = {
	Common = { Light = 0, Range = 0, Sparkles = 0, Aura = false, Pulse = false, Reflectance = 0 },
	Rare = { Light = 0.4, Range = 6, Sparkles = 2, Aura = false, Pulse = false, Reflectance = 0.02 },
	Epic = { Light = 0.6, Range = 7, Sparkles = 4, Aura = false, Pulse = false, Reflectance = 0.05 },
	Legendary = { Light = 0.9, Range = 8, Sparkles = 7, Aura = true, Pulse = false, Reflectance = 0.1 },
	Mythic = { Light = 1.2, Range = 9, Sparkles = 11, Aura = true, Pulse = true, Reflectance = 0.14 },
	["Brainrot God"] = {
		Light = 1.4,
		Range = 10,
		Sparkles = 14,
		Aura = true,
		Pulse = true,
		Reflectance = 0.16,
		RainbowLight = true,
	},
	Secret = { Light = 1.3, Range = 10, Sparkles = 16, Aura = true, Pulse = true, Reflectance = 0.2, Dark = true },
	OG = { Light = 1.7, Range = 12, Sparkles = 20, Aura = true, Pulse = true, Reflectance = 0.25 },
}

local MUTATION_REFLECTANCE: { [string]: number } = {
	Gold = 0.22,
	Diamond = 0.3,
	Rainbow = 0.15,
	Bloodrot = 0.1,
	Galaxy = 0.2,
	Lava = 0.12,
	Frozen = 0.35,
	Taco = 0.1,
	Lucky = 0.18,
	Cash = 0.2,
	Storm = 0.25,
	Heist = 0.3,
	Boss = 0.12,
	Admin = 0.2,
}

-- How many glowing blocks circle a brainrot with each mutation.
local ORBITERS: { [string]: number } = {
	Gold = 3,
	Diamond = 4,
	Rainbow = 6,
	Bloodrot = 4,
	Galaxy = 6,
	Lava = 4,
	Frozen = 4,
	Taco = 5,
	Lucky = 5,
	Cash = 5,
	Storm = 6,
	Heist = 5,
	Boss = 6,
	Admin = 8,
}

local MUTATION_COLOURS: { [string]: ColorSequence } = {
	Galaxy = ColorSequence.new({
		ColorSequenceKeypoint.new(0, Color3.fromRGB(120, 60, 255)),
		ColorSequenceKeypoint.new(0.5, Color3.fromRGB(255, 120, 230)),
		ColorSequenceKeypoint.new(1, Color3.fromRGB(90, 200, 255)),
	}),
	Lava = ColorSequence.new(Color3.fromRGB(255, 220, 80), Color3.fromRGB(255, 60, 10)),
	Frozen = ColorSequence.new(Color3.new(1, 1, 1), Color3.fromRGB(140, 220, 255)),
	Bloodrot = ColorSequence.new(Color3.fromRGB(255, 60, 70), Color3.fromRGB(120, 0, 10)),
	Taco = ColorSequence.new({
		ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 210, 80)),
		ColorSequenceKeypoint.new(0.5, Color3.fromRGB(255, 90, 40)),
		ColorSequenceKeypoint.new(1, Color3.fromRGB(110, 210, 60)),
	}),
	Lucky = ColorSequence.new(Color3.fromRGB(120, 255, 150), Color3.fromRGB(20, 170, 70)),
	Cash = ColorSequence.new(Color3.fromRGB(190, 255, 110), Color3.fromRGB(255, 220, 70)),
	Storm = ColorSequence.new(Color3.new(1, 1, 1), Color3.fromRGB(80, 150, 255)),
	Heist = ColorSequence.new(Color3.fromRGB(255, 225, 90), Color3.fromRGB(60, 50, 20)),
	Boss = ColorSequence.new(Color3.fromRGB(255, 200, 60), Color3.fromRGB(255, 50, 20)),
	Admin = ColorSequence.new({
		ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 40, 70)),
		ColorSequenceKeypoint.new(0.5, Color3.new(1, 1, 1)),
		ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 40, 70)),
	}),
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
local MOTIONS: { [string]: boolean } = { Walk = true, Fly = true, Drive = true, Spin = true, Hop = true, Skate = true }
local attaching: { [Model]: boolean } = {}
local rainbowAssets: { [AssetLoader.BrainrotAsset]: boolean } = {}

--------------------------------------------------------------------------------
-- Effects
--------------------------------------------------------------------------------

local localPlayer = Players.LocalPlayer

-- Settings > Low graphics: no sparkles or auras.
local function lowGraphics(): boolean
	return localPlayer ~= nil and localPlayer:GetAttribute("LowGraphics") == true
end

local function sparkles(part: BasePart, name: string, rate: number, colour: ColorSequence, size: number, rising: boolean)
	if lowGraphics() then
		return
	end
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

local TRAIL_RAINBOW = ColorSequence.new({
	ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 60, 60)),
	ColorSequenceKeypoint.new(0.2, Color3.fromRGB(255, 160, 40)),
	ColorSequenceKeypoint.new(0.4, Color3.fromRGB(255, 240, 60)),
	ColorSequenceKeypoint.new(0.6, Color3.fromRGB(70, 230, 90)),
	ColorSequenceKeypoint.new(0.8, Color3.fromRGB(60, 150, 255)),
	ColorSequenceKeypoint.new(1, Color3.fromRGB(170, 80, 255)),
})

local function addTraitEffects(visual: Visual, traitName: string?)
	local part = visual.Body
	local scale = visual.Height / 5
	if traitName == "Fire" then
		local fire = Instance.new("Fire")
		fire.Name = "TraitFire"
		fire.Color = Color3.fromRGB(255, 110, 20)
		fire.SecondaryColor = Color3.fromRGB(255, 230, 80)
		fire.Heat = 7
		fire.Size = 3 * scale
		fire.Parent = part
		local glow = Instance.new("PointLight")
		glow.Name = "FireGlow"
		glow.Color = Color3.fromRGB(255, 140, 40)
		glow.Brightness = 0.9
		glow.Range = 8 * math.clamp(scale, 1, 1.5)
		glow.Parent = part
	elseif traitName == "Glitched" then
		visual.Glitch = true
		sparkles(part, "GlitchBits", 8, ColorSequence.new(Color3.fromRGB(60, 255, 240), Color3.fromRGB(255, 60, 220)), 0.35 * scale, false)
	elseif traitName == "Nyan" then
		local top = Instance.new("Attachment")
		top.Name = "TrailTop"
		top.Position = Vector3.new(0, 0.35 * visual.Height, 0)
		top.Parent = part
		local bottom = Instance.new("Attachment")
		bottom.Name = "TrailBottom"
		bottom.Position = Vector3.new(0, -0.1 * visual.Height, 0)
		bottom.Parent = part
		local trail = Instance.new("Trail")
		trail.Name = "NyanTrail"
		trail.Attachment0 = top
		trail.Attachment1 = bottom
		trail.Color = TRAIL_RAINBOW
		trail.LightEmission = 0.8
		trail.Lifetime = 0.7
		trail.MinLength = 0.05
		trail.FaceCamera = true
		trail.Transparency = NumberSequence.new(0.1, 1)
		trail.Parent = part
		sparkles(part, "NyanStars", 6, ColorSequence.new(Color3.new(1, 1, 1), Color3.fromRGB(255, 240, 120)), 0.4 * scale, false)
	end
end

-- A burst of sparkles when a brainrot pops into a base.
local function arrivalBurst(visual: Visual)
	local arrived = visual.Model:GetAttribute("Arrived")
	if typeof(arrived) ~= "number" or Workspace:GetServerTimeNow() - arrived > 4 then
		return
	end
	local emitter = Instance.new("ParticleEmitter")
	emitter.Name = "Arrival"
	emitter.Rate = 0
	emitter.Speed = NumberRange.new(6, 14)
	emitter.SpreadAngle = Vector2.new(180, 180)
	emitter.Lifetime = NumberRange.new(0.6, 1.2)
	emitter.LightEmission = 1
	emitter.Size = NumberSequence.new(0.5, 0)
	emitter.Color = RAINBOW_SEQUENCE
	emitter.Parent = visual.Body
	emitter:Emit(50)
	task.delay(2, function()
		emitter:Destroy()
	end)
end

-- Glowing blocks circling a mutated brainrot (moved every frame in animate).
local function addOrbiters(visual: Visual, mutation: BrainrotConfig.Mutation)
	if lowGraphics() then
		return
	end
	local count = ORBITERS[mutation.Name] or 3
	local size = math.clamp(visual.Height * 0.07, 0.2, 1.2)
	local width = visual.Body.Size.X
	visual.OrbitRadius = math.max(width * 0.55, visual.Height * 0.35) + size
	for index = 1, count do
		local cube = Instance.new("Part")
		cube.Name = "Orbiter"
		cube.Size = Vector3.one * size * (if index % 2 == 0 then 0.7 else 1)
		cube.Material = Enum.Material.Neon
		cube.Color = if mutation.Name == "Rainbow" then Color3.fromHSV(index / count, 0.8, 1) else mutation.Color
		cube.Anchored = true
		cube.CanCollide = false
		cube.CanQuery = false
		cube.CanTouch = false
		cube.CastShadow = false
		cube.Transparency = 0.1
		cube:SetAttribute(PIECE_ATTRIBUTE, true)
		cube.Parent = visual.Root
		table.insert(visual.Orbiters, cube)
	end
end

-- The hat goes on top of the head (HatAnchors, worked out from each
-- brainrot's shape by tools/build_hat_anchors.py) and moves with it.
local function attachHat(visual: Visual)
	local old = visual.Hat
	if old then
		old:Destroy()
		visual.Hat = nil
	end
	local hatName = visual.Model:GetAttribute("Hat")
	if typeof(hatName) ~= "string" then
		return
	end
	local brainrotId = visual.Model:GetAttribute("BrainrotId")
	local anchor = if typeof(brainrotId) == "string" then HatAnchors[brainrotId] else nil
	local target: BasePart = visual.Body
	for _, piece in visual.Pieces do
		if piece.Kind == (if anchor then anchor.Piece else "Head") and piece.Kind ~= "Body" then
			target = piece.Part
		end
	end
	-- (Without an anchor: the middle of the top of the head or body.)
	local width = if anchor
		then anchor.Width * visual.Height
		else math.clamp(math.min(target.Size.X, target.Size.Z) * 0.75, 0.6, visual.Height * 0.55)
	local hat = HatModels.build(hatName, width)
	if hat == nil then
		return
	end
	local size = target.Size
	local top = if anchor
		then CFrame.new(anchor.X * size.X, anchor.Y * size.Y - width * 0.06, anchor.Z * size.Z)
		else CFrame.new(0, size.Y / 2 - width * 0.06, 0)
	for _, part in hat:GetDescendants() do
		if part:IsA("BasePart") then
			local offset = part.CFrame
			part.Anchored = false
			part.Massless = true
			part:SetAttribute(PIECE_ATTRIBUTE, true)
			part.CFrame = target.CFrame * top * offset
			local weld = Instance.new("Weld")
			weld.Part0 = target
			weld.Part1 = part
			weld.C0 = top * offset
			weld.Parent = part
		end
	end
	hat.Parent = target
	visual.Hat = hat
end

-- The rarest brainrots' extra flash (BrainrotFlair): a shine, a coloured
-- glow, sparkles, a fire on the head and glowing squares rising off them.
local function addFlair(visual: Visual)
	local brainrotId = visual.Model:GetAttribute("BrainrotId")
	local flair = if typeof(brainrotId) == "string" then BrainrotFlair[brainrotId] else nil
	if flair == nil then
		return
	end
	local part = visual.Body
	local scale = visual.Height / 5
	for _, piece in visual.Pieces do
		piece.Part.Reflectance = math.max(piece.Part.Reflectance, flair.Shine)
	end
	-- Its own glow instead of the Secret smoke.
	local smoke = part:FindFirstChild("SecretSmoke")
	if smoke then
		smoke:Destroy()
	end
	local light = visual.Light
	if light == nil then
		local glow = Instance.new("PointLight")
		glow.Name = "Glow"
		glow.Shadows = false
		glow.Parent = part
		visual.Light = glow
		light = glow
	end
	if light then
		light.Color = flair.Glow
		light.Brightness = 2
		light.Range = 14 * math.clamp(scale, 1, 1.6)
		visual.BaseBrightness = 2
	end
	visual.RainbowLight = false
	if flair.Fire then
		local head = part
		for _, piece in visual.Pieces do
			if piece.Kind == "Head" then
				head = piece.Part
			end
		end
		local fire = Instance.new("Fire")
		fire.Name = "FlairFire"
		fire.Color = flair.Fire[1]
		fire.SecondaryColor = flair.Fire[2] or flair.Fire[1]
		fire.Heat = 9
		fire.Size = 2.2 * scale
		fire.Parent = head
	end
	if lowGraphics() then
		return
	end
	sparkles(part, "FlairSparkles", flair.Sparkles, flair.SparkleColours, 0.5 * scale, false)
	sparkles(part, "FlairAura", math.floor(flair.Sparkles / 2), flair.SparkleColours, 0.75 * scale, true)
	visual.SquareSpread = math.max(visual.Body.Size.X, visual.Body.Size.Z) * 0.45 + 0.3 * scale
	visual.SquareSize = math.clamp(0.3 * scale, 0.2, 0.9)
	for index = 1, flair.Squares do
		local square = Instance.new("Part")
		square.Name = "FlairSquare"
		square.Size = Vector3.one * visual.SquareSize
		square.Material = Enum.Material.Neon
		square.Color = flair.SquareColours[(index - 1) % #flair.SquareColours + 1]
		square.Anchored = true
		square.CanCollide = false
		square.CanQuery = false
		square.CanTouch = false
		square.CastShadow = false
		square.Transparency = 1
		square:SetAttribute(PIECE_ATTRIBUTE, true)
		square.Parent = visual.Root
		table.insert(visual.Squares, square)
		table.insert(visual.SquareSeeds, (index - 1) / flair.Squares + math.random() * 0.05)
	end
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
		brightness = math.max(brightness, 0.8)
		range = math.max(range, 8)
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
		light.Range = range * math.clamp(scale, 1, 1.5)
		light.Shadows = false
		light.Parent = part
		visual.Light = light
		visual.BaseBrightness = brightness
	end

	local rainbowRarity = effect ~= nil and effect.RainbowLight == true
	local darkRarity = effect ~= nil and effect.Dark == true
	if effect and effect.Sparkles > 0 and rarity then
		local colours = if rainbowRarity
			then RAINBOW_SEQUENCE
			elseif darkRarity then ColorSequence.new(Color3.new(1, 1, 1))
			else ColorSequence.new(rarity.Color)
		sparkles(part, "RaritySparkles", effect.Sparkles, colours, 0.45 * scale, false)
	end
	if effect and effect.Aura and rarity then
		local colours = if rainbowRarity
			then RAINBOW_SEQUENCE
			elseif darkRarity then ColorSequence.new(Color3.fromRGB(40, 40, 50), Color3.new(1, 1, 1))
			else ColorSequence.new(Color3.new(1, 1, 1), rarity.Color)
		sparkles(part, "Aura", if darkRarity then 10 else 6, colours, 0.6 * scale, true)
	end
	if darkRarity then
		local smoke = Instance.new("Smoke")
		smoke.Name = "SecretSmoke"
		smoke.Color = Color3.fromRGB(25, 25, 35)
		smoke.Opacity = 0.12
		smoke.RiseVelocity = 1.5
		smoke.Size = 1.5 * scale
		smoke.Parent = part
		if visual.Light then
			(visual.Light :: PointLight).Color = Color3.fromRGB(230, 230, 255)
		end
	end
	visual.Pulse = effect ~= nil and effect.Pulse
	visual.RainbowLight = rainbowRarity and mutation == nil

	if mutation then
		local colours = if mutation.Name == "Rainbow"
			then RAINBOW_SEQUENCE
			else MUTATION_COLOURS[mutation.Name] or ColorSequence.new(mutation.Color, Color3.new(1, 1, 1))
		sparkles(part, "MutationSparkles", 10, colours, 0.55 * scale, false)
		sparkles(part, "MutationAura", 5, colours, 0.7 * scale, true)
		addOrbiters(visual, mutation)
		if mutation.Name == "Admin" then
			visual.Glitch = true
		end
		if mutation.Name == "Lava" or mutation.Name == "Boss" then
			local fire = Instance.new("Fire")
			fire.Name = "LavaFire"
			fire.Color = Color3.fromRGB(255, 120, 20)
			fire.SecondaryColor = Color3.fromRGB(255, 220, 60)
			fire.Heat = 4
			fire.Size = 2.5 * scale
			fire.Parent = part
		elseif mutation.Name == "Bloodrot" then
			-- Dripping red.
			local drips = Instance.new("ParticleEmitter")
			drips.Name = "BloodDrips"
			drips.Rate = 6
			drips.Color = colours
			drips.LightInfluence = 0.5
			drips.Lifetime = NumberRange.new(0.6, 1)
			drips.Speed = NumberRange.new(0, 0.5)
			drips.Acceleration = Vector3.new(0, -20, 0)
			drips.Size = NumberSequence.new(0.18 * scale)
			drips.Parent = part
		end
	end
	addFlair(visual)
end

--------------------------------------------------------------------------------
-- Attaching models
--------------------------------------------------------------------------------

local function isOwnPiece(instance: Instance): boolean
	return instance:GetAttribute(PIECE_ATTRIBUTE) == true
end

-- Hides a part of the server's block figure on this client only.
local function hideFallback(visual: Visual, instance: Instance)
	if not visual.Imported and instance:IsA("BasePart") and instance ~= visual.Root and not isOwnPiece(instance) then
		instance.LocalTransparencyModifier = 1
	end
end

local function detach(instance: Model)
	local visual = visuals[instance]
	if visual == nil then
		return
	end
	visuals[instance] = nil
	for _, orbiter in visual.Orbiters do
		orbiter:Destroy()
	end
	for _, square in visual.Squares do
		square:Destroy()
	end
	local hat = visual.Hat
	if hat then
		hat:Destroy()
	end
	if visual.Imported then
		local highlight = visual.Highlight
		if highlight then
			highlight:Destroy()
		end
		return
	end
	for _, piece in visual.Pieces do
		piece.Part:Destroy()
	end
end

-- An imported model: animate the Welds the server made.
local function attachImported(instance: Model)
	local root = instance:FindFirstChild("Root")
	local height = instance:GetAttribute("FigureHeight")
	if root == nil or not root:IsA("BasePart") or typeof(height) ~= "number" then
		return
	end
	local existing = visuals[instance]
	if existing and existing.Root == root then
		return
	end
	detach(instance)

	local pieces: { PieceVisual } = {}
	local body: BasePart? = nil
	local legs = 0
	for _, descendant in instance:GetDescendants() do
		if descendant:IsA("Weld") and descendant.Name == "Pose" and descendant.Part0 == root then
			local part = descendant.Part1
			if part == nil then
				continue
			end
			-- Moving pieces carry their joint (Hip) and phase; block-built ones
			-- also their kind (arm, wing, ...) and a prop's spin axis.
			local hip = part:GetAttribute("Hip")
			local phase = part:GetAttribute("LegPhase")
			local kindAttribute = part:GetAttribute("PieceKind")
			local axisAttribute = part:GetAttribute("PieceAxis")
			local moving = typeof(hip) == "Vector3" and typeof(phase) == "number"
			local kind = if not moving then "Body" elseif typeof(kindAttribute) == "string" then kindAttribute else "Leg"
			if kind == "Leg" then
				legs += 1
			end
			table.insert(pieces, {
				Part = part,
				Weld = descendant,
				Kind = kind,
				Base = descendant.C0,
				Hip = if typeof(hip) == "Vector3" then hip else Vector3.zero,
				Direction = if phase == 1 then -1 else 1,
				Axis = if axisAttribute == "X" then Vector3.xAxis elseif axisAttribute == "Z" then Vector3.zAxis else Vector3.yAxis,
			})
			if part.Name == "Body" or (body == nil and kind == "Body") then
				body = part
			end
		end
	end
	if body == nil or #pieces == 0 then
		return
	end

	local mutationAttribute = instance:GetAttribute("Mutation")
	local rarityAttribute = instance:GetAttribute("Rarity")
	local motionAttribute = instance:GetAttribute("Motion")
	local mutation = if typeof(mutationAttribute) == "string" then mutationAttribute else nil
	local visual: Visual = {
		Model = instance,
		Root = root,
		Body = body :: BasePart,
		Imported = true,
		Highlight = nil,
		Pieces = pieces,
		HasLegs = legs >= 2,
		Height = height,
		Phase = math.random() * math.pi * 2,
		Light = nil,
		BaseBrightness = 0,
		Pulse = false,
		Rainbow = mutation == "Rainbow",
		RainbowLight = false,
		Motion = if typeof(motionAttribute) == "string" and MOTIONS[motionAttribute] then motionAttribute else "Walk",
		LastPosition = root.Position,
		Speed = 0,
		Stride = math.random() * math.pi * 2,
		Spin = 0,
		Block = instance:GetAttribute("LuckyBlock") == true,
		Glitch = false,
		Hat = nil,
		Orbiters = {},
		OrbitRadius = 0,
		Squares = {},
		SquareSeeds = {},
		SquareSpread = 0,
		SquareSize = 0,
		StateSince = os.clock(),
		LastState = nil,
	}
	addEffects(visual, if typeof(rarityAttribute) == "string" then rarityAttribute else nil, mutation)
	local traitAttribute = instance:GetAttribute("Trait")
	addTraitEffects(visual, if typeof(traitAttribute) == "string" then traitAttribute else nil)
	pcall(arrivalBurst, visual)
	pcall(attachHat, visual)
	local mutationInfo = if mutation then BrainrotConfig.MutationByName[mutation] else nil
	if mutationInfo then
		-- Textured meshes can't be recoloured, so the mutation glows over them.
		local highlight = Instance.new("Highlight")
		highlight.Name = "MutationGlow"
		highlight.FillColor = mutationInfo.Color
		highlight.FillTransparency = 0.78
		highlight.OutlineColor = mutationInfo.Color
		highlight.OutlineTransparency = 0.35
		highlight.DepthMode = Enum.HighlightDepthMode.Occluded
		highlight.Adornee = instance
		highlight.Parent = instance
		visual.Highlight = highlight
	end
	visuals[instance] = visual
end

local function attachModel(instance: Instance)
	if not instance:IsA("Model") or attaching[instance] then
		return
	end
	if instance:GetAttribute("CustomModel") == true then
		attachImported(instance)
		return
	end
	local brainrotId = instance:GetAttribute("BrainrotId")
	local height = instance:GetAttribute("FigureHeight")
	local mutationAttribute = instance:GetAttribute("Mutation")
	local rarityAttribute = instance:GetAttribute("Rarity")
	local motionAttribute = instance:GetAttribute("Motion")
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

		-- The blocky meshes, or where this device can't build meshes, the same
		-- brainrot from plain boxes.
		local built, asset = AssetLoader.createBrainrotParts(brainrotId, mutation, height)
		local placed: { AssetLoader.BoxPiece } = {}
		if built and asset then
			for _, entry in built do
				table.insert(placed, {
					Part = entry.Part :: BasePart,
					Kind = entry.Piece.Kind,
					Offset = entry.Offset,
					Pivot = entry.Pivot,
					Phase = entry.Piece.Phase,
					Axis = entry.Piece.Axis,
				})
			end
		else
			local boxes = AssetLoader.createBrainrotBoxes(brainrotId, mutation, height)
			if boxes == nil then
				return
			end
			placed = boxes
		end
		if instance.Parent == nil or rootInstance.Parent ~= instance then
			for _, entry in placed do
				entry.Part:Destroy()
			end
			return
		end

		local pieces: { PieceVisual } = {}
		local body: BasePart? = nil
		local hasLegs = false
		local centre = CFrame.new(0, height / 2, 0)
		for _, entry in placed do
			local part = entry.Part
			part:SetAttribute(PIECE_ATTRIBUTE, true)
			-- (A box piece's boxes are ours too.)
			for _, box in part:GetChildren() do
				if box:IsA("BasePart") then
					box:SetAttribute(PIECE_ATTRIBUTE, true)
				end
			end
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

			local kind = entry.Kind
			hasLegs = hasLegs or kind == "Leg"
			table.insert(pieces, {
				Part = part,
				Weld = weld,
				Kind = kind,
				Base = centre * CFrame.new(entry.Offset),
				Hip = centre.Position + entry.Pivot,
				Direction = if entry.Phase == 1 then -1 else 1,
				Axis = if entry.Axis == "X" then Vector3.xAxis elseif entry.Axis == "Z" then Vector3.zAxis else Vector3.yAxis,
			})
			if kind == "Body" then
				body = part
			end
		end
		if body == nil then
			for _, entry in placed do
				entry.Part:Destroy()
			end
			return
		end

		local visual: Visual = {
			Model = instance,
			Root = rootInstance,
			Body = body :: BasePart,
			Imported = false,
			Highlight = nil,
			Pieces = pieces,
			HasLegs = hasLegs,
			Height = height,
			Phase = math.random() * math.pi * 2,
			Light = nil,
			BaseBrightness = 0,
			Pulse = false,
			Rainbow = mutation == "Rainbow",
			RainbowLight = false,
			Motion = if typeof(motionAttribute) == "string" and MOTIONS[motionAttribute] then motionAttribute else "Walk",
			LastPosition = rootInstance.Position,
			Speed = 0,
			Stride = math.random() * math.pi * 2,
			Spin = 0,
			Block = false,
			Glitch = false,
			Hat = nil,
			Orbiters = {},
			OrbitRadius = 0,
			Squares = {},
			SquareSeeds = {},
			SquareSpread = 0,
			SquareSize = 0,
			StateSince = os.clock(),
			LastState = nil,
		}
		addEffects(visual, rarity, mutation)
		local traitAttribute = instance:GetAttribute("Trait")
		addTraitEffects(visual, if typeof(traitAttribute) == "string" then traitAttribute else nil)
		pcall(arrivalBurst, visual)
		-- Parented under the Root, so they leave with it if it streams out.
		for _, piece in pieces do
			piece.Part.Parent = rootInstance
		end
		for _, descendant in instance:GetDescendants() do
			hideFallback(visual, descendant)
		end

		visuals[instance] = visual
		pcall(attachHat, visual)
		if visual.Rainbow and asset then
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
	instance:GetAttributeChangedSignal("Hat"):Connect(function()
		local visual = visuals[instance]
		if visual then
			pcall(attachHat, visual)
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

-- A brainrot still showing its block figure (its model couldn't be built,
-- say the device was busy) gets another try every few seconds.
task.spawn(function()
	while true do
		task.wait(5)
		for _, child in brainrotsFolder:GetChildren() do
			if child:IsA("Model") and visuals[child] == nil and not attaching[child] then
				task.spawn(attachModel, child)
			end
		end
	end
end)


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
	local motion = visual.Motion
	local moving = visual.Speed > MIN_WALK_SPEED
	local blend = math.clamp(visual.Speed / 3, 0, 1)
	if moving then
		local stepsPerSecond = math.clamp(visual.Speed / (height * 1.1), 0.8, 2.4)
		visual.Stride += dt * stepsPerSecond * math.pi * 2
	end
	local stride = visual.Stride

	if state ~= visual.LastState then
		visual.LastState = state
		visual.StateSince = t
	end
	-- Skating: how far through a trick (0 to 1), the height of the jump
	-- (0 on the ground, 1 at the top), which trick, and the pushing foot.
	local skateAlpha, skateAir, skateTrick, skatePush = 0, 0, 0, 0
	if state == "Defeated" then
		local fall = math.clamp((t - visual.StateSince) / 0.8, 0, 1)
		local eased = fall * fall
		modelOffset = CFrame.new(0, -height * 0.2 * eased, 0) * centre * CFrame.Angles(0, 0, math.rad(85) * eased)
	elseif state == "Carried" then
		local wiggle = phase * 12
		swing = math.sin(phase * 16) * math.rad(35)
		modelOffset = centre * CFrame.Angles(math.sin(wiggle) * math.rad(10), 0, math.cos(wiggle * 0.7) * math.rad(14))
	elseif state == "Opening" then
		-- A lucky block about to pop: shakes harder and harder.
		local shake = math.rad(6 + 10 * math.abs(math.sin(t * 3)))
		modelOffset = CFrame.new(0, 0.3 * height, 0)
			* centre
			* CFrame.Angles(math.sin(t * 47) * shake, t * 6, math.cos(t * 53) * shake)
	elseif visual.Block then
		if moving then
			-- Little hops all the way home.
			local air = math.abs(math.sin(stride * 0.6))
			modelOffset = CFrame.new(0, air * 0.18 * height, 0) * centre * CFrame.Angles(-math.rad(6) * air, 0, 0)
		else
			-- Floats and slowly turns on its pedestal.
			local float = (0.18 + 0.06 * math.sin(phase * 2)) * height
			modelOffset = CFrame.new(0, float, 0) * centre * CFrame.Angles(0, phase * 0.9, math.sin(phase * 1.3) * math.rad(4))
		end
	elseif motion == "Fly" then
		-- Hovers above the ground, banking and dipping as it flies.
		local lift = (0.35 + 0.05 * math.sin(phase * 2.2)) * height
		local bank = math.sin(phase * 0.9) * math.rad(if moving then 12 else 6)
		local pitch = if moving then -math.rad(10) * blend else math.sin(phase * 1.3) * math.rad(4)
		modelOffset = CFrame.new(0, lift, 0) * centre * CFrame.Angles(pitch, 0, bank)
	elseif motion == "Skate" and state ~= "Carried" then
		-- Rides a skateboard: carves from side to side, kicks to push after
		-- landing, and pops a trick every few seconds (an ollie, a kickflip
		-- or a shove-it), even parked on a pedestal.
		local period = if moving then SKATE_TRICK_EVERY else SKATE_TRICK_EVERY * 1.6
		local cycle = phase % period
		if cycle < SKATE_AIR_TIME then
			skateAlpha = cycle / SKATE_AIR_TIME
			skateAir = math.sin(skateAlpha * math.pi)
			skateTrick = math.floor(phase / period) % 3
		elseif moving then
			local since = cycle - SKATE_AIR_TIME - 0.3
			if since > 0 and since < 1.4 then
				skatePush = math.max(0, math.sin(since / 1.4 * math.pi * 2)) * blend
			end
		end
		local ground = 1 - skateAir
		local carve = math.sin(phase * 1.6) * math.rad(if moving then 9 else 3) * ground
		local weave = if moving then math.sin(phase * 1.6 - 0.8) * math.rad(8) * blend else math.sin(phase * 0.7) * math.rad(6)
		-- Nose up on the way up, down on the way down.
		local pitch = math.sin(skateAlpha * math.pi * 2) * math.rad(12)
		modelOffset = CFrame.new(0, skateAir * SKATE_POP * height, 0) * centre * CFrame.Angles(pitch, weave, carve)
	elseif motion == "Drive" then
		-- Rolls along with little bumps; rumbles in place when parked.
		local bump = if moving then math.abs(math.sin(stride * 2)) * 0.02 * height else math.abs(math.sin(phase * 14)) * 0.005 * height
		local rock = if moving then math.sin(stride * 2) * math.rad(2) else 0
		modelOffset = CFrame.new(0, bump, 0) * centre * CFrame.Angles(rock - math.rad(3) * blend, 0, 0)
	elseif moving then
		if visual.HasLegs then
			-- A real walk: legs step in turn, a small bob as they pass each
			-- other, leaning into the walk.
			swing = math.sin(stride) * LEG_SWING * blend
			local bob = (0.5 + 0.5 * math.cos(stride * 2)) * WALK_BOB * height * blend
			local roll = math.sin(stride) * WALK_ROLL * blend
			modelOffset = CFrame.new(0, bob, 0) * centre * CFrame.Angles(-WALK_LEAN * blend, 0, roll)
		elseif motion == "Hop" then
			-- Small hops, rocking a little from side to side.
			local air = math.abs(math.sin(stride * 0.8))
			local rock = math.sin(stride * 0.8) * math.rad(6) * blend
			modelOffset = CFrame.new(0, air * 0.1 * height * blend, 0) * centre * CFrame.Angles(-math.rad(6) * air * blend, 0, rock)
		else
			-- No legs to walk on: waddle, rocking onto each side with every
			-- step and turning a little with it.
			local rock = math.sin(stride) * WADDLE_ROLL * blend
			local turn = math.sin(stride) * WADDLE_TURN * blend
			local bob = math.abs(math.sin(stride)) * WALK_BOB * height * blend
			modelOffset = CFrame.new(0, bob, 0) * centre * CFrame.Angles(-WALK_LEAN * blend, turn, rock)
		end
	elseif motion == "Spin" then
		-- A slow twirl on the spot.
		local rise = math.abs(math.sin(phase * 1.5)) * 0.02 * height
		modelOffset = CFrame.new(0, rise, 0) * centre * CFrame.Angles(0, phase * 0.8, 0)
	elseif motion == "Hop" then
		-- A small bounce every so often, squashing a little on landing.
		local air = math.abs(math.sin(phase * 1.2))
		modelOffset = CFrame.new(0, air * 0.05 * height, 0) * centre * CFrame.Angles(-math.rad(4) * air, 0, 0)
	else
		-- Idle: gentle bob and sway, with a small hop every few seconds.
		local bob = (math.sin(phase * 2) * 0.5 + 0.5) * 0.025 * height
		local cycle = (phase * 0.5) % (math.pi * 2)
		local hop = if cycle < 0.5 then math.sin(cycle / 0.5 * math.pi) * 0.03 * height else 0
		local sway = math.sin(phase * 1.1) * math.rad(7)
		modelOffset = CFrame.new(0, bob + hop, 0) * centre * CFrame.Angles(0, sway, math.sin(phase * 2) * math.rad(2))
	end

	-- Glitched: every so often it jumps to a wrong spot for a frame.
	if visual.Glitch and math.random() < 0.06 then
		local jolt = Vector3.new(math.random() - 0.5, math.random() * 0.3, math.random() - 0.5) * 0.3 * height
		modelOffset = CFrame.new(jolt) * modelOffset * CFrame.Angles(0, (math.random() - 0.5) * 0.8, 0)
	end

	-- Arms swing against the legs (or with each waddle), flail when carried
	-- and wave a little when idle.
	local armSwing: number
	if state == "Carried" then
		armSwing = math.sin(phase * 14) * math.rad(55)
	elseif motion == "Skate" then
		armSwing = math.sin(phase * 1.9) * math.rad(8)
	elseif moving and motion ~= "Fly" and motion ~= "Drive" then
		armSwing = -math.sin(stride) * ARM_SWING * blend
	else
		armSwing = math.sin(phase * 1.6) * math.rad(6)
	end
	-- Wings flap fast in flight, slowly otherwise.
	local flying = motion == "Fly" or state == "Carried"
	local flapRate = if flying then (if moving then 15 else 10) else 4
	local flap = math.sin(t * flapRate + visual.Phase) * math.rad(if flying then 32 else 10)
	local wag = math.sin(phase * (if moving then 9 else 4)) * math.rad(if moving then 22 else 14)
	local hasEars, hasBoard = false, false
	for _, piece in visual.Pieces do
		if piece.Kind == "Ear" then
			hasEars = true
		elseif piece.Kind == "Board" then
			hasBoard = true
		end
	end
	local nod: CFrame
	if hasEars and not moving and state ~= "Carried" then
		-- A puppy's head tilt every few seconds, one way then the other.
		local cycle = phase % 5
		local tilt = if cycle < 1.8 then math.sin(cycle / 1.8 * math.pi) * math.rad(20) else 0
		local side = if math.floor(phase / 5) % 2 == 0 then 1 else -1
		nod = CFrame.Angles(math.sin(phase * 0.9) * math.rad(3), math.sin(phase * 0.45) * math.rad(12), tilt * side)
	elseif moving then
		nod = CFrame.Angles(math.sin(stride * 2) * math.rad(5) * blend, math.sin(stride) * math.rad(4) * blend, 0)
	else
		-- Looks around now and then.
		nod = CFrame.Angles(math.sin(phase * 0.9) * math.rad(3), math.sin(phase * 0.45) * math.rad(16), math.sin(phase * 0.7) * math.rad(3))
	end
	-- Propellers always turn; wheels roll with the ground speed; halos turn slowly.
	visual.Spin += dt * (if motion == "Drive" or motion == "Skate" then visual.Speed * 1.6 else PROP_SPIN)

	-- Ears flop outwards with every step (flapping when carried).
	local earFlop: number
	if state == "Carried" then
		earFlop = (0.5 + 0.5 * math.sin(phase * 14)) * math.rad(40)
	elseif moving then
		earFlop = math.rad(4) + (0.5 + 0.5 * math.sin(stride * 2)) * math.rad(20) * blend
	else
		earFlop = math.rad(4) + (0.5 + 0.5 * math.sin(phase * 1.3)) * math.rad(5)
	end
	-- (They fly up when a skater jumps.)
	earFlop += skateAir * math.rad(45)
	-- The skateboard: flips about its length for a kickflip or spins flat
	-- for a shove-it.
	local boardTurn = CFrame.identity
	if skateAir > 0 and skateTrick > 0 then
		local spin = (1 - math.cos(skateAlpha * math.pi)) * math.pi
		boardTurn = if skateTrick == 1 then CFrame.Angles(0, 0, spin) else CFrame.Angles(0, spin, 0)
	end

	-- Glowing blocks circle the brainrot, bobbing and tumbling.
	local orbiters = visual.Orbiters
	if #orbiters > 0 then
		local rootFrame = visual.Root.CFrame
		local count = #orbiters
		for index, cube in orbiters do
			local angle = t * 1.6 + (index - 1) / count * math.pi * 2
			local y = height * (0.5 + 0.25 * math.sin(t * 2 + index * 1.7))
			cube.CFrame = rootFrame
				* CFrame.new(math.cos(angle) * visual.OrbitRadius, y, math.sin(angle) * visual.OrbitRadius)
				* CFrame.Angles(t * 2 + index, t * 3, 0)
		end
	end

	-- Glowing squares rise off the rarest brainrots like flames: each starts
	-- low somewhere round it, climbs, spins, shrinks and fades, then starts
	-- again somewhere else.
	local squares = visual.Squares
	if #squares > 0 then
		local rootFrame = visual.Root.CFrame
		for index, square in squares do
			local seed = visual.SquareSeeds[index]
			local cycle = t / 1.7 + seed
			local u = cycle % 1
			local angle = seed * 40.1 + math.floor(cycle) * 2.39
			local radius = visual.SquareSpread * (0.45 + 0.55 * ((seed * 7.31 + math.floor(cycle) * 0.37) % 1))
			square.Size = Vector3.one * visual.SquareSize * (1.15 - 0.85 * u)
			square.Transparency = 0.05 + 0.9 * u * u
			square.CFrame = rootFrame
				* CFrame.new(math.cos(angle) * radius, height * (0.05 + 1.05 * u), math.sin(angle) * radius)
				* CFrame.Angles(u * 4 + seed * 6, u * 5, 0)
		end
	end

	-- modelOffset moves the model about its centre; the pieces' rest poses
	-- are relative to the feet.
	local frame = modelOffset * centre:Inverse()
	-- Ears move with the head and wheels with the board.
	local headPose, boardPose = CFrame.identity, CFrame.identity
	if hasEars or hasBoard then
		for _, piece in visual.Pieces do
			if piece.Kind == "Head" then
				headPose = CFrame.new(piece.Hip) * nod * CFrame.new(-piece.Hip)
			elseif piece.Kind == "Board" then
				-- Mid-kickflip the board drops half its width under the feet,
				-- so it flips clear of them.
				local drop = if skateTrick == 1 then skateAir * piece.Part.Size.X * 0.5 else 0
				boardPose = CFrame.new(0, -drop, 0) * CFrame.new(piece.Hip) * boardTurn * CFrame.new(-piece.Hip)
			end
		end
	end
	for _, piece in visual.Pieces do
		local kind = piece.Kind
		local turn: CFrame? = nil
		-- Which side of the body it's on, for things that swing outwards.
		local side = if piece.Hip.X >= 0 then 1 else -1
		if kind == "Leg" and motion == "Skate" and state ~= "Carried" then
			-- The back foot kicks to push; the other stays on the board.
			turn = CFrame.Angles(if piece.Direction < 0 then -skatePush * math.rad(40) else 0, 0, 0)
		elseif kind == "Leg" then
			turn = CFrame.Angles(swing * piece.Direction, 0, 0)
		elseif kind == "Arm" and motion == "Skate" and state ~= "Carried" then
			-- Arms out for balance, flung up in the air.
			local raise = math.rad(22) + math.sin(phase * 2.3 + piece.Direction) * math.rad(7) + skateAir * math.rad(50)
			turn = CFrame.Angles(armSwing * piece.Direction, 0, raise * side)
		elseif kind == "Arm" then
			turn = CFrame.Angles(armSwing * piece.Direction, 0, 0)
		elseif kind == "Wing" then
			turn = CFrame.Angles(0, 0, flap * piece.Direction)
		elseif kind == "Tail" then
			turn = CFrame.Angles(0, wag * piece.Direction, 0)
		elseif kind == "Head" then
			turn = nod
		elseif kind == "Prop" then
			local angle = if piece.Axis == Vector3.yAxis then visual.Spin * 0.25 else visual.Spin
			turn = boardPose * CFrame.new(piece.Hip) * CFrame.fromAxisAngle(piece.Axis, angle * piece.Direction) * CFrame.new(-piece.Hip)
		elseif kind == "Board" then
			turn = boardPose
		elseif kind == "Ear" then
			turn = headPose * CFrame.new(piece.Hip) * CFrame.Angles(0, 0, earFlop * side) * CFrame.new(-piece.Hip)
		end
		if kind == "Prop" or kind == "Board" or kind == "Ear" then
			-- (Already about its joint, and its parent's.)
			piece.Weld.C0 = frame * (turn :: CFrame) * piece.Base
		elseif turn then
			piece.Weld.C0 = frame * CFrame.new(piece.Hip) * turn * CFrame.new(-piece.Hip) * piece.Base
		else
			piece.Weld.C0 = frame * piece.Base
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
		if visual.Glitch then
			local flicker = if math.random() < 0.08 then 0.6 else 0
			for _, piece in visual.Pieces do
				piece.Part.LocalTransparencyModifier = flicker
			end
		end

		local light = visual.Light
		if light then
			if visual.Pulse then
				light.Brightness = visual.BaseBrightness * (0.7 + 0.3 * math.sin(t * 4 + visual.Phase))
			end
			if visual.Rainbow or visual.RainbowLight then
				light.Color = Color3.fromHSV((t * 0.25) % 1, 0.8, 1)
			end
		end
		local highlight = visual.Highlight
		if highlight and visual.Rainbow then
			local colour = Color3.fromHSV((t * 0.25) % 1, 0.8, 1)
			highlight.FillColor = colour
			highlight.OutlineColor = colour
		end
	end

	if t - lastRainbowUpdate >= RAINBOW_INTERVAL and next(rainbowAssets) ~= nil then
		lastRainbowUpdate = t
		for asset in rainbowAssets do
			AssetLoader.animateRainbow(asset, t)
		end
	end
end)

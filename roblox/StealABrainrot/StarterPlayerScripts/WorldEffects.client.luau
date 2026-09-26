--!strict
--[[
	WorldEffects
	Location: StarterPlayer.StarterPlayerScripts (LocalScript)

	Everything that makes the world feel alive, drawn on this client only:
	  * weather from the server (ReplicatedStorage attribute Weather): rain,
	    snow, fog and thunderstorms with lightning and thunder. Nothing falls
	    inside the bases.
	  * event skies (EventSky / EventParticles): the sky is tinted and gold
	    sparkles, diamonds, confetti, embers, stars, meteors, snow, tacos,
	    clovers or cash fall around you while the event runs
	  * the shopkeepers come alive: the Robux rat winds up and slaps with its
	    galaxy glove, the Gear Shop noob waves, both look around and talk
	  * Cash Rain coins drop from the sky and spin
	  * a big banner while a troll item holds you (Frozen, Dancing, ...)
]]

local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local AudioConfig = require(Shared:WaitForChild("AudioConfig"))
local Sounds = require(Shared:WaitForChild("Sounds"))

local player = Players.LocalPlayer
local map = Workspace:WaitForChild("Map")
local plotsFolder = map:WaitForChild("Plots")

local rng = Random.new()

--------------------------------------------------------------------------------
-- Falling particles
--------------------------------------------------------------------------------

type LayerStyle = {
	Count: number,
	Make: () -> BasePart,
	-- Studs per second (downwards; upwards when Rising).
	MinSpeed: number,
	MaxSpeed: number,
	-- Sideways wobble in studs.
	Sway: number,
	Wind: Vector3,
	-- Half the width of the box around the camera the particles fill.
	Radius: number,
	Top: number,
	Bottom: number,
	Rising: boolean?,
	Spin: boolean?,
	-- Keep the part lined up with the way it moves (rain, meteors).
	Streak: boolean?,
	-- Hide particles that would fall inside a base.
	Outdoor: boolean?,
}

type Drop = {
	Part: BasePart,
	Position: Vector3,
	Speed: number,
	Seed: number,
}

type Layer = {
	Style: LayerStyle,
	Drops: { Drop },
	Folder: Folder,
	Rotation: CFrame,
}

local effectsFolder = Instance.new("Folder")
effectsFolder.Name = "WorldEffects"
effectsFolder.Parent = Workspace

-- Base footprints (2D) so rain and snow stay outside.
type Footprint = { Frame: CFrame, HalfX: number, HalfZ: number }
local footprints: { Footprint } = {}
for _, plot in plotsFolder:GetChildren() do
	local floor = plot:FindFirstChild("Floor")
	if floor and floor:IsA("BasePart") then
		table.insert(footprints, { Frame = floor.CFrame, HalfX = floor.Size.X / 2 + 1.5, HalfZ = floor.Size.Z / 2 + 1.5 })
	end
end

local function isIndoors(position: Vector3): boolean
	for _, footprint in footprints do
		local localPosition = footprint.Frame:PointToObjectSpace(position)
		if math.abs(localPosition.X) <= footprint.HalfX and math.abs(localPosition.Z) <= footprint.HalfZ then
			return true
		end
	end
	return false
end

local function basicPart(size: Vector3, colour: Color3, material: Enum.Material, transparency: number): Part
	local part = Instance.new("Part")
	part.Size = size
	part.Color = colour
	part.Material = material
	part.Transparency = transparency
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.CastShadow = false
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	return part
end

local function emojiPart(emoji: string, size: number): Part
	local part = basicPart(Vector3.new(0.2, 0.2, 0.2), Color3.new(1, 1, 1), Enum.Material.SmoothPlastic, 1)
	local billboard = Instance.new("BillboardGui")
	billboard.Size = UDim2.fromScale(size, size)
	billboard.LightInfluence = 0
	billboard.MaxDistance = 150
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Text = emoji
	label.TextScaled = true
	label.Font = Enum.Font.GothamBold
	label.Parent = billboard
	billboard.Parent = part
	return part
end

local function spawnPosition(style: LayerStyle, centre: Vector3, anywhere: boolean): Vector3
	local x = centre.X + rng:NextNumber(-style.Radius, style.Radius)
	local z = centre.Z + rng:NextNumber(-style.Radius, style.Radius)
	local y: number
	if anywhere then
		y = centre.Y + rng:NextNumber(-style.Bottom, style.Top)
	elseif style.Rising then
		y = centre.Y - style.Bottom
	else
		y = centre.Y + style.Top
	end
	return Vector3.new(x, y, z)
end

local function placeDrop(layer: Layer, drop: Drop, centre: Vector3, anywhere: boolean)
	local style = layer.Style
	drop.Position = spawnPosition(style, centre, anywhere)
	drop.Speed = rng:NextNumber(style.MinSpeed, style.MaxSpeed)
	drop.Seed = rng:NextNumber(0, 100)
end

local function createLayer(name: string, style: LayerStyle): Layer
	local folder = Instance.new("Folder")
	folder.Name = name
	folder.Parent = effectsFolder
	local direction = Vector3.new(style.Wind.X, if style.Rising then style.MaxSpeed else -style.MaxSpeed, style.Wind.Z)
	local layer: Layer = {
		Style = style,
		Drops = {},
		Folder = folder,
		Rotation = CFrame.lookAt(Vector3.zero, direction.Unit) * CFrame.Angles(math.rad(90), 0, 0),
	}
	local camera = Workspace.CurrentCamera
	local centre = if camera then camera.CFrame.Position else Vector3.zero
	for _ = 1, style.Count do
		local part = style.Make()
		local drop: Drop = { Part = part, Position = Vector3.zero, Speed = 0, Seed = 0 }
		placeDrop(layer, drop, centre, true)
		part.CFrame = CFrame.new(drop.Position)
		part.Parent = folder
		table.insert(layer.Drops, drop)
	end
	return layer
end

local function stepLayer(layer: Layer, centre: Vector3, t: number, dt: number)
	local style = layer.Style
	local parts: { BasePart } = {}
	local frames: { CFrame } = {}
	for _, drop in layer.Drops do
		local vertical = if style.Rising then drop.Speed else -drop.Speed
		drop.Position += Vector3.new(style.Wind.X, vertical, style.Wind.Z) * dt
		local offset = drop.Position - centre
		local outside = math.abs(offset.X) > style.Radius or math.abs(offset.Z) > style.Radius
		local gone = if style.Rising then offset.Y > style.Top else offset.Y < -style.Bottom
		if outside or gone then
			placeDrop(layer, drop, centre, outside and not gone)
		end
		local position = drop.Position
		if style.Outdoor then
			-- Wind can blow a drop over a roof, so check where it is now.
			local hide = if isIndoors(position) then 1 else 0
			if drop.Part.LocalTransparencyModifier ~= hide then
				drop.Part.LocalTransparencyModifier = hide
			end
		end
		if style.Sway > 0 then
			position += Vector3.new(math.sin(t * 1.3 + drop.Seed) * style.Sway, 0, math.cos(t * 1.1 + drop.Seed * 2) * style.Sway)
		end
		local frame = CFrame.new(position)
		if style.Streak then
			frame *= layer.Rotation
		elseif style.Spin then
			frame *= CFrame.Angles(t * 2 + drop.Seed, t * 3 + drop.Seed * 2, 0)
		end
		table.insert(parts, drop.Part)
		table.insert(frames, frame)
	end
	Workspace:BulkMoveTo(parts, frames, Enum.BulkMoveMode.FireCFrameChanged)
end

local rainbowColours = {
	Color3.fromRGB(255, 70, 70),
	Color3.fromRGB(255, 170, 40),
	Color3.fromRGB(255, 230, 60),
	Color3.fromRGB(80, 230, 100),
	Color3.fromRGB(60, 170, 255),
	Color3.fromRGB(190, 90, 255),
}

local function neonCube(size: number, colour: Color3): () -> BasePart
	return function(): BasePart
		return basicPart(Vector3.new(size, size, size), colour, Enum.Material.Neon, 0.1)
	end
end

local RAIN_STYLE: LayerStyle = {
	Count = 220,
	Make = function(): BasePart
		return basicPart(Vector3.new(0.08, 2.4, 0.08), Color3.fromRGB(175, 205, 255), Enum.Material.SmoothPlastic, 0.4)
	end,
	MinSpeed = 85,
	MaxSpeed = 110,
	Sway = 0,
	Wind = Vector3.new(9, 0, 5),
	Radius = 70,
	Top = 60,
	Bottom = 12,
	Streak = true,
	Outdoor = true,
}

local STORM_STYLE: LayerStyle = table.clone(RAIN_STYLE)
STORM_STYLE.Count = 320
STORM_STYLE.Wind = Vector3.new(22, 0, 12)

local SNOW_STYLE: LayerStyle = {
	Count = 200,
	Make = function(): BasePart
		local part = basicPart(Vector3.new(0.35, 0.35, 0.35), Color3.new(1, 1, 1), Enum.Material.SmoothPlastic, 0.05)
		part.Shape = Enum.PartType.Ball
		return part
	end,
	MinSpeed = 5,
	MaxSpeed = 9,
	Sway = 1.5,
	Wind = Vector3.new(2, 0, 1),
	Radius = 70,
	Top = 45,
	Bottom = 10,
	Outdoor = true,
}

local EVENT_STYLES: { [string]: LayerStyle } = {
	Sparkles = {
		Count = 110,
		Make = neonCube(0.3, Color3.fromRGB(255, 215, 60)),
		MinSpeed = 3,
		MaxSpeed = 6,
		Sway = 1,
		Wind = Vector3.zero,
		Radius = 60,
		Top = 40,
		Bottom = 8,
		Spin = true,
	},
	Crystals = {
		Count = 100,
		Make = function(): BasePart
			local part = basicPart(Vector3.new(0.35, 0.6, 0.35), Color3.fromRGB(120, 230, 255), Enum.Material.Glass, 0.2)
			part.Reflectance = 0.4
			return part
		end,
		MinSpeed = 4,
		MaxSpeed = 7,
		Sway = 0.8,
		Wind = Vector3.zero,
		Radius = 60,
		Top = 40,
		Bottom = 8,
		Spin = true,
	},
	Confetti = {
		Count = 180,
		Make = function(): BasePart
			local colour = rainbowColours[rng:NextInteger(1, #rainbowColours)]
			return basicPart(Vector3.new(0.5, 0.05, 0.3), colour, Enum.Material.SmoothPlastic, 0)
		end,
		MinSpeed = 4,
		MaxSpeed = 8,
		Sway = 1.5,
		Wind = Vector3.zero,
		Radius = 60,
		Top = 40,
		Bottom = 8,
		Spin = true,
	},
	Embers = {
		Count = 120,
		Make = neonCube(0.25, Color3.fromRGB(255, 60, 30)),
		MinSpeed = 2,
		MaxSpeed = 5,
		Sway = 1.2,
		Wind = Vector3.zero,
		Radius = 60,
		Top = 35,
		Bottom = 6,
		Rising = true,
		Spin = true,
	},
	Stars = {
		Count = 140,
		Make = function(): BasePart
			local colour = if rng:NextNumber() < 0.5 then Color3.new(1, 1, 1) else Color3.fromRGB(200, 150, 255)
			return basicPart(Vector3.new(0.3, 0.3, 0.3), colour, Enum.Material.Neon, 0)
		end,
		MinSpeed = 0.5,
		MaxSpeed = 2,
		Sway = 0.5,
		Wind = Vector3.zero,
		Radius = 70,
		Top = 50,
		Bottom = 5,
		Spin = true,
	},
	Meteors = {
		Count = 8,
		Make = function(): BasePart
			local part = basicPart(Vector3.new(2.2, 2.2, 2.2), Color3.fromRGB(255, 120, 30), Enum.Material.Neon, 0)
			part.Shape = Enum.PartType.Ball
			local fire = Instance.new("Fire")
			fire.Size = 6
			fire.Heat = 12
			fire.Color = Color3.fromRGB(255, 120, 20)
			fire.SecondaryColor = Color3.fromRGB(255, 220, 60)
			fire.Parent = part
			return part
		end,
		MinSpeed = 45,
		MaxSpeed = 65,
		Sway = 0,
		Wind = Vector3.new(35, 0, 20),
		Radius = 130,
		Top = 140,
		Bottom = 5,
		Streak = true,
	},
	Snow = SNOW_STYLE,
	Tacos = {
		Count = 45,
		Make = function(): BasePart
			return emojiPart("🌮", 2.5)
		end,
		MinSpeed = 6,
		MaxSpeed = 12,
		Sway = 1.5,
		Wind = Vector3.zero,
		Radius = 60,
		Top = 40,
		Bottom = 6,
	},
	Clovers = {
		Count = 45,
		Make = function(): BasePart
			return emojiPart("🍀", 2)
		end,
		MinSpeed = 4,
		MaxSpeed = 9,
		Sway = 1.5,
		Wind = Vector3.zero,
		Radius = 60,
		Top = 40,
		Bottom = 6,
	},
	Cash = {
		Count = 55,
		Make = function(): BasePart
			return emojiPart("💵", 2.2)
		end,
		MinSpeed = 6,
		MaxSpeed = 11,
		Sway = 1.8,
		Wind = Vector3.zero,
		Radius = 60,
		Top = 40,
		Bottom = 6,
	},
}

local weatherLayer: Layer? = nil
local eventLayer: Layer? = nil

local function removeLayer(layer: Layer?)
	if layer then
		layer.Folder:Destroy()
	end
end

--------------------------------------------------------------------------------
-- Sky, weather and event tints
--------------------------------------------------------------------------------

local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere")
local baseDensity = if atmosphere then atmosphere.Density else 0.2
local baseHaze = if atmosphere then atmosphere.Haze else 0.6
local baseAtmosphereColour = if atmosphere then atmosphere.Color else Color3.new(0.78, 0.9, 1)
local baseDecay = if atmosphere then atmosphere.Decay else Color3.new(0.55, 0.75, 1)

local weatherTint = Instance.new("ColorCorrectionEffect")
weatherTint.Name = "WeatherTint"
weatherTint.Parent = Lighting

local eventTint = Instance.new("ColorCorrectionEffect")
eventTint.Name = "EventTint"
eventTint.Parent = Lighting

local flash = Instance.new("ColorCorrectionEffect")
flash.Name = "LightningFlash"
flash.Parent = Lighting

type SkyLook = { Tint: Color3, Saturation: number, Atmosphere: Color3, Decay: Color3 }

local SKY_LOOKS: { [string]: SkyLook } = {
	Gold = { Tint = Color3.fromRGB(255, 240, 200), Saturation = 0.1, Atmosphere = Color3.fromRGB(255, 225, 150), Decay = Color3.fromRGB(255, 190, 90) },
	Diamond = { Tint = Color3.fromRGB(220, 245, 255), Saturation = 0.1, Atmosphere = Color3.fromRGB(190, 240, 255), Decay = Color3.fromRGB(110, 200, 255) },
	Rainbow = { Tint = Color3.new(1, 1, 1), Saturation = 0.3, Atmosphere = Color3.fromRGB(255, 200, 240), Decay = Color3.fromRGB(200, 150, 255) },
	Blood = { Tint = Color3.fromRGB(255, 150, 150), Saturation = 0.1, Atmosphere = Color3.fromRGB(200, 40, 50), Decay = Color3.fromRGB(120, 10, 20) },
	Galaxy = { Tint = Color3.fromRGB(210, 185, 255), Saturation = 0.2, Atmosphere = Color3.fromRGB(120, 70, 220), Decay = Color3.fromRGB(60, 20, 140) },
	Lava = { Tint = Color3.fromRGB(255, 205, 170), Saturation = 0.15, Atmosphere = Color3.fromRGB(255, 140, 70), Decay = Color3.fromRGB(200, 60, 20) },
	Frost = { Tint = Color3.fromRGB(215, 235, 255), Saturation = -0.1, Atmosphere = Color3.fromRGB(215, 240, 255), Decay = Color3.fromRGB(150, 210, 255) },
	Taco = { Tint = Color3.fromRGB(255, 240, 205), Saturation = 0.15, Atmosphere = Color3.fromRGB(255, 220, 140), Decay = Color3.fromRGB(255, 160, 60) },
	Lucky = { Tint = Color3.fromRGB(215, 255, 215), Saturation = 0.15, Atmosphere = Color3.fromRGB(170, 255, 170), Decay = Color3.fromRGB(80, 200, 90) },
	Cash = { Tint = Color3.fromRGB(225, 255, 215), Saturation = 0.15, Atmosphere = Color3.fromRGB(190, 255, 170), Decay = Color3.fromRGB(90, 200, 80) },
	Admin = { Tint = Color3.new(1, 1, 1), Saturation = 0.45, Atmosphere = Color3.fromRGB(255, 190, 250), Decay = Color3.fromRGB(150, 120, 255) },
}

-- Settings > Low graphics: no falling weather or event particles.
local function lowGraphics(): boolean
	return player:GetAttribute("LowGraphics") == true
end

local TWEEN = TweenInfo.new(3, Enum.EasingStyle.Sine)
local rainbowSky = false

local function applyEventSky()
	local sky = ReplicatedStorage:GetAttribute("EventSky")
	local look = if typeof(sky) == "string" then SKY_LOOKS[sky] else nil
	rainbowSky = sky == "Rainbow" or sky == "Admin"
	TweenService:Create(eventTint, TWEEN, {
		TintColor = if look then look.Tint else Color3.new(1, 1, 1),
		Saturation = if look then look.Saturation else 0,
	}):Play()
	if atmosphere then
		TweenService:Create(atmosphere, TWEEN, {
			Color = if look then look.Atmosphere else baseAtmosphereColour,
			Decay = if look then look.Decay else baseDecay,
		}):Play()
	end

	removeLayer(eventLayer)
	eventLayer = nil
	local particles = ReplicatedStorage:GetAttribute("EventParticles")
	local style = if typeof(particles) == "string" then EVENT_STYLES[particles] else nil
	if style and not lowGraphics() then
		eventLayer = createLayer("Event" .. tostring(particles), style)
	end
end

local rainSound = Instance.new("Sound")
rainSound.Name = "Rain"
rainSound.SoundId = "rbxassetid://" .. tostring(AudioConfig.RainSound.Id)
rainSound.Looped = true
rainSound.Volume = 0
rainSound.Parent = SoundService

local currentWeather = "Clear"

local function applyWeather()
	local weather = ReplicatedStorage:GetAttribute("Weather")
	currentWeather = if typeof(weather) == "string" then weather else "Clear"

	local density, haze, brightness, saturation = baseDensity, baseHaze, 0, 0
	local style: LayerStyle? = nil
	local rainVolume = 0
	if currentWeather == "Rain" then
		style = RAIN_STYLE
		density, haze, brightness, saturation = baseDensity + 0.1, baseHaze + 0.6, -0.04, -0.15
		rainVolume = AudioConfig.RainSound.Volume
	elseif currentWeather == "Thunderstorm" then
		style = STORM_STYLE
		density, haze, brightness, saturation = baseDensity + 0.18, baseHaze + 1.2, -0.1, -0.3
		rainVolume = AudioConfig.RainSound.Volume * 1.4
	elseif currentWeather == "Snow" then
		style = SNOW_STYLE
		density, haze, brightness, saturation = baseDensity + 0.12, baseHaze + 0.8, 0.02, -0.1
	elseif currentWeather == "Fog" then
		density, haze, brightness, saturation = 0.5, 2.6, -0.02, -0.15
	end

	if atmosphere then
		TweenService:Create(atmosphere, TWEEN, { Density = density, Haze = haze }):Play()
	end
	TweenService:Create(weatherTint, TWEEN, { Brightness = brightness, Saturation = saturation }):Play()

	removeLayer(weatherLayer)
	weatherLayer = if style and not lowGraphics() then createLayer("Weather" .. currentWeather, style) else nil

	if rainVolume > 0 and not rainSound.IsPlaying then
		rainSound:Play()
	end
	local fade = TweenService:Create(rainSound, TWEEN, { Volume = rainVolume })
	fade:Play()
	if rainVolume == 0 then
		fade.Completed:Once(function()
			if currentWeather ~= "Rain" and currentWeather ~= "Thunderstorm" then
				rainSound:Stop()
			end
		end)
	end
end

-- A zigzag bolt in the distance, a flash, and thunder a moment later.
local function lightningStrike()
	local camera = Workspace.CurrentCamera
	if camera == nil then
		return
	end
	local angle = rng:NextNumber(0, math.pi * 2)
	local distance = rng:NextNumber(140, 260)
	local ground = camera.CFrame.Position + Vector3.new(math.cos(angle) * distance, 0, math.sin(angle) * distance)
	local groundY = 1
	local point = Vector3.new(ground.X, 200, ground.Z)
	local bolt = Instance.new("Folder")
	bolt.Name = "Lightning"
	for _ = 1, 8 do
		local nextPoint = Vector3.new(point.X + rng:NextNumber(-14, 14), point.Y - (200 - groundY) / 8, point.Z + rng:NextNumber(-14, 14))
		local segment = basicPart(Vector3.new(0.8, 0.8, (nextPoint - point).Magnitude), Color3.fromRGB(230, 240, 255), Enum.Material.Neon, 0)
		segment.CFrame = CFrame.lookAt((point + nextPoint) / 2, nextPoint)
		segment.Parent = bolt
		point = nextPoint
	end
	bolt.Parent = effectsFolder
	flash.Brightness = 0.55
	task.delay(0.08, function()
		flash.Brightness = 0
	end)
	task.delay(0.16, function()
		flash.Brightness = 0.35
	end)
	task.delay(0.24, function()
		flash.Brightness = 0
		bolt:Destroy()
	end)
	Sounds.play("Lightning")
	task.delay(rng:NextNumber(0.6, 1.6), function()
		Sounds.play("Thunder")
	end)
end

ReplicatedStorage:GetAttributeChangedSignal("Weather"):Connect(applyWeather)
ReplicatedStorage:GetAttributeChangedSignal("EventSky"):Connect(applyEventSky)
ReplicatedStorage:GetAttributeChangedSignal("EventParticles"):Connect(applyEventSky)
player:GetAttributeChangedSignal("LowGraphics"):Connect(function()
	applyWeather()
	applyEventSky()
end)
applyWeather()
applyEventSky()

task.spawn(function()
	while true do
		task.wait(rng:NextNumber(6, 14))
		if currentWeather == "Thunderstorm" then
			lightningStrike()
		end
	end
end)

--------------------------------------------------------------------------------
-- Shopkeepers
--------------------------------------------------------------------------------

type Group = { Parts: { BasePart }, Originals: { CFrame } }

type Seller = {
	Kind: string,
	Groups: { [string]: Group },
	All: Group,
	Shoulder: CFrame?,
	LeftShoulder: CFrame?,
	Neck: CFrame?,
	Height: number,
	Bubble: TextLabel?,
	Phase: number,
}

local SELLER_LINES: { [string]: { string } } = {
	Robux = {
		"Psst... wanna freeze someone? ❄️",
		"Land mines! Spike traps! Get 'em here!",
		"Boogie Bombs make EVERYONE dance 💃",
		"Best deals in town. Robux only 😎",
		"Somebody stealing? SLAP 'EM 👋",
		"Double Cash forever... just saying 💸",
	},
	Gear = {
		"Speed Coils! Gravity Coils! 🌀",
		"Need to run faster? I got you!",
		"Invisibility Cloak in stock 👻",
		"Every slap counts! 👋",
		"Jump over those lasers, bro!",
	},
}

local function newGroup(): Group
	return { Parts = {}, Originals = {} }
end

local function createBubble(head: BasePart): TextLabel
	local billboard = Instance.new("BillboardGui")
	billboard.Name = "SpeechBubble"
	billboard.Adornee = head
	billboard.Size = UDim2.fromOffset(250, 64)
	billboard.StudsOffsetWorldSpace = Vector3.new(0, head.Size.Y / 2 + 3.2, 0)
	billboard.MaxDistance = 70
	billboard.LightInfluence = 0

	local frame = Instance.new("Frame")
	frame.AnchorPoint = Vector2.new(0.5, 0.5)
	frame.Position = UDim2.fromScale(0.5, 0.5)
	frame.Size = UDim2.fromScale(1, 1)
	frame.BackgroundColor3 = Color3.new(1, 1, 1)
	frame.Parent = billboard
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 14)
	corner.Parent = frame
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 3
	stroke.Color = Color3.fromRGB(30, 30, 40)
	stroke.Parent = frame
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Position = UDim2.fromScale(0.05, 0.1)
	label.Size = UDim2.fromScale(0.9, 0.8)
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = Color3.fromRGB(25, 25, 35)
	label.Parent = frame
	billboard.Parent = effectsFolder
	return label
end

local function loadSeller(stallName: string, kind: string): Seller?
	local stall = map:FindFirstChild(stallName)
	local keeper = if stall then stall:FindFirstChild("Shopkeeper", true) else nil
	if keeper == nil then
		return nil
	end
	local seller: Seller = {
		Kind = kind,
		Groups = { Head = newGroup(), RightArm = newGroup(), LeftArm = newGroup(), Body = newGroup() },
		All = newGroup(),
		Shoulder = nil,
		LeftShoulder = nil,
		Neck = nil,
		Height = 0,
		Bubble = nil,
		Phase = rng:NextNumber(0, 10),
	}
	local lowest, highest = math.huge, -math.huge
	for _, descendant in keeper:GetDescendants() do
		if descendant:IsA("BasePart") then
			local name = descendant.Name
			local groupName = if string.sub(name, 1, 4) == "Head"
				then "Head"
				elseif string.sub(name, 1, 8) == "RightArm" then "RightArm"
				elseif string.sub(name, 1, 7) == "LeftArm" then "LeftArm"
				elseif string.find(name, "Leg") then nil
				else "Body"
			local group = if groupName then seller.Groups[groupName] else nil
			if group then
				table.insert(group.Parts, descendant)
				table.insert(group.Originals, descendant.CFrame)
			end
			table.insert(seller.All.Parts, descendant)
			table.insert(seller.All.Originals, descendant.CFrame)
			lowest = math.min(lowest, descendant.Position.Y - descendant.Size.Y / 2)
			highest = math.max(highest, descendant.Position.Y + descendant.Size.Y / 2)
			if name == "RightArm" then
				seller.Shoulder = descendant.CFrame * CFrame.new(0, descendant.Size.Y / 2 - descendant.Size.X / 2, 0)
			elseif name == "LeftArm" then
				seller.LeftShoulder = descendant.CFrame * CFrame.new(0, descendant.Size.Y / 2 - descendant.Size.X / 2, 0)
			elseif name == "Head" then
				seller.Neck = descendant.CFrame * CFrame.new(0, -descendant.Size.Y / 2, 0)
				seller.Bubble = createBubble(descendant)
			end
		end
	end
	seller.Height = highest - lowest
	return seller
end

local sellers: { Seller } = {}
for _, entry in { { "ShopStall", "Robux" }, { "GearShop", "Gear" } } do
	local seller = loadSeller(entry[1], entry[2])
	if seller then
		table.insert(sellers, seller)
	end
end

-- Moves every part of a group by `rotation` about `pivot`, then by `lift`.
local function poseGroup(group: Group, pivot: CFrame?, rotation: CFrame, lift: Vector3, parts: { BasePart }, frames: { CFrame })
	for index, part in group.Parts do
		local original = group.Originals[index]
		local posed = if pivot then pivot * rotation * pivot:Inverse() * original else original
		table.insert(parts, part)
		table.insert(frames, posed + lift)
	end
end

local function animateSeller(seller: Seller, t: number)
	local phase = t + seller.Phase
	local scale = seller.Height / 6
	local lift = Vector3.new(0, (math.sin(phase * 2) * 0.5 + 0.5) * 0.08 * scale, 0)
	local look = CFrame.Angles(math.sin(phase * 0.7) * math.rad(3), math.sin(phase * 0.45) * math.rad(25), 0)

	local rightArm = CFrame.identity
	local leftArm = CFrame.identity
	if seller.Kind == "Robux" then
		-- Wind up, then a big slap with the glove every few seconds.
		-- The glove is held up in front, so a positive angle pulls it back
		-- over the shoulder and a negative one swings it forward and down.
		local cycle = phase % 3.2
		local angle: number
		if cycle < 0.6 then
			angle = math.rad(35) * math.sin(cycle / 0.6 * math.pi / 2)
		elseif cycle < 0.8 then
			local k = (cycle - 0.6) / 0.2
			angle = math.rad(35) - math.rad(105) * k
		elseif cycle < 1.4 then
			local k = (cycle - 0.8) / 0.6
			angle = -math.rad(70) * (1 - k)
		else
			angle = math.sin(phase * 3) * math.rad(4)
		end
		rightArm = CFrame.Angles(angle, 0, 0)
		leftArm = CFrame.Angles(math.sin(phase * 1.5) * math.rad(6), 0, 0)
	else
		-- A friendly wave overhead.
		local wave = math.sin(phase * 7) * math.rad(22)
		leftArm = CFrame.Angles(0, 0, -math.rad(150)) * CFrame.Angles(0, 0, wave)
		rightArm = CFrame.Angles(math.sin(phase * 1.5) * math.rad(6), 0, 0)
	end

	local parts: { BasePart } = {}
	local frames: { CFrame } = {}
	poseGroup(seller.Groups.Body, nil, CFrame.identity, lift, parts, frames)
	poseGroup(seller.Groups.Head, seller.Neck, look, lift, parts, frames)
	poseGroup(seller.Groups.RightArm, seller.Shoulder, rightArm, lift, parts, frames)
	poseGroup(seller.Groups.LeftArm, seller.LeftShoulder, leftArm, lift, parts, frames)
	Workspace:BulkMoveTo(parts, frames, Enum.BulkMoveMode.FireCFrameChanged)
end

task.spawn(function()
	local index = 0
	while true do
		for _, seller in sellers do
			local bubble = seller.Bubble
			local lines = SELLER_LINES[seller.Kind]
			if bubble and lines then
				bubble.Text = lines[(index % #lines) + 1]
				local frame = bubble.Parent :: Frame
				frame.Size = UDim2.fromScale(0.6, 0.6)
				TweenService:Create(frame, TweenInfo.new(0.25, Enum.EasingStyle.Back), { Size = UDim2.fromScale(1, 1) }):Play()
			end
		end
		index += 1
		task.wait(4.5)
	end
end)

--------------------------------------------------------------------------------
-- Cash Rain coins
--------------------------------------------------------------------------------

type Coin = { Part: BasePart, Target: Vector3, SpawnedAt: number, Seed: number }
local coins: { [BasePart]: Coin } = {}

local function trackCoin(instance: Instance)
	if instance:IsA("BasePart") and instance:GetAttribute("Spin") == true then
		coins[instance] = {
			Part = instance,
			Target = instance.Position,
			SpawnedAt = os.clock(),
			Seed = rng:NextNumber(0, 10),
		}
		local sparkle = Instance.new("Sparkles")
		sparkle.SparkleColor = Color3.fromRGB(255, 240, 120)
		sparkle.Parent = instance
	end
end

task.spawn(function()
	local coinsFolder = map:WaitForChild("Coins", 60)
	if coinsFolder == nil then
		return
	end
	coinsFolder.ChildAdded:Connect(trackCoin)
	coinsFolder.ChildRemoved:Connect(function(child: Instance)
		if child:IsA("BasePart") then
			coins[child] = nil
		end
	end)
	for _, child in coinsFolder:GetChildren() do
		trackCoin(child)
	end
end)

local COIN_FALL_SECONDS = 0.9

local function animateCoins(t: number)
	local parts: { BasePart } = {}
	local frames: { CFrame } = {}
	for part, coin in coins do
		if part.Parent == nil then
			coins[part] = nil
			continue
		end
		local age = t - coin.SpawnedAt
		local fall = if age < COIN_FALL_SECONDS then (1 - age / COIN_FALL_SECONDS) ^ 2 * 70 else 0
		local bob = math.sin(t * 3 + coin.Seed) * 0.3
		table.insert(parts, part)
		table.insert(frames, CFrame.new(coin.Target + Vector3.new(0, fall + bob, 0)) * CFrame.Angles(0, t * 3 + coin.Seed, 0))
	end
	if #parts > 0 then
		Workspace:BulkMoveTo(parts, frames, Enum.BulkMoveMode.FireCFrameChanged)
	end
end

--------------------------------------------------------------------------------
-- Troll item banner
--------------------------------------------------------------------------------

local STUN_TEXT: { [string]: { Text: string, Colour: Color3 } } = {
	Frozen = { Text = "🧊 FROZEN SOLID!", Colour = Color3.fromRGB(140, 220, 255) },
	Spiked = { Text = "🌵 OUCH! STUCK IN SPIKES!", Colour = Color3.fromRGB(255, 120, 120) },
	Launched = { Text = "💥 KABOOM!", Colour = Color3.fromRGB(255, 170, 60) },
	Dancing = { Text = "💃 YOU CAN'T STOP DANCING!", Colour = Color3.fromRGB(255, 120, 230) },
}

local stunGui = Instance.new("ScreenGui")
stunGui.Name = "StunBanner"
stunGui.ResetOnSpawn = false
stunGui.IgnoreGuiInset = true
stunGui.DisplayOrder = 5
local stunLabel = Instance.new("TextLabel")
stunLabel.AnchorPoint = Vector2.new(0.5, 0.5)
stunLabel.Position = UDim2.fromScale(0.5, 0.3)
stunLabel.Size = UDim2.fromScale(0.7, 0.1)
stunLabel.BackgroundTransparency = 1
stunLabel.Font = Enum.Font.FredokaOne
stunLabel.TextScaled = true
stunLabel.TextStrokeTransparency = 0
stunLabel.Visible = false
stunLabel.Parent = stunGui
stunGui.Parent = player:WaitForChild("PlayerGui")

local frozenTint = Instance.new("ColorCorrectionEffect")
frozenTint.Name = "FrozenTint"
frozenTint.Enabled = false
frozenTint.TintColor = Color3.fromRGB(190, 230, 255)
frozenTint.Saturation = -0.3
frozenTint.Parent = Lighting

local function updateStun()
	local kind = player:GetAttribute("Stunned")
	local info = if typeof(kind) == "string" then STUN_TEXT[kind] else nil
	stunLabel.Visible = info ~= nil
	frozenTint.Enabled = kind == "Frozen"
	if info then
		stunLabel.Text = info.Text
		stunLabel.TextColor3 = info.Colour
		stunLabel.Size = UDim2.fromScale(0.4, 0.06)
		TweenService:Create(stunLabel, TweenInfo.new(0.3, Enum.EasingStyle.Back), { Size = UDim2.fromScale(0.7, 0.1) }):Play()
	end
end
player:GetAttributeChangedSignal("Stunned"):Connect(updateStun)
updateStun()

--------------------------------------------------------------------------------
-- Every frame
--------------------------------------------------------------------------------

--------------------------------------------------------------------------------
-- Bases: animated skins (Rainbow trim cycles colours, Galaxy trim pulses and
-- stars drift up inside) and the alarm (a robbed base's lights flash red).
--------------------------------------------------------------------------------

type PlotLook = {
	Trim: { BasePart },
	Lights: { Light },
	LightColours: { Color3 },
	LightBrightness: { number },
	Panels: { BasePart },
	PanelColours: { Color3 },
	AlarmOn: boolean,
	Stars: ParticleEmitter?,
}

local plotLooks: { [Instance]: PlotLook } = {}
for _, plot in plotsFolder:GetChildren() do
	local look: PlotLook = {
		Trim = {},
		Lights = {},
		LightColours = {},
		LightBrightness = {},
		Panels = {},
		PanelColours = {},
		AlarmOn = false,
		Stars = nil,
	}
	for _, descendant in plot:GetDescendants() do
		if descendant:IsA("BasePart") and descendant:GetAttribute("SkinTrim") == true then
			table.insert(look.Trim, descendant)
		end
	end
	local lamps = plot:FindFirstChild("Lamps")
	if lamps then
		for _, descendant in lamps:GetDescendants() do
			if descendant:IsA("Light") then
				table.insert(look.Lights, descendant)
				table.insert(look.LightColours, descendant.Color)
				table.insert(look.LightBrightness, descendant.Brightness)
			elseif descendant:IsA("BasePart") and string.match(descendant.Name, "^Lamp") then
				table.insert(look.Panels, descendant)
				table.insert(look.PanelColours, descendant.Color)
			end
		end
	end
	plotLooks[plot] = look
end

local GALAXY_A = Color3.fromRGB(190, 110, 255)
local GALAXY_B = Color3.fromRGB(90, 220, 255)
local ALARM_RED = Color3.fromRGB(255, 30, 30)

local function animatePlots(t: number)
	for plot, look in plotLooks do
		local effect = plot:GetAttribute("SkinEffect")
		if effect == "Rainbow" then
			for index, part in look.Trim do
				part.Color = Color3.fromHSV((t * 0.2 + index * 0.035) % 1, 0.85, 1)
			end
		elseif effect == "Galaxy" then
			for index, part in look.Trim do
				part.Color = GALAXY_A:Lerp(GALAXY_B, 0.5 + 0.5 * math.sin(t * 1.5 + index * 0.4))
			end
		end
		-- Stars drifting up inside a Galaxy base.
		local wantStars = effect == "Galaxy" and not lowGraphics()
		if wantStars and look.Stars == nil then
			local floor = plot:FindFirstChild("Floor")
			if floor and floor:IsA("BasePart") then
				local stars = Instance.new("ParticleEmitter")
				stars.Name = "GalaxyStars"
				stars.Rate = 8
				stars.Lifetime = NumberRange.new(3, 5)
				stars.Speed = NumberRange.new(1, 3)
				stars.EmissionDirection = Enum.NormalId.Top
				stars.LightEmission = 1
				stars.Size = NumberSequence.new({
					NumberSequenceKeypoint.new(0, 0),
					NumberSequenceKeypoint.new(0.3, 0.35),
					NumberSequenceKeypoint.new(1, 0),
				})
				stars.Color = ColorSequence.new(GALAXY_A, Color3.new(1, 1, 1))
				stars.Parent = floor
				look.Stars = stars
			end
		elseif not wantStars and look.Stars then
			(look.Stars :: ParticleEmitter):Destroy()
			look.Stars = nil
		end

		local alarm = plot:GetAttribute("Alarm") == true
		if alarm then
			local on = math.sin(t * 12) > 0
			for index, light in look.Lights do
				light.Color = ALARM_RED
				light.Brightness = look.LightBrightness[index] * (if on then 2 else 0.4)
			end
			for _, panel in look.Panels do
				panel.Color = if on then ALARM_RED else Color3.fromRGB(90, 10, 10)
			end
			look.AlarmOn = true
		elseif look.AlarmOn then
			look.AlarmOn = false
			for index, light in look.Lights do
				light.Color = look.LightColours[index]
				light.Brightness = look.LightBrightness[index]
			end
			for index, panel in look.Panels do
				panel.Color = look.PanelColours[index]
			end
		end
	end
end

local lastFrame = os.clock()
RunService.RenderStepped:Connect(function()
	local t = os.clock()
	local dt = math.min(t - lastFrame, 0.1)
	lastFrame = t
	local camera = Workspace.CurrentCamera
	local centre = if camera then camera.CFrame.Position else Vector3.zero

	local weather = weatherLayer
	if weather then
		stepLayer(weather, centre, t, dt)
	end
	local event = eventLayer
	if event then
		stepLayer(event, centre, t, dt)
	end
	if rainbowSky then
		eventTint.TintColor = Color3.fromHSV((t * 0.08) % 1, 0.12, 1)
	end
	for _, seller in sellers do
		animateSeller(seller, t)
	end
	animateCoins(t)
	animatePlots(t)
end)

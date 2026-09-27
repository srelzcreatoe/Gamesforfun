--!strict
--[[
	LoadingScreen (client)
	Location: ReplicatedFirst (LocalScript)

	The title and loading screen, like Grow a Garden's: the game's world
	blurred behind it with the camera drifting over the map, a big bouncy
	cartoon "SNATCH THE BRAINROT" logo, a loading bar with tips, a Skip button,
	and a PLAY button once everything is ready. It needs nothing else from the
	game, so it shows as soon as the player joins; the HUD and Roblox's own
	menus stay hidden until the player goes in.
]]

local ContentProvider = game:GetService("ContentProvider")
local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedFirst = game:GetService("ReplicatedFirst")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local StarterGui = game:GetService("StarterGui")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

pcall(function()
	ReplicatedFirst:RemoveDefaultLoadingScreen()
end)

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui") :: PlayerGui

local TITLE_FONT = Enum.Font.LuckiestGuy
local TEXT_FONT = Enum.Font.FredokaOne
local OUTLINE = Color3.fromRGB(45, 20, 75)
local SKIP_AFTER_SECONDS = 1.5
-- Whatever is still loading after this long, PLAY shows up anyway.
local GIVE_UP_SECONDS = 30
local CLICK_SOUND = "rbxassetid://17208396156"
local rgb = Color3.fromRGB

local TIPS = {
	"Step on the green pads in your base to collect your Cash!",
	"Lock your base with the red button to zap thieves with lasers!",
	"Hold E on someone else's brainrot and run it home to steal it!",
	"Rebirth to earn more and unlock the next floor of your base!",
	"Find every brainrot to fill the Index and earn more forever!",
	"Events like Gold Rush and Blood Moon bring rare mutations!",
	"Make a brainrot your guard and it knocks thieves out of your base!",
	"Team up in a crew: you earn more for every crewmate here!",
	"Lucky blocks can pop into a Secret brainrot!",
	"Brainrots level up while they stand on their pedestals!",
}

local function create(className: string, properties: { [string]: any }, children: { Instance }?): Instance
	local instance = Instance.new(className)
	for key, value in properties do
		(instance :: any)[key] = value
	end
	if children then
		for _, child in children do
			child.Parent = instance
		end
	end
	return instance
end

local function corner(radius: UDim): Instance
	return create("UICorner", { CornerRadius = radius })
end

local function stroke(colour: Color3, thickness: number): UIStroke
	return create("UIStroke", {
		Color = colour,
		Thickness = thickness,
		LineJoinMode = Enum.LineJoinMode.Round,
	}) :: UIStroke
end

local function gradient(top: Color3, bottom: Color3): Instance
	return create("UIGradient", {
		Color = ColorSequence.new(top, bottom),
		Rotation = 90,
	})
end

local function playClick()
	local sound = Instance.new("Sound")
	sound.SoundId = CLICK_SOUND
	sound.Volume = 0.6
	sound.Parent = SoundService
	sound:Play()
	task.delay(2, function()
		sound:Destroy()
	end)
end

--------------------------------------------------------------------------------
-- The screen
--------------------------------------------------------------------------------

local screen = create("ScreenGui", {
	Name = "LoadingScreen",
	IgnoreGuiInset = true,
	ResetOnSpawn = false,
	DisplayOrder = 100,
	ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
}) :: ScreenGui

-- A soft purple tint over the blurred world, darker at the top and bottom.
local tint = create("Frame", {
	Name = "Tint",
	Size = UDim2.fromScale(1, 1),
	BackgroundColor3 = rgb(40, 16, 70),
	BackgroundTransparency = 0,
	BorderSizePixel = 0,
}, {
	create("UIGradient", {
		Rotation = 90,
		Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0, 0.3),
			NumberSequenceKeypoint.new(0.45, 0.72),
			NumberSequenceKeypoint.new(0.75, 0.6),
			NumberSequenceKeypoint.new(1, 0.25),
		}),
	}),
}) :: Frame
tint.Parent = screen

-- Things floating up behind the logo: cash, brains, gems and stars.
local floaters = create("Frame", {
	Name = "Floaters",
	Size = UDim2.fromScale(1, 1),
	BackgroundTransparency = 1,
	ClipsDescendants = true,
}) :: Frame
floaters.Parent = screen
local FLOATER_ICONS = { "💰", "🧠", "💎", "⭐", "🍕", "💵" }
type Floater = { Label: TextLabel, X: number, Speed: number, Offset: number, Sway: number }
local floaterList: { Floater } = {}
for index = 1, 14 do
	local label = create("TextLabel", {
		BackgroundTransparency = 1,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Size = UDim2.fromScale(0.06, 0.06),
		SizeConstraint = Enum.SizeConstraint.RelativeYY,
		Text = FLOATER_ICONS[(index - 1) % #FLOATER_ICONS + 1],
		TextScaled = true,
		TextTransparency = 0.35,
		Font = TEXT_FONT,
	}) :: TextLabel
	label.Parent = floaters
	table.insert(floaterList, {
		Label = label,
		X = (index - 0.5) / 14 + (math.random() - 0.5) * 0.05,
		Speed = 0.035 + math.random() * 0.035,
		Offset = math.random(),
		Sway = math.random() * math.pi * 2,
	})
end

-- The logo: "SNATCH THE" over a huge "BRAINROT", every letter its own candy
-- colour with a thick outline and a shadow, bobbing in a wave.
local logo = create("Frame", {
	Name = "Logo",
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.3),
	Size = UDim2.fromScale(0.86, 0.4),
	BackgroundTransparency = 1,
}, {
	create("UIAspectRatioConstraint", { AspectRatio = 2.3 }),
	create("UISizeConstraint", { MaxSize = Vector2.new(980, 426) }),
}) :: Frame
logo.Parent = screen

type Outlined = { Label: TextLabel, Stroke: UIStroke, Ratio: number }
local outlined: { Outlined } = {}
local function outline(label: TextLabel, ratio: number)
	local lineStroke = stroke(OUTLINE, 4)
	lineStroke.Parent = label
	table.insert(outlined, { Label = label, Stroke = lineStroke, Ratio = ratio })
end

local titleLine = create("TextLabel", {
	Name = "SnatchThe",
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.fromScale(0.5, 0),
	Size = UDim2.fromScale(0.78, 0.34),
	BackgroundTransparency = 1,
	Font = TITLE_FONT,
	Text = "SNATCH THE",
	TextScaled = true,
	TextColor3 = rgb(255, 255, 255),
	Rotation = -3,
}, { gradient(rgb(255, 255, 255), rgb(255, 225, 120)) }) :: TextLabel
titleLine.Parent = logo
outline(titleLine, 0.07)

local LETTER_COLOURS = {
	rgb(255, 95, 162),
	rgb(255, 159, 28),
	rgb(255, 214, 55),
	rgb(110, 224, 110),
	rgb(62, 197, 255),
	rgb(166, 108, 255),
	rgb(255, 95, 162),
	rgb(255, 159, 28),
}
local lettersRow = create("Frame", {
	Name = "Brainrot",
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.fromScale(0.5, 1),
	Size = UDim2.fromScale(1, 0.66),
	BackgroundTransparency = 1,
}, {
	create("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		VerticalAlignment = Enum.VerticalAlignment.Center,
		SortOrder = Enum.SortOrder.LayoutOrder,
		Padding = UDim.new(0, 0),
	}),
}) :: Frame
lettersRow.Parent = logo

type Letter = { Holder: Frame, Face: TextLabel, Shadow: TextLabel, Index: number }
local letters: { Letter } = {}
for index, char in string.split("BRAINROT", "") do
	local holder = create("Frame", {
		Name = "Letter" .. index,
		LayoutOrder = index,
		Size = UDim2.fromScale(0.118, 1),
		BackgroundTransparency = 1,
	}) :: Frame
	local shadow = create("TextLabel", {
		Name = "Shadow",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.56),
		Size = UDim2.fromScale(1.15, 1),
		BackgroundTransparency = 1,
		Font = TITLE_FONT,
		Text = char,
		TextScaled = true,
		TextColor3 = OUTLINE,
	}) :: TextLabel
	outline(shadow, 0.07)
	shadow.Parent = holder
	local colour = LETTER_COLOURS[index]
	local face = create("TextLabel", {
		Name = "Face",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromScale(1.15, 1),
		BackgroundTransparency = 1,
		Font = TITLE_FONT,
		Text = char,
		TextScaled = true,
		TextColor3 = rgb(255, 255, 255),
	}, { gradient(colour:Lerp(rgb(255, 255, 255), 0.45), colour) }) :: TextLabel
	outline(face, 0.07)
	face.Parent = holder
	holder.Parent = lettersRow
	table.insert(letters, { Holder = holder, Face = face, Shadow = shadow, Index = index })
end

local tagline = create("TextLabel", {
	Name = "Tagline",
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.fromScale(0.5, 0.52),
	Size = UDim2.fromScale(0.7, 0.05),
	BackgroundTransparency = 1,
	Font = TEXT_FONT,
	Text = "Buy them. Steal them. Get rich!",
	TextScaled = true,
	TextColor3 = rgb(255, 255, 255),
}, { create("UITextSizeConstraint", { MaxTextSize = 30 }) }) :: TextLabel
tagline.Parent = screen
outline(tagline, 0.08)

-- The loading bar, the line above it saying what's loading and a tip below.
local barArea = create("Frame", {
	Name = "LoadingArea",
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.74),
	Size = UDim2.fromScale(0.62, 0.2),
	BackgroundTransparency = 1,
}, { create("UISizeConstraint", { MaxSize = Vector2.new(620, 200) }) }) :: Frame
barArea.Parent = screen

local status = create("TextLabel", {
	Name = "Status",
	Size = UDim2.fromScale(1, 0.24),
	BackgroundTransparency = 1,
	Font = TEXT_FONT,
	Text = "Loading the map...",
	TextScaled = true,
	TextColor3 = rgb(255, 255, 255),
}, { create("UITextSizeConstraint", { MaxTextSize = 28 }) }) :: TextLabel
status.Parent = barArea
outline(status, 0.08)

local bar = create("Frame", {
	Name = "Bar",
	Position = UDim2.fromScale(0, 0.3),
	Size = UDim2.fromScale(1, 0.26),
	BackgroundColor3 = rgb(35, 22, 60),
	BackgroundTransparency = 0.15,
}, { corner(UDim.new(1, 0)), stroke(rgb(255, 255, 255), 3) }) :: Frame
bar.Parent = barArea
local fill = create("Frame", {
	Name = "Fill",
	Size = UDim2.fromScale(0, 1),
	BackgroundColor3 = rgb(255, 255, 255),
}, { corner(UDim.new(1, 0)), gradient(rgb(150, 255, 110), rgb(40, 185, 60)) }) :: Frame
fill.Parent = bar
local percent = create("TextLabel", {
	Name = "Percent",
	Size = UDim2.fromScale(1, 1),
	BackgroundTransparency = 1,
	Font = TITLE_FONT,
	Text = "0%",
	TextScaled = true,
	TextColor3 = rgb(255, 255, 255),
	ZIndex = 2,
}, { create("UITextSizeConstraint", { MaxTextSize = 30 }), create("UIPadding", { PaddingTop = UDim.new(0.14, 0), PaddingBottom = UDim.new(0.1, 0) }) }) :: TextLabel
percent.Parent = bar
outline(percent, 0.08)

local tip = create("TextLabel", {
	Name = "Tip",
	Position = UDim2.fromScale(0, 0.64),
	Size = UDim2.fromScale(1, 0.34),
	BackgroundTransparency = 1,
	Font = TEXT_FONT,
	Text = "💡 " .. TIPS[math.random(1, #TIPS)],
	TextScaled = true,
	TextWrapped = true,
	TextColor3 = rgb(255, 240, 180),
}, { create("UITextSizeConstraint", { MaxTextSize = 22 }) }) :: TextLabel
tip.Parent = barArea
outline(tip, 0.06)

-- Chunky cartoon buttons: a coloured block with a darker base and a shine.
local function cartoonButton(name: string, text: string, colour: Color3, properties: { [string]: any }): TextButton
	local button = create("TextButton", {
		Name = name,
		AutoButtonColor = false,
		BackgroundColor3 = colour,
		Font = TITLE_FONT,
		Text = text,
		TextScaled = true,
		TextColor3 = rgb(255, 255, 255),
		Visible = false,
	}, {
		corner(UDim.new(0.3, 0)),
		gradient(colour:Lerp(rgb(255, 255, 255), 0.35), colour),
		create("UIPadding", {
			PaddingTop = UDim.new(0.18, 0),
			PaddingBottom = UDim.new(0.12, 0),
			PaddingLeft = UDim.new(0.08, 0),
			PaddingRight = UDim.new(0.08, 0),
		}),
		create("UIScale", { Name = "Pop", Scale = 1 }),
	}) :: TextButton
	for key, value in properties do
		(button :: any)[key] = value
	end
	local edge = stroke(OUTLINE, 4)
	edge.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	edge.Parent = button
	outline(button :: any, 0.07)
	button.Parent = screen
	return button
end

local skipButton = cartoonButton("Skip", "SKIP ⏩", rgb(255, 95, 95), {
	AnchorPoint = Vector2.new(1, 1),
	Position = UDim2.new(1, -24, 1, -24),
	Size = UDim2.fromScale(0.16, 0.08),
})
create("UISizeConstraint", { MinSize = Vector2.new(120, 44), MaxSize = Vector2.new(200, 70) }).Parent = skipButton

local playButton = cartoonButton("Play", "PLAY!", rgb(70, 215, 80), {
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.74),
	Size = UDim2.fromScale(0.3, 0.13),
})
create("UISizeConstraint", { MinSize = Vector2.new(200, 66), MaxSize = Vector2.new(360, 118) }).Parent = playButton

screen.Parent = playerGui

--------------------------------------------------------------------------------
-- The blurred world behind it
--------------------------------------------------------------------------------

local blur = Instance.new("BlurEffect")
blur.Name = "LoadingBlur"
blur.Size = 22
blur.Parent = Lighting

-- The camera drifts in a slow circle over the middle of the map.
local camera = Workspace.CurrentCamera
local cameraStarted = os.clock()
local function driftCamera()
	local current = Workspace.CurrentCamera
	if current == nil then
		return
	end
	camera = current
	current.CameraType = Enum.CameraType.Scriptable
	local angle = (os.clock() - cameraStarted) * 0.05 + 0.6
	local eye = Vector3.new(math.cos(angle) * 170, 85, math.sin(angle) * 120)
	current.CFrame = CFrame.lookAt(eye, Vector3.new(0, 8, 0))
end
driftCamera()
RunService:BindToRenderStep("LoadingCamera", Enum.RenderPriority.Camera.Value + 1, driftCamera)

-- The HUD and Roblox's own menus stay hidden until the player goes in.
local hiddenGuis: { ScreenGui } = {}
local function hideGui(child: Instance)
	if child:IsA("ScreenGui") and child ~= screen and child.Enabled then
		child.Enabled = false
		table.insert(hiddenGuis, child)
	end
end
for _, child in playerGui:GetChildren() do
	hideGui(child)
end
local guiAdded = playerGui.ChildAdded:Connect(hideGui)
task.spawn(function()
	-- The core UI can take a moment to be ready.
	for _ = 1, 20 do
		if pcall(function()
			StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.All, false)
		end) then
			return
		end
		task.wait(0.25)
	end
end)

--------------------------------------------------------------------------------
-- Loading
--------------------------------------------------------------------------------

local startedAt = os.clock()
local biggestQueue = 1
-- (progress 0..1 of each step, what it says while it's the one loading)
local function loadingSteps(): { { number | string } }
	local loaded = game:IsLoaded()
	local queue = ContentProvider.RequestQueueSize
	biggestQueue = math.max(biggestQueue, queue)
	local assets = if loaded then 1 - queue / biggestQueue else 0
	local dataLoaded = player:GetAttribute("DataLoaded") == true
	local ready = ReplicatedStorage:FindFirstChild("Remotes") ~= nil
		and playerGui:FindFirstChild("GameHud") ~= nil
		and player.Character ~= nil
	return {
		{ if loaded then 1 else 0, "Loading the map..." },
		{ assets, "Loading the brainrots..." },
		{ if dataLoaded then 1 else 0, "Waking up your brainrots..." },
		{ if ready then 1 else 0, "Getting your base ready..." },
	}
end

local shown = 0
local finished = false
local loadingDone = false
local playShownAt: number? = nil
local tipIndex = 0

local function popIn(button: TextButton)
	local pop = button:FindFirstChild("Pop") :: UIScale?
	button.Visible = true
	if pop then
		pop.Scale = 0.2
		TweenService:Create(pop, TweenInfo.new(0.45, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()
	end
end

local function showPlay()
	if loadingDone or finished then
		return
	end
	loadingDone = true
	status.Text = "Ready!"
	percent.Text = "100%"
	fill.Size = UDim2.fromScale(1, 1)
	skipButton.Visible = false
	task.delay(0.35, function()
		if finished then
			return
		end
		TweenService:Create(barArea, TweenInfo.new(0.25), { Position = UDim2.fromScale(0.5, 0.9) }):Play()
		bar.Visible = false
		status.Visible = false
		popIn(playButton)
		playShownAt = os.clock()
	end)
end

local function finish()
	if finished then
		return
	end
	finished = true
	playClick()
	RunService:UnbindFromRenderStep("LoadingCamera")
	guiAdded:Disconnect()
	for _, gui in hiddenGuis do
		if gui.Parent then
			gui.Enabled = true
		end
	end
	pcall(function()
		StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.All, true)
	end)
	-- Back to the normal camera, following the player.
	if camera then
		camera.CameraType = Enum.CameraType.Custom
		local character = player.Character
		local humanoid = if character then character:FindFirstChildOfClass("Humanoid") else nil
		if humanoid then
			camera.CameraSubject = humanoid
		end
	end
	-- Everything flies and fades away.
	local out = TweenInfo.new(0.5, Enum.EasingStyle.Quad, Enum.EasingDirection.In)
	TweenService:Create(blur, out, { Size = 0 }):Play()
	TweenService:Create(logo, out, { Position = UDim2.fromScale(0.5, -0.4) }):Play()
	TweenService:Create(barArea, out, { Position = UDim2.fromScale(0.5, 1.4) }):Play()
	TweenService:Create(playButton, out, { Position = UDim2.fromScale(0.5, 1.4) }):Play()
	TweenService:Create(skipButton, out, { Position = UDim2.new(1, -24, 1, 140) }):Play()
	TweenService:Create(tint, out, { BackgroundTransparency = 1 }):Play()
	for _, item in { tagline, status, percent, tip } do
		TweenService:Create(item, out, { TextTransparency = 1 }):Play()
	end
	for _, floater in floaterList do
		TweenService:Create(floater.Label, out, { TextTransparency = 1 }):Play()
	end
	task.delay(0.6, function()
		screen:Destroy()
		blur:Destroy()
	end)
end

skipButton.Activated:Connect(finish)
playButton.Activated:Connect(finish)
task.delay(SKIP_AFTER_SECONDS, function()
	if not finished and not loadingDone then
		popIn(skipButton)
	end
end)

-- Everything that moves: the logo, the floaters, the bar and the tips.
local animation: RBXScriptConnection? = nil
animation = RunService.RenderStepped:Connect(function(dt: number)
	if finished then
		if animation then
			animation:Disconnect()
		end
		return
	end
	local t = os.clock() - startedAt

	-- Outlines stay the same thickness for the text's size on any screen.
	for _, item in outlined do
		local size = item.Label.AbsoluteSize
		local height = if size then size.Y else 0
		if height > 0 then
			item.Stroke.Thickness = math.clamp(height * item.Ratio, 1.5, 8)
		end
	end

	-- The letters bob in a wave and wobble; the whole logo breathes.
	for _, letter in letters do
		local wave = t * 3 - letter.Index * 0.55
		local y = math.sin(wave) * 0.07
		local turn = math.sin(wave * 0.8 + letter.Index) * 5
		letter.Face.Position = UDim2.fromScale(0.5, 0.5 + y)
		letter.Face.Rotation = turn
		letter.Shadow.Position = UDim2.fromScale(0.5, 0.56 + y)
		letter.Shadow.Rotation = turn
	end
	titleLine.Rotation = -3 + math.sin(t * 1.6) * 2
	logo.Size = UDim2.fromScale(0.86 * (1 + math.sin(t * 2) * 0.015), 0.4)

	for _, floater in floaterList do
		local rise = ((t * floater.Speed + floater.Offset) % 1)
		floater.Label.Position = UDim2.fromScale(floater.X + math.sin(t + floater.Sway) * 0.015, 1.08 - rise * 1.16)
		floater.Label.Rotation = math.sin(t * 1.3 + floater.Sway) * 15
	end

	-- PLAY pulses once it has popped in.
	local pop = playButton:FindFirstChild("Pop") :: UIScale?
	if pop and playShownAt and os.clock() - playShownAt > 0.5 then
		pop.Scale = 1 + math.sin(t * 5) * 0.05
	end

	-- A new tip every few seconds.
	local nextTip = math.floor(t / 4.5)
	if nextTip ~= tipIndex then
		tipIndex = nextTip
		tip.Text = "💡 " .. TIPS[(nextTip % #TIPS) + 1]
	end

	if loadingDone then
		return
	end
	local total, current = 0, nil
	local steps = loadingSteps()
	for _, step in steps do
		local amount = step[1] :: number
		total += amount / #steps
		if amount < 1 and current == nil then
			current = step[2] :: string
		end
	end
	if t > GIVE_UP_SECONDS then
		total = 1
	end
	-- The bar eases towards the real progress (and never goes backwards).
	shown = math.max(shown, shown + (total - shown) * math.min(1, dt * 3))
	if total >= 1 and shown > 0.995 then
		shown = 1
	end
	fill.Size = UDim2.fromScale(math.max(shown, 0.06), 1)
	percent.Text = string.format("%d%%", math.floor(shown * 100))
	if current then
		status.Text = current
	end
	if shown >= 1 then
		showPlay()
	end
end)

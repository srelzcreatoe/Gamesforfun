-- Everything the player sees on screen: round status and timer, their role,
-- messages, the item they are holding (with a Drop button), a red glow when
-- the monster is close, and the jumpscare when they get caught. The modules
-- inside this script add the skin shop, voting, the keypad, spectating and
-- the monster's trap button. All of the UI is built in code, so there is
-- nothing to set up in StarterGui.

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")

local Config = require(ReplicatedStorage:WaitForChild("Config"))
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local gameState = ReplicatedStorage:WaitForChild("GameState")
local player = Players.LocalPlayer

local UI = require(script.UI)
local create, round = UI.create, UI.round
local FONT, RED, WHITE, BLACK = UI.FONT, UI.RED, UI.WHITE, UI.BLACK

---------------------------------------------------------------------------
-- HUD
---------------------------------------------------------------------------

local hud = create("ScreenGui", {
	Name = "GameHud",
	ResetOnSpawn = false,
	ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	Parent = player:WaitForChild("PlayerGui"),
})

local statusFrame = create("Frame", {
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 8),
	Size = UDim2.new(0.7, 0, 0, 40),
	BackgroundColor3 = BLACK,
	BackgroundTransparency = 0.35,
	Parent = hud,
})
round(statusFrame)
create("UISizeConstraint", { MaxSize = Vector2.new(460, 40), Parent = statusFrame })

local statusLabel = create("TextLabel", {
	Position = UDim2.new(0, 12, 0, 0),
	Size = UDim2.new(1, -90, 1, 0),
	BackgroundTransparency = 1,
	Font = FONT,
	TextSize = 18,
	TextColor3 = WHITE,
	TextXAlignment = Enum.TextXAlignment.Left,
	TextTruncate = Enum.TextTruncate.AtEnd,
	Text = "",
	Parent = statusFrame,
})

local timerLabel = create("TextLabel", {
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, -12, 0, 0),
	Size = UDim2.new(0, 70, 1, 0),
	BackgroundTransparency = 1,
	Font = FONT,
	TextSize = 20,
	TextColor3 = RED,
	TextXAlignment = Enum.TextXAlignment.Right,
	Text = "",
	Parent = statusFrame,
})

local roleLabel = create("TextLabel", {
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 52),
	Size = UDim2.new(0.7, 0, 0, 22),
	BackgroundTransparency = 1,
	Font = FONT,
	TextSize = 16,
	TextStrokeTransparency = 0.5,
	Text = "",
	Visible = false,
	Parent = hud,
})

local messages = create("Frame", {
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 80),
	Size = UDim2.new(0.7, 0, 0, 170),
	BackgroundTransparency = 1,
	Parent = hud,
})
create("UISizeConstraint", { MaxSize = Vector2.new(460, 170), Parent = messages })
create("UIListLayout", {
	HorizontalAlignment = Enum.HorizontalAlignment.Center,
	SortOrder = Enum.SortOrder.LayoutOrder,
	Padding = UDim.new(0, 4),
	Parent = messages,
})

local heldFrame = create("Frame", {
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.new(0.5, 0, 1, -20),
	Size = UDim2.new(0, 290, 0, 50),
	BackgroundColor3 = BLACK,
	BackgroundTransparency = 0.35,
	Visible = false,
	Parent = hud,
})
round(heldFrame)

local swatch = create("Frame", {
	AnchorPoint = Vector2.new(0, 0.5),
	Position = UDim2.new(0, 10, 0.5, 0),
	Size = UDim2.new(0, 28, 0, 28),
	Parent = heldFrame,
})
round(swatch, 14)

local heldLabel = create("TextLabel", {
	Position = UDim2.new(0, 46, 0, 0),
	Size = UDim2.new(1, -156, 1, 0),
	BackgroundTransparency = 1,
	Font = FONT,
	TextSize = 18,
	TextColor3 = WHITE,
	TextXAlignment = Enum.TextXAlignment.Left,
	TextTruncate = Enum.TextTruncate.AtEnd,
	Text = "",
	Parent = heldFrame,
})

local dropButton = create("TextButton", {
	AnchorPoint = Vector2.new(1, 0.5),
	Position = UDim2.new(1, -8, 0.5, 0),
	Size = UDim2.new(0, 96, 0, 36),
	BackgroundColor3 = Color3.fromRGB(150, 30, 30),
	Font = FONT,
	TextSize = 16,
	TextColor3 = WHITE,
	Text = if UserInputService.KeyboardEnabled then "Drop (G)" else "Drop",
	Parent = heldFrame,
})
round(dropButton)

---------------------------------------------------------------------------
-- Effects layer (covers the whole screen, including behind the top bar)
---------------------------------------------------------------------------

local effects = create("ScreenGui", {
	Name = "GameEffects",
	ResetOnSpawn = false,
	IgnoreGuiInset = true,
	DisplayOrder = 10,
	Parent = player:WaitForChild("PlayerGui"),
})

-- Red glow around the edges of the screen when the monster is near.
local vignette = create("CanvasGroup", {
	Size = UDim2.fromScale(1, 1),
	BackgroundTransparency = 1,
	GroupTransparency = 1,
	Parent = effects,
})
for _, edge in {
	{ size = UDim2.fromScale(1, 0.3), position = UDim2.fromScale(0, 0), rotation = 90 },
	{ size = UDim2.fromScale(1, 0.3), position = UDim2.fromScale(0, 0.7), rotation = -90 },
	{ size = UDim2.fromScale(0.25, 1), position = UDim2.fromScale(0, 0), rotation = 0 },
	{ size = UDim2.fromScale(0.25, 1), position = UDim2.fromScale(0.75, 0), rotation = 180 },
} do
	local frame = create("Frame", {
		Size = edge.size,
		Position = edge.position,
		BackgroundColor3 = RED,
		BorderSizePixel = 0,
		Parent = vignette,
	})
	create("UIGradient", {
		Rotation = edge.rotation,
		Transparency = NumberSequence.new(0, 1),
		Parent = frame,
	})
end

-- Jumpscare: a shaking black screen with two huge red eyes.
local scare = create("Frame", {
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.fromScale(1.1, 1.1),
	BackgroundColor3 = BLACK,
	BorderSizePixel = 0,
	Visible = false,
	ZIndex = 10,
	Parent = effects,
})
local eyes = {}
for _, x in { 0.38, 0.62 } do
	local eye = create("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(x, 0.42),
		Size = UDim2.fromScale(0.02, 0.02),
		BackgroundColor3 = RED,
		ZIndex = 11,
		Parent = scare,
	})
	round(eye, 1000)
	create("UIAspectRatioConstraint", { AspectRatio = 1, DominantAxis = Enum.DominantAxis.Width, Parent = eye })
	create("UIStroke", { Color = RED, Thickness = 8, Transparency = 0.4, Parent = eye })
	table.insert(eyes, eye)
end
create("TextLabel", {
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.7),
	Size = UDim2.fromScale(0.6, 0.15),
	BackgroundTransparency = 1,
	Font = Enum.Font.Creepster,
	TextScaled = true,
	TextColor3 = RED,
	Text = "CAUGHT!",
	ZIndex = 11,
	Parent = scare,
})

---------------------------------------------------------------------------
-- Wiring
---------------------------------------------------------------------------

local function formatTime(seconds: number): string
	return string.format("%d:%02d", seconds // 60, seconds % 60)
end

local function refreshStatus()
	statusLabel.Text = tostring(gameState:GetAttribute("Status") or "")
	local timeLeft = gameState:GetAttribute("TimeLeft")
	timerLabel.Text = if typeof(timeLeft) == "number" and timeLeft > 0 then formatTime(timeLeft) else ""
end
gameState:GetAttributeChangedSignal("Status"):Connect(refreshStatus)
gameState:GetAttributeChangedSignal("TimeLeft"):Connect(refreshStatus)
refreshStatus()

local function refreshRole()
	local role = player:GetAttribute("Role")
	if role == "Survivor" then
		roleLabel.Text = "You are a SURVIVOR: find the items and escape!"
		roleLabel.TextColor3 = Color3.fromRGB(120, 255, 150)
	elseif role == "Monster" then
		roleLabel.Text = `You are {string.upper(Config.MonsterName)}: catch everyone!`
		roleLabel.TextColor3 = RED
	end
	roleLabel.Visible = role ~= nil
end
player:GetAttributeChangedSignal("Role"):Connect(refreshRole)
refreshRole()

local function refreshHeld()
	local itemId = player:GetAttribute("HeldItem")
	if typeof(itemId) ~= "string" then
		heldFrame.Visible = false
		return
	end
	local info = Config.Items[itemId]
	heldLabel.Text = if info then info.DisplayName else itemId
	swatch.BackgroundColor3 = if info then info.Color else WHITE
	heldFrame.Visible = true
end
player:GetAttributeChangedSignal("HeldItem"):Connect(refreshHeld)
refreshHeld()

local function requestDrop()
	remotes.DropItem:FireServer()
end
dropButton.Activated:Connect(requestDrop)
UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed then
		return
	end
	if input.KeyCode == Enum.KeyCode.G or input.KeyCode == Enum.KeyCode.ButtonY then
		requestDrop()
	end
end)

local messageCount = 0
remotes.Notify.OnClientEvent:Connect(function(text: string)
	messageCount += 1
	local label = create("TextLabel", {
		Size = UDim2.new(1, 0, 0, 26),
		BackgroundColor3 = BLACK,
		BackgroundTransparency = 0.45,
		Font = FONT,
		TextSize = 16,
		TextColor3 = WHITE,
		TextTruncate = Enum.TextTruncate.AtEnd,
		Text = text,
		LayoutOrder = messageCount,
		Parent = messages,
	})
	round(label, 6)

	-- Keep only the newest few messages.
	local labels = {}
	for _, child in messages:GetChildren() do
		if child:IsA("TextLabel") then
			table.insert(labels, child)
		end
	end
	table.sort(labels, function(a, b)
		return a.LayoutOrder < b.LayoutOrder
	end)
	for index = 1, #labels - 5 do
		labels[index]:Destroy()
	end

	task.delay(4, function()
		if label.Parent then
			local fade = TweenService:Create(label, TweenInfo.new(0.6), { TextTransparency = 1, BackgroundTransparency = 1 })
			fade:Play()
			fade.Completed:Wait()
			label:Destroy()
		end
	end)
end)

remotes.Jumpscare.OnClientEvent:Connect(function()
	scare.Visible = true
	for _, eye in eyes do
		eye.Size = UDim2.fromScale(0.02, 0.02)
		TweenService:Create(eye, TweenInfo.new(0.25, Enum.EasingStyle.Back, Enum.EasingDirection.Out), {
			Size = UDim2.fromScale(0.17, 0.17),
		}):Play()
	end

	if Config.JumpscareSoundId ~= "" then
		local sound = create("Sound", { SoundId = Config.JumpscareSoundId, Volume = 1, Parent = SoundService })
		sound:Play()
		sound.Ended:Once(function()
			sound:Destroy()
		end)
	end

	local finish = os.clock() + Config.JumpscareTime
	while os.clock() < finish do
		scare.Position = UDim2.new(0.5, math.random(-16, 16), 0.5, math.random(-16, 16))
		scare.BackgroundColor3 = if math.random() < 0.25 then Color3.fromRGB(70, 0, 0) else BLACK
		task.wait(0.03)
	end
	scare.Visible = false
	scare.Position = UDim2.fromScale(0.5, 0.5)
end)

-- Monster-nearby glow. Pulses faster the closer it gets.
RunService.RenderStepped:Connect(function()
	local intensity = 0
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if root and root:IsA("BasePart") and player:GetAttribute("Role") == "Survivor" then
		for _, monster in CollectionService:GetTagged("Monster") do
			if monster:IsA("Model") and monster ~= character and monster:IsDescendantOf(workspace) then
				local distance = (monster:GetPivot().Position - root.Position).Magnitude
				local closeness = 1 - math.clamp((distance - 8) / (Config.WarningRange - 8), 0, 1)
				intensity = math.max(intensity, closeness)
			end
		end
	end
	local pulse = 0.8 + 0.2 * math.sin(os.clock() * (4 + 8 * intensity))
	vignette.GroupTransparency = 1 - intensity * 0.7 * pulse
end)

---------------------------------------------------------------------------
-- The rest of the UI
---------------------------------------------------------------------------

require(script.Shop).Init(hud)
require(script.Vote).Init(hud)
require(script.Keypad).Init(hud)
require(script.Spectate).Init(hud)
require(script.Actions).Init(hud)

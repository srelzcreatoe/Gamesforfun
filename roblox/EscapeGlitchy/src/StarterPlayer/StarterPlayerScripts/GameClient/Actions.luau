-- Things that depend on what you're doing in a round:
--   * the monster's SET TRAP button (F on keyboard, X on gamepad)
--   * a dark screen edge while you hide, and a warning while you're trapped
--   * prompt texts: hiding spots say Hide / Leave / Search, and the monster
--     doesn't see item and lock prompts it can't use

local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local ProximityPromptService = game:GetService("ProximityPromptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local UI = require(script.Parent.UI)

local create = UI.create
local FONT, RED, WHITE, BLACK = UI.FONT, UI.RED, UI.WHITE, UI.BLACK
local player = Players.LocalPlayer

local Actions = {}

function Actions.Init(hud: ScreenGui)
	local placeTrapRemote = ReplicatedStorage:WaitForChild("Remotes"):WaitForChild("PlaceTrap")

	---------------------------------------------------------------------------
	-- Trap button for a player monster
	---------------------------------------------------------------------------
	local trapButton = UI.button(hud, "", {
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -20),
		Size = UDim2.new(0, 200, 0, 50),
		BackgroundColor3 = Color3.fromRGB(120, 25, 25),
		TextSize = 18,
		Visible = false,
	})
	create("UIStroke", { Color = RED, Thickness = 2, ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Parent = trapButton })

	local function placeTrap()
		placeTrapRemote:FireServer()
	end
	trapButton.Activated:Connect(placeTrap)
	ContextActionService:BindAction("PlaceTrap", function(_, inputState)
		if inputState == Enum.UserInputState.Begin and trapButton.Visible then
			placeTrap()
		end
		return Enum.ContextActionResult.Pass
	end, false, Enum.KeyCode.F, Enum.KeyCode.ButtonX)

	local function refreshTrapButton()
		local left = player:GetAttribute("TrapsLeft")
		local isMonster = player:GetAttribute("Role") == "Monster"
		trapButton.Visible = isMonster and typeof(left) == "number" and left > 0
		trapButton.Text = `SET TRAP ({left or 0})  [F]`
	end
	player:GetAttributeChangedSignal("TrapsLeft"):Connect(refreshTrapButton)
	player:GetAttributeChangedSignal("Role"):Connect(refreshTrapButton)
	refreshTrapButton()

	---------------------------------------------------------------------------
	-- Hiding and trapped overlays
	---------------------------------------------------------------------------
	local overlay = create("ScreenGui", {
		Name = "ActionEffects",
		ResetOnSpawn = false,
		IgnoreGuiInset = true,
		DisplayOrder = 5,
		Parent = player:WaitForChild("PlayerGui"),
	})
	local hideShade = create("Frame", {
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = BLACK,
		BackgroundTransparency = 0.45,
		Visible = false,
		Parent = overlay,
	})
	-- A bright slit in the middle, like peeking between closet doors.
	create("UIGradient", {
		Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0, 0),
			NumberSequenceKeypoint.new(0.42, 0),
			NumberSequenceKeypoint.new(0.5, 1),
			NumberSequenceKeypoint.new(0.58, 0),
			NumberSequenceKeypoint.new(1, 0),
		}),
		Parent = hideShade,
	})
	create("TextLabel", {
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -90),
		Size = UDim2.new(0.8, 0, 0, 30),
		BackgroundTransparency = 1,
		Font = FONT,
		TextSize = 20,
		TextColor3 = WHITE,
		TextStrokeTransparency = 0.4,
		Text = "You're hiding. Stay quiet... (use the prompt to get out)",
		Parent = hideShade,
	})

	local trappedLabel = create("TextLabel", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.35),
		Size = UDim2.new(0.8, 0, 0, 50),
		BackgroundTransparency = 1,
		Font = Enum.Font.Creepster,
		TextSize = 44,
		TextColor3 = RED,
		TextStrokeTransparency = 0.3,
		Text = "YOU'RE STUCK IN A TRAP!",
		Visible = false,
		Parent = overlay,
	})

	player:GetAttributeChangedSignal("Hiding"):Connect(function()
		hideShade.Visible = player:GetAttribute("Hiding") == true
	end)
	player:GetAttributeChangedSignal("Trapped"):Connect(function()
		trappedLabel.Visible = player:GetAttribute("Trapped") == true
	end)

	---------------------------------------------------------------------------
	-- Prompt texts (these changes only happen on this player's screen)
	---------------------------------------------------------------------------
	local shown: { [ProximityPrompt]: boolean } = {}

	local function adjust(prompt: ProximityPrompt)
		local role = player:GetAttribute("Role")
		if prompt:GetAttribute("HidePrompt") then
			prompt.ActionText = if player:GetAttribute("Hiding")
				then "Leave"
				elseif role == "Monster" then "Search"
				else "Hide"
		elseif role == "Monster" and (prompt:GetAttribute("ItemPrompt") or prompt:GetAttribute("LockPrompt")) then
			prompt.Enabled = false
		end
	end

	ProximityPromptService.PromptShown:Connect(function(prompt)
		shown[prompt] = true
		adjust(prompt)
	end)
	ProximityPromptService.PromptHidden:Connect(function(prompt)
		shown[prompt] = nil
	end)
	player:GetAttributeChangedSignal("Hiding"):Connect(function()
		for prompt in shown do
			if prompt.Parent then
				adjust(prompt)
			else
				shown[prompt] = nil
			end
		end
	end)
end

return Actions

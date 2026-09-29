-- The number pad that opens when you use a keypad lock. Tap the digits (or
-- type them), then OK. The code is written on a note somewhere in the map.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")

local UI = require(script.Parent.UI)

local create, round = UI.create, UI.round
local FONT, WHITE = UI.FONT, UI.WHITE
local player = Players.LocalPlayer

local CODE_LENGTH = 4

-- Keyboard keys that type a digit.
local DIGIT_KEYS = {}
for digit, name in { "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine" } do
	DIGIT_KEYS[(Enum.KeyCode :: any)[name]] = tostring(digit)
	DIGIT_KEYS[(Enum.KeyCode :: any)["Keypad" .. name]] = tostring(digit)
end
DIGIT_KEYS[Enum.KeyCode.Zero] = "0"
DIGIT_KEYS[Enum.KeyCode.KeypadZero] = "0"

local Keypad = {}

function Keypad.Init(hud: ScreenGui)
	local remotes = ReplicatedStorage:WaitForChild("Remotes")
	local keypadRemote = remotes:WaitForChild("Keypad")
	local codeRemote = remotes:WaitForChild("EnterCode")

	local frame = create("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.new(0, 240, 0, 330),
		BackgroundColor3 = Color3.fromRGB(30, 32, 38),
		Visible = false,
		ZIndex = 6,
		Parent = hud,
	})
	round(frame, 12)
	create("UIStroke", { Color = Color3.fromRGB(90, 95, 110), Thickness = 2, Parent = frame })

	local display = create("TextLabel", {
		Position = UDim2.new(0, 12, 0, 12),
		Size = UDim2.new(1, -60, 0, 50),
		BackgroundColor3 = Color3.fromRGB(10, 25, 15),
		Font = Enum.Font.Code,
		TextSize = 34,
		TextColor3 = Color3.fromRGB(80, 255, 130),
		Text = "",
		Parent = frame,
	})
	round(display, 6)

	local currentLock: Instance? = nil
	local digits = ""

	local function refresh()
		display.Text = if digits == "" then "- - - -" else digits
	end
	local function close()
		frame.Visible = false
		currentLock = nil
	end
	local function press(key: string)
		if key == "C" then
			digits = ""
		elseif key == "OK" then
			if currentLock and #digits == CODE_LENGTH then
				codeRemote:FireServer(currentLock, digits)
				close()
			end
		elseif #digits < CODE_LENGTH then
			digits ..= key
		end
		refresh()
	end

	local closeButton = UI.button(frame, "X", {
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -10, 0, 12),
		Size = UDim2.new(0, 36, 0, 36),
		BackgroundColor3 = Color3.fromRGB(150, 30, 30),
		TextSize = 20,
	})
	closeButton.Activated:Connect(close)

	local keys = { "1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "OK" }
	for index, key in keys do
		local column = (index - 1) % 3
		local row = (index - 1) // 3
		local button = UI.button(frame, key, {
			Position = UDim2.new(0, 12 + column * 74, 0, 74 + row * 62),
			Size = UDim2.new(0, 68, 0, 56),
			TextSize = 24,
			BackgroundColor3 = if key == "OK"
				then Color3.fromRGB(40, 130, 70)
				elseif key == "C" then Color3.fromRGB(130, 90, 30)
				else Color3.fromRGB(60, 62, 72),
			TextColor3 = WHITE,
			Font = FONT,
		})
		button.Activated:Connect(function()
			press(key)
		end)
	end

	keypadRemote.OnClientEvent:Connect(function(lock)
		currentLock = lock
		digits = ""
		refresh()
		frame.Visible = true
	end)

	UserInputService.InputBegan:Connect(function(input, gameProcessed)
		if not frame.Visible or gameProcessed then
			return
		end
		local digit = DIGIT_KEYS[input.KeyCode]
		if digit then
			press(digit)
		elseif input.KeyCode == Enum.KeyCode.Backspace then
			digits = string.sub(digits, 1, -2)
			refresh()
		elseif input.KeyCode == Enum.KeyCode.Return or input.KeyCode == Enum.KeyCode.KeypadEnter then
			press("OK")
		end
	end)

	-- Close it if you get caught while typing.
	player:GetAttributeChangedSignal("Role"):Connect(function()
		if player:GetAttribute("Role") ~= "Survivor" then
			close()
		end
	end)
end

return Keypad

-- Spectating: once you're out of a round (caught or escaped), a SPECTATE
-- button lets you watch the players who are still playing.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local UI = require(script.Parent.UI)

local create, round = UI.create, UI.round
local FONT, RED, WHITE, BLACK = UI.FONT, UI.RED, UI.WHITE, UI.BLACK
local player = Players.LocalPlayer

local Spectate = {}

-- Players still in the round who can be watched.
local function candidates(): { Player }
	local list = {}
	for _, other in Players:GetPlayers() do
		local humanoid = other.Character and other.Character:FindFirstChildOfClass("Humanoid")
		if other ~= player and other:GetAttribute("Role") ~= nil and humanoid then
			table.insert(list, other)
		end
	end
	return list
end

function Spectate.Init(hud: ScreenGui)
	local gameState = ReplicatedStorage:WaitForChild("GameState")
	local spectateRemote = ReplicatedStorage:WaitForChild("Remotes"):WaitForChild("Spectate")

	local openButton = UI.button(hud, "SPECTATE", {
		AnchorPoint = Vector2.new(0, 0.5),
		Position = UDim2.new(0, 12, 0.5, 56),
		Size = UDim2.new(0, 110, 0, 40),
		TextSize = 16,
		Visible = false,
	})
	create("UIStroke", { Color = RED, Thickness = 2, ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Parent = openButton })

	local bar = create("Frame", {
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -20),
		Size = UDim2.new(0, 340, 0, 50),
		BackgroundColor3 = BLACK,
		BackgroundTransparency = 0.3,
		Visible = false,
		Parent = hud,
	})
	round(bar, 10)
	local previous = UI.button(bar, "<", { Position = UDim2.new(0, 6, 0, 6), Size = UDim2.new(0, 40, 0, 38), TextSize = 22 })
	local nextButton = UI.button(bar, ">", { Position = UDim2.new(0, 214, 0, 6), Size = UDim2.new(0, 40, 0, 38), TextSize = 22 })
	local stop = UI.button(bar, "Stop", {
		Position = UDim2.new(0, 262, 0, 6),
		Size = UDim2.new(0, 72, 0, 38),
		BackgroundColor3 = Color3.fromRGB(150, 30, 30),
	})
	local nameLabel = create("TextLabel", {
		Position = UDim2.new(0, 50, 0, 0),
		Size = UDim2.new(0, 160, 1, 0),
		BackgroundTransparency = 1,
		Font = FONT,
		TextSize = 16,
		TextColor3 = WHITE,
		TextTruncate = Enum.TextTruncate.AtEnd,
		Text = "",
		Parent = bar,
	})

	local watching: Player? = nil

	local function watch(target: Player?)
		watching = target
		local camera = workspace.CurrentCamera
		local humanoid = target and target.Character and target.Character:FindFirstChildOfClass("Humanoid")
		if target and humanoid then
			camera.CameraSubject = humanoid
			nameLabel.Text = `Watching {target.DisplayName}`
			spectateRemote:FireServer(target)
		else
			watching = nil
			local own = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
			if own then
				camera.CameraSubject = own
			end
			spectateRemote:FireServer(nil)
		end
		bar.Visible = watching ~= nil
	end

	local function step(direction: number)
		local list = candidates()
		if #list == 0 then
			watch(nil)
			return
		end
		local index = table.find(list, watching :: Player) or 0
		watch(list[(index - 1 + direction) % #list + 1])
	end

	openButton.Activated:Connect(function()
		step(1)
	end)
	previous.Activated:Connect(function()
		step(-1)
	end)
	nextButton.Activated:Connect(function()
		step(1)
	end)
	stop.Activated:Connect(function()
		watch(nil)
	end)

	-- Keep things up to date as people get caught and rounds end.
	task.spawn(function()
		while true do
			task.wait(0.5)
			local canWatch = gameState:GetAttribute("Phase") == "Playing" and player:GetAttribute("Role") == nil
			local list = if canWatch then candidates() else {}
			openButton.Visible = #list > 0 and watching == nil
			if watching then
				if #list == 0 then
					watch(nil)
				elseif not table.find(list, watching) then
					step(1)
				end
			end
		end
	end)
	-- Respawning resets the camera, so point it back at whoever we watch.
	player.CharacterAdded:Connect(function()
		if watching then
			task.defer(watch, watching)
		end
	end)
end

return Spectate

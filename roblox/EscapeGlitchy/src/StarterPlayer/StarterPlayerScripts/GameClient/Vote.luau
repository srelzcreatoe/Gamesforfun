-- The voting panel shown during intermission: pick the next chapter and
-- whether the monster is the AI or a player.

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local UI = require(script.Parent.UI)

local create, round = UI.create, UI.round
local FONT, RED, BLACK = UI.FONT, UI.RED, UI.BLACK

local MODE_NAMES = { Bot = "AI monster", Player = "Player monster" }

local Vote = {}

function Vote.Init(hud: ScreenGui)
	local gameState = ReplicatedStorage:WaitForChild("GameState")
	local voteRemote = ReplicatedStorage:WaitForChild("Remotes"):WaitForChild("Vote")

	local panel = create("Frame", {
		AnchorPoint = Vector2.new(1, 0.5),
		Position = UDim2.new(1, -12, 0.5, 0),
		Size = UDim2.new(0, 230, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundColor3 = BLACK,
		BackgroundTransparency = 0.25,
		Visible = false,
		Parent = hud,
	})
	round(panel, 10)
	create("UIStroke", { Color = RED, Thickness = 1.5, Parent = panel })
	create("UIPadding", {
		PaddingTop = UDim.new(0, 10),
		PaddingBottom = UDim.new(0, 10),
		PaddingLeft = UDim.new(0, 10),
		PaddingRight = UDim.new(0, 10),
		Parent = panel,
	})
	create("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 6), Parent = panel })

	local function heading(text: string, order: number)
		create("TextLabel", {
			LayoutOrder = order,
			Size = UDim2.new(1, 0, 0, 22),
			BackgroundTransparency = 1,
			Font = FONT,
			TextSize = 18,
			TextColor3 = RED,
			TextXAlignment = Enum.TextXAlignment.Left,
			Text = text,
			Parent = panel,
		})
	end
	local function section(order: number): Frame
		local frame = create("Frame", {
			LayoutOrder = order,
			Size = UDim2.new(1, 0, 0, 0),
			AutomaticSize = Enum.AutomaticSize.Y,
			BackgroundTransparency = 1,
			Parent = panel,
		})
		create("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 4), Parent = frame })
		return frame
	end
	heading("VOTE: CHAPTER", 1)
	local mapList = section(2)
	heading("VOTE: MONSTER", 3)
	local modeList = section(4)

	local myMap: number? = nil
	local myMode: string? = nil
	local wasOpen = false

	local render
	local function fill(list: Frame, entries, isChosen: (number, any) -> boolean, label: (any) -> string, onPick: (number, any) -> ())
		for _, child in list:GetChildren() do
			if child:IsA("TextButton") then
				child:Destroy()
			end
		end
		for index, entry in entries do
			local chosen = isChosen(index, entry)
			local button = UI.button(list, `{label(entry)}   {entry.votes}`, {
				LayoutOrder = index,
				Size = UDim2.new(1, 0, 0, 32),
				TextSize = 15,
				TextXAlignment = Enum.TextXAlignment.Left,
				BackgroundColor3 = if chosen then Color3.fromRGB(150, 30, 30) else Color3.fromRGB(50, 50, 60),
			})
			create("UIPadding", { PaddingLeft = UDim.new(0, 8), Parent = button })
			button.Activated:Connect(function()
				onPick(index, entry)
				render()
			end)
		end
	end

	function render()
		local ok, vote = pcall(function()
			return HttpService:JSONDecode(gameState:GetAttribute("Vote") or "")
		end)
		if not ok or typeof(vote) ~= "table" or not vote.open then
			panel.Visible = false
			wasOpen = false
			return
		end
		if not wasOpen then
			myMap, myMode = nil, nil -- a new vote started
		end
		wasOpen = true
		panel.Visible = true

		fill(mapList, vote.maps, function(index)
			return index == myMap
		end, function(entry)
			return entry.name
		end, function(index)
			myMap = index
			voteRemote:FireServer("Map", index)
		end)
		fill(modeList, vote.modes, function(_, entry)
			return entry.name == myMode
		end, function(entry)
			return MODE_NAMES[entry.name] or entry.name
		end, function(_, entry)
			myMode = entry.name
			voteRemote:FireServer("Mode", entry.name)
		end)
	end

	gameState:GetAttributeChangedSignal("Vote"):Connect(render)
	render()
end

return Vote

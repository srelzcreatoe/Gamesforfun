--!strict
--[[
	LeaderboardManager
	Location: ServerScriptService (Script)

	Draws the global leaderboards on the boards in Workspace.Map.Leaderboards:
	Top Cash, Top Steals and Top Rebirths across every server, plus the game's
	logo board. Each player's leaderstats are written to an OrderedDataStore
	every couple of minutes (only when they changed) and the top 10 are read
	back every minute.

	When DataStores aren't available (an unpublished place in Studio), the
	boards rank the players in this server instead and say so.
]]

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local NumberFormat = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("NumberFormat"))

local LOG_PREFIX = "[LeaderboardManager]"
local STORE_PREFIX = "BrainrotGame_v1_Top"
local ROWS = 10
local WRITE_INTERVAL_SECONDS = 120
local REFRESH_INTERVAL_SECONDS = 60
local FIRST_REFRESH_DELAY_SECONDS = 5

type Stat = {
	Name: string,
	Board: string,
	Title: string,
	Color: Color3,
	Format: (number) -> string,
}

type Row = {
	UserId: number,
	Name: string,
	Value: number,
}

type BoardGui = {
	Rows: { { Frame: Frame, Rank: TextLabel, Avatar: ImageLabel, Name: TextLabel, Value: TextLabel } },
	Footer: TextLabel,
}

local STATS: { Stat } = {
	{ Name = "Cash", Board = "TopCash", Title = "TOP CASH", Color = Color3.fromRGB(80, 255, 110), Format = NumberFormat.cash },
	{ Name = "Steals", Board = "TopSteals", Title = "TOP STEALS", Color = Color3.fromRGB(255, 90, 90), Format = NumberFormat.commas },
	{ Name = "Rebirths", Board = "TopRebirths", Title = "TOP REBIRTHS", Color = Color3.fromRGB(80, 190, 255), Format = NumberFormat.commas },
}
local RANK_COLORS = {
	Color3.fromRGB(255, 210, 60),
	Color3.fromRGB(215, 225, 240),
	Color3.fromRGB(230, 150, 90),
}

local map = Workspace:WaitForChild("Map")
local boardsFolder = map:WaitForChild("Leaderboards", 30)

local stores: { [string]: OrderedDataStore } = {}
local warnedWrite = false
local lastWritten: { [Player]: { [string]: number } } = {}
local nameCache: { [number]: string } = {}
local boards: { [string]: BoardGui } = {}

for _, stat in STATS do
	local ok, result = pcall(function(): OrderedDataStore
		return DataStoreService:GetOrderedDataStore(STORE_PREFIX .. stat.Name)
	end)
	if ok then
		stores[stat.Name] = result
	end
end

--------------------------------------------------------------------------------
-- Board drawing
--------------------------------------------------------------------------------

local function text(parent: Instance, name: string, properties: { [string]: any }): TextLabel
	local label = Instance.new("TextLabel")
	label.Name = name
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = Color3.new(1, 1, 1)
	label.TextStrokeTransparency = 0.3
	for key, value in properties do
		(label :: any)[key] = value
	end
	label.Parent = parent
	return label
end

local function getScreen(boardName: string): BasePart?
	local board = if boardsFolder then boardsFolder:FindFirstChild(boardName) else nil
	local screen = if board then board:FindFirstChild("Screen") else nil
	return if screen and screen:IsA("BasePart") then screen else nil
end

local function createSurface(screen: BasePart): SurfaceGui
	local surface = Instance.new("SurfaceGui")
	surface.Name = "BoardGui"
	surface.Face = Enum.NormalId.Front
	surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	surface.PixelsPerStud = 25
	surface.LightInfluence = 0
	surface.Parent = screen
	return surface
end

local function createBoard(stat: Stat, screen: BasePart): BoardGui
	local surface = createSurface(screen)
	text(surface, "Title", {
		Position = UDim2.fromScale(0.04, 0.015),
		Size = UDim2.fromScale(0.92, 0.1),
		Text = stat.Title,
		TextColor3 = stat.Color,
	})

	local rows = {}
	for index = 1, ROWS do
		local frame = Instance.new("Frame")
		frame.Name = "Row" .. index
		frame.Position = UDim2.fromScale(0.03, 0.125 + (index - 1) * 0.079)
		frame.Size = UDim2.fromScale(0.94, 0.072)
		frame.BackgroundColor3 = if index % 2 == 1 then Color3.fromRGB(40, 44, 70) else Color3.fromRGB(30, 33, 55)
		frame.BorderSizePixel = 0
		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0.2, 0)
		corner.Parent = frame
		frame.Parent = surface

		local rank = text(frame, "Rank", {
			Size = UDim2.fromScale(0.12, 1),
			Text = "#" .. index,
			TextColor3 = RANK_COLORS[index] or Color3.fromRGB(200, 205, 230),
		})
		local avatar = Instance.new("ImageLabel")
		avatar.Name = "Avatar"
		avatar.BackgroundTransparency = 1
		avatar.Position = UDim2.fromScale(0.13, 0.05)
		avatar.Size = UDim2.fromScale(0.1, 0.9)
		avatar.Parent = frame
		local name = text(frame, "PlayerName", {
			Position = UDim2.fromScale(0.25, 0.1),
			Size = UDim2.fromScale(0.45, 0.8),
			TextXAlignment = Enum.TextXAlignment.Left,
			Text = "",
		})
		local value = text(frame, "Value", {
			Position = UDim2.fromScale(0.7, 0.1),
			Size = UDim2.fromScale(0.28, 0.8),
			TextXAlignment = Enum.TextXAlignment.Right,
			TextColor3 = stat.Color,
			Text = "",
		})
		table.insert(rows, { Frame = frame, Rank = rank, Avatar = avatar, Name = name, Value = value })
	end

	local footer = text(surface, "Footer", {
		Position = UDim2.fromScale(0.04, 0.93),
		Size = UDim2.fromScale(0.92, 0.05),
		Text = "Loading...",
		TextColor3 = Color3.fromRGB(170, 175, 200),
	})
	return { Rows = rows, Footer = footer }
end

local function drawLogo()
	local screen = getScreen("LogoBoard")
	if screen == nil then
		return
	end
	local surface = createSurface(screen)
	local title = text(surface, "Logo", {
		Position = UDim2.fromScale(0.05, 0.12),
		Size = UDim2.fromScale(0.9, 0.5),
		Text = "STEAL A\nBRAINROT",
		TextStrokeTransparency = 0,
	})
	local gradient = Instance.new("UIGradient")
	gradient.Color = ColorSequence.new({
		ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 90, 90)),
		ColorSequenceKeypoint.new(0.35, Color3.fromRGB(255, 220, 60)),
		ColorSequenceKeypoint.new(0.7, Color3.fromRGB(90, 255, 140)),
		ColorSequenceKeypoint.new(1, Color3.fromRGB(90, 180, 255)),
	})
	gradient.Rotation = 90
	gradient.Parent = title
	text(surface, "Tagline", {
		Position = UDim2.fromScale(0.05, 0.68),
		Size = UDim2.fromScale(0.9, 0.12),
		Text = "Buy - Collect - Steal - Rebirth",
		TextColor3 = Color3.fromRGB(230, 235, 255),
	})
end

local function drawRows(stat: Stat, rows: { Row }, footerText: string)
	local board = boards[stat.Name]
	if board == nil then
		return
	end
	for index, row in board.Rows do
		local entry = rows[index]
		row.Frame.Visible = entry ~= nil
		if entry then
			row.Name.Text = entry.Name
			row.Value.Text = stat.Format(entry.Value)
			row.Avatar.Image = if entry.UserId > 0
				then string.format("rbxthumb://type=AvatarHeadShot&id=%d&w=48&h=48", entry.UserId)
				else ""
		end
	end
	board.Footer.Text = footerText
end

--------------------------------------------------------------------------------
-- Data
--------------------------------------------------------------------------------

local function getStatValue(player: Player, statName: string): number?
	local leaderstats = player:FindFirstChild("leaderstats")
	local value = if leaderstats then leaderstats:FindFirstChild(statName) else nil
	if value and value:IsA("IntValue") then
		return value.Value
	end
	return nil
end

local function getName(userId: number): string
	local cached = nameCache[userId]
	if cached then
		return cached
	end
	local player = Players:GetPlayerByUserId(userId)
	if player then
		nameCache[userId] = player.Name
		return player.Name
	end
	local ok, result = pcall(function(): string
		return Players:GetNameFromUserIdAsync(userId)
	end)
	local name = if ok and typeof(result) == "string" then result else "Player " .. userId
	nameCache[userId] = name
	return name
end

local function writeScores()
	for _, player in Players:GetPlayers() do
		if player.UserId > 0 then
			local written = lastWritten[player] or {}
			lastWritten[player] = written
			for _, stat in STATS do
				local store: OrderedDataStore? = stores[stat.Name]
				local value = getStatValue(player, stat.Name)
				if store and value and value > 0 and written[stat.Name] ~= value then
					local ok, err = pcall(function()
						store:SetAsync(tostring(player.UserId), math.floor(value))
					end)
					if ok then
						written[stat.Name] = value
					elseif not warnedWrite then
						-- Usually an unpublished place in Studio; warn once, not every time.
						warnedWrite = true
						warn(string.format("%s Could not save scores (%s); the boards show this server only.", LOG_PREFIX, tostring(err)))
					end
				end
			end
		end
	end
end

local function readGlobalTop(stat: Stat): { Row }?
	local store: OrderedDataStore? = stores[stat.Name]
	if store == nil then
		return nil
	end
	local ok, page = pcall(function(): { any }
		return store:GetSortedAsync(false, ROWS):GetCurrentPage()
	end)
	if not ok or typeof(page) ~= "table" then
		return nil
	end
	local rows: { Row } = {}
	for _, entry in page do
		local userId = tonumber(entry.key)
		local value = tonumber(entry.value)
		if userId and value then
			table.insert(rows, { UserId = userId, Name = getName(userId), Value = value })
		end
	end
	return rows
end

local function readServerTop(stat: Stat): { Row }
	local rows: { Row } = {}
	for _, player in Players:GetPlayers() do
		local value = getStatValue(player, stat.Name)
		if value then
			table.insert(rows, { UserId = player.UserId, Name = player.Name, Value = value })
		end
	end
	table.sort(rows, function(a, b)
		return a.Value > b.Value
	end)
	while #rows > ROWS do
		table.remove(rows)
	end
	return rows
end

local function refreshBoards()
	for _, stat in STATS do
		local rows = readGlobalTop(stat)
		if rows then
			drawRows(stat, rows, "All servers - updates every minute")
		else
			drawRows(stat, readServerTop(stat), "This server only (publish the game for global scores)")
		end
	end
end

--------------------------------------------------------------------------------
-- Startup
--------------------------------------------------------------------------------

for _, stat in STATS do
	local screen = getScreen(stat.Board)
	if screen then
		boards[stat.Name] = createBoard(stat, screen)
	end
end
drawLogo()

Players.PlayerRemoving:Connect(function(player: Player)
	lastWritten[player] = nil
end)

task.spawn(function()
	task.wait(FIRST_REFRESH_DELAY_SECONDS)
	local sinceWrite = WRITE_INTERVAL_SECONDS
	while true do
		if sinceWrite >= WRITE_INTERVAL_SECONDS then
			sinceWrite = 0
			xpcall(writeScores, function(err: any)
				warn(string.format("%s Writing scores failed: %s", LOG_PREFIX, tostring(err)))
			end)
		end
		xpcall(refreshBoards, function(err: any)
			warn(string.format("%s Refreshing boards failed: %s", LOG_PREFIX, tostring(err)))
		end)
		task.wait(REFRESH_INTERVAL_SECONDS)
		sinceWrite += REFRESH_INTERVAL_SECONDS
	end
end)

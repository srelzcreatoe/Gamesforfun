-- Coins and escapes: shown on the leaderboard and saved with DataStores.
--
-- Saving only works in a published game, or in Studio after turning on
-- Game Settings > Security > "Enable Studio Access to API Services".
-- Without that the game still runs, it just starts everyone at 0.

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))

local Data = {}

local STORE_NAME = "PlayerData_v1"
local AUTOSAVE_INTERVAL = 120

local store: DataStore? = nil
local storeFailed = false
local loaded: { [Player]: boolean } = {}

local function getStore(): DataStore?
	if store or storeFailed then
		return store
	end
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore(STORE_NAME)
	end)
	if ok then
		store = result
	else
		storeFailed = true
		warn(`[{Config.GameName}] DataStores are unavailable, progress will not be saved: {result}`)
	end
	return store
end

local function key(player: Player)
	return "player_" .. player.UserId
end

local function getStat(player: Player, name: string): IntValue?
	local leaderstats = player:FindFirstChild("leaderstats")
	local value = leaderstats and leaderstats:FindFirstChild(name)
	return if value and value:IsA("IntValue") then value else nil
end

local function onPlayerAdded(player: Player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Parent = leaderstats
	local escapes = Instance.new("IntValue")
	escapes.Name = "Escapes"
	escapes.Parent = leaderstats
	leaderstats.Parent = player

	local dataStore = getStore()
	if not dataStore then
		return
	end
	local ok, saved = pcall(function()
		return dataStore:GetAsync(key(player))
	end)
	if not ok then
		-- Do not mark the player as loaded, so we never overwrite their real
		-- save with zeros.
		warn(`[{Config.GameName}] Could not load data for {player.Name}: {saved}`)
		return
	end
	if not player.Parent then
		return
	end
	if type(saved) == "table" then
		-- Add rather than overwrite, in case they earned some while loading.
		coins.Value += tonumber(saved.Coins) or 0
		escapes.Value += tonumber(saved.Escapes) or 0
	end
	loaded[player] = true
end

local function save(player: Player)
	local dataStore = getStore()
	local coins, escapes = getStat(player, "Coins"), getStat(player, "Escapes")
	if not loaded[player] or not dataStore or not coins or not escapes then
		return
	end
	local ok, err = pcall(function()
		dataStore:SetAsync(key(player), { Coins = coins.Value, Escapes = escapes.Value })
	end)
	if not ok then
		warn(`[{Config.GameName}] Could not save data for {player.Name}: {err}`)
	end
end

function Data.Start()
	Players.PlayerAdded:Connect(onPlayerAdded)
	for _, player in Players:GetPlayers() do
		task.spawn(onPlayerAdded, player)
	end

	Players.PlayerRemoving:Connect(function(player)
		save(player)
		loaded[player] = nil
	end)

	game:BindToClose(function()
		local pending = 0
		for _, player in Players:GetPlayers() do
			pending += 1
			task.spawn(function()
				save(player)
				pending -= 1
			end)
		end
		local deadline = os.clock() + 20
		while pending > 0 and os.clock() < deadline do
			task.wait(0.1)
		end
	end)

	task.spawn(function()
		while true do
			task.wait(AUTOSAVE_INTERVAL)
			for _, player in Players:GetPlayers() do
				task.spawn(save, player)
			end
		end
	end)
end

function Data.AddCoins(player: Player, amount: number)
	local coins = getStat(player, "Coins")
	if coins then
		coins.Value += amount
	end
end

function Data.AddEscape(player: Player)
	local escapes = getStat(player, "Escapes")
	if escapes then
		escapes.Value += 1
	end
end

return Data

-- Player progress: coins and escapes (shown on the leaderboard), the skins
-- they own and the skins they have equipped. Saved with DataStores.
--
-- Saving only works in a published game, or in Studio after turning on
-- Game Settings > Security > "Enable Studio Access to API Services".
-- Without that the game still runs, it just starts everyone fresh.
--
-- The client can see a player's skins through these attributes on the Player:
--   OwnedSkins    comma separated skin ids, e.g. "Default,Glitchy,Noob"
--   SurvivorSkin  the equipped survivor skin id
--   MonsterSkin   the equipped monster skin id

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))

local Data = {}

local STORE_NAME = "PlayerData_v1"
local AUTOSAVE_INTERVAL = 120

type Profile = {
	skins: { [string]: boolean },
	equipped: { Survivor: string, Monster: string },
}

local store: DataStore? = nil
local storeFailed = false
local loaded: { [Player]: boolean } = {}
local profiles: { [Player]: Profile } = {}

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

-- Copies the player's skins into attributes so their client can show them.
local function publishSkins(player: Player)
	local profile = profiles[player]
	if not profile then
		return
	end
	local owned = {}
	for skinId in profile.skins do
		table.insert(owned, skinId)
	end
	table.sort(owned)
	player:SetAttribute("OwnedSkins", table.concat(owned, ","))
	player:SetAttribute("SurvivorSkin", profile.equipped.Survivor)
	player:SetAttribute("MonsterSkin", profile.equipped.Monster)
end

local onLoaded: ((Player) -> ())? = nil

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

	local profile: Profile = {
		skins = { [Config.DefaultSurvivorSkin] = true, [Config.DefaultMonsterSkin] = true },
		equipped = { Survivor = Config.DefaultSurvivorSkin, Monster = Config.DefaultMonsterSkin },
	}
	profiles[player] = profile
	publishSkins(player)

	local dataStore = getStore()
	local ok, saved = true, nil
	if dataStore then
		ok, saved = pcall(function()
			return dataStore:GetAsync(key(player))
		end)
		if not ok then
			-- Do not mark the player as loaded, so we never overwrite their real
			-- save with an empty one.
			warn(`[{Config.GameName}] Could not load data for {player.Name}: {saved}`)
		end
	end
	if not player.Parent then
		return
	end

	if ok and type(saved) == "table" then
		-- Add rather than overwrite, in case they earned some while loading.
		coins.Value += tonumber(saved.Coins) or 0
		escapes.Value += tonumber(saved.Escapes) or 0
		if type(saved.Skins) == "table" then
			for _, skinId in saved.Skins do
				if typeof(skinId) == "string" and Config.GetSkin(skinId) then
					profile.skins[skinId] = true
				end
			end
		end
		for _, skinType in { "Survivor", "Monster" } do
			local skinId = saved[skinType .. "Skin"]
			local skin = typeof(skinId) == "string" and Config.GetSkin(skinId)
			if skin and skin.Type == skinType and profile.skins[skinId] then
				profile.equipped[skinType] = skinId
			end
		end
		publishSkins(player)
	end
	if ok and dataStore then
		loaded[player] = true
	end
	if onLoaded then
		onLoaded(player)
	end
end

local function save(player: Player)
	local dataStore = getStore()
	local profile = profiles[player]
	local coins, escapes = getStat(player, "Coins"), getStat(player, "Escapes")
	if not loaded[player] or not dataStore or not profile or not coins or not escapes then
		return
	end
	local owned = {}
	for skinId in profile.skins do
		table.insert(owned, skinId)
	end
	local ok, err = pcall(function()
		dataStore:SetAsync(key(player), {
			Coins = coins.Value,
			Escapes = escapes.Value,
			Skins = owned,
			SurvivorSkin = profile.equipped.Survivor,
			MonsterSkin = profile.equipped.Monster,
		})
	end)
	if not ok then
		warn(`[{Config.GameName}] Could not save data for {player.Name}: {err}`)
	end
end

-- afterLoad is called for every player once their saved data has been loaded
-- (or failed to load).
function Data.Start(afterLoad: (Player) -> ())
	onLoaded = afterLoad
	Players.PlayerAdded:Connect(onPlayerAdded)
	for _, player in Players:GetPlayers() do
		task.spawn(onPlayerAdded, player)
	end

	Players.PlayerRemoving:Connect(function(player)
		save(player)
		loaded[player] = nil
		profiles[player] = nil
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

-- Takes coins away if the player has enough. Returns whether it worked.
function Data.SpendCoins(player: Player, amount: number): boolean
	local coins = getStat(player, "Coins")
	if not coins or coins.Value < amount then
		return false
	end
	coins.Value -= amount
	return true
end

function Data.AddEscape(player: Player)
	local escapes = getStat(player, "Escapes")
	if escapes then
		escapes.Value += 1
	end
end

function Data.OwnsSkin(player: Player, skinId: string): boolean
	local profile = profiles[player]
	return profile ~= nil and profile.skins[skinId] == true
end

function Data.GiveSkin(player: Player, skinId: string)
	local profile = profiles[player]
	if profile then
		profile.skins[skinId] = true
		publishSkins(player)
	end
end

function Data.GetEquippedSkin(player: Player, skinType: "Survivor" | "Monster"): string
	local profile = profiles[player]
	if not profile then
		return if skinType == "Survivor" then Config.DefaultSurvivorSkin else Config.DefaultMonsterSkin
	end
	return profile.equipped[skinType]
end

function Data.SetEquippedSkin(player: Player, skinType: "Survivor" | "Monster", skinId: string)
	local profile = profiles[player]
	if profile then
		profile.equipped[skinType] = skinId
		publishSkins(player)
	end
end

return Data

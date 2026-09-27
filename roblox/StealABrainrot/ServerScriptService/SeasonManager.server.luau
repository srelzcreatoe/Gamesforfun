--!strict
--[[
	SeasonManager
	Location: ServerScriptService (Script)

	The season pass: playing earns XP (ExtrasConfig.ActivityXP for everything
	GameplayManager and the other scripts report, plus a little for every
	minute played), every ExtrasConfig.TierXP XP opens the next of 30 tiers,
	and each tier has a free reward and a premium one for owners of the Season
	Pass game pass. A new season (and a fresh pass) starts every
	ExtrasConfig.SeasonDays days; its XP is kept by DataAndMonetizationManager.

	Remotes:
	  Season       RemoteFunction ("State") -> state, ("Claim", { Tier, Track })
	               -> (ok, message), ("ClaimAll") -> (ok, message)
	  SeasonState  RemoteEvent, server -> client: state (see buildState)
	Saved: progress "SeasonClaims" = { Id, Free = { tier... }, Premium = { tier... } }
	Also publishes this week's limited brainrot (ExtrasConfig.LimitedRotation)
	as ReplicatedStorage attributes LimitedId and LimitedEndsAt (server time).
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local ExtrasConfig = require(Shared:WaitForChild("ExtrasConfig"))
local FeatureConfig = require(Shared:WaitForChild("FeatureConfig"))

type Reward = FeatureConfig.Reward
type Claims = { Id: number, Free: { number }, Premium: { number } }

local REQUEST_COOLDOWN_SECONDS = 0.3
local PLAYTIME_TICK_SECONDS = 60

local dataApi = ServerStorage:WaitForChild("DataAndMonetization")
local gameplayApi = ServerStorage:WaitForChild("Gameplay")
local rewardsApi = ServerStorage:WaitForChild("Rewards")
local getSeasonFunction = dataApi:WaitForChild("GetSeason") :: BindableFunction
local addSeasonXPFunction = dataApi:WaitForChild("AddSeasonXP") :: BindableFunction
local getProgressFunction = dataApi:WaitForChild("GetProgress") :: BindableFunction
local setProgressFunction = dataApi:WaitForChild("SetProgress") :: BindableFunction
local ownsGamePassFunction = dataApi:WaitForChild("OwnsGamePass") :: BindableFunction
local progressChangedEvent = dataApi:WaitForChild("ProgressChanged") :: BindableEvent
local gamePassChangedEvent = dataApi:WaitForChild("GamePassOwnershipChanged") :: BindableEvent
local activityEvent = gameplayApi:WaitForChild("Activity") :: BindableEvent
local grantRewardFunction = rewardsApi:WaitForChild("GrantReward") :: BindableFunction

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local notifyEvent = remotes:WaitForChild("Notify") :: RemoteEvent

local seasonFunction = Instance.new("RemoteFunction")
seasonFunction.Name = "Season"
seasonFunction.Parent = remotes
local stateEvent = Instance.new("RemoteEvent")
stateEvent.Name = "SeasonState"
stateEvent.Parent = remotes

local ready: { [Player]: boolean } = {}
local lastRequest: { [Player]: number } = {}

local function notify(player: Player, message: string, kind: string, sound: string?)
	notifyEvent:FireClient(player, message, kind, sound)
end

local function getSeason(player: Player): (number, number)
	local season = getSeasonFunction:Invoke(player)
	if typeof(season) ~= "table" then
		return ExtrasConfig.season(os.time()), 0
	end
	return tonumber(season.Id) or 1, tonumber(season.XP) or 0
end

local function isPremium(player: Player): boolean
	return ownsGamePassFunction:Invoke(player, "SeasonPass") == true
end

local function getClaims(player: Player, seasonId: number): Claims
	local saved = getProgressFunction:Invoke(player, "SeasonClaims")
	if typeof(saved) ~= "table" or saved.Id ~= seasonId then
		return { Id = seasonId, Free = {}, Premium = {} }
	end
	local function list(value: any): { number }
		local result: { number } = {}
		if typeof(value) == "table" then
			for _, tier in value do
				if typeof(tier) == "number" then
					table.insert(result, tier)
				end
			end
		end
		return result
	end
	return { Id = seasonId, Free = list(saved.Free), Premium = list(saved.Premium) }
end

local function buildState(player: Player): { [string]: any }
	local seasonId, xp = getSeason(player)
	local _, endsAt = ExtrasConfig.season(os.time())
	local claims = getClaims(player, seasonId)
	return {
		Season = seasonId,
		-- Clients count down in server time.
		EndsAt = Workspace:GetServerTimeNow() + (endsAt - os.time()),
		XP = xp,
		Tier = ExtrasConfig.tierOf(xp),
		Premium = isPremium(player),
		Free = claims.Free,
		PremiumClaimed = claims.Premium,
	}
end

local function pushState(player: Player)
	if ready[player] and player.Parent == Players then
		stateEvent:FireClient(player, buildState(player))
	end
end

local function addXP(player: Player, amount: number)
	if not ready[player] or amount <= 0 then
		return
	end
	local _, before = getSeason(player)
	local after = tonumber(addSeasonXPFunction:Invoke(player, amount)) or before
	local tierBefore, tierAfter = ExtrasConfig.tierOf(before), ExtrasConfig.tierOf(after)
	if tierAfter > tierBefore then
		notify(player, string.format("🏆 Season tier %d reached! Claim your reward in the Season menu.", tierAfter), "Success", "Notify")
	end
	pushState(player)
end

-- Gives a tier's reward on one track. Returns (ok, message).
local function claim(player: Player, tier: number, track: string): (boolean, string?)
	local seasonId, xp = getSeason(player)
	if tier < 1 or tier > ExtrasConfig.SeasonTierCount or tier ~= math.floor(tier) then
		return false, nil
	end
	if ExtrasConfig.tierOf(xp) < tier then
		return false, "Reach that tier first!"
	end
	if track == "Premium" and not isPremium(player) then
		return false, "Get the Season Pass for the premium rewards!"
	end
	if track ~= "Free" and track ~= "Premium" then
		return false, nil
	end
	local claims = getClaims(player, seasonId)
	local list = if track == "Free" then claims.Free else claims.Premium
	if table.find(list, tier) then
		return false, "Already claimed!"
	end
	table.insert(list, tier)
	-- Saved before the reward is given, so it can't be claimed twice.
	if setProgressFunction:Invoke(player, "SeasonClaims", claims) ~= true then
		return false, "Try again in a moment."
	end
	local reward = ExtrasConfig.SeasonTiers[tier][if track == "Free" then 1 else 2]
	local ok, what = grantRewardFunction:Invoke(player, reward)
	return ok == true, string.format("Tier %d: %s!", tier, tostring(what))
end

seasonFunction.OnServerInvoke = function(player: Player, action: any, argument: any): (boolean, string?, any)
	if not ready[player] then
		return false, "Still loading, try again in a moment."
	end
	if action == "State" then
		return true, nil, buildState(player)
	end
	local now = os.clock()
	if now - (lastRequest[player] or 0) < REQUEST_COOLDOWN_SECONDS then
		return false, "Slow down!"
	end
	lastRequest[player] = now
	if action == "Claim" and typeof(argument) == "table" then
		local ok, message = claim(player, tonumber(argument.Tier) or 0, tostring(argument.Track))
		pushState(player)
		return ok, message, buildState(player)
	elseif action == "ClaimAll" then
		local _, xp = getSeason(player)
		local reached = ExtrasConfig.tierOf(xp)
		local count = 0
		for tier = 1, reached do
			for _, track in { "Free", "Premium" } do
				if claim(player, tier, track) then
					count += 1
				end
			end
		end
		pushState(player)
		return count > 0, if count > 0 then string.format("Claimed %d reward%s!", count, if count == 1 then "" else "s") else "Nothing to claim yet.", buildState(player)
	end
	return false, nil
end

activityEvent.Event:Connect(function(playerArg: any, kind: any, amount: any)
	if typeof(playerArg) ~= "Instance" or not playerArg:IsA("Player") or typeof(kind) ~= "string" then
		return
	end
	local xp = ExtrasConfig.ActivityXP[kind]
	if xp == nil then
		return
	end
	-- Most activities come one at a time; a few (BossHit) report a count.
	local count = if kind == "BossHit" then math.clamp(tonumber(amount) or 1, 0, 500) else 1
	addXP(playerArg, xp * count)
end)

progressChangedEvent.Event:Connect(function(playerArg: any, key: any)
	if typeof(playerArg) == "Instance" and playerArg:IsA("Player") and (key == "Season" or key == "SeasonClaims") then
		pushState(playerArg)
	end
end)

gamePassChangedEvent.Event:Connect(function(playerArg: any, passName: any)
	if typeof(playerArg) == "Instance" and playerArg:IsA("Player") and passName == "SeasonPass" then
		pushState(playerArg)
	end
end)

local function onPlayerAdded(player: Player)
	local function start()
		ready[player] = true
		pushState(player)
	end
	if player:GetAttribute("DataLoaded") == true then
		start()
		return
	end
	local connection: RBXScriptConnection? = nil
	connection = player:GetAttributeChangedSignal("DataLoaded"):Connect(function()
		if player:GetAttribute("DataLoaded") == true then
			if connection then
				connection:Disconnect()
			end
			start()
		end
	end)
end

Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(function(player: Player)
	ready[player] = nil
	lastRequest[player] = nil
end)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

-- This week's limited brainrot, from the server's clock (a player's device
-- clock can be wrong): ReplicatedStorage attributes LimitedId and
-- LimitedEndsAt (server time).
local function publishLimited()
	local limited, endsAt = ExtrasConfig.currentLimited(os.time())
	ReplicatedStorage:SetAttribute("LimitedId", limited.Id)
	ReplicatedStorage:SetAttribute("LimitedEndsAt", Workspace:GetServerTimeNow() + (endsAt - os.time()))
end
publishLimited()
task.spawn(function()
	while true do
		task.wait(30)
		publishLimited()
	end
end)

-- A little XP for every minute played.
task.spawn(function()
	while true do
		task.wait(PLAYTIME_TICK_SECONDS)
		for player in ready do
			pcall(addXP, player, ExtrasConfig.PlaytimeXPPerMinute * PLAYTIME_TICK_SECONDS / 60)
		end
	end
end)

--!strict
--[[
	RewardsManager
	Location: ServerScriptService (Script)

	Everything players earn by showing up and playing:
	  * the spin wheel: one free spin a day (one more each with Premium and
	    with the VIP pass), plus spins
	    from Robux spin packs, daily rewards, playtime gifts, quests and codes
	  * a 7-day login streak with a bigger reward each day
	  * playtime gifts that unlock after minutes played today
	  * codes, each once per player
	  * three daily quests (buy, steal, collect, open a lucky block, ...)
	    and a bonus for finishing all three
	  * badges (FeatureConfig.Badges)
	  * the short tutorial for new players
	  * the Upgrades shop: walk speed levels and base skins bought with Cash
	  * the Group Chest for members of the game's group
	  * saved settings (music and sound volume, low graphics)

	Every request is checked here: the client only asks. Rewards go through the
	DataAndMonetization API (Cash, saved Progress) and the Gameplay API
	(brainrots and lucky blocks land in the base, or wait for room).

	Remotes (ReplicatedStorage.Remotes):
	  Rewards       RemoteFunction (action, argument) -> (ok, message?, extra?)
	  RewardsState  RemoteEvent, server -> client: the player's state (see buildState)
	Player attributes: SpeedLevel, TutorialStep (0 = none)
]]

local BadgeService = game:GetService("BadgeService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))
local FeatureConfig = require(Shared:WaitForChild("FeatureConfig"))
local NumberFormat = require(Shared:WaitForChild("NumberFormat"))

type Reward = FeatureConfig.Reward

local LOG_PREFIX = "[RewardsManager]"
local REQUEST_COOLDOWN_SECONDS = 0.35
local PLAYTIME_TICK_SECONDS = 5
local MAX_CODE_LENGTH = 32

local dataApi = ServerStorage:WaitForChild("DataAndMonetization")
local gameplayApi = ServerStorage:WaitForChild("Gameplay")

local function bindableFunction(folder: Instance, name: string): BindableFunction
	return folder:WaitForChild(name) :: BindableFunction
end

local addCashFunction = bindableFunction(dataApi, "AddCash")
local spendCashFunction = bindableFunction(dataApi, "SpendCash")
local getPlayerDataFunction = bindableFunction(dataApi, "GetPlayerData")
local getProgressFunction = bindableFunction(dataApi, "GetProgress")
local setProgressFunction = bindableFunction(dataApi, "SetProgress")
local progressChangedEvent = dataApi:WaitForChild("ProgressChanged") :: BindableEvent
local giveBrainrotFunction = bindableFunction(gameplayApi, "GiveBrainrot")
local getIncomeFunction = bindableFunction(gameplayApi, "GetIncome")
local ownsGamePassFunction = bindableFunction(dataApi, "OwnsGamePass")
local addHatFunction = bindableFunction(dataApi, "AddHat")
local activityEvent = gameplayApi:WaitForChild("Activity") :: BindableEvent

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local notifyEvent = remotes:WaitForChild("Notify") :: RemoteEvent

local rewardsFunction = Instance.new("RemoteFunction")
rewardsFunction.Name = "Rewards"
local stateEvent = Instance.new("RemoteEvent")
stateEvent.Name = "RewardsState"
stateEvent.Parent = remotes

local rng = Random.new()
local lastRequest: { [Player]: number } = {}
local ready: { [Player]: boolean } = {}
local statePushQueued: { [Player]: boolean } = {}

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------

local function notify(player: Player, message: string, kind: string, sound: string?)
	notifyEvent:FireClient(player, message, kind, sound)
end

local function today(): number
	return os.time() // 86400
end

local function getProgress(player: Player, key: string): any
	return getProgressFunction:Invoke(player, key)
end

local function setProgress(player: Player, key: string, value: any): boolean
	return setProgressFunction:Invoke(player, key, value) == true
end

local function getTable(player: Player, key: string): { [any]: any }
	local value = getProgress(player, key)
	return if typeof(value) == "table" then value else {}
end

local function getNumber(player: Player, key: string): number
	return tonumber(getProgress(player, key)) or 0
end

local function isLoaded(player: Player): boolean
	return ready[player] == true and player.Parent == Players and getPlayerDataFunction:Invoke(player) ~= nil
end

local function income(player: Player): number
	return tonumber(getIncomeFunction:Invoke(player)) or 0
end

local function isPremium(player: Player): boolean
	return player.MembershipType == Enum.MembershipType.Premium
end

local function isVip(player: Player): boolean
	return ownsGamePassFunction:Invoke(player, "VIP") == true
end

--------------------------------------------------------------------------------
-- Rewards
--------------------------------------------------------------------------------

local function addSpins(player: Player, count: number): boolean
	local spins = getTable(player, "Spins")
	spins.Extra = math.clamp((tonumber(spins.Extra) or 0) + count, 0, 10000)
	return setProgress(player, "Spins", spins)
end

local function addBoost(player: Player, seconds: number): boolean
	local endsAt = math.max(getNumber(player, "CashBoostEndsAt"), os.time())
	return setProgress(player, "CashBoostEndsAt", endsAt + seconds)
end

-- Gives a reward and returns what it was, for the message ("$5K", ...).
local function grant(player: Player, reward: Reward): (boolean, string)
	if reward.Kind == "Cash" then
		local amount = FeatureConfig.cashAmount(reward, income(player))
		return addCashFunction:Invoke(player, amount) == true, NumberFormat.cash(amount)
	elseif reward.Kind == "Spins" then
		return addSpins(player, reward.Count or 1), FeatureConfig.describeReward(reward)
	elseif reward.Kind == "Boost" then
		return addBoost(player, reward.Seconds or 0), FeatureConfig.describeReward(reward)
	elseif (reward.Kind == "Block" or reward.Kind == "Brainrot") and reward.Id and BrainrotConfig.ById[reward.Id] then
		local result = giveBrainrotFunction:Invoke(player, reward.Id)
		return result == "Placed" or result == "Pending", FeatureConfig.describeReward(reward)
	elseif reward.Kind == "Hat" then
		local hatName = addHatFunction:Invoke(player, reward.Hat or "Random", 1)
		if typeof(hatName) ~= "string" then
			return false, "nothing"
		end
		return true, FeatureConfig.describeReward({ Kind = "Hat", Hat = hatName } :: Reward)
	end
	return false, "nothing"
end

-- Server API (ServerStorage.Rewards) for the season pass and boss raids:
--   BindableFunction GrantReward(player, reward) -> (ok, description)
do
	local folder = Instance.new("Folder")
	folder.Name = "Rewards"
	local grantFunction = Instance.new("BindableFunction")
	grantFunction.Name = "GrantReward"
	grantFunction.OnInvoke = function(playerArg: any, reward: any): (boolean, string)
		if typeof(playerArg) ~= "Instance" or not playerArg:IsA("Player") or typeof(reward) ~= "table" then
			return false, "nothing"
		end
		return grant(playerArg, reward :: Reward)
	end
	grantFunction.Parent = folder
	folder.Parent = ServerStorage
end

--------------------------------------------------------------------------------
-- Badges
--------------------------------------------------------------------------------

local function awardBadge(player: Player, key: string)
	local badgeId = FeatureConfig.Badges[key]
	if typeof(badgeId) ~= "number" or badgeId == 0 then
		return
	end
	local awarded = getTable(player, "Badges")
	if table.find(awarded, key) then
		return
	end
	task.spawn(function()
		local ok, result = pcall(function(): boolean
			return BadgeService:AwardBadge(player.UserId, badgeId)
		end)
		if ok and result and player.Parent == Players then
			local list = getTable(player, "Badges")
			if table.find(list, key) == nil then
				table.insert(list, key)
				setProgress(player, "Badges", list)
			end
		elseif not ok then
			warn(string.format("%s Couldn't award badge %s: %s", LOG_PREFIX, key, tostring(result)))
		end
	end)
end

--------------------------------------------------------------------------------
-- Quests
--------------------------------------------------------------------------------

type QuestState = { Id: string, Progress: number, Claimed: boolean }

-- Today's quests, rolling new ones on a new day.
local function getQuests(player: Player): { Day: number, List: { QuestState }, Bonus: boolean }
	local saved = getTable(player, "Quests")
	local list: { QuestState } = {}
	if saved.Day == today() and typeof(saved.List) == "table" then
		for _, entry in saved.List do
			if typeof(entry) == "table" and typeof(entry.Id) == "string" and FeatureConfig.QuestById[entry.Id] then
				table.insert(list, {
					Id = entry.Id,
					Progress = math.max(0, tonumber(entry.Progress) or 0),
					Claimed = entry.Claimed == true,
				})
			end
		end
	end
	if #list == 0 then
		local pool = table.clone(FeatureConfig.Quests)
		for _ = 1, math.min(FeatureConfig.QuestsPerDay, #pool) do
			local quest = table.remove(pool, rng:NextInteger(1, #pool))
			if quest then
				table.insert(list, { Id = quest.Id, Progress = 0, Claimed = false })
			end
		end
		local fresh = { Day = today(), List = list, Bonus = false }
		setProgress(player, "Quests", fresh)
		return fresh
	end
	return { Day = today(), List = list, Bonus = saved.Bonus == true }
end

--------------------------------------------------------------------------------
-- State for the client
--------------------------------------------------------------------------------

local function spinsAvailable(player: Player): (number, number)
	local spins = getTable(player, "Spins")
	local free = if spins.FreeDay ~= today() then 1 else 0
	if isPremium(player) and spins.PremiumDay ~= today() then
		free += FeatureConfig.PremiumDailySpins
	end
	if isVip(player) and spins.VipDay ~= today() then
		free += FeatureConfig.VipDailySpins
	end
	return free, math.max(0, tonumber(spins.Extra) or 0)
end

local function buildState(player: Player): { [string]: any }
	local daily = getTable(player, "Daily")
	local streak = tonumber(daily.Streak) or 0
	local claimedToday = daily.Day == today()
	local continues = daily.Day == today() - 1
	local nextStreak = if claimedToday then streak else (if continues then streak + 1 else 1)

	local playtime = getTable(player, "Playtime")
	local playSeconds = if playtime.Day == today() then tonumber(playtime.Seconds) or 0 else 0
	local playClaimed = if playtime.Day == today() and typeof(playtime.Claimed) == "table" then playtime.Claimed else {}

	local quests = getQuests(player)
	local questList = {}
	for _, quest in quests.List do
		local info = FeatureConfig.QuestById[quest.Id]
		table.insert(questList, {
			Id = quest.Id,
			Text = info.Text,
			Target = info.Target,
			Progress = math.min(quest.Progress, info.Target),
			Claimed = quest.Claimed,
			Reward = FeatureConfig.describeReward(info.Reward, income(player)),
		})
	end

	local free, extra = spinsAvailable(player)
	local skins = getTable(player, "Skins")
	local settings = getTable(player, "Settings")
	return {
		Day = today(),
		SecondsToNextDay = 86400 - os.time() % 86400,
		Daily = {
			Streak = streak,
			Claimed = claimedToday,
			-- Which of the 7 rewards is (or was) today's.
			Index = (math.max(nextStreak, 1) - 1) % #FeatureConfig.DailyRewards + 1,
		},
		Spins = { Free = free, Extra = extra },
		Playtime = { Seconds = playSeconds, Claimed = playClaimed },
		Quests = questList,
		QuestBonus = quests.Bonus,
		Settings = settings,
		SpeedLevel = getNumber(player, "SpeedLevel"),
		Skins = {
			Owned = if typeof(skins.Owned) == "table" then skins.Owned else {},
			Equipped = if typeof(skins.Equipped) == "string" then skins.Equipped else "Classic",
		},
		GroupChest = getProgress(player, "GroupChest") == true,
		GroupEnabled = FeatureConfig.GroupId ~= 0,
		Income = income(player),
	}
end

local function pushState(player: Player)
	if statePushQueued[player] then
		return
	end
	statePushQueued[player] = true
	task.defer(function()
		statePushQueued[player] = nil
		if isLoaded(player) then
			stateEvent:FireClient(player, buildState(player))
		end
	end)
end

--------------------------------------------------------------------------------
-- Tutorial
--------------------------------------------------------------------------------

local TUTORIAL_ACTIVITIES = { "Buy", "Collect", "Lock" }
local TUTORIAL_DONE = #TUTORIAL_ACTIVITIES + 1

local function setTutorialStep(player: Player, step: number)
	setProgress(player, "Tutorial", step)
	player:SetAttribute("TutorialStep", if step >= TUTORIAL_DONE then 0 else step)
end

local function advanceTutorial(player: Player, activity: string)
	local step = getNumber(player, "Tutorial")
	if step < 1 or step >= TUTORIAL_DONE or TUTORIAL_ACTIVITIES[step] ~= activity then
		return
	end
	step += 1
	setTutorialStep(player, step)
	if step >= TUTORIAL_DONE then
		addCashFunction:Invoke(player, FeatureConfig.TutorialReward)
		notify(
			player,
			string.format("Tutorial done! Here's %s. Now go steal some brainrots!", NumberFormat.cash(FeatureConfig.TutorialReward)),
			"Success",
			"Rebirth"
		)
	end
end

--------------------------------------------------------------------------------
-- Activity: quests, badges and the tutorial
--------------------------------------------------------------------------------

local function onActivity(player: Player, kind: string, amount: number)
	if not isLoaded(player) then
		return
	end
	advanceTutorial(player, kind)

	local quests = getQuests(player)
	local changed = false
	for _, quest in quests.List do
		local info = FeatureConfig.QuestById[quest.Id]
		if info.Activity == kind and not quest.Claimed and quest.Progress < info.Target then
			quest.Progress = math.min(info.Target, quest.Progress + amount)
			changed = true
			if quest.Progress >= info.Target then
				notify(player, string.format("Quest complete: %s! Claim it in Quests.", info.Text), "Success", "Notify")
			end
		end
	end
	if changed then
		setProgress(player, "Quests", quests)
		pushState(player)
	end

	if kind == "Steal" then
		awardBadge(player, "FirstSteal")
	elseif kind == "Rebirth" then
		awardBadge(player, "FirstRebirth")
		local data = getPlayerDataFunction:Invoke(player)
		if typeof(data) == "table" and (tonumber(data.Rebirths) or 0) >= 5 then
			awardBadge(player, "Rebirth5")
		end
	elseif kind == "OpenBlock" then
		awardBadge(player, "LuckyOpener")
	elseif kind == "Fuse" then
		awardBadge(player, "FirstFuse")
	elseif kind == "Trade" then
		awardBadge(player, "FirstTrade")
	elseif kind == "Secret" then
		awardBadge(player, "SecretOwner")
	elseif kind == "IndexComplete" then
		awardBadge(player, "IndexMaster")
	end
end

activityEvent.Event:Connect(function(playerArg: any, kind: any, amount: any)
	if typeof(playerArg) == "Instance" and playerArg:IsA("Player") and typeof(kind) == "string" then
		onActivity(playerArg, kind, math.clamp(tonumber(amount) or 1, 0, 1e12))
	end
end)

--------------------------------------------------------------------------------
-- Requests
--------------------------------------------------------------------------------

type Handler = (player: Player, argument: any) -> (boolean, string?, any)

local function pickSpinPrize(): number
	local total = 0
	for _, prize in FeatureConfig.SpinPrizes do
		total += prize.Weight
	end
	local roll = rng:NextNumber(0, total)
	for index, prize in FeatureConfig.SpinPrizes do
		roll -= prize.Weight
		if roll <= 0 then
			return index
		end
	end
	return 1
end

local HANDLERS: { [string]: Handler } = {}

HANDLERS.State = function(player: Player): (boolean, string?, any)
	return true, nil, buildState(player)
end

HANDLERS.ClaimDaily = function(player: Player): (boolean, string?, any)
	local daily = getTable(player, "Daily")
	if daily.Day == today() then
		return false, "You already claimed today's reward. Come back tomorrow!"
	end
	local streak = if daily.Day == today() - 1 then (tonumber(daily.Streak) or 0) + 1 else 1
	local index = (streak - 1) % #FeatureConfig.DailyRewards + 1
	if not setProgress(player, "Daily", { Day = today(), Streak = streak }) then
		return false, "Try again in a moment."
	end
	local ok, what = grant(player, FeatureConfig.DailyRewards[index])
	if streak >= 7 then
		awardBadge(player, "WeekStreak")
	end
	pushState(player)
	return ok, string.format("Day %d reward: %s!", streak, what)
end

HANDLERS.Spin = function(player: Player): (boolean, string?, any)
	local spins = getTable(player, "Spins")
	local free, extra = spinsAvailable(player)
	if free <= 0 and extra <= 0 then
		return false, "No spins left! Get more from quests, gifts or the shop."
	end
	if spins.FreeDay ~= today() then
		spins.FreeDay = today()
	elseif isPremium(player) and spins.PremiumDay ~= today() then
		spins.PremiumDay = today()
	elseif isVip(player) and spins.VipDay ~= today() then
		spins.VipDay = today()
	else
		spins.Extra = extra - 1
	end
	if not setProgress(player, "Spins", spins) then
		return false, "Try again in a moment."
	end
	local index = pickSpinPrize()
	local prize = FeatureConfig.SpinPrizes[index]
	local _, what = grant(player, prize.Reward)
	onActivity(player, "Spin", 1)
	pushState(player)
	return true, "You won " .. what .. "!", { Index = index }
end

HANDLERS.ClaimPlaytime = function(player: Player, argument: any): (boolean, string?, any)
	local index = tonumber(argument)
	local gift = if index then FeatureConfig.PlaytimeRewards[index] else nil
	if index == nil or gift == nil then
		return false, nil
	end
	local playtime = getTable(player, "Playtime")
	if playtime.Day ~= today() then
		return false, "Keep playing to unlock this gift!"
	end
	local claimed = if typeof(playtime.Claimed) == "table" then playtime.Claimed else {}
	if table.find(claimed, index) then
		return false, "Already opened!"
	end
	if (tonumber(playtime.Seconds) or 0) < gift.Minutes * 60 then
		return false, "Keep playing to unlock this gift!"
	end
	table.insert(claimed, index)
	playtime.Claimed = claimed
	if not setProgress(player, "Playtime", playtime) then
		return false, "Try again in a moment."
	end
	local ok, what = grant(player, gift.Reward)
	pushState(player)
	return ok, "Gift opened: " .. what .. "!"
end

HANDLERS.Redeem = function(player: Player, argument: any): (boolean, string?, any)
	if typeof(argument) ~= "string" or #argument > MAX_CODE_LENGTH then
		return false, "That code doesn't exist."
	end
	local code = string.upper((string.gsub(argument, "%s", "")))
	local reward = FeatureConfig.Codes[code]
	if reward == nil then
		return false, "That code doesn't exist."
	end
	local used = getTable(player, "Codes")
	if table.find(used, code) then
		return false, "You already used this code."
	end
	table.insert(used, code)
	if not setProgress(player, "Codes", used) then
		return false, "Try again in a moment."
	end
	local ok, what = grant(player, reward)
	pushState(player)
	return ok, string.format("Code %s: %s!", code, what)
end

HANDLERS.ClaimQuest = function(player: Player, argument: any): (boolean, string?, any)
	local quests = getQuests(player)
	local quest = quests.List[tonumber(argument) or 0]
	if quest == nil then
		return false, nil
	end
	local info = FeatureConfig.QuestById[quest.Id]
	if quest.Claimed then
		return false, "Already claimed!"
	elseif quest.Progress < info.Target then
		return false, "Finish the quest first!"
	end
	quest.Claimed = true
	if not setProgress(player, "Quests", quests) then
		return false, "Try again in a moment."
	end
	local ok, what = grant(player, info.Reward)
	pushState(player)
	-- Season pass XP.
	activityEvent:Fire(player, "Quest", 1)
	return ok, "Quest reward: " .. what .. "!"
end

HANDLERS.ClaimQuestBonus = function(player: Player): (boolean, string?, any)
	local quests = getQuests(player)
	if quests.Bonus then
		return false, "Already claimed!"
	end
	for _, quest in quests.List do
		if not quest.Claimed then
			return false, "Claim all of today's quests first!"
		end
	end
	quests.Bonus = true
	if not setProgress(player, "Quests", quests) then
		return false, "Try again in a moment."
	end
	local ok, what = grant(player, FeatureConfig.QuestBonus)
	pushState(player)
	return ok, "All quests done! Bonus: " .. what .. "!"
end

HANDLERS.BuySpeed = function(player: Player): (boolean, string?, any)
	local level = getNumber(player, "SpeedLevel")
	local cost = FeatureConfig.SpeedCosts[level + 1]
	if cost == nil then
		return false, "You're already max speed!"
	end
	if spendCashFunction:Invoke(player, cost) ~= true then
		return false, string.format("You need %s for the next speed level.", NumberFormat.cash(cost))
	end
	setProgress(player, "SpeedLevel", level + 1)
	player:SetAttribute("SpeedLevel", level + 1)
	pushState(player)
	return true, string.format("Speed level %d! You run faster now.", level + 1)
end

HANDLERS.BuySkin = function(player: Player, argument: any): (boolean, string?, any)
	local skin = if typeof(argument) == "string" then FeatureConfig.SkinByName[argument] else nil
	if skin == nil or skin.Price == nil then
		return false, nil
	end
	local skins = getTable(player, "Skins")
	local owned = if typeof(skins.Owned) == "table" then skins.Owned else {}
	if table.find(owned, skin.Name) or skin.Price == 0 then
		return false, "You already own this skin."
	end
	if spendCashFunction:Invoke(player, skin.Price) ~= true then
		return false, string.format("You need %s for the %s skin.", NumberFormat.cash(skin.Price), skin.Name)
	end
	table.insert(owned, skin.Name)
	skins.Owned = owned
	skins.Equipped = skin.Name
	setProgress(player, "Skins", skins)
	pushState(player)
	return true, string.format("Your base is now %s!", skin.Name)
end

HANDLERS.EquipSkin = function(player: Player, argument: any): (boolean, string?, any)
	local skin = if typeof(argument) == "string" then FeatureConfig.SkinByName[argument] else nil
	if skin == nil then
		return false, nil
	end
	local skins = getTable(player, "Skins")
	local owned = if typeof(skins.Owned) == "table" then skins.Owned else {}
	if skin.Price ~= 0 and table.find(owned, skin.Name) == nil then
		return false, "You don't own this skin yet."
	end
	skins.Owned = owned
	skins.Equipped = skin.Name
	setProgress(player, "Skins", skins)
	pushState(player)
	return true, string.format("Equipped the %s skin.", skin.Name)
end

HANDLERS.ClaimGroupChest = function(player: Player): (boolean, string?, any)
	if FeatureConfig.GroupId == 0 then
		return false, "There's no group chest yet."
	end
	if getProgress(player, "GroupChest") == true then
		return false, "You already opened the Group Chest."
	end
	local ok, member = pcall(function(): boolean
		return player:IsInGroupAsync(FeatureConfig.GroupId)
	end)
	if not ok or not member then
		return false, "Join the group to open the Group Chest!"
	end
	setProgress(player, "GroupChest", true)
	local granted, what = grant(player, FeatureConfig.GroupChest)
	pushState(player)
	return granted, "Group Chest: " .. what .. "!"
end

HANDLERS.SaveSettings = function(player: Player, argument: any): (boolean, string?, any)
	if typeof(argument) ~= "table" then
		return false, nil
	end
	local defaults = FeatureConfig.DefaultSettings
	setProgress(player, "Settings", {
		Music = math.clamp(tonumber(argument.Music) or defaults.Music, 0, 1),
		Sfx = math.clamp(tonumber(argument.Sfx) or defaults.Sfx, 0, 1),
		LowGraphics = argument.LowGraphics == true,
	})
	return true, nil
end

HANDLERS.SkipTutorial = function(player: Player): (boolean, string?, any)
	if getNumber(player, "Tutorial") < TUTORIAL_DONE then
		setTutorialStep(player, TUTORIAL_DONE)
	end
	return true, nil
end

rewardsFunction.OnServerInvoke = function(player: Player, action: any, argument: any): (boolean, string?, any)
	if typeof(action) ~= "string" then
		return false, nil
	end
	local handler = HANDLERS[action]
	if handler == nil or not isLoaded(player) then
		return false, "Still loading, try again in a moment."
	end
	local now = os.clock()
	if action ~= "State" and now - (lastRequest[player] or 0) < REQUEST_COOLDOWN_SECONDS then
		return false, "Slow down!"
	end
	lastRequest[player] = now
	local ok, message, extra = handler(player, argument)
	return ok, message, extra
end

--------------------------------------------------------------------------------
-- Players
--------------------------------------------------------------------------------

local function onDataLoaded(player: Player)
	if ready[player] then
		return
	end
	ready[player] = true
	player:SetAttribute("SpeedLevel", math.clamp(getNumber(player, "SpeedLevel"), 0, #FeatureConfig.SpeedCosts))

	-- New players get the tutorial; everyone else has seen the game already.
	local tutorial = getProgress(player, "Tutorial")
	if tutorial == nil then
		local data = getPlayerDataFunction:Invoke(player)
		local isNew = typeof(data) == "table" and data.Cash == 0 and data.Rebirths == 0 and data.Steals == 0
		setTutorialStep(player, if isNew then 1 else TUTORIAL_DONE)
	else
		setTutorialStep(player, math.clamp(tonumber(tutorial) or TUTORIAL_DONE, 1, TUTORIAL_DONE))
	end
	awardBadge(player, "Welcome")
	pushState(player)

	local free = spinsAvailable(player)
	local daily = getTable(player, "Daily")
	if daily.Day ~= today() or free > 0 then
		task.delay(6, function()
			if player.Parent == Players then
				notify(player, "Your daily reward and free spin are ready! 🎁", "Info", "Notify")
			end
		end)
	end
end

local function onPlayerAdded(player: Player)
	if player:GetAttribute("DataLoaded") == true then
		task.spawn(onDataLoaded, player)
		return
	end
	local connection: RBXScriptConnection? = nil
	connection = player:GetAttributeChangedSignal("DataLoaded"):Connect(function()
		if player:GetAttribute("DataLoaded") == true then
			if connection then
				connection:Disconnect()
			end
			onDataLoaded(player)
		end
	end)
end

Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(function(player: Player)
	ready[player] = nil
	lastRequest[player] = nil
	statePushQueued[player] = nil
end)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

-- Robux purchases (spin packs, skins, Cash Boosts) change saved progress.
progressChangedEvent.Event:Connect(function(playerArg: any, key: any)
	if typeof(playerArg) == "Instance" and playerArg:IsA("Player") and (key == "Spins" or key == "Skins" or key == "CashBoostEndsAt") then
		pushState(playerArg)
	end
end)

-- Playtime: minutes played today (UTC), and badges that watch Cash.
task.spawn(function()
	while true do
		task.wait(PLAYTIME_TICK_SECONDS)
		for _, player in Players:GetPlayers() do
			if not isLoaded(player) then
				continue
			end
			local playtime = getTable(player, "Playtime")
			if playtime.Day ~= today() then
				playtime = { Day = today(), Seconds = 0, Claimed = {} }
			end
			local before = tonumber(playtime.Seconds) or 0
			playtime.Seconds = before + PLAYTIME_TICK_SECONDS
			setProgress(player, "Playtime", playtime)
			for _, gift in FeatureConfig.PlaytimeRewards do
				local unlockAt = gift.Minutes * 60
				if before < unlockAt and playtime.Seconds >= unlockAt then
					notify(player, "A playtime gift is ready to open! 🎁", "Info", "Notify")
					pushState(player)
				end
			end
			local data = getPlayerDataFunction:Invoke(player)
			if typeof(data) == "table" and (tonumber(data.Cash) or 0) >= 1000000 then
				awardBadge(player, "Millionaire")
			end
		end
	end
end)

-- Parent last so the client sees both remotes together.
rewardsFunction.Parent = remotes

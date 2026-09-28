--!strict
--[[
	GameplayManager
	Location: ServerScriptService (Script)

	Runs the Snatch the Brainrot loop on the server:
	  * gives each player one of the bases in Workspace.Map.Plots
	  * spawns brainrots on the conveyor (rarer ones more often during a Server
	    Rarity Boost, one mutation far more often during a mutation event) that
	    players buy with Cash
	  * a bought brainrot walks from the conveyor to its buyer's base; until it
	    reaches the door, anyone else can buy it off them (the first buyer gets
	    their Cash back) and it turns around to walk to the new owner's base
	  * brainrots on their pedestals fill the collect pad in front of them with
	    Cash; the owner steps on the pad to collect it. Uncollected Cash is saved,
	    and brainrots keep earning while their owner is offline
	  * brainrots can be sold or stolen; a slapped thief drops what they carry
	  * each base has a laser door its owner can lock; the EMP Laser Overrider
	    lets its buyer walk through any locked door
	  * rebirths reset Cash (and the pads) for a permanent income bonus and open
	    the next floor of the base (4 floors of 8 pedestals)
	  * events every few minutes: mutation events (Gold Rush, Blood Moon, ...),
	    Taco Tuesday, Lucky Hour and Cash Rain (coins to collect), and now and
	    then ADMIN ABUSE (everything at once; admins can start it with /abuse)
	  * lucky blocks turn up on the conveyor (or are bought with Robux); their
	    owner opens them in their base for a random brainrot
	  * traits (Fire, Tiny, Giant, Glitched, Nyan) roll like mutations and
	    stack with them
	  * the Index: finding every brainrot of a rarity (or every Gold, Diamond
	    or Rainbow one) pays out and adds a permanent income bonus
	  * pedestal upgrades, base skins, income boosts (Cash Boost, friends,
	    Premium, group, Index), the base alarm, the Long Lock pass, and
	    brainrots each rebirth needs

	Every decision is made here. Clients only press ProximityPrompts and call the
	RequestRebirth remote, and each request is re-checked on the server
	(ownership, distance, Cash, free slots). Cash and saved data go through the
	DataAndMonetizationManager API in ServerStorage.

	Client-facing state:
	  ReplicatedStorage.Remotes.Notify (RemoteEvent, server -> client: message, kind, sound?)
	  ReplicatedStorage.Remotes.PlaySound (RemoteEvent, server -> client: sound)
	  ReplicatedStorage.Remotes.RequestRebirth (RemoteFunction)
	  Player attributes IncomePerSecond (number), Carrying (boolean)
	  Plot model attributes OwnerUserId (number, 0 = empty), LockEndsAt (server time)
	  ReplicatedStorage attributes EventName, EventMutation, EventEndsAt, EventSky,
	    EventParticles (the running event)
	  Workspace.Map.Coins (Cash Rain coins, attribute Spin for the client)
	  Brainrot model attributes BrainrotId, State, OwnerUserId, ...
	  ProximityPrompt attributes PromptKind ("Buy" | "Steal" | "Sell" | "Snipe"),
	    OwnerUserId, Carried, Walking, Snipeable (used by the client to hide
	    prompts that do not apply)

	  ReplicatedStorage.Remotes.LuckyReveal (server -> all clients:
	    ownerUserId, blockId, resultEntry, position)
	  ReplicatedStorage.Remotes.BaseAlarm (server -> victim: thief or nil, name)
	  Player attributes IncomeMultiplier, BoostInfo, Discovered ("," list)
	  Plot model attributes Alarm, Skin, SkinEffect; slot attribute Level
	  Brainrot model attributes Trait, Slot, LuckyBlock

	Server API for other scripts (ServerStorage.Gameplay):
	  BindableEvent    ForceDrop(player, message?, catcher?)  a thief drops their brainrot
	  BindableEvent    Activity(player, kind, amount)  for quests, badges and the
	    tutorial: Buy, BuyEpic, Steal, Collect, OpenBlock, Lock, Upgrade,
	    Catch, Fuse, Trade, Rebirth, Slap, Spin, Secret
	  BindableFunction GiveBrainrot(player, entry) -> "Placed" | "Pending" | nil
	  BindableFunction TakeBrainrots(player, slots) -> { entry }?  (for fusing)
	  BindableFunction TradeBrainrots(playerA, slotsA, playerB, slotsB) -> boolean
	  BindableFunction DescribeSlots(player, slots) -> { entry }?  (what's there)
	  BindableFunction GetIncome(player) -> number
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local ServerStorage = game:GetService("ServerStorage")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local BrainrotConfig = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("BrainrotConfig"))
local ExtrasConfig = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("ExtrasConfig"))
local FeatureConfig = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("FeatureConfig"))
local GameConfig = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("GameConfig"))
local MonetizationConfig = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("MonetizationConfig"))
local NumberFormat = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("NumberFormat"))

local LOG_PREFIX = "[GameplayManager]"

-- Fixed numbers and look-up tables live in Tuning, and the objects this
-- script makes in Api, rather than in locals of their own: Studio compiles
-- scripts with full debug info, which allows only 200 locals at the top level
-- of a script, and this one is big.
local Tuning = {}

-- Height of a carried brainrot's feet above the thief's HumanoidRootPart.
Tuning.CARRY_HEIGHT = 3.2
-- Height in studs of a brainrot with Scale 1.
Tuning.FIGURE_HEIGHT = 5.2
Tuning.FAST_TICK_SECONDS = 0.1
Tuning.SLOW_TICK_SECONDS = 1
Tuning.REBIRTH_REQUEST_COOLDOWN_SECONDS = 1
-- Walking brainrots walk beside the conveyor this far from the carpet's end.
Tuning.LANE_INSET = 3
-- The pad in front of a pedestal, and the walkway between pads and door.
Tuning.PAD_OFFSET = 5.5
Tuning.PAD_REACH = 1
-- How far from the stairs a walking brainrot steps off onto the floor above.
Tuning.STAIR_EXIT_OFFSET = 4.75

--------------------------------------------------------------------------------
-- Types
--------------------------------------------------------------------------------

type Definition = BrainrotConfig.Brainrot
type Mutation = BrainrotConfig.Mutation
type Trait = BrainrotConfig.Trait
type NotifyKind = "Info" | "Success" | "Warning" | "Error"

type Visual = {
	Model: Model,
	Root: BasePart,
	PromptAttachment: Attachment,
	PriceLabel: TextLabel?,
	OwnerLabel: TextLabel?,
	IncomeLabel: TextLabel?,
}

type Pad = {
	Part: BasePart,
	Billboard: BillboardGui,
	Amount: TextLabel,
	Tag: TextLabel,
}

type Plot = {
	Index: number,
	Model: Model,
	Floor: BasePart,
	Interior: BasePart,
	LaserZone: BasePart,
	Carpet: BasePart?,
	Lasers: { BasePart },
	SpawnPoint: BasePart,
	Slots: { BasePart },
	Pads: { [number]: Pad },
	-- Uncollected Cash on each slot's pad (fractions carry over).
	PadCash: { number },
	OfflinePads: { [number]: boolean },
	Occupants: { [number]: Occupant },
	Reserved: { [number]: boolean },
	-- Stairs from floor N up to floor N + 1, and signs on locked floors.
	Stairs: { [number]: Stair },
	FloorSigns: { [number]: TextLabel },
	UnlockedFloors: number,
	-- Pedestal upgrade level of each slot (1 = not upgraded) and its glow ring.
	Levels: { number },
	LevelRings: { [number]: BasePart },
	-- Parts a base skin recolours, with their original look.
	SkinParts: { SkinPart },
	Owner: Player?,
	LockEndsAt: number,
	SignTitle: TextLabel,
	SignSubtitle: TextLabel,
	LockLabel: TextLabel,
}

type Walk = {
	-- Where to walk, with the height of the floor at each point. Between two
	-- points the height follows a straight line (up the stairs too), and a
	-- short ray only fine-tunes it onto each step, so a lag spike can never
	-- drop a brainrot onto the wrong floor.
	Points: { Vector3 },
	-- Start of the stretch it's walking now.
	Last: Vector3,
	Index: number,
	-- Reaching this point means it walked through its owner's door.
	DoorIndex: number,
	Entered: boolean,
	Speed: number,
	Height: number,
}

type SkinPart = { Part: BasePart, Kind: string, Color: Color3, Material: Enum.Material }

type Occupant = {
	Definition: Definition,
	Mutation: Mutation?,
	Trait: Trait?,
	Plot: Plot,
	SlotIndex: number,
	Model: Model,
	Root: BasePart,
	PromptAttachment: Attachment,
	StealPrompt: ProximityPrompt,
	SellPrompt: ProximityPrompt,
	SnipePrompt: ProximityPrompt?,
	UpgradePrompt: ProximityPrompt?,
	-- A lucky block being opened saves as what it will become.
	OpeningResult: string?,
	-- What its owner paid; the price for anyone buying it off them.
	Price: number,
	Walk: Walk?,
	Sniping: boolean,
	Carrier: Player?,
	PriceLabel: TextLabel?,
	OwnerLabel: TextLabel?,
	-- The hat it wears (ExtrasConfig.Hats) and how long it has been levelling
	-- up; both are saved with it (BrainrotConfig.encodeFull).
	Hat: string?,
	Seconds: number,
	IncomeLabel: TextLabel?,
	LevelLabel: TextLabel?,
}

type Carry = {
	Thief: Player,
	Occupant: Occupant,
	VictimPlot: Plot,
	TargetPlot: Plot,
	TargetSlot: number,
	StartedAt: number,
	LastPosition: Vector3,
	LastCheckedAt: number,
	Weld: WeldConstraint,
}

type ConveyorItem = {
	Definition: Definition,
	Mutation: Mutation?,
	Trait: Trait?,
	Price: number,
	Model: Model,
	Root: BasePart,
	PromptAttachment: Attachment,
	Tween: Tween,
	Sold: boolean,
}

type GameEvent = GameConfig.GameEvent

type Stair = { Bottom: Vector3, Top: Vector3 }

--------------------------------------------------------------------------------
-- Data API (ServerStorage.DataAndMonetization)
--------------------------------------------------------------------------------

-- Handles to the DataAndMonetization API, in one table to keep the number of
-- locals in this script down (Luau allows 200).
local DataApi: { [string]: any } = {}
do
	local folder = ServerStorage:WaitForChild("DataAndMonetization")
	for _, name in
		{
			"AddCash",
			"SpendCash",
			"AddRebirths",
			"AddSteals",
			"GetPlayerData",
			"GetBrainrots",
			"SetBrainrots",
			"GetPadCash",
			"SetPadCash",
			"CollectPadCash",
			"TakeOfflineSeconds",
			"IsLaserBypassActive",
			"GetServerRarityMultiplier",
			"GetProgress",
			"SetProgress",
			"GetHats",
			"AddHat",
			"TakeHat",
			"OwnsGamePass",
			"SaveNow",
			"ProgressChanged",
			"EMPLaserOverriderPurchased",
			"ServerRarityBoostChanged",
		}
	do
		DataApi[name] = folder:WaitForChild(name)
	end
end

local function addCash(player: Player, amount: number): boolean
	return DataApi.AddCash:Invoke(player, amount) == true
end

local function spendCash(player: Player, amount: number): boolean
	return DataApi.SpendCash:Invoke(player, amount) == true
end

local function getPlayerData(player: Player): { [string]: any }?
	local data = DataApi.GetPlayerData:Invoke(player)
	return if typeof(data) == "table" then data else nil
end

local function getProgress(player: Player, key: string): any
	return DataApi.GetProgress:Invoke(player, key)
end

local function setProgress(player: Player, key: string, value: any): boolean
	return DataApi.SetProgress:Invoke(player, key, value) == true
end

--------------------------------------------------------------------------------
-- Remotes and server API
--------------------------------------------------------------------------------

local Api = {}
Api.remotesFolder = Instance.new("Folder")
Api.remotesFolder.Name = "Remotes"

Api.notifyEvent = Instance.new("RemoteEvent")
Api.notifyEvent.Name = "Notify"
Api.notifyEvent.Parent = Api.remotesFolder

Api.playSoundEvent = Instance.new("RemoteEvent")
Api.playSoundEvent.Name = "PlaySound"
Api.playSoundEvent.Parent = Api.remotesFolder

Api.requestRebirthFunction = Instance.new("RemoteFunction")
Api.requestRebirthFunction.Name = "RequestRebirth"
Api.requestRebirthFunction.Parent = Api.remotesFolder

Api.luckyRevealEvent = Instance.new("RemoteEvent")
Api.luckyRevealEvent.Name = "LuckyReveal"
Api.luckyRevealEvent.Parent = Api.remotesFolder

Api.baseAlarmEvent = Instance.new("RemoteEvent")
Api.baseAlarmEvent.Name = "BaseAlarm"
Api.baseAlarmEvent.Parent = Api.remotesFolder

-- The client passes chat commands on too, in case the server doesn't hear them.
Api.chatCommandEvent = Instance.new("RemoteEvent")
Api.chatCommandEvent.Name = "ChatCommand"
Api.chatCommandEvent.Parent = Api.remotesFolder

Api.remotesFolder.Parent = ReplicatedStorage

-- Parented to ServerStorage once every function is set (see the end).
Api.gameplayApi = Instance.new("Folder")
Api.gameplayApi.Name = "Gameplay"
Api.forceDropEvent = Instance.new("BindableEvent")
Api.forceDropEvent.Name = "ForceDrop"
Api.forceDropEvent.Parent = Api.gameplayApi
Api.activityEvent = Instance.new("BindableEvent")
Api.activityEvent.Name = "Activity"
Api.activityEvent.Parent = Api.gameplayApi

local function reportActivity(player: Player, kind: string, amount: number?)
	Api.activityEvent:Fire(player, kind, amount or 1)
end

-- `sound` names an entry in AudioConfig.Sounds for the client to play.
local function notify(player: Player, message: string, kind: NotifyKind, sound: string?)
	Api.notifyEvent:FireClient(player, message, kind, sound)
end

local function playSound(player: Player, sound: string)
	Api.playSoundEvent:FireClient(player, sound)
end

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------

local map = Workspace:WaitForChild("Map")
local plotsFolder = map:WaitForChild("Plots")
local conveyorFolder = map:WaitForChild("Conveyor")
local conveyorStart = conveyorFolder:WaitForChild("ConveyorStart") :: BasePart
local conveyorEnd = conveyorFolder:WaitForChild("ConveyorEnd") :: BasePart

local brainrotsFolder = Instance.new("Folder")
brainrotsFolder.Name = "Brainrots"
brainrotsFolder.Parent = map

local plots: { Plot } = {}
local plotByPlayer: { [Player]: Plot } = {}
local carries: { [Player]: Carry } = {}
local conveyorItems: { [ConveyorItem]: boolean } = {}
local conveyorItemCount = 0
local walkers: { [Occupant]: boolean } = {}
local lastRebirthRequest: { [Player]: number } = {}
local rng = Random.new()
local nextGuaranteedAt: { [string]: number } = {}
for _, rule in GameConfig.GuaranteedRarities do
	nextGuaranteedAt[rule.Rarity] = Workspace:GetServerTimeNow() + rule.IntervalSeconds
end
local activeEvent: GameEvent? = nil
local coinsFolder = Instance.new("Folder")
coinsFolder.Name = "Coins"
coinsFolder.Parent = map

-- Walking brainrots follow the ground: the baseplate, the conveyor and the bases.
local groundParams = RaycastParams.new()
groundParams.FilterType = Enum.RaycastFilterType.Include
do
	local ground: { Instance } = { plotsFolder }
	local belt = conveyorFolder:FindFirstChild("Belt")
	if belt then
		table.insert(ground, belt)
	end
	local baseplate = Workspace:FindFirstChild("Baseplate")
	if baseplate then
		table.insert(ground, baseplate)
	end
	groundParams.FilterDescendantsInstances = ground
end

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------

local function getLiveCharacter(player: Player): (BasePart?, Humanoid?)
	local character = player.Character
	if character == nil then
		return nil, nil
	end
	local rootPart = character:FindFirstChild("HumanoidRootPart")
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if rootPart == nil or not rootPart:IsA("BasePart") or humanoid == nil or humanoid.Health <= 0 then
		return nil, nil
	end
	return rootPart, humanoid
end

local function isPlayerNear(player: Player, position: Vector3): boolean
	local rootPart = getLiveCharacter(player)
	return rootPart ~= nil
		and (rootPart.Position - position).Magnitude <= GameConfig.PromptDistance + GameConfig.InteractionTolerance
end

local function isInsidePart(part: BasePart, position: Vector3): boolean
	local localPosition = part.CFrame:PointToObjectSpace(position)
	local halfSize = part.Size / 2
	return math.abs(localPosition.X) <= halfSize.X
		and math.abs(localPosition.Y) <= halfSize.Y
		and math.abs(localPosition.Z) <= halfSize.Z
end

local function isLocked(plot: Plot): boolean
	return Workspace:GetServerTimeNow() < plot.LockEndsAt
end

local function floorOf(slotIndex: number): number
	return (slotIndex - 1) // GameConfig.SlotsPerFloor + 1
end

-- Free pedestals are only handed out on floors the owner has opened.
local function findFreeSlot(plot: Plot): number?
	local limit = math.min(#plot.Slots, plot.UnlockedFloors * GameConfig.SlotsPerFloor)
	for index = 1, limit do
		if plot.Occupants[index] == nil and not plot.Reserved[index] then
			return index
		end
	end
	return nil
end

local function getSlotCFrame(plot: Plot, slotIndex: number): CFrame
	local slot = plot.Slots[slotIndex]
	local top = slot.Position + Vector3.new(0, slot.Size.Y / 2, 0)
	return CFrame.new(top) * plot.Floor.CFrame.Rotation
end

local function priceOf(definition: Definition, mutation: Mutation?, trait: Trait?): number
	return math.floor(definition.Price * BrainrotConfig.multiplier(mutation, trait))
end

local function incomeOf(definition: Definition, mutation: Mutation?, trait: Trait?): number
	return definition.IncomePerSecond * BrainrotConfig.multiplier(mutation, trait)
end

local function fullName(definition: Definition, mutation: Mutation?, trait: Trait?): string
	return BrainrotConfig.fullName(definition, mutation, trait)
end

local function entryOf(definition: Definition, mutation: Mutation?, trait: Trait?): string
	return BrainrotConfig.encode(definition.Id, if mutation then mutation.Name else nil, if trait then trait.Name else nil)
end

local function occupantEntry(occupant: Occupant): string
	return occupant.OpeningResult or entryOf(occupant.Definition, occupant.Mutation, occupant.Trait)
end

-- What a base brainrot saves as: its entry plus its hat and level time.
local function savedEntry(occupant: Occupant): string
	if occupant.OpeningResult then
		return occupant.OpeningResult
	end
	return BrainrotConfig.encodeFull(
		occupant.Definition.Id,
		if occupant.Mutation then occupant.Mutation.Name else nil,
		if occupant.Trait then occupant.Trait.Name else nil,
		occupant.Hat,
		occupant.Seconds
	)
end

local function getBrainrotIds(plot: Plot): { string }
	local brainrotIds: { string } = {}
	for index = 1, #plot.Slots do
		local occupant = plot.Occupants[index]
		if occupant then
			table.insert(brainrotIds, savedEntry(occupant))
		end
	end
	return brainrotIds
end

-- What the pedestal under a slot adds to its brainrot's income.
local function pedestalMultiplier(plot: Plot, slotIndex: number): number
	return 1 + FeatureConfig.PedestalBonus * ((plot.Levels[slotIndex] or 1) - 1)
end

-- Everything a base brainrot earns per second before the player's own
-- multipliers: its income, the pedestal, its level and its hat.
local function occupantIncome(occupant: Occupant): number
	local hat = if occupant.Hat then ExtrasConfig.HatByName[occupant.Hat] else nil
	return incomeOf(occupant.Definition, occupant.Mutation, occupant.Trait)
		* pedestalMultiplier(occupant.Plot, occupant.SlotIndex)
		* ExtrasConfig.levelMultiplier(ExtrasConfig.levelOf(occupant.Seconds))
		* (1 + if hat then hat.Bonus else 0)
end

Api.slotsChangedEvent = Instance.new("BindableEvent")
Api.slotsChangedEvent.Name = "SlotsChanged"
Api.slotsChangedEvent.Parent = Api.gameplayApi
Api.stolenEvent = Instance.new("BindableEvent")
Api.stolenEvent.Name = "Stolen"
Api.stolenEvent.Parent = Api.gameplayApi

-- A brainrot leaving its base (sold, stolen, fused, traded) gives its hat
-- back to whoever owned it.
local function returnHat(occupant: Occupant, owner: Player?)
	local hatName = occupant.Hat
	occupant.Hat = nil
	if hatName and owner and owner.Parent == Players then
		DataApi.AddHat:Invoke(owner, hatName, 1)
	end
end

local function saveBrainrots(plot: Plot): boolean
	local owner = plot.Owner
	if owner == nil then
		return false
	end
	local saved = DataApi.SetBrainrots:Invoke(owner, getBrainrotIds(plot)) == true
	-- Guards, pets and the Manage menu follow what's in the base.
	Api.slotsChangedEvent:Fire(owner)
	return saved
end

-- Income boosts that add up: friends in the server, Premium, the group and
-- the Index. Filled in as players join and find brainrots.
local friendsOf: { [Player]: { [number]: boolean } } = {}
local inGroup: { [Player]: boolean } = {}
local indexBonus: { [Player]: number } = {}

local function percent(value: number): string
	return string.format("+%d%%", math.floor(value * 100 + 0.5))
end

local getIncomeMultiplier: (player: Player) -> (number, { string })
do
	local function friendBoost(player: Player): number
		local count = 0
		local friends = friendsOf[player]
		if friends then
			for _, other in Players:GetPlayers() do
				if other ~= player and friends[other.UserId] then
					count += 1
				end
			end
		end
		return math.min(count * FeatureConfig.FriendBoost, FeatureConfig.MaxFriendBoost)
	end

	local function isPremium(player: Player): boolean
		return player.MembershipType == Enum.MembershipType.Premium
	end

	-- Everything that multiplies a player's income, and a line per boost for
	-- the HUD.
	getIncomeMultiplier = function(player: Player): (number, { string })
		local info: { string } = {}
		local data = getPlayerData(player)
		if data == nil then
			return 1, info
		end
		local rebirths = tonumber(data.Rebirths) or 0
		local passes = data.OwnedGamePasses
		local doubleCashId = MonetizationConfig.GamePasses.DoubleCash
		local hasDoubleCash = doubleCashId ~= nil and typeof(passes) == "table" and passes[tostring(doubleCashId)] == true
		local rebirthMultiplier = GameConfig.getRebirthIncomeMultiplier(rebirths)
		local multiplier = rebirthMultiplier
		if rebirths > 0 then
			table.insert(info, string.format("Rebirth %d: x%s", rebirths, tostring(rebirthMultiplier)))
		end
		if hasDoubleCash then
			multiplier *= MonetizationConfig.DoubleCashIncomeMultiplier
			table.insert(info, "2x Cash pass: x2")
		end
		local vipId = MonetizationConfig.GamePasses.VIP
		local isVip = vipId ~= nil and typeof(passes) == "table" and passes[tostring(vipId)] == true
		local boostEndsAt = tonumber(player:GetAttribute("CashBoostEndsAt")) or 0
		if boostEndsAt > Workspace:GetServerTimeNow() then
			multiplier *= MonetizationConfig.CashBoostMultiplier
			table.insert(info, "Cash Boost: x" .. tostring(MonetizationConfig.CashBoostMultiplier))
		end
		local bonus = 0
		local friends = friendBoost(player)
		if friends > 0 then
			bonus += friends
			table.insert(info, "Friends: " .. percent(friends))
		end
		if isPremium(player) then
			bonus += FeatureConfig.PremiumBoost
			table.insert(info, "Premium: " .. percent(FeatureConfig.PremiumBoost))
		end
		if isVip then
			bonus += FeatureConfig.VipBoost
			table.insert(info, "VIP: " .. percent(FeatureConfig.VipBoost))
		end
		if inGroup[player] then
			bonus += FeatureConfig.GroupBoost
			table.insert(info, "Group: " .. percent(FeatureConfig.GroupBoost))
		end
		local index = indexBonus[player] or 0
		if index > 0 then
			bonus += index
			table.insert(info, "Index: " .. percent(index))
		end
		-- Crewmates in the server (SocialManager sets CrewBoost).
		local crew = math.clamp(tonumber(player:GetAttribute("CrewBoost")) or 0, 0, 0.5)
		if crew > 0 then
			bonus += crew
			table.insert(info, "Crew: " .. percent(crew))
		end
		return multiplier * (1 + bonus), info
	end
end

local function setCarrying(player: Player, carrying: boolean)
	local _, humanoid = getLiveCharacter(player)
	if humanoid then
		local level = math.clamp(tonumber(player:GetAttribute("SpeedLevel")) or 0, 0, #FeatureConfig.SpeedCosts)
		local bonus = ExtrasConfig.speedBonusOf(player)
		humanoid.WalkSpeed = bonus
			+ if carrying
				then GameConfig.CarryWalkSpeed + level * FeatureConfig.CarrySpeedPerLevel
				else GameConfig.DefaultWalkSpeed + level * FeatureConfig.SpeedPerLevel
	end
	-- GearManager listens to this to re-apply coils once the carry ends.
	player:SetAttribute("Carrying", carrying)
end

--------------------------------------------------------------------------------
-- Index: the brainrots (and mutated ones) each player has ever had
--------------------------------------------------------------------------------

local discovered: { [Player]: { [string]: boolean } } = {}

local refreshIndex: (player: Player) -> ()
local discover: (player: Player, definition: Definition, mutation: Mutation?) -> ()
-- Keys of a set, sorted (saved lists stay in a stable order).
local sortedKeys: (set: { [string]: boolean }) -> { string }
do
	sortedKeys = function(set: { [string]: boolean }): { string }
		local list: { string } = {}
		for key in set do
			table.insert(list, key)
		end
		table.sort(list)
		return list
	end

	local function rarityComplete(found: { [string]: boolean }, rarityName: string): boolean
		local choices = BrainrotConfig.DropsByRarity[rarityName]
		if choices == nil or #choices == 0 then
			return false
		end
		for _, definition in choices do
			if not found[definition.Id] then
				return false
			end
		end
		return true
	end

	local function mutationComplete(found: { [string]: boolean }, mutationName: string): boolean
		for _, definition in BrainrotConfig.Obtainable do
			if not found[definition.Id .. ":" .. mutationName] then
				return false
			end
		end
		return #BrainrotConfig.Obtainable > 0
	end

	-- Works out the Index income bonus and pays out pages finished for the first time.
	refreshIndex = function(player: Player)
		local found = discovered[player]
		if found == nil then
			return
		end
		local savedClaims = getProgress(player, "IndexClaimed")
		local claimed: { [string]: boolean } = {}
		if typeof(savedClaims) == "table" then
			for _, key in savedClaims do
				if typeof(key) == "string" then
					claimed[key] = true
				end
			end
		end
		local bonus = 0
		local newlyClaimed = false
		local function check(key: string, complete: boolean, reward: { Bonus: number, Cash: number }, label: string)
			if not complete then
				return
			end
			bonus += reward.Bonus
			if not claimed[key] then
				claimed[key] = true
				newlyClaimed = true
				addCash(player, reward.Cash)
				notify(
					player,
					string.format("INDEX COMPLETE: %s! %s income forever and %s!", label, percent(reward.Bonus), NumberFormat.cash(reward.Cash)),
					"Success",
					"Rebirth"
				)
				reportActivity(player, "IndexComplete")
			end
		end
		for _, rarity in BrainrotConfig.Rarities do
			local reward = FeatureConfig.IndexRewards[rarity.Name]
			if reward then
				check(rarity.Name, rarityComplete(found, rarity.Name), reward, "every " .. rarity.Name)
			end
		end
		for _, mutationName in FeatureConfig.MutationIndex do
			local reward = FeatureConfig.MutationIndexRewards[mutationName]
			if reward then
				check("Mutation:" .. mutationName, mutationComplete(found, mutationName), reward, "every " .. mutationName .. " brainrot")
			end
		end
		if newlyClaimed then
			setProgress(player, "IndexClaimed", sortedKeys(claimed))
		end
		indexBonus[player] = bonus
		player:SetAttribute("Discovered", table.concat(sortedKeys(found), ","))
	end

	-- Adds a brainrot (and its mutated version) to the player's Index.
	discover = function(player: Player, definition: Definition, mutation: Mutation?)
		local found = discovered[player]
		if found == nil or BrainrotConfig.isLuckyBlock(definition) then
			return
		end
		local changed = false
		if not found[definition.Id] then
			found[definition.Id] = true
			changed = true
		end
		if mutation then
			local key = definition.Id .. ":" .. mutation.Name
			if not found[key] then
				found[key] = true
				changed = true
			end
		end
		if changed then
			setProgress(player, "Discovered", sortedKeys(found))
			refreshIndex(player)
		end
		if definition.Rarity == "Secret" then
			reportActivity(player, "Secret")
		end
	end
end

--------------------------------------------------------------------------------
-- Brainrot visuals
--------------------------------------------------------------------------------

local function addBodyPart(
	model: Model,
	root: BasePart,
	name: string,
	shape: Enum.PartType,
	size: Vector3,
	offset: Vector3,
	color: Color3,
	material: Enum.Material
): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Shape = shape
	part.Size = size
	part.Color = color
	part.Material = material
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.CFrame = root.CFrame * CFrame.new(offset)
	part.Anchored = false
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Massless = true

	local weld = Instance.new("WeldConstraint")
	weld.Part0 = root
	weld.Part1 = part
	weld.Parent = part

	part.Parent = model
	return part
end

-- The simple block figure each client swaps for the brainrot's model (its
-- glow and effects are added there).
local function buildFigure(model: Model, root: BasePart, definition: Definition): number
	local s = definition.Scale
	local bodySize = if definition.BodyShape == "Ball" then Vector3.one * 2.8 * s else Vector3.new(2.6, 2.6, 2.2) * s
	local bodyShape = if definition.BodyShape == "Ball" then Enum.PartType.Ball else Enum.PartType.Block
	local white = Color3.new(1, 1, 1)
	local black = Color3.new(0.1, 0.1, 0.1)

	addBodyPart(model, root, "Body", bodyShape, bodySize, Vector3.new(0, 1.5 * s, 0), definition.BodyColor, Enum.Material.SmoothPlastic)
	addBodyPart(model, root, "Head", Enum.PartType.Ball, Vector3.one * 2.1 * s, Vector3.new(0, 3.7 * s, 0), definition.BodyColor, Enum.Material.SmoothPlastic)
	for _, side in { -1, 1 } do
		addBodyPart(model, root, "Eye", Enum.PartType.Ball, Vector3.one * 0.7 * s, Vector3.new(0.45 * side * s, 3.85 * s, -0.8 * s), white, Enum.Material.SmoothPlastic)
		addBodyPart(model, root, "Pupil", Enum.PartType.Ball, Vector3.one * 0.35 * s, Vector3.new(0.45 * side * s, 3.85 * s, -1.1 * s), black, Enum.Material.SmoothPlastic)
		addBodyPart(model, root, "Foot", Enum.PartType.Block, Vector3.new(0.8, 0.5, 1) * s, Vector3.new(0.6 * side * s, 0.25 * s, 0), definition.AccentColor, Enum.Material.SmoothPlastic)
	end
	addBodyPart(model, root, "Hat", Enum.PartType.Block, Vector3.new(1.3, 0.6, 1.3) * s, Vector3.new(0, 4.85 * s, 0), definition.AccentColor, Enum.Material.SmoothPlastic)
	return Tuning.FIGURE_HEIGHT * s
end

-- World-space box around some parts.
local function partsBounds(parts: { BasePart }): (Vector3, Vector3)
	local low = Vector3.new(math.huge, math.huge, math.huge)
	local high = -low
	for _, part in parts do
		local half = part.Size / 2
		for _, corner in
			{
				Vector3.new(-1, -1, -1),
				Vector3.new(-1, -1, 1),
				Vector3.new(-1, 1, -1),
				Vector3.new(-1, 1, 1),
				Vector3.new(1, -1, -1),
				Vector3.new(1, -1, 1),
				Vector3.new(1, 1, -1),
				Vector3.new(1, 1, 1),
			}
		do
			local point = part.CFrame:PointToWorldSpace(half * corner)
			low = low:Min(point)
			high = high:Max(point)
		end
	end
	return low, high
end

-- Imported models are copied onto a brainrot's root by TemplateModels.build
-- (shared with guards and pets).
local TemplateModels = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("TemplateModels"))

-- Brainrot models imported in Studio (File > Import 3D of
-- BrainrotModels/Import/BrainrotModels.glb) arrive as a "BrainrotModels"
-- model in Workspace with parts named "<Id>_Body", "<Id>_Leg1", "<Id>_Front"
-- and so on. This turns them into one template per brainrot in
-- ReplicatedStorage.BrainrotModels: standing on the origin, facing -Z (from
-- the Front and Top markers, whatever axes the importer used), with the
-- parts named Body/Leg1/Leg2 and a Height attribute. A Model named after a
-- brainrot's Id (made or imported by hand) works too.
--
-- Block-built brainrots (tools/blocky) are in the file as their body plus
-- each moving piece, named by kind and number ("<Id>_Arm3": the brainrot's
-- asset module has its Phase and Axis at Parts[3 + 1]), with an
-- "<Id>_Pivot3" marker at the joint it turns about and an "<Id>_Built" marker.
Tuning.MOVING_KINDS = { Leg = true, Arm = true, Wing = true, Tail = true, Head = true, Prop = true, Ear = true, Board = true } :: { [string]: boolean }
-- How far (as a share) an imported model's piece sizes can be from its
-- brainrot's (ModelShapes) and still count as it. The two most alike
-- brainrots are 0.1 apart.
Tuning.SHAPE_TOLERANCE = 0.05

local function prepareImportedModels(): (number, { string })
	local function isMarker(piece: string): boolean
		return piece == "Front" or piece == "Top" or piece == "Built" or string.match(piece, "^Pivot%d+$") ~= nil
	end
	local function isPiece(piece: string): boolean
		if piece == "Body" or isMarker(piece) then
			return true
		end
		local kind = string.match(piece, "^(%a+)%d+$")
		return kind ~= nil and Tuning.MOVING_KINDS[kind] == true
	end
	-- A block-built brainrot's pieces as its asset module lists them.
	local function assetParts(brainrotId: string): { any }?
		local assets = ReplicatedStorage:FindFirstChild("Assets")
		local folder = if assets then assets:FindFirstChild("Brainrots") else nil
		local module = if folder then folder:FindFirstChild(brainrotId) else nil
		if module == nil or not module:IsA("ModuleScript") then
			return nil
		end
		local ok, data = pcall(require, module)
		return if ok and typeof(data) == "table" and typeof(data.Parts) == "table" then data.Parts else nil
	end

	local containers: { Instance } = {}
	local function consider(container: Instance?)
		if container and container ~= map and not container:IsDescendantOf(map) and table.find(containers, container) == nil then
			table.insert(containers, container)
		end
	end
	-- Wherever the imports ended up (Workspace, ReplicatedStorage or
	-- ServerStorage, maybe in a folder), and whatever the importer named them:
	-- any model holding a part called "<Id>_Body" (or "<Id>_Front"). One brainrot imported on
	-- its own (BrainrotModels/Import/One/<Id>.glb) is a model too.
	for _, place in { Workspace, ReplicatedStorage, ServerStorage } :: { Instance } do
		consider(place:FindFirstChild("BrainrotModels", true))
		for _, descendant in place:GetDescendants() do
			-- (Its Front marker too, so an import that lost its body is tidied away.)
			local brainrotId = string.match(descendant.Name, "^(%w+)_Body$") or string.match(descendant.Name, "^(%w+)_Front$")
			if brainrotId and BrainrotConfig.ById[brainrotId] and descendant:IsA("BasePart") then
				local holder: Instance = descendant
				while holder.Parent and holder.Parent ~= place and not holder.Parent:IsA("Folder") do
					holder = holder.Parent
				end
				if holder ~= descendant then
					consider(holder)
				end
			end
		end
	end
	if #containers == 0 then
		return 0, {}
	end

	-- Each brainrot's pieces come from one import (they're placed apart). If
	-- an older import is still around too, the one made the way the brainrot
	-- is now (block-built, with a Built marker, or not) wins.
	local groups: { [string]: { [string]: BasePart } } = {}
	local groupBuilt: { [string]: boolean } = {}
	-- (Imported pieces named "<Id>_<Piece>", rather than a hand-made model.)
	local groupNamed: { [string]: boolean } = {}
	for _, container in containers do
		if container.Parent == nil then
			continue
		end
		local found: { [string]: { [string]: BasePart } } = {}
		local named: { [string]: boolean } = {}
		for _, descendant in container:GetDescendants() do
			if not descendant:IsA("BasePart") then
				continue
			end
			local brainrotId, piece = string.match(descendant.Name, "^(%w+)_(%a+%d*)")
			if brainrotId and piece and BrainrotConfig.ById[brainrotId] and isPiece(piece) then
				found[brainrotId] = found[brainrotId] or {}
				found[brainrotId][piece] = descendant
				named[brainrotId] = true
			else
				-- A hand-made model: a Model named after the brainrot.
				local ancestor = descendant:FindFirstAncestorWhichIsA("Model")
				while ancestor and ancestor ~= container and BrainrotConfig.ById[ancestor.Name] == nil do
					ancestor = ancestor.Parent and ancestor.Parent:FindFirstAncestorWhichIsA("Model")
				end
				if ancestor and ancestor ~= container then
					found[ancestor.Name] = found[ancestor.Name] or {}
					local key = descendant.Name
					while found[ancestor.Name][key] do
						key ..= "_"
					end
					found[ancestor.Name][key] = descendant
				end
			end
		end
		for brainrotId, pieces in found do
			-- (An import that lost its body doesn't count.)
			local body: BasePart?, front: BasePart?, top: BasePart? = pieces.Body, pieces.Front, pieces.Top
			local complete = body ~= nil or (front == nil and top == nil)
			local definition = BrainrotConfig.ById[brainrotId]
			local wanted = definition ~= nil and definition.BlockBuilt
			local builtMarker: BasePart? = pieces.Built
			local isBuilt = builtMarker ~= nil
			if complete and (groups[brainrotId] == nil or (isBuilt == wanted and groupBuilt[brainrotId] ~= wanted)) then
				groups[brainrotId] = pieces
				groupBuilt[brainrotId] = isBuilt
				groupNamed[brainrotId] = named[brainrotId] == true
			end
		end
	end

	-- A model can end up with another brainrot's name (the importer or an old
	-- import mixing them up), so each imported one's pieces and their sizes
	-- are checked against ModelShapes: one that's really another brainrot's is
	-- used for that one, and one that looks like none is left out.
	local ModelShapes = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("ModelShapes"))
	local function shapeError(pieces: { [string]: BasePart }, shape: { [string]: { number } }): number
		local body: BasePart? = pieces.Body
		if body == nil then
			return math.huge
		end
		local unit = math.max(body.Size.X, body.Size.Y, body.Size.Z)
		local worst, count = 0, 0
		for piece, part in pieces do
			if isMarker(piece) then
				continue
			end
			local want = shape[piece]
			if want == nil or unit <= 0 then
				return math.huge
			end
			count += 1
			local sizes = { part.Size.X / unit, part.Size.Y / unit, part.Size.Z / unit }
			table.sort(sizes, function(a: number, b: number): boolean
				return a > b
			end)
			for index = 1, 3 do
				worst = math.max(worst, math.abs(sizes[index] - want[index]) / math.max(want[index], 0.1))
			end
		end
		local expected = 0
		for _ in shape do
			expected += 1
		end
		return if count == expected then worst else math.huge
	end
	local checked: { [string]: { [string]: BasePart } } = {}
	local wrong: { string } = {}
	for brainrotId, pieces in groups do
		local shape = ModelShapes[brainrotId]
		if shape == nil or not groupNamed[brainrotId] or shapeError(pieces, shape) <= Tuning.SHAPE_TOLERANCE then
			checked[brainrotId] = pieces
		else
			table.insert(wrong, brainrotId)
		end
	end
	table.sort(wrong)
	-- (If most don't match, the importer must measure them differently: then
	-- the check can't be trusted, so the names are kept.)
	local namedCount = 0
	for brainrotId in groups do
		if groupNamed[brainrotId] then
			namedCount += 1
		end
	end
	if namedCount >= 4 and #wrong * 2 > namedCount then
		warn(string.format("%s Couldn't check the imported models' names (most don't match their shapes), so they're used as named.", LOG_PREFIX))
		for _, brainrotId in wrong do
			checked[brainrotId] = groups[brainrotId]
		end
		table.clear(wrong)
	end
	local renamed: { string } = {}
	local unknown: { string } = {}
	for _, brainrotId in wrong do
		local pieces = groups[brainrotId]
		local best, bestError = nil :: string?, Tuning.SHAPE_TOLERANCE
		for otherId, shape in ModelShapes do
			local miss = shapeError(pieces, shape)
			if miss <= bestError and checked[otherId] == nil then
				best, bestError = otherId, miss
			end
		end
		if best then
			checked[best] = pieces
			table.insert(renamed, string.format("%s (was named %s)", best, brainrotId))
		else
			table.insert(unknown, brainrotId)
		end
	end
	if #renamed > 0 then
		warn(string.format("%s Imported models with another brainrot's name, now used for the right one: %s.", LOG_PREFIX, table.concat(renamed, ", ")))
	end
	if #unknown > 0 then
		warn(
			string.format(
				"%s These imported models don't look like the brainrot they're named after, so those brainrots are built from blocks: %s. Delete the BrainrotModels import, import BrainrotModels/Import/BrainrotModels.glb again and save.",
				LOG_PREFIX,
				table.concat(unknown, ", ")
			)
		)
	end

	local folder = Instance.new("Folder")
	folder.Name = "BrainrotModels"
	local count = 0
	for brainrotId, pieces in checked do
		-- A block-built brainrot comes with a Built marker; an import of one
		-- without it is from before it was rebuilt from blocks, and one with it
		-- of a brainrot that isn't block-built any more is from when it was.
		local definition = BrainrotConfig.ById[brainrotId]
		local built: BasePart? = pieces.Built
		if definition and definition.BlockBuilt ~= (built ~= nil) then
			continue
		end
		local front, top = pieces.Front, pieces.Top
		local parts: { BasePart } = {}
		for piece, part in pieces do
			if not isMarker(piece) then
				table.insert(parts, part)
			end
		end
		if #parts == 0 then
			continue
		end
		local low, high = partsBounds(parts)
		local centre = (low + high) / 2
		local frame = CFrame.new(centre)
		if front and top then
			local up = (top.Position - centre).Unit
			local ahead = front.Position - centre
			ahead = (ahead - up * ahead:Dot(up)).Unit
			frame = CFrame.lookAt(centre, centre + ahead, up)
		end
		local template = Instance.new("Model")
		template.Name = brainrotId
		for _, part in parts do
			part.CFrame = frame:ToObjectSpace(part.CFrame)
		end
		low, high = partsBounds(parts)
		local feet = Vector3.new((low.X + high.X) / 2, low.Y, (low.Z + high.Z) / 2)
		-- Moving pieces of a block-built brainrot: their kind, joint, phase and axis.
		local assetInfo = if built then assetParts(brainrotId) else nil
		for piece, part in pieces do
			local kind, number = string.match(piece, "^(%a+)(%d+)$")
			local marker = if kind and number and Tuning.MOVING_KINDS[kind] then pieces["Pivot" .. number] else nil
			if marker then
				local info = if assetInfo then assetInfo[(tonumber(number) or 0) + 1] else nil
				part:SetAttribute("PieceKind", kind)
				part:SetAttribute("Pivot", frame:PointToObjectSpace(marker.Position) - feet)
				part:SetAttribute("PiecePhase", if typeof(info) == "table" and info.Phase == 1 then 1 else 0)
				part:SetAttribute("PieceAxis", if typeof(info) == "table" and typeof(info.Axis) == "string" then info.Axis else "Y")
			end
		end
		for piece, part in pieces do
			if isMarker(piece) then
				continue
			end
			part.CFrame -= feet
			part.Anchored = true
			part.CanCollide = false
			part.CanQuery = false
			part.CanTouch = false
			if isPiece(piece) then
				part.Name = piece
			end
			part.Parent = template
		end
		template:SetAttribute("Height", high.Y - low.Y)
		template.WorldPivot = CFrame.identity
		template.Parent = folder
		count += 1
	end
	for _, container in containers do
		container:Destroy()
	end
	folder.Parent = ReplicatedStorage
	-- Brainrots still without a model (the import lost them, or they're new).
	local missing: { string } = {}
	for _, definition in BrainrotConfig.Brainrots do
		if not BrainrotConfig.isLuckyBlock(definition) and folder:FindFirstChild(definition.Id) == nil then
			table.insert(missing, definition.Id)
		end
	end
	return count, missing
end

Tuning.RAINBOW = ColorSequence.new({
	ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 70, 70)),
	ColorSequenceKeypoint.new(0.2, Color3.fromRGB(255, 190, 40)),
	ColorSequenceKeypoint.new(0.4, Color3.fromRGB(90, 255, 90)),
	ColorSequenceKeypoint.new(0.6, Color3.fromRGB(60, 200, 255)),
	ColorSequenceKeypoint.new(0.8, Color3.fromRGB(150, 90, 255)),
	ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 80, 200)),
})
-- OG labels shine aqua, white and gold.
Tuning.OG_SHINE = ColorSequence.new({
	ColorSequenceKeypoint.new(0, Color3.fromRGB(60, 255, 215)),
	ColorSequenceKeypoint.new(0.45, Color3.fromRGB(255, 255, 255)),
	ColorSequenceKeypoint.new(0.55, Color3.fromRGB(255, 255, 255)),
	ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 205, 60)),
})

-- A brainrot's label is sized in studs, so labels further away get smaller
-- instead of piling up on the screen. Line heights are given in pixels of
-- a label Tuning.INFO_DESIGN_WIDTH wide, which is Tuning.INFO_STUDS_WIDE studs across
-- (less than the gap between two pedestals).
Tuning.INFO_DESIGN_WIDTH = 260
Tuning.INFO_STUDS_WIDE = 8

local function addInfoLabel(parent: Instance, text: string, color: Color3, textSize: number, order: number, rainbow: boolean?): TextLabel
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.Text = text
	label.TextColor3 = if rainbow then Color3.new(1, 1, 1) else color
	label.TextScaled = true
	label.LayoutOrder = order
	label:SetAttribute("LineHeight", textSize + 6)

	-- Up close the text stops growing.
	local limit = Instance.new("UITextSizeConstraint")
	limit.MaxTextSize = math.floor(textSize * 1.5)
	limit.Parent = label

	local outline = Instance.new("UIStroke")
	outline.Color = Color3.new(0, 0, 0)
	outline.Thickness = 2
	outline.Parent = label

	if rainbow then
		local gradient = Instance.new("UIGradient")
		gradient.Color = Tuning.RAINBOW
		gradient.Parent = label
	end
	label.Parent = parent
	return label
end

-- Sizes a label and its lines (again after a line is removed).
local function layoutInfo(billboard: Instance?)
	if billboard == nil or not billboard:IsA("BillboardGui") then
		return
	end
	local total = 0
	for _, child in billboard:GetChildren() do
		if child:IsA("TextLabel") then
			total += tonumber(child:GetAttribute("LineHeight")) or 0
		end
	end
	if total <= 0 then
		return
	end
	billboard.Size = UDim2.fromScale(Tuning.INFO_STUDS_WIDE, Tuning.INFO_STUDS_WIDE * total / Tuning.INFO_DESIGN_WIDTH)
	for _, child in billboard:GetChildren() do
		if child:IsA("TextLabel") then
			child.Size = UDim2.fromScale(1, (tonumber(child:GetAttribute("LineHeight")) or 0) / total)
		end
	end
end

local buildLuckyBlock: (model: Model, root: BasePart, definition: Definition) -> number
local refreshOccupantInfo: (occupant: Occupant) -> ()
do
	-- A lucky block: a glossy cube with a "?" on every side and glowing edges,
	-- held by a Pose weld so BrainrotVisuals can make it hop and float.
	local LUCKY_BLOCK_SIZE = 3.4
	local LUCKY_EDGES: { { Vector3 } } = {
		-- Size and offset (in block sizes) of each of the 12 edges.
		{ Vector3.new(1, 0.08, 0.08), Vector3.new(0, 0.5, 0.5) },
		{ Vector3.new(1, 0.08, 0.08), Vector3.new(0, 0.5, -0.5) },
		{ Vector3.new(1, 0.08, 0.08), Vector3.new(0, -0.5, 0.5) },
		{ Vector3.new(1, 0.08, 0.08), Vector3.new(0, -0.5, -0.5) },
		{ Vector3.new(0.08, 1, 0.08), Vector3.new(0.5, 0, 0.5) },
		{ Vector3.new(0.08, 1, 0.08), Vector3.new(0.5, 0, -0.5) },
		{ Vector3.new(0.08, 1, 0.08), Vector3.new(-0.5, 0, 0.5) },
		{ Vector3.new(0.08, 1, 0.08), Vector3.new(-0.5, 0, -0.5) },
		{ Vector3.new(0.08, 0.08, 1), Vector3.new(0.5, 0.5, 0) },
		{ Vector3.new(0.08, 0.08, 1), Vector3.new(-0.5, 0.5, 0) },
		{ Vector3.new(0.08, 0.08, 1), Vector3.new(0.5, -0.5, 0) },
		{ Vector3.new(0.08, 0.08, 1), Vector3.new(-0.5, -0.5, 0) },
	}

	buildLuckyBlock = function(model: Model, root: BasePart, definition: Definition): number
		local size = LUCKY_BLOCK_SIZE
		local offset = CFrame.new(0, size / 2 + 0.2, 0)
		local body = Instance.new("Part")
		body.Name = "Body"
		body.Size = Vector3.one * size
		body.Color = definition.BodyColor
		body.Material = Enum.Material.SmoothPlastic
		body.Reflectance = 0.15
		body.TopSurface = Enum.SurfaceType.Smooth
		body.BottomSurface = Enum.SurfaceType.Smooth
		body.Anchored = false
		body.CanCollide = false
		body.CanQuery = false
		body.CanTouch = false
		body.Massless = true
		body.CFrame = root.CFrame * offset
		local weld = Instance.new("Weld")
		weld.Name = "Pose"
		weld.Part0 = root
		weld.Part1 = body
		weld.C0 = offset
		weld.Parent = body

		for _, face in Enum.NormalId:GetEnumItems() do
			local surface = Instance.new("SurfaceGui")
			surface.Name = "Mark"
			surface.Face = face
			surface.LightInfluence = 0
			surface.CanvasSize = Vector2.new(100, 100)
			local mark = Instance.new("TextLabel")
			mark.BackgroundTransparency = 1
			mark.Size = UDim2.fromScale(1, 1)
			mark.Font = Enum.Font.FredokaOne
			mark.Text = "?"
			mark.TextScaled = true
			mark.TextColor3 = definition.AccentColor
			local outline = Instance.new("UIStroke")
			outline.Thickness = 4
			outline.Color = definition.BodyColor:Lerp(Color3.new(0, 0, 0), 0.6)
			outline.Parent = mark
			mark.Parent = surface
			surface.Parent = body
		end

		for number, edge in LUCKY_EDGES do
			local trim = Instance.new("Part")
			trim.Name = "Edge" .. number
			trim.Size = edge[1] * size + Vector3.one * 0.02
			trim.Color = definition.AccentColor
			trim.Material = Enum.Material.Neon
			trim.Anchored = false
			trim.CanCollide = false
			trim.CanQuery = false
			trim.CanTouch = false
			trim.Massless = true
			trim.CFrame = body.CFrame * CFrame.new(edge[2] * size)
			local hold = Instance.new("WeldConstraint")
			hold.Part0 = body
			hold.Part1 = trim
			hold.Parent = trim
			trim.Parent = model
		end

		local light = Instance.new("PointLight")
		light.Color = definition.BodyColor
		light.Brightness = 1
		light.Range = 9
		light.Parent = body
		body.Parent = model
		model:SetAttribute("LuckyBlock", true)
		return size + 0.2
	end
end

-- The rarities a lucky block can open into, for its label: "Rare - Mythic".
local function luckyRange(definition: Definition): string
	local lowest, highest = math.huge, -math.huge
	local odds = definition.Odds
	local list: { BrainrotConfig.OddsEntry } = if odds then BrainrotConfig.oddsList(odds) else {}
	for _, entry in list do
		for index, rarity in BrainrotConfig.Rarities do
			if rarity.Name == entry.Rarity then
				lowest = math.min(lowest, index)
				highest = math.max(highest, index)
			end
		end
	end
	local low, high = BrainrotConfig.Rarities[lowest], BrainrotConfig.Rarities[highest]
	if low == nil or high == nil then
		return "???"
	end
	return if low == high then low.Name else low.Name .. " - " .. high.Name
end

-- `price` adds a price line (conveyor and walking brainrots); `ownerText` adds
-- a line saying whose base a walking brainrot is heading to.
local function buildBrainrot(definition: Definition, mutation: Mutation?, trait: Trait?, price: number?, ownerText: string?): Visual
	local rarity = BrainrotConfig.RarityByName[definition.Rarity]
	local isBlock = BrainrotConfig.isLuckyBlock(definition)

	local model = Instance.new("Model")
	model.Name = definition.Id
	-- Streams in and out as a whole, so clients never see half a brainrot.
	model.ModelStreamingMode = Enum.ModelStreamingMode.Atomic

	local root = Instance.new("Part")
	root.Name = "Root"
	root.Size = Vector3.one
	root.Transparency = 1
	root.Anchored = true
	root.CanCollide = false
	root.CanQuery = false
	root.CanTouch = false
	root.Massless = true
	root.CFrame = CFrame.identity
	root.Parent = model
	model.PrimaryPart = root

	local customModels = ReplicatedStorage:FindFirstChild("BrainrotModels")
	local template = if customModels and not isBlock then customModels:FindFirstChild(definition.Id) else nil
	if template and #template:GetChildren() == 0 then
		template = nil
	end
	local hasCustomModel = isBlock or (template ~= nil and template:IsA("Model"))
	local traitScale = if trait then trait.Scale else 1
	local height = if isBlock
		then buildLuckyBlock(model, root, definition)
		elseif template and template:IsA("Model") then TemplateModels.build(model, root, template, Tuning.FIGURE_HEIGHT * definition.Scale * traitScale)
		else buildFigure(model, root, definition)
	if not hasCustomModel and traitScale ~= 1 then
		height *= traitScale
	end

	-- Tells BrainrotVisuals on each client which 3D model to show, how tall,
	-- which effects to add and how to animate it (State).
	model:SetAttribute("BrainrotId", definition.Id)
	model:SetAttribute("FigureHeight", height)
	model:SetAttribute("CustomModel", hasCustomModel)
	model:SetAttribute("Rarity", definition.Rarity)
	model:SetAttribute("Mutation", if mutation then mutation.Name else nil)
	model:SetAttribute("Trait", if trait then trait.Name else nil)
	model:SetAttribute("Price", price)
	model:SetAttribute("Motion", definition.Motion)
	model:SetAttribute("State", "Idle")

	local promptAttachment = Instance.new("Attachment")
	promptAttachment.Name = "PromptAttachment"
	promptAttachment.Position = Vector3.new(0, height * 0.5, 0)
	promptAttachment.Parent = root

	local billboard = Instance.new("BillboardGui")
	billboard.Name = "Info"
	billboard.Adornee = root
	billboard.StudsOffsetWorldSpace = Vector3.new(0, height + 2.4, 0)
	billboard.MaxDistance = 80
	billboard.LightInfluence = 0

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
	layout.VerticalAlignment = Enum.VerticalAlignment.Bottom
	layout.Parent = billboard

	local ownerLabel: TextLabel? = nil
	if ownerText then
		ownerLabel = addInfoLabel(billboard, ownerText, Color3.fromRGB(200, 230, 255), 16, -2)
	end
	if trait then
		addInfoLabel(billboard, trait.Icon .. " " .. trait.Name .. " x" .. tostring(trait.Multiplier), trait.Color, 20, -1, trait.Name == "Nyan")
	end
	if mutation then
		addInfoLabel(billboard, mutation.Name, mutation.Color, 20, 0, mutation.Name == "Rainbow")
	end
	addInfoLabel(billboard, definition.DisplayName, Color3.new(1, 1, 1), 22, 1)
	local rarityLabel = addInfoLabel(
		billboard,
		definition.Rarity,
		if rarity then rarity.Color else Color3.new(1, 1, 1),
		20,
		2,
		rarity ~= nil and rarity.Style == "Rainbow"
	)
	if rarity and rarity.Style == "Secret" then
		-- Black text with a white outline, like the original's Secrets.
		local outline = rarityLabel:FindFirstChildOfClass("UIStroke")
		if outline then
			outline.Color = Color3.new(1, 1, 1)
		end
	elseif rarity and rarity.Style == "OG" then
		rarityLabel.TextColor3 = Color3.new(1, 1, 1)
		local shine = Instance.new("UIGradient")
		shine.Color = Tuning.OG_SHINE
		shine.Parent = rarityLabel
	end
	local incomeLabel: TextLabel? = nil
	if isBlock then
		addInfoLabel(billboard, "Opens into " .. luckyRange(definition), Color3.fromRGB(255, 230, 70), 18, 3)
	else
		incomeLabel = addInfoLabel(billboard, NumberFormat.cash(incomeOf(definition, mutation, trait)) .. "/s", Color3.fromRGB(255, 230, 70), 20, 3)
	end
	local priceLabel: TextLabel? = nil
	if price then
		priceLabel = addInfoLabel(billboard, NumberFormat.cash(price), Color3.fromRGB(90, 255, 120), 22, 4)
	end
	layoutInfo(billboard)
	billboard.Parent = root

	return {
		Model = model,
		Root = root,
		PromptAttachment = promptAttachment,
		PriceLabel = priceLabel,
		OwnerLabel = ownerLabel,
		IncomeLabel = incomeLabel,
	}
end

Tuning.PROMPT_OFFSETS = {
	Upgrade = Vector2.new(0, 84),
	Open = Vector2.new(0, -84),
	Manage = Vector2.new(0, -84),
} :: { [string]: Vector2 }

-- Updates a base brainrot's label (income with its level, hat and pedestal)
-- and the Level and Hat attributes the clients show.
refreshOccupantInfo = function(occupant: Occupant)
	if BrainrotConfig.isLuckyBlock(occupant.Definition) then
		return
	end
	local level = ExtrasConfig.levelOf(occupant.Seconds)
	occupant.Model:SetAttribute("Level", level)
	occupant.Model:SetAttribute("Hat", occupant.Hat)
	local incomeLabel = occupant.IncomeLabel
	if incomeLabel then
		incomeLabel.Text = NumberFormat.cash(occupantIncome(occupant)) .. "/s"
	end
	local billboard = if incomeLabel then incomeLabel.Parent else nil
	if billboard == nil then
		return
	end
	local levelLabel = occupant.LevelLabel
	if levelLabel == nil then
		levelLabel = addInfoLabel(billboard, "", Color3.fromRGB(140, 230, 255), 18, 5)
		occupant.LevelLabel = levelLabel
		layoutInfo(billboard)
	end
	local hat = if occupant.Hat then ExtrasConfig.HatByName[occupant.Hat] else nil
	local text = string.format("⭐ Lv %d%s", level, if level >= ExtrasConfig.MaxLevel then " MAX" else "")
	if hat then
		text ..= "  " .. hat.Icon .. " +" .. math.floor(hat.Bonus * 100 + 0.5) .. "%"
	end
	;(levelLabel :: TextLabel).Text = text
end

local function createPrompt(
	attachment: Attachment,
	kind: string,
	actionText: string,
	objectText: string,
	holdDuration: number,
	keyCode: Enum.KeyCode,
	ownerUserId: number?
): ProximityPrompt
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = actionText
	prompt.ObjectText = objectText
	prompt.HoldDuration = holdDuration
	prompt.KeyboardKeyCode = keyCode
	prompt.MaxActivationDistance = GameConfig.PromptDistance
	prompt.RequiresLineOfSight = false
	-- The owner's prompts share a spot: stack them so none hides another.
	prompt.UIOffset = Tuning.PROMPT_OFFSETS[kind] or Vector2.zero
	prompt:SetAttribute("PromptKind", kind)
	prompt:SetAttribute("Carried", false)
	prompt:SetAttribute("Walking", false)
	if ownerUserId then
		prompt:SetAttribute("OwnerUserId", ownerUserId)
	end
	prompt.Parent = attachment
	return prompt
end

--------------------------------------------------------------------------------
-- Occupants (brainrots that belong to a base)
--------------------------------------------------------------------------------

local onStealTriggered: (occupant: Occupant, thief: Player) -> ()
local onSellTriggered: (occupant: Occupant, player: Player) -> ()
local onSnipeTriggered: (occupant: Occupant, player: Player) -> ()
local onUpgradeTriggered: (occupant: Occupant, player: Player) -> ()
local onOpenTriggered: (occupant: Occupant, player: Player) -> ()
-- Puts lucky blocks and gifts waiting for room onto free pedestals.
local placePending: (player: Player) -> ()

local function ownerText(player: Player): string
	return "Walking to " .. player.DisplayName .. "'s base"
end

-- Sets a flag the client uses to hide prompts (Walking, Carried) on every
-- prompt of a brainrot but the Snipe one.
local function setPromptFlag(occupant: Occupant, attribute: string, value: boolean)
	for _, child in occupant.PromptAttachment:GetChildren() do
		if child:IsA("ProximityPrompt") and child:GetAttribute("PromptKind") ~= "Snipe" then
			child:SetAttribute(attribute, value)
		end
	end
end

local function setOccupantCarried(occupant: Occupant, carried: boolean)
	setPromptFlag(occupant, "Carried", carried)
end

local function setOccupantOwner(occupant: Occupant, owner: Player)
	occupant.Model:SetAttribute("OwnerUserId", owner.UserId)
	occupant.Model:SetAttribute("Slot", occupant.SlotIndex)
	for _, child in occupant.PromptAttachment:GetChildren() do
		if child:IsA("ProximityPrompt") then
			child:SetAttribute("OwnerUserId", owner.UserId)
		end
	end
	local ownerLabel = occupant.OwnerLabel
	if ownerLabel then
		ownerLabel.Text = ownerText(owner)
	end
end

-- Ends a walk right where the brainrot is (it stays in its base's list).
local function stopWalking(occupant: Occupant)
	occupant.Walk = nil
	walkers[occupant] = nil
end

-- Called when a walking brainrot reaches its pedestal.
local function finishWalk(occupant: Occupant)
	stopWalking(occupant)
	occupant.Root.CFrame = getSlotCFrame(occupant.Plot, occupant.SlotIndex)
	occupant.Model:SetAttribute("State", "Idle")
	setPromptFlag(occupant, "Walking", false)
	local snipePrompt = occupant.SnipePrompt
	if snipePrompt then
		snipePrompt:Destroy()
		occupant.SnipePrompt = nil
	end
	local priceLabel = occupant.PriceLabel
	if priceLabel then
		priceLabel:Destroy()
	end
	local ownerLabel = occupant.OwnerLabel
	if ownerLabel then
		ownerLabel:Destroy()
	end
	occupant.PriceLabel = nil
	occupant.OwnerLabel = nil
	layoutInfo(occupant.Root:FindFirstChild("Info"))
end

-- Height of the walkable surface at (x, z), looking down from `above`.
local function surfaceAt(x: number, z: number, above: number, depth: number): number?
	local result = Workspace:Raycast(Vector3.new(x, above, z), Vector3.new(0, -depth, 0), groundParams)
	return if result then result.Position.Y else nil
end

-- The path from `from` to a pedestal: onto the walkway beside the conveyor,
-- along it to the base's carpet, up the carpet, through the door, up the
-- stairs to the pedestal's floor and past the pads to the pedestal. Every
-- point carries the floor height there. Returns the points and the index of
-- the door.
local function buildPath(plot: Plot, slotIndex: number, from: Vector3): ({ Vector3 }, number)
	local floorFrame = plot.Floor.CFrame
	local halfDepth = plot.Floor.Size.Z / 2
	local groundTop = plot.Floor.Position.Y + plot.Floor.Size.Y / 2
	local carpet = plot.Carpet
	local carpetLength = if carpet then carpet.Size.Z else 0
	local laneZ = -halfDepth - carpetLength + Tuning.LANE_INSET
	local slot = plot.Slots[slotIndex]
	local slotLocal = floorFrame:PointToObjectSpace(slot.Position)
	local slotTop = slot.Position.Y + slot.Size.Y / 2
	local fromLocal = floorFrame:PointToObjectSpace(from)
	local padZ = slotLocal.Z - Tuning.PAD_OFFSET

	local points: { Vector3 } = {}
	local function add(x: number, z: number, y: number)
		local world = floorFrame:PointToWorldSpace(Vector3.new(x, 0, z))
		table.insert(points, Vector3.new(world.X, y, world.Z))
	end
	-- Outside the base the ground is looked up (carpet, walkway, grass).
	local function addOutside(x: number, z: number)
		local world = floorFrame:PointToWorldSpace(Vector3.new(x, 0, z))
		local y = surfaceAt(world.X, world.Z, groundTop + 5, 12) or groundTop
		table.insert(points, Vector3.new(world.X, y, world.Z))
	end

	if fromLocal.Z < -halfDepth and math.abs(fromLocal.X) > 2 then
		-- Not on this base's carpet yet: walk beside the conveyor first.
		addOutside(fromLocal.X, laneZ)
		addOutside(0, laneZ)
	end
	addOutside(0, -halfDepth - 1)
	local doorIndex = #points
	add(0, -halfDepth + 2, groundTop)

	-- Upper floors: up each flight of stairs along the front wall, stepping
	-- off onto the floor above at the top.
	local floorTop = groundTop
	local climbed = false
	for floor = 1, floorOf(slotIndex) - 1 do
		local stair = plot.Stairs[floor]
		if stair then
			local bottom = floorFrame:PointToObjectSpace(stair.Bottom)
			local top = floorFrame:PointToObjectSpace(stair.Top)
			local exitZ = bottom.Z + Tuning.STAIR_EXIT_OFFSET
			local firstStep = surfaceAt(stair.Bottom.X, stair.Bottom.Z, stair.Bottom.Y + 1, 3) or floorTop + 1
			local nextFloor = surfaceAt(stair.Top.X, stair.Top.Z, stair.Top.Y + 1, 3) or stair.Top.Y - 0.5
			add(bottom.X, exitZ, floorTop)
			add(bottom.X, bottom.Z, firstStep)
			add(top.X, top.Z, nextFloor)
			add(top.X, exitZ, nextFloor)
			floorTop = nextFloor
			climbed = true
		end
	end
	if climbed then
		add(0, floorFrame:PointToObjectSpace(points[#points]).Z, floorTop)
	end
	floorTop = slotTop - slot.Size.Y
	add(0, padZ, floorTop)
	add(slotLocal.X, padZ, floorTop)
	add(slotLocal.X, slotLocal.Z, slotTop)
	return points, doorIndex
end

local function pathLength(from: Vector3, points: { Vector3 }): number
	local length = 0
	local last = from
	for _, point in points do
		local offset = point - last
		length += Vector3.new(offset.X, 0, offset.Z).Magnitude
		last = point
	end
	return length
end

local function startWalk(occupant: Occupant, from: Vector3)
	local points, doorIndex = buildPath(occupant.Plot, occupant.SlotIndex, from)
	local length = pathLength(from, points)
	occupant.Walk = {
		Points = points,
		Index = 1,
		DoorIndex = doorIndex,
		Entered = false,
		Speed = math.max(GameConfig.BrainrotWalkSpeed, length / GameConfig.MaxWalkSeconds),
		Height = from.Y,
		Last = from,
	}
	walkers[occupant] = true
	occupant.Model:SetAttribute("State", "Walking")
	setPromptFlag(occupant, "Walking", true)
	local snipePrompt = occupant.SnipePrompt
	if snipePrompt then
		snipePrompt:SetAttribute("Snipeable", true)
	end
end

-- The step or floor right under a walker whose path is at `pathHeight`. The
-- ray starts just above the path, so it can't start inside a step.
local function groundHeightAt(position: Vector3, pathHeight: number): number?
	local ground = surfaceAt(position.X, position.Z, pathHeight + 2.5, 5)
	if ground and ground >= pathHeight - 1.5 then
		return ground
	end
	return nil
end

-- Moves every walking brainrot a frame further along its path.
local function stepWalkers(dt: number)
	for occupant in walkers do
		local walk = occupant.Walk
		if walk == nil or occupant.Model.Parent == nil then
			walkers[occupant] = nil
			continue
		end
		local root = occupant.Root
		local position = root.Position
		local remaining = walk.Speed * dt
		while remaining > 0 do
			local target: Vector3? = walk.Points[walk.Index]
			if not target then
				break
			end
			local flat = Vector3.new(target.X - position.X, 0, target.Z - position.Z)
			local distance = flat.Magnitude
			if distance <= remaining then
				position = Vector3.new(target.X, position.Y, target.Z)
				remaining -= distance
				walk.Last = target
				if walk.Index == walk.DoorIndex and not walk.Entered then
					-- Through the door: it's safe in its owner's base now.
					walk.Entered = true
					local snipePrompt = occupant.SnipePrompt
					if snipePrompt then
						snipePrompt:SetAttribute("Snipeable", false)
					end
				end
				walk.Index += 1
			else
				position += flat.Unit * remaining
				remaining = 0
			end
		end

		if walk.Index > #walk.Points then
			finishWalk(occupant)
			continue
		end

		-- Height along the current stretch, then onto the step under it.
		local target = walk.Points[walk.Index]
		local last = walk.Last
		local stretch = Vector3.new(target.X - last.X, 0, target.Z - last.Z).Magnitude
		local left = Vector3.new(target.X - position.X, 0, target.Z - position.Z).Magnitude
		local progress = if stretch > 0.01 then math.clamp(1 - left / stretch, 0, 1) else 1
		local pathHeight = last.Y + (target.Y - last.Y) * progress
		local ground = groundHeightAt(position, pathHeight) or pathHeight
		walk.Height += (ground - walk.Height) * math.min(1, dt * 15)
		walk.Height = math.clamp(walk.Height, pathHeight - 1.5, pathHeight + 1.5)

		local standing = Vector3.new(position.X, walk.Height, position.Z)
		local facing = Vector3.new(target.X - standing.X, 0, target.Z - standing.Z)
		local rotation = root.CFrame.Rotation
		if facing.Magnitude > 0.05 then
			rotation = rotation:Lerp(CFrame.lookAt(Vector3.zero, facing), math.min(1, dt * 10))
		end
		root.CFrame = CFrame.new(standing) * rotation
	end
end

-- A pedestal's upgrade level shows as a glowing band around its foot.
local function updatePedestalLook(plot: Plot, slotIndex: number)
	local slot: BasePart? = plot.Slots[slotIndex]
	if slot == nil then
		return
	end
	local level = plot.Levels[slotIndex] or 1
	slot:SetAttribute("Level", level)
	local ring: BasePart? = plot.LevelRings[slotIndex]
	if level <= 1 then
		if ring then
			ring:Destroy()
			plot.LevelRings[slotIndex] = nil
		end
		return
	end
	if ring == nil then
		local newRing = Instance.new("Part")
		newRing.Name = "LevelRing"
		newRing.Anchored = true
		newRing.CanCollide = false
		newRing.CanQuery = false
		newRing.CanTouch = false
		newRing.CastShadow = false
		newRing.Material = Enum.Material.Neon
		newRing.Size = Vector3.new(slot.Size.X + 0.6, 0.4, slot.Size.Z + 0.6)
		newRing.CFrame = slot.CFrame * CFrame.new(0, -slot.Size.Y / 2 + 0.2, 0)
		local glow = Instance.new("PointLight")
		glow.Brightness = 1.2
		glow.Range = 7
		glow.Shadows = false
		glow.Parent = newRing
		newRing.Parent = slot
		plot.LevelRings[slotIndex] = newRing
		ring = newRing
	end
	local colour = FeatureConfig.PedestalColors[level - 1] or Color3.new(1, 1, 1)
	local liveRing = ring :: BasePart
	liveRing.Color = colour
	local glow = liveRing:FindFirstChildOfClass("PointLight")
	if glow then
		glow.Color = colour
	end
end

local function refreshUpgradePrompt(occupant: Occupant)
	local prompt = occupant.UpgradePrompt
	if prompt == nil then
		return
	end
	local level = occupant.Plot.Levels[occupant.SlotIndex] or 1
	local cost = FeatureConfig.PedestalCosts[level]
	local bonus = math.floor(FeatureConfig.PedestalBonus * 100 + 0.5)
	if cost == nil then
		prompt.ActionText = "Max Level"
		prompt.ObjectText = string.format("Pedestal Lv %d (+%d%% income)", level, bonus * (level - 1))
	else
		prompt.ActionText = "Upgrade " .. NumberFormat.cash(cost)
		prompt.ObjectText = string.format("Pedestal Lv %d → %d (+%d%% income)", level, level + 1, bonus * level)
	end
	prompt:SetAttribute("MaxLevel", cost == nil)
end

-- Puts a brainrot in a base. With `walkFrom` it walks there from that
-- position (and can be bought off its owner until it reaches the door).
local function placeOccupant(
	plot: Plot,
	slotIndex: number,
	definition: Definition,
	mutation: Mutation?,
	trait: Trait?,
	walkFrom: CFrame?,
	price: number?,
	hatName: string?,
	seconds: number?
): Occupant?
	local owner = plot.Owner
	if owner == nil or plot.Occupants[slotIndex] ~= nil then
		return nil
	end

	local paid = price or priceOf(definition, mutation, trait)
	local visual = buildBrainrot(
		definition,
		mutation,
		trait,
		if walkFrom then paid else nil,
		if walkFrom then ownerText(owner) else nil
	)
	visual.Model:SetAttribute("OwnerUserId", owner.UserId)
	visual.Model:SetAttribute("Slot", slotIndex)
	local refund = math.floor(priceOf(definition, mutation, trait) * GameConfig.SellRefundFraction)
	local name = fullName(definition, mutation, trait)

	local occupant: Occupant = {
		Definition = definition,
		Mutation = mutation,
		Trait = trait,
		Plot = plot,
		SlotIndex = slotIndex,
		Model = visual.Model,
		Root = visual.Root,
		PromptAttachment = visual.PromptAttachment,
		StealPrompt = createPrompt(visual.PromptAttachment, "Steal", "Steal", name, GameConfig.StealHoldSeconds, Enum.KeyCode.E, owner.UserId),
		SellPrompt = createPrompt(visual.PromptAttachment, "Sell", "Sell for " .. NumberFormat.cash(refund), name, 0.5, Enum.KeyCode.F, owner.UserId),
		SnipePrompt = nil,
		UpgradePrompt = createPrompt(visual.PromptAttachment, "Upgrade", "Upgrade", "Pedestal", 0.3, Enum.KeyCode.R, owner.UserId),
		OpeningResult = nil,
		Price = paid,
		Walk = nil,
		Sniping = false,
		Carrier = nil,
		PriceLabel = visual.PriceLabel,
		OwnerLabel = visual.OwnerLabel,
		Hat = if hatName and ExtrasConfig.HatByName[hatName] then hatName else nil,
		Seconds = math.max(0, seconds or 0),
		IncomeLabel = visual.IncomeLabel,
		LevelLabel = nil,
	}

	occupant.StealPrompt.Triggered:Connect(function(player: Player)
		onStealTriggered(occupant, player)
	end)
	occupant.SellPrompt.Triggered:Connect(function(player: Player)
		onSellTriggered(occupant, player)
	end)
	local upgradePrompt = occupant.UpgradePrompt :: ProximityPrompt
	upgradePrompt.Triggered:Connect(function(player: Player)
		onUpgradeTriggered(occupant, player)
	end)
	refreshUpgradePrompt(occupant)
	if BrainrotConfig.isLuckyBlock(definition) then
		local openPrompt = createPrompt(visual.PromptAttachment, "Open", "Open!", name, 0.6, Enum.KeyCode.E, owner.UserId)
		openPrompt.Triggered:Connect(function(player: Player)
			onOpenTriggered(occupant, player)
		end)
	else
		-- Hats, guard duty and pets: the client opens a menu for this one.
		createPrompt(visual.PromptAttachment, "Manage", "Manage", name, 0, Enum.KeyCode.G, owner.UserId)
	end

	if walkFrom then
		local snipePrompt = createPrompt(visual.PromptAttachment, "Snipe", "Buy " .. NumberFormat.cash(paid), name, 0, Enum.KeyCode.E, owner.UserId)
		snipePrompt:SetAttribute("Snipeable", false)
		snipePrompt.Triggered:Connect(function(player: Player)
			onSnipeTriggered(occupant, player)
		end)
		occupant.SnipePrompt = snipePrompt
		visual.Root.CFrame = walkFrom
		startWalk(occupant, walkFrom.Position)
	else
		visual.Root.CFrame = getSlotCFrame(plot, slotIndex)
	end

	plot.Occupants[slotIndex] = occupant
	refreshOccupantInfo(occupant)
	visual.Model.Parent = brainrotsFolder
	return occupant
end

local function destroyOccupant(occupant: Occupant)
	stopWalking(occupant)
	occupant.Model:Destroy()
end

--------------------------------------------------------------------------------
-- Buying a walking brainrot off its buyer
--------------------------------------------------------------------------------

onSnipeTriggered = function(occupant: Occupant, sniper: Player)
	local walk = occupant.Walk
	local ownerPlot = occupant.Plot
	local owner = ownerPlot.Owner
	if walk == nil or walk.Entered or occupant.Sniping or owner == nil or owner == sniper then
		return
	end
	if ownerPlot.Occupants[occupant.SlotIndex] ~= occupant then
		return
	end
	local sniperPlot = plotByPlayer[sniper]
	if sniperPlot == nil then
		notify(sniper, "You don't have a base yet.", "Error")
		return
	end
	if not isPlayerNear(sniper, occupant.PromptAttachment.WorldPosition) then
		return
	end
	local slotIndex = findFreeSlot(sniperPlot)
	if slotIndex == nil then
		notify(sniper, "Your base is full! Sell a brainrot first.", "Error")
		return
	end

	local price = occupant.Price
	local name = fullName(occupant.Definition, occupant.Mutation, occupant.Trait)
	occupant.Sniping = true
	sniperPlot.Reserved[slotIndex] = true
	local paid = spendCash(sniper, price)
	sniperPlot.Reserved[slotIndex] = nil
	occupant.Sniping = false
	if not paid then
		notify(sniper, string.format("You need %s to buy %s.", NumberFormat.cash(price), name), "Error")
		return
	end

	-- Anything could have changed while paying: if so, give the Cash back.
	local currentWalk = occupant.Walk
	if
		currentWalk == nil
		or currentWalk.Entered
		or occupant.Plot ~= ownerPlot
		or ownerPlot.Owner ~= owner
		or ownerPlot.Occupants[occupant.SlotIndex] ~= occupant
		or sniperPlot.Owner ~= sniper
		or sniperPlot.Occupants[slotIndex] ~= nil
	then
		addCash(sniper, price)
		return
	end

	ownerPlot.Occupants[occupant.SlotIndex] = nil
	if not saveBrainrots(ownerPlot) then
		ownerPlot.Occupants[occupant.SlotIndex] = occupant
		addCash(sniper, price)
		return
	end
	addCash(owner, price)

	occupant.Plot = sniperPlot
	occupant.SlotIndex = slotIndex
	sniperPlot.Occupants[slotIndex] = occupant
	saveBrainrots(sniperPlot)
	setOccupantOwner(occupant, sniper)
	refreshUpgradePrompt(occupant)
	startWalk(occupant, occupant.Root.Position)
	discover(sniper, occupant.Definition, occupant.Mutation)
	placePending(owner)

	notify(sniper, string.format("You bought %s off %s!", name, owner.DisplayName), "Success", "Purchase")
	notify(
		owner,
		string.format("%s bought your %s before it got home! You got %s back.", sniper.DisplayName, name, NumberFormat.cash(price)),
		"Error",
		"Sniped"
	)
end

--------------------------------------------------------------------------------
-- Stealing
--------------------------------------------------------------------------------

-- The base alarm rings while anyone carries a brainrot out of the base.
local function updateAlarm(plot: Plot)
	local active = false
	for _, carry in carries do
		if carry.VictimPlot == plot then
			active = true
			break
		end
	end
	if (plot.Model:GetAttribute("Alarm") == true) ~= active then
		plot.Model:SetAttribute("Alarm", active)
		local owner = plot.Owner
		if not active and owner then
			Api.baseAlarmEvent:FireClient(owner, nil, nil)
		end
	end
end

local function endCarry(carry: Carry, message: string?)
	local thief = carry.Thief
	if carries[thief] == carry then
		carries[thief] = nil
	end
	carry.TargetPlot.Reserved[carry.TargetSlot] = nil
	setCarrying(thief, false)

	local occupant = carry.Occupant
	occupant.Carrier = nil
	occupant.Root.Anchored = true
	carry.Weld:Destroy()

	local victimPlot = carry.VictimPlot
	if victimPlot.Occupants[occupant.SlotIndex] == occupant then
		occupant.Root.CFrame = getSlotCFrame(victimPlot, occupant.SlotIndex)
		occupant.Model:SetAttribute("State", "Idle")
		setOccupantCarried(occupant, false)
	else
		destroyOccupant(occupant)
	end

	if message then
		notify(thief, message, "Warning")
		local victim = victimPlot.Owner
		if victim then
			notify(victim, string.format("Your %s is back home.", fullName(occupant.Definition, occupant.Mutation, occupant.Trait)), "Success", "Returned")
		end
	end
	updateAlarm(victimPlot)
end

local function completeSteal(carry: Carry)
	local thief = carry.Thief
	local occupant = carry.Occupant
	local victimPlot = carry.VictimPlot
	local targetPlot = carry.TargetPlot
	local victim = victimPlot.Owner

	if victim == nil or targetPlot.Owner ~= thief or victimPlot.Occupants[occupant.SlotIndex] ~= occupant then
		endCarry(carry, nil)
		return
	end

	carries[thief] = nil
	targetPlot.Reserved[carry.TargetSlot] = nil
	setCarrying(thief, false)
	updateAlarm(victimPlot)

	-- Remove from the victim first: if the victim's data can no longer be
	-- written, the thief gets nothing rather than a duplicate.
	victimPlot.Occupants[occupant.SlotIndex] = nil
	destroyOccupant(occupant)
	if not saveBrainrots(victimPlot) then
		warn(string.format("%s Could not update %s's brainrots; steal cancelled.", LOG_PREFIX, victim.Name))
		return
	end

	-- A stolen brainrot starts over at level 1, and its hat falls off (back to
	-- its old owner).
	local hadHat = occupant.Hat
	returnHat(occupant, victim)
	placeOccupant(targetPlot, carry.TargetSlot, occupant.Definition, occupant.Mutation, occupant.Trait, nil, occupant.Price)
	saveBrainrots(targetPlot)
	DataApi.AddSteals:Invoke(thief, 1)
	discover(thief, occupant.Definition, occupant.Mutation)
	reportActivity(thief, "Steal")

	local name = fullName(occupant.Definition, occupant.Mutation, occupant.Trait)
	notify(thief, string.format("You stole %s!", name), "Success", "StealSuccess")
	notify(
		victim,
		string.format("%s stole your %s!%s", thief.DisplayName, name, if hadHat then " (You kept its hat.)" else ""),
		"Error",
		"Stolen"
	)
	Api.stolenEvent:Fire(thief, victim, occupantEntry(occupant))
	placePending(victim)
end

onStealTriggered = function(occupant: Occupant, thief: Player)
	local victimPlot = occupant.Plot
	local victim = victimPlot.Owner
	if victim == nil or victim == thief or occupant.Carrier ~= nil or occupant.Walk ~= nil or occupant.OpeningResult ~= nil then
		return
	end
	if victimPlot.Occupants[occupant.SlotIndex] ~= occupant then
		return
	end
	if carries[thief] then
		notify(thief, "You're already carrying a brainrot!", "Warning")
		return
	end
	local crew = thief:GetAttribute("CrewId")
	if crew ~= nil and victim:GetAttribute("CrewId") == crew then
		notify(thief, "That's your crewmate's brainrot!", "Warning")
		return
	end
	if thief:GetAttribute("CarryingLoot") == true then
		notify(thief, "Drop off your loot first!", "Warning")
		return
	end
	local thiefPlot = plotByPlayer[thief]
	if thiefPlot == nil then
		notify(thief, "You need a base to steal.", "Error")
		return
	end
	local rootPart, humanoid = getLiveCharacter(thief)
	if rootPart == nil or humanoid == nil or not isPlayerNear(thief, occupant.PromptAttachment.WorldPosition) then
		return
	end
	local targetSlot = findFreeSlot(thiefPlot)
	if targetSlot == nil then
		notify(thief, "Your base is full! Sell a brainrot first.", "Error")
		return
	end

	thiefPlot.Reserved[targetSlot] = true
	occupant.Carrier = thief
	occupant.Model:SetAttribute("State", "Carried")
	setOccupantCarried(occupant, true)

	local root = occupant.Root
	root.CFrame = rootPart.CFrame * CFrame.new(0, Tuning.CARRY_HEIGHT, 0)
	root.Anchored = false
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = rootPart
	weld.Part1 = root
	weld.Parent = root

	carries[thief] = {
		Thief = thief,
		Occupant = occupant,
		VictimPlot = victimPlot,
		TargetPlot = thiefPlot,
		TargetSlot = targetSlot,
		StartedAt = os.clock(),
		LastPosition = rootPart.Position,
		LastCheckedAt = os.clock(),
		Weld = weld,
	}
	setCarrying(thief, true)

	local name = fullName(occupant.Definition, occupant.Mutation, occupant.Trait)
	notify(thief, "Run it back to your base!", "Info", "Grab")
	notify(victim, string.format("%s is stealing your %s! Catch them!", thief.DisplayName, name), "Warning", "Alarm")
	victimPlot.Model:SetAttribute("Alarm", true)
	Api.baseAlarmEvent:FireClient(victim, thief, name)
end

onSellTriggered = function(occupant: Occupant, player: Player)
	local plot = occupant.Plot
	if
		plot.Owner ~= player
		or occupant.Carrier ~= nil
		or occupant.Walk ~= nil
		or occupant.OpeningResult ~= nil
		or plot.Occupants[occupant.SlotIndex] ~= occupant
	then
		return
	end
	if not isPlayerNear(player, occupant.PromptAttachment.WorldPosition) then
		return
	end

	plot.Occupants[occupant.SlotIndex] = nil
	if not saveBrainrots(plot) then
		plot.Occupants[occupant.SlotIndex] = occupant
		return
	end
	destroyOccupant(occupant)
	returnHat(occupant, player)

	local refund = math.floor(priceOf(occupant.Definition, occupant.Mutation, occupant.Trait) * GameConfig.SellRefundFraction)
	if refund > 0 then
		addCash(player, refund)
	end
	notify(
		player,
		string.format("Sold %s for %s", fullName(occupant.Definition, occupant.Mutation, occupant.Trait), NumberFormat.cash(refund)),
		"Success",
		"Sell"
	)
	placePending(player)
end

-- `catcher` is whoever made them drop it (a slap), for quests.
Api.forceDropEvent.Event:Connect(function(playerArg: any, message: any, catcher: any)
	if typeof(playerArg) ~= "Instance" or not playerArg:IsA("Player") then
		return
	end
	local carry = carries[playerArg]
	if carry then
		endCarry(carry, if typeof(message) == "string" then message else "You dropped the brainrot!")
		if typeof(catcher) == "Instance" and catcher:IsA("Player") and catcher ~= playerArg then
			reportActivity(catcher, "Catch")
		end
	end
end)

--------------------------------------------------------------------------------
-- Conveyor
--------------------------------------------------------------------------------

local function pickFromRarity(rarityName: string): Definition?
	local choices = BrainrotConfig.DropsByRarity[rarityName]
	if choices == nil or #choices == 0 then
		return nil
	end
	-- Events like Taco Tuesday make brainrots with a tag more likely.
	local event = activeEvent
	local boost = if event then event.TagBoost else nil
	if boost == nil then
		return choices[rng:NextInteger(1, #choices)]
	end
	local tagged: { Definition } = {}
	for _, definition in choices do
		if BrainrotConfig.hasTag(definition, boost.Tag) then
			table.insert(tagged, definition)
		end
	end
	if #tagged > 0 and rng:NextNumber() < boost.Share then
		return tagged[rng:NextInteger(1, #tagged)]
	end
	return choices[rng:NextInteger(1, #choices)]
end

local function resetGuaranteeTimer(rarityName: string)
	for _, rule in GameConfig.GuaranteedRarities do
		if rule.Rarity == rarityName then
			nextGuaranteedAt[rarityName] = Workspace:GetServerTimeNow() + rule.IntervalSeconds
		end
	end
end

local function rollDefinition(): Definition?
	-- A guaranteed spawn whose timer ran out wins over the random roll.
	local now = Workspace:GetServerTimeNow()
	for _, rule in GameConfig.GuaranteedRarities do
		if now >= (nextGuaranteedAt[rule.Rarity] or math.huge) then
			resetGuaranteeTimer(rule.Rarity)
			local guaranteed = pickFromRarity(rule.Rarity)
			if guaranteed then
				return guaranteed
			end
		end
	end

	local event = activeEvent
	local multiplier = (tonumber(DataApi.GetServerRarityMultiplier:Invoke()) or 1) * (if event and event.Luck then event.Luck else 1)
	-- OG finds: their own tiny chance on every spawn, raised by luck boosts.
	if #BrainrotConfig.OGFinds > 0 and rng:NextNumber() < BrainrotConfig.OGChance * multiplier then
		return BrainrotConfig.OGFinds[rng:NextInteger(1, #BrainrotConfig.OGFinds)]
	end
	local commonRarity = BrainrotConfig.Rarities[1]

	local totalWeight = 0
	local weights: { number } = {}
	for index, rarity in BrainrotConfig.Rarities do
		local weight = 0
		if #BrainrotConfig.DropsByRarity[rarity.Name] > 0 then
			weight = if rarity == commonRarity then rarity.Weight else rarity.Weight * multiplier
		end
		weights[index] = weight
		totalWeight += weight
	end
	if totalWeight <= 0 then
		return nil
	end

	local roll = rng:NextNumber(0, totalWeight)
	for index, rarity in BrainrotConfig.Rarities do
		roll -= weights[index]
		if roll <= 0 and weights[index] > 0 then
			resetGuaranteeTimer(rarity.Name)
			return pickFromRarity(rarity.Name)
		end
	end
	return pickFromRarity(commonRarity.Name)
end

local function mutationChance(mutation: Mutation): number
	local event = activeEvent
	if event and event.Mutation == mutation.Name then
		-- Event-only mutations get the event's own chance.
		if event.MutationChance then
			return event.MutationChance
		end
		return mutation.Chance * (event.ChanceMultiplier or 1)
	end
	-- The weather has variants too: Storm brainrots in thunderstorms, Frozen
	-- ones in the snow. ADMIN ABUSE can make Admin ones.
	local weatherChance = GameConfig.WeatherMutations[mutation.Name]
	if weatherChance and ReplicatedStorage:GetAttribute("Weather") == weatherChance.Weather then
		return weatherChance.Chance
	end
	if mutation.Name == "Admin" and event and event.AdminAbuse then
		return GameConfig.AdminMutationChance
	end
	return mutation.Chance
end

local function rollMutation(): Mutation?
	local roll = rng:NextNumber()
	for _, mutation in BrainrotConfig.Mutations do
		local chance = mutationChance(mutation)
		if roll < chance then
			return mutation
		end
		roll -= chance
	end
	-- Admin Abuse: everything gets a mutation.
	local event = activeEvent
	if event and event.AllMutated then
		local choices: { Mutation } = {}
		for _, mutation in BrainrotConfig.Mutations do
			if mutation.Chance > 0 or mutation.Name == event.Mutation then
				table.insert(choices, mutation)
			end
		end
		if #choices > 0 then
			return choices[rng:NextInteger(1, #choices)]
		end
	end
	return nil
end

local function rollTrait(): Trait?
	local event = activeEvent
	local luck = if event and event.TraitLuck then event.TraitLuck else 1
	local roll = rng:NextNumber()
	for _, trait in BrainrotConfig.Traits do
		local chance = trait.Chance * luck
		if roll < chance then
			return trait
		end
		roll -= chance
	end
	return nil
end

local function rollLuckyBlock(): Definition?
	local total = 0
	for _, weight in BrainrotConfig.LuckyBlockWeights do
		total += weight
	end
	local roll = rng:NextNumber(0, total)
	for _, definition in BrainrotConfig.LuckyBlocks do
		roll -= BrainrotConfig.LuckyBlockWeights[definition.Id] or 0
		if roll <= 0 and (BrainrotConfig.LuckyBlockWeights[definition.Id] or 0) > 0 then
			return definition
		end
	end
	return BrainrotConfig.ById.LuckyBlock
end

-- What a lucky block opens into: a rarity from its odds, then a brainrot of it.
-- A lucky block's roll: a rarity (then any brainrot of it) or one of its
-- particular brainrots (see BrainrotConfig.oddsList).
local function rollFromOdds(odds: { [string]: number }): Definition?
	local list = BrainrotConfig.oddsList(odds)
	local total = 0
	for _, entry in list do
		total += entry.Weight
	end
	if total <= 0 then
		return nil
	end
	local roll = rng:NextNumber(0, total)
	for _, entry in list do
		roll -= entry.Weight
		if roll <= 0 then
			return entry.Brainrot or pickFromRarity(entry.Rarity)
		end
	end
	local last = list[#list]
	return last.Brainrot or pickFromRarity(last.Rarity)
end

local function removeConveyorItem(item: ConveyorItem)
	if conveyorItems[item] then
		conveyorItems[item] = nil
		conveyorItemCount -= 1
	end
	item.Tween:Cancel()
	item.Model:Destroy()
end

local function onBuyTriggered(item: ConveyorItem, player: Player)
	if item.Sold or not conveyorItems[item] then
		return
	end
	local plot = plotByPlayer[player]
	if plot == nil then
		notify(player, "You don't have a base yet.", "Error")
		return
	end
	if not isPlayerNear(player, item.PromptAttachment.WorldPosition) then
		return
	end
	local slotIndex = findFreeSlot(plot)
	if slotIndex == nil then
		notify(player, "Your base is full! Sell a brainrot first.", "Error")
		return
	end

	local definition = item.Definition
	local name = fullName(definition, item.Mutation, item.Trait)
	item.Sold = true
	plot.Reserved[slotIndex] = true
	local paid = spendCash(player, item.Price)
	plot.Reserved[slotIndex] = nil

	if not paid then
		item.Sold = false
		notify(player, string.format("You need %s to buy %s.", NumberFormat.cash(item.Price), name), "Error")
		return
	end
	if plot.Owner ~= player then
		addCash(player, item.Price)
		item.Sold = false
		return
	end

	local fromCFrame = item.Root.CFrame
	removeConveyorItem(item)
	placeOccupant(plot, slotIndex, definition, item.Mutation, item.Trait, fromCFrame, item.Price)
	saveBrainrots(plot)
	notify(player, string.format("You bought %s! It's walking to your base.", name), "Success", "Purchase")
	discover(player, definition, item.Mutation)
	reportActivity(player, "Buy")
	local rarityIndex = 0
	for index, rarity in BrainrotConfig.Rarities do
		if rarity.Name == definition.Rarity then
			rarityIndex = index
		end
	end
	if rarityIndex >= 3 and not BrainrotConfig.isLuckyBlock(definition) then
		reportActivity(player, "BuyEpic")
	end
end

local function spawnConveyorBrainrot()
	local definition: Definition? = nil
	if rng:NextNumber() < BrainrotConfig.LuckyBlockChance then
		definition = rollLuckyBlock()
	end
	if definition == nil then
		definition = rollDefinition()
	end
	if definition == nil then
		return
	end
	local isBlock = BrainrotConfig.isLuckyBlock(definition)
	local mutation = if isBlock then nil else rollMutation()
	local trait = if isBlock then nil else rollTrait()
	local event = activeEvent
	local priceMultiplier = if event and event.PriceMultiplier then event.PriceMultiplier else 1
	local price = math.max(1, math.floor(priceOf(definition, mutation, trait) * priceMultiplier))

	local startPosition = conveyorStart.Position
	local endPosition = Vector3.new(conveyorEnd.Position.X, startPosition.Y, conveyorEnd.Position.Z)
	local direction = endPosition - startPosition
	if direction.Magnitude < 1 then
		return
	end
	local startCFrame = CFrame.lookAt(startPosition, endPosition)
	local endCFrame = startCFrame + direction

	local visual = buildBrainrot(definition, mutation, trait, price, nil)
	visual.Model:SetAttribute("State", "Conveyor")
	visual.Root.CFrame = startCFrame
	visual.Model.Parent = brainrotsFolder

	local tween = TweenService:Create(
		visual.Root,
		TweenInfo.new(direction.Magnitude / GameConfig.ConveyorSpeedStudsPerSecond, Enum.EasingStyle.Linear),
		{ CFrame = endCFrame }
	)

	local item: ConveyorItem = {
		Definition = definition,
		Mutation = mutation,
		Trait = trait,
		Price = price,
		Model = visual.Model,
		Root = visual.Root,
		PromptAttachment = visual.PromptAttachment,
		Tween = tween,
		Sold = false,
	}
	conveyorItems[item] = true
	conveyorItemCount += 1

	local prompt = createPrompt(
		visual.PromptAttachment,
		"Buy",
		"Buy " .. NumberFormat.cash(price),
		fullName(definition, mutation, trait),
		0,
		Enum.KeyCode.E,
		nil
	)
	prompt.Triggered:Connect(function(player: Player)
		onBuyTriggered(item, player)
	end)
	tween.Completed:Connect(function(playbackState: Enum.PlaybackState)
		if playbackState == Enum.PlaybackState.Completed and conveyorItems[item] then
			removeConveyorItem(item)
		end
	end)
	tween:Play()
	-- An OG is so rare that the whole server hears about it.
	if definition.Rarity == "OG" then
		for _, player in Players:GetPlayers() do
			notify(player, string.format("An OG %s is on the conveyor! It costs %s.", fullName(definition, mutation, trait), NumberFormat.cash(price)), "Success", "Event")
		end
	end
end

--------------------------------------------------------------------------------
-- Collect pads
--------------------------------------------------------------------------------

local function padCashList(plot: Plot): { number }
	local list: { number } = table.create(#plot.Slots)
	for index = 1, #plot.Slots do
		list[index] = math.floor(plot.PadCash[index] or 0)
	end
	return list
end

local function updatePadLabel(plot: Plot, index: number)
	local pad = plot.Pads[index]
	if pad == nil then
		return
	end
	local amount = math.floor(plot.PadCash[index] or 0)
	pad.Billboard.Enabled = plot.Owner ~= nil and (amount > 0 or plot.Occupants[index] ~= nil)
	pad.Amount.Text = NumberFormat.cash(amount)
	pad.Tag.Visible = plot.OfflinePads[index] == true and amount > 0
end

local function updatePadLabels(plot: Plot)
	for index in plot.Pads do
		updatePadLabel(plot, index)
	end
end

local function clearPads(plot: Plot)
	for index = 1, #plot.Slots do
		plot.PadCash[index] = 0
	end
	table.clear(plot.OfflinePads)
	updatePadLabels(plot)
end

local function isOnPad(pad: BasePart, position: Vector3): boolean
	local offset = pad.CFrame:PointToObjectSpace(position)
	return math.abs(offset.X) <= pad.Size.X / 2 + Tuning.PAD_REACH
		and math.abs(offset.Z) <= pad.Size.Z / 2 + Tuning.PAD_REACH
		and offset.Y >= -1
		and offset.Y <= 6
end

-- The owner standing on a pad collects its Cash.
local function collectPads(plot: Plot)
	local owner = plot.Owner
	local rootPart = if owner then getLiveCharacter(owner) else nil
	if owner == nil or rootPart == nil or not isInsidePart(plot.Interior, rootPart.Position) then
		return
	end
	for index, pad in plot.Pads do
		local amount = plot.PadCash[index] or 0
		local whole = math.floor(amount)
		if whole >= 1 and isOnPad(pad.Part, rootPart.Position) then
			local wasOffline = plot.OfflinePads[index]
			plot.PadCash[index] = amount - whole
			plot.OfflinePads[index] = nil
			if DataApi.CollectPadCash:Invoke(owner, whole, padCashList(plot)) == true then
				playSound(owner, "Collect")
				reportActivity(owner, "Collect")
			else
				plot.PadCash[index] = amount
				plot.OfflinePads[index] = wasOffline
			end
			updatePadLabel(plot, index)
		end
	end
end

local function createPadGui(part: BasePart): Pad
	local surface = Instance.new("SurfaceGui")
	surface.Name = "CollectGui"
	surface.Face = Enum.NormalId.Top
	surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	surface.PixelsPerStud = 40
	surface.LightInfluence = 0

	local collectText = Instance.new("TextLabel")
	collectText.BackgroundTransparency = 1
	collectText.Size = UDim2.fromScale(1, 1)
	collectText.Font = Enum.Font.FredokaOne
	collectText.Text = "COLLECT"
	collectText.TextScaled = true
	collectText.TextColor3 = Color3.fromRGB(235, 255, 235)
	collectText.TextStrokeTransparency = 0.4
	collectText.Parent = surface
	surface.Parent = part

	local billboard = Instance.new("BillboardGui")
	billboard.Name = "PadGui"
	billboard.Adornee = part
	billboard.Size = UDim2.fromScale(5, 1.75) -- studs, like everything in the world
	billboard.StudsOffsetWorldSpace = Vector3.new(0, 2.2, 0)
	billboard.MaxDistance = 50
	billboard.LightInfluence = 0
	billboard.Enabled = false

	local tag = Instance.new("TextLabel")
	tag.Name = "Tag"
	tag.BackgroundTransparency = 1
	tag.Size = UDim2.fromScale(1, 0.4)
	tag.Font = Enum.Font.FredokaOne
	tag.Text = "OFFLINE CASH"
	tag.TextScaled = true
	tag.TextColor3 = Color3.fromRGB(255, 225, 70)
	tag.TextStrokeTransparency = 0.2
	tag.Visible = false
	tag.Parent = billboard

	local amount = Instance.new("TextLabel")
	amount.Name = "Amount"
	amount.BackgroundTransparency = 1
	amount.Position = UDim2.fromScale(0, 0.38)
	amount.Size = UDim2.fromScale(1, 0.62)
	amount.Font = Enum.Font.FredokaOne
	amount.Text = "$0"
	amount.TextScaled = true
	amount.TextColor3 = Color3.fromRGB(90, 255, 110)
	amount.TextStrokeTransparency = 0.1
	amount.Parent = billboard

	billboard.Parent = part
	return { Part = part, Billboard = billboard, Amount = amount, Tag = tag }
end

--------------------------------------------------------------------------------
-- Plots
--------------------------------------------------------------------------------

local function setLasersActive(plot: Plot, active: boolean)
	for _, laser in plot.Lasers do
		laser.Transparency = if active then 0.1 else 1
	end
end

local function updatePlotLabels(plot: Plot)
	local owner = plot.Owner
	if owner == nil then
		plot.SignTitle.Text = "Empty Base"
		plot.SignSubtitle.Text = ""
		plot.LockLabel.Text = ""
		return
	end
	plot.SignTitle.Text = owner.DisplayName .. "'s Base"
	plot.SignSubtitle.Text = NumberFormat.cash(tonumber(owner:GetAttribute("IncomePerSecond")) or 0) .. "/s"
	if isLocked(plot) then
		plot.LockLabel.Text = "LOCKED " .. NumberFormat.duration(plot.LockEndsAt - Workspace:GetServerTimeNow())
	else
		plot.LockLabel.Text = "STEP HERE TO LOCK"
	end
end

local function onLockButtonTouched(plot: Plot, hit: BasePart)
	local owner = plot.Owner
	local character = if owner then owner.Character else nil
	if owner == nil or character == nil or not hit:IsDescendantOf(character) or isLocked(plot) then
		return
	end
	-- The Long Lock pass makes it last longer.
	local seconds = GameConfig.LockDurationSeconds
	if DataApi.OwnsGamePass:Invoke(owner, "LongLock") == true then
		seconds *= FeatureConfig.LongLockMultiplier
	end
	plot.LockEndsAt = Workspace:GetServerTimeNow() + seconds
	plot.Model:SetAttribute("LockEndsAt", plot.LockEndsAt)
	setLasersActive(plot, true)
	updatePlotLabels(plot)
	notify(owner, string.format("Base locked for %d seconds!", seconds), "Success", "Lock")
	reportActivity(owner, "Lock")
end

local function createSign(sign: BasePart): (TextLabel, TextLabel)
	local surfaceGui = Instance.new("SurfaceGui")
	surfaceGui.Name = "SignGui"
	surfaceGui.Face = Enum.NormalId.Front
	surfaceGui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	surfaceGui.PixelsPerStud = 40
	surfaceGui.LightInfluence = 0

	local title = Instance.new("TextLabel")
	title.Name = "Title"
	title.BackgroundTransparency = 1
	title.Size = UDim2.fromScale(1, 0.62)
	title.Font = Enum.Font.FredokaOne
	title.TextScaled = true
	title.TextColor3 = Color3.new(1, 1, 1)
	title.TextStrokeTransparency = 0.3
	title.Parent = surfaceGui

	local subtitle = Instance.new("TextLabel")
	subtitle.Name = "Subtitle"
	subtitle.BackgroundTransparency = 1
	subtitle.Position = UDim2.fromScale(0, 0.6)
	subtitle.Size = UDim2.fromScale(1, 0.36)
	subtitle.Font = Enum.Font.FredokaOne
	subtitle.TextScaled = true
	subtitle.TextColor3 = Color3.fromRGB(90, 255, 120)
	subtitle.TextStrokeTransparency = 0.3
	subtitle.Parent = surfaceGui

	surfaceGui.Parent = sign
	return title, subtitle
end

local function createLockLabel(lockButton: BasePart): TextLabel
	local billboard = Instance.new("BillboardGui")
	billboard.Name = "LockGui"
	billboard.Adornee = lockButton
	billboard.Size = UDim2.fromScale(7, 1.4)
	billboard.StudsOffsetWorldSpace = Vector3.new(0, 3, 0)
	billboard.MaxDistance = 60
	billboard.LightInfluence = 0

	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = Color3.fromRGB(255, 90, 90)
	label.TextStrokeTransparency = 0.2
	label.Parent = billboard

	billboard.Parent = lockButton
	return label
end

local function findPart(parent: Instance, name: string): BasePart?
	local child = parent:FindFirstChild(name)
	if child and child:IsA("BasePart") then
		return child
	end
	return nil
end

local function collectNumberedParts(folder: Instance?, prefix: string): { [number]: BasePart }
	local parts: { [number]: BasePart } = {}
	if folder == nil then
		return parts
	end
	for _, child in folder:GetChildren() do
		local suffix = string.match(child.Name, "^" .. prefix .. "(%d+)$")
		if suffix and child:IsA("BasePart") then
			parts[tonumber(suffix) :: number] = child
		end
	end
	return parts
end

-- Numbered parts in order, skipping gaps.
local function sortedParts(parts: { [number]: BasePart }): { BasePart }
	local numbers: { number } = {}
	for number in parts do
		table.insert(numbers, number)
	end
	table.sort(numbers)
	local list: { BasePart } = {}
	for _, number in numbers do
		table.insert(list, parts[number])
	end
	return list
end

local function createFloorSign(part: BasePart): TextLabel
	local billboard = Instance.new("BillboardGui")
	billboard.Name = "FloorGui"
	billboard.Adornee = part
	billboard.Size = UDim2.fromScale(12, 3)
	billboard.MaxDistance = 90
	billboard.LightInfluence = 0

	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = Color3.fromRGB(255, 220, 90)
	label.TextStrokeTransparency = 0.1
	label.Parent = billboard

	billboard.Parent = part
	return label
end

-- Shows which floors are still locked and what unlocks them.
local function updateFloorSigns(plot: Plot)
	for floor, label in plot.FloorSigns do
		local rebirths = GameConfig.FloorUnlockRebirths[floor] or 0
		if plot.Owner == nil or floor <= plot.UnlockedFloors then
			label.Text = ""
		else
			label.Text = string.format("🔒 Floor %d\nUnlocks at Rebirth %d", floor, rebirths)
		end
	end
end

local function refreshUnlockedFloors(plot: Plot)
	local owner = plot.Owner
	local data = if owner then getPlayerData(owner) else nil
	local rebirths = if data then tonumber(data.Rebirths) or 0 else 0
	local floors = math.max(1, GameConfig.getUnlockedFloors(rebirths))
	local maxFloors = math.ceil(#plot.Slots / GameConfig.SlotsPerFloor)
	floors = math.min(floors, maxFloors)
	if floors ~= plot.UnlockedFloors then
		local gained = floors > plot.UnlockedFloors and plot.UnlockedFloors > 0 and owner ~= nil
		plot.UnlockedFloors = floors
		plot.Model:SetAttribute("UnlockedFloors", floors)
		if gained and owner then
			notify(owner, string.format("Floor %d of your base is unlocked! More room for brainrots.", floors), "Success", "Purchase")
		end
	end
	updateFloorSigns(plot)
end

-- The walls, floors and neon trim a base skin recolours, with how they look
-- now so the Classic skin can put them back.
local function collectSkinParts(model: Instance): { SkinPart }
	local list: { SkinPart } = {}
	local function add(instance: Instance?, kind: string)
		if instance and instance:IsA("BasePart") and instance.Transparency < 0.5 then
			table.insert(list, { Part = instance, Kind = kind, Color = instance.Color, Material = instance.Material })
			if kind == "Trim" then
				instance:SetAttribute("SkinTrim", true)
			end
		end
	end
	add(model:FindFirstChild("Floor"), "Floor")
	add(model:FindFirstChild("Roof"), "Wall")
	add(model:FindFirstChild("WallAboveDoor"), "Wall")
	local walls = model:FindFirstChild("Walls")
	if walls then
		for _, child in walls:GetChildren() do
			if not string.find(child.Name, "Glass") and not string.find(child.Name, "Sill") then
				add(child, "Wall")
			end
		end
	end
	local floors = model:FindFirstChild("Floors")
	if floors then
		for _, child in floors:GetChildren() do
			if string.match(child.Name, "^Slab") or string.match(child.Name, "^Step") then
				add(child, "Floor")
			end
		end
	end
	local trim = model:FindFirstChild("Trim")
	if trim then
		for _, child in trim:GetChildren() do
			if child:IsA("BasePart") and (child.Material == Enum.Material.Neon or child.Name == "Pillar" or child.Name == "Flag") then
				add(child, "Trim")
			elseif child.Name == "RoofBlock" then
				add(child, "Wall")
			end
		end
	end
	return list
end

local function applySkin(plot: Plot, skinName: string?)
	local skin = if skinName then FeatureConfig.SkinByName[skinName] else nil
	local classic = skin == nil or skin.Effect == "Classic"
	for _, entry in plot.SkinParts do
		local part = entry.Part
		if skin == nil or classic then
			part.Color = entry.Color
			part.Material = entry.Material
		elseif entry.Kind == "Wall" then
			part.Color = skin.Wall
			part.Material = skin.WallMaterial
		elseif entry.Kind == "Floor" then
			part.Color = skin.Floor
			part.Material = skin.FloorMaterial
		else
			part.Color = skin.Trim
		end
	end
	plot.Model:SetAttribute("Skin", if skin and not classic then skin.Name else nil)
	plot.Model:SetAttribute("SkinEffect", if skin and not classic then skin.Effect else nil)
end

-- The skin a player has on, if they own it.
local function equippedSkin(player: Player): string?
	local skins = getProgress(player, "Skins")
	if typeof(skins) ~= "table" then
		return nil
	end
	local name = skins.Equipped
	local skin = if typeof(name) == "string" then FeatureConfig.SkinByName[name] else nil
	if skin == nil then
		return nil
	end
	local owned = typeof(skins.Owned) == "table" and table.find(skins.Owned, name) ~= nil
	return if owned or skin.Price == 0 then name else nil
end

local function loadPlot(model: Instance, index: number): Plot?
	if not model:IsA("Model") then
		return nil
	end
	local floor = findPart(model, "Floor")
	local interior = findPart(model, "Interior")
	local laserZone = findPart(model, "LaserZone")
	local lockButton = findPart(model, "LockButton")
	local spawnPoint = findPart(model, "SpawnPoint")
	local sign = findPart(model, "Sign")
	local slotParts = collectNumberedParts(model:FindFirstChild("Slots"), "Slot")
	local slots = sortedParts(slotParts)
	local lasers = sortedParts(collectNumberedParts(model:FindFirstChild("Lasers"), "Laser"))
	if floor == nil or interior == nil or laserZone == nil or lockButton == nil or spawnPoint == nil or sign == nil or #slots == 0 then
		warn(string.format("%s %s is missing parts and was skipped.", LOG_PREFIX, model:GetFullName()))
		return nil
	end

	-- Pad N belongs to Slot N.
	local pads: { [number]: Pad } = {}
	local padParts = collectNumberedParts(model:FindFirstChild("Pads"), "Pad")
	local padCash: { number } = {}
	for slotIndex, slot in slots do
		padCash[slotIndex] = 0
		for number, slotPart in slotParts do
			local padPart = padParts[number]
			if slotPart == slot and padPart then
				pads[slotIndex] = createPadGui(padPart)
			end
		end
	end

	-- Stairs and locked-floor signs on the upper floors.
	local stairs: { [number]: Stair } = {}
	local floorSigns: { [number]: TextLabel } = {}
	local floorsFolder = model:FindFirstChild("Floors")
	if floorsFolder then
		local bottoms = collectNumberedParts(floorsFolder, "StairBottom")
		local tops = collectNumberedParts(floorsFolder, "StairTop")
		for floorNumber, bottom in bottoms do
			local top = tops[floorNumber]
			if top then
				stairs[floorNumber] = { Bottom = bottom.Position, Top = top.Position }
			end
		end
		for floorNumber, signPart in collectNumberedParts(floorsFolder, "FloorSign") do
			floorSigns[floorNumber] = createFloorSign(signPart)
		end
	end

	local title, subtitle = createSign(sign)
	local plot: Plot = {
		Index = index,
		Model = model,
		Floor = floor,
		Interior = interior,
		LaserZone = laserZone,
		Carpet = findPart(model, "Carpet"),
		Lasers = lasers,
		SpawnPoint = spawnPoint,
		Slots = slots,
		Pads = pads,
		PadCash = padCash,
		OfflinePads = {},
		Occupants = {},
		Reserved = {},
		Owner = nil,
		LockEndsAt = 0,
		SignTitle = title,
		SignSubtitle = subtitle,
		LockLabel = createLockLabel(lockButton),
		Stairs = stairs,
		FloorSigns = floorSigns,
		UnlockedFloors = 1,
		Levels = table.create(#slots, 1),
		LevelRings = {},
		SkinParts = collectSkinParts(model),
	}

	model:SetAttribute("OwnerUserId", 0)
	model:SetAttribute("LockEndsAt", 0)
	model:SetAttribute("UnlockedFloors", 1)
	updateFloorSigns(plot)
	setLasersActive(plot, false)
	updatePlotLabels(plot)

	lockButton.Touched:Connect(function(hit: BasePart)
		onLockButtonTouched(plot, hit)
	end)
	return plot
end

local function teleportToPlot(player: Player)
	local plot = plotByPlayer[player]
	local character = player.Character
	if plot and character then
		character:PivotTo(plot.SpawnPoint.CFrame * CFrame.new(0, 4, 0))
	end
end

-- Uncollected Cash from last time goes back on the pads, and brainrots earn
-- offline cash for the time the player was away.
local function restorePads(player: Player, plot: Plot)
	local saved = DataApi.GetPadCash:Invoke(player)
	if typeof(saved) == "table" then
		for index, amount in saved do
			if typeof(index) == "number" and typeof(amount) == "number" and amount > 0 then
				-- A pad that no longer exists hands its Cash to the first one.
				local target = if index <= #plot.Slots then index else 1
				plot.PadCash[target] = (plot.PadCash[target] or 0) + amount
			end
		end
	end

	local seconds = tonumber(DataApi.TakeOfflineSeconds:Invoke(player)) or 0
	local total = 0
	if seconds >= GameConfig.OfflineMinSeconds then
		local earningSeconds = math.min(seconds, GameConfig.OfflineMaxHours * 3600)
		local incomeMultiplier = getIncomeMultiplier(player)
		local multiplier = incomeMultiplier * GameConfig.OfflineIncomeFraction
		for index, occupant in plot.Occupants do
			-- Offline cash at the level it had when its owner left; then it
			-- levels up for the time away too.
			local income = occupantIncome(occupant)
			local earned = math.floor(income * multiplier * earningSeconds)
			if not BrainrotConfig.isLuckyBlock(occupant.Definition) then
				occupant.Seconds += earningSeconds
				refreshOccupantInfo(occupant)
			end
			if earned > 0 then
				plot.PadCash[index] = (plot.PadCash[index] or 0) + earned
				plot.OfflinePads[index] = true
				total += earned
			end
		end
	end
	DataApi.SetPadCash:Invoke(player, padCashList(plot))
	updatePadLabels(plot)
	if total > 0 then
		saveBrainrots(plot)
	end

	if total > 0 then
		notify(
			player,
			string.format(
				"Welcome back! Your brainrots made %s while you were away (%s). Step on the green pads to collect it!",
				NumberFormat.cash(total),
				NumberFormat.duration(math.min(seconds, GameConfig.OfflineMaxHours * 3600))
			),
			"Success",
			"OfflineCash"
		)
	end
end

local function assignPlot(player: Player)
	if plotByPlayer[player] or player.Parent ~= Players then
		return
	end
	local plot: Plot? = nil
	for _, candidate in plots do
		if candidate.Owner == nil then
			plot = candidate
			break
		end
	end
	if plot == nil then
		notify(player, "Every base on this server is taken. Try another server!", "Error")
		return
	end

	plot.Owner = player
	plotByPlayer[player] = plot
	plot.Model:SetAttribute("OwnerUserId", player.UserId)
	plot.UnlockedFloors = 0
	refreshUnlockedFloors(plot)

	-- Pedestal upgrades, the Index and the base skin.
	local savedLevels = getProgress(player, "Pedestals")
	for index = 1, #plot.Slots do
		local level = if typeof(savedLevels) == "table" then tonumber(savedLevels[index]) else nil
		plot.Levels[index] = math.clamp(math.floor(level or 1), 1, FeatureConfig.maxPedestalLevel())
		updatePedestalLook(plot, index)
	end
	local found: { [string]: boolean } = {}
	local savedFound = getProgress(player, "Discovered")
	if typeof(savedFound) == "table" then
		for _, key in savedFound do
			if typeof(key) == "string" then
				found[key] = true
			end
		end
	end
	discovered[player] = found
	applySkin(plot, equippedSkin(player))

	local savedIds = DataApi.GetBrainrots:Invoke(player)
	local changed = false
	local nextSlot = 1
	if typeof(savedIds) == "table" then
		for _, entry in savedIds do
			local definition, mutation, trait = nil, nil, nil
			local hatName, seconds = nil, 0
			if typeof(entry) == "string" then
				definition, mutation, trait = BrainrotConfig.decode(entry)
				hatName, seconds = BrainrotConfig.decodeExtras(entry)
			end
			if definition and nextSlot <= #plot.Slots then
				placeOccupant(plot, nextSlot, definition, mutation, trait, nil, nil, hatName, seconds)
				discover(player, definition, mutation)
				nextSlot += 1
			else
				changed = true
			end
		end
	end

	-- A brand-new player gets one free brainrot so income starts right away.
	if nextSlot == 1 then
		local data = getPlayerData(player)
		local starter = BrainrotConfig.ById[GameConfig.StarterBrainrotId]
		if data and data.Cash == 0 and data.Rebirths == 0 and starter then
			placeOccupant(plot, 1, starter, nil, nil, nil, nil)
			discover(player, starter, nil)
			changed = true
			notify(player, string.format("Welcome! Here's a free %s to get you started.", starter.DisplayName), "Success")
		end
	end
	if changed then
		saveBrainrots(plot)
	end

	restorePads(player, plot)
	refreshIndex(player)
	placePending(player)
	updatePlotLabels(plot)
	teleportToPlot(player)
end

local function releasePlot(player: Player)
	local ownCarry = carries[player]
	if ownCarry then
		endCarry(ownCarry, nil)
	end

	local plot = plotByPlayer[player]
	if plot == nil then
		return
	end
	for _, carry in carries do
		if carry.VictimPlot == plot or carry.TargetPlot == plot then
			endCarry(carry, "The owner left, so the brainrot went back.")
		end
	end
	for _, occupant in plot.Occupants do
		destroyOccupant(occupant)
	end
	table.clear(plot.Occupants)
	table.clear(plot.Reserved)

	plotByPlayer[player] = nil
	plot.Owner = nil
	plot.LockEndsAt = 0
	plot.Model:SetAttribute("OwnerUserId", 0)
	plot.Model:SetAttribute("LockEndsAt", 0)
	plot.UnlockedFloors = 1
	plot.Model:SetAttribute("UnlockedFloors", 1)
	plot.Model:SetAttribute("Alarm", false)
	for index = 1, #plot.Slots do
		plot.Levels[index] = 1
		updatePedestalLook(plot, index)
	end
	applySkin(plot, nil)
	discovered[player] = nil
	indexBonus[player] = nil
	updateFloorSigns(plot)
	setLasersActive(plot, false)
	clearPads(plot)
	updatePlotLabels(plot)
end

--------------------------------------------------------------------------------
-- Ticks
--------------------------------------------------------------------------------

-- Horizontal speed check for thieves, so a teleport can't carry a stolen
-- brainrot home. Vertical movement (jumps, falls) is ignored.
local function movedTooFast(carry: Carry, position: Vector3, clock: number): boolean
	local elapsed = clock - carry.LastCheckedAt
	local offset = position - carry.LastPosition
	local horizontalDistance = Vector3.new(offset.X, 0, offset.Z).Magnitude
	carry.LastPosition = position
	carry.LastCheckedAt = clock
	local level = math.clamp(tonumber(carry.Thief:GetAttribute("SpeedLevel")) or 0, 0, #FeatureConfig.SpeedCosts)
	local bonus = math.max(0, ExtrasConfig.speedBonusOf(carry.Thief))
	local speed = GameConfig.CarryWalkSpeed + level * FeatureConfig.CarrySpeedPerLevel + bonus
	return horizontalDistance > speed * elapsed * 2 + GameConfig.CarrySpeedToleranceStuds
end

-- Runs every Tuning.FAST_TICK_SECONDS: laser doors, collect pads and brainrots being carried.
local function fastTick()
	for _, plot in plots do
		local owner = plot.Owner
		if owner and isLocked(plot) then
			local ownerCrew = owner:GetAttribute("CrewId")
			for _, player in Players:GetPlayers() do
				if player ~= owner and (ownerCrew == nil or player:GetAttribute("CrewId") ~= ownerCrew) then
					local rootPart, humanoid = getLiveCharacter(player)
					if
						rootPart
						and humanoid
						and isInsidePart(plot.LaserZone, rootPart.Position)
						and DataApi.IsLaserBypassActive:Invoke(player) ~= true
					then
						humanoid.Health = 0
						notify(player, "Zapped by the laser door!", "Error", "Zap")
					end
				end
			end
		end
		if owner then
			collectPads(plot)
		end
	end

	for thief, carry in carries do
		local rootPart = getLiveCharacter(thief)
		local clock = os.clock()
		if rootPart == nil then
			endCarry(carry, "You dropped the brainrot!")
		elseif movedTooFast(carry, rootPart.Position, clock) then
			endCarry(carry, "You moved too fast and dropped the brainrot!")
		elseif isInsidePart(carry.TargetPlot.Interior, rootPart.Position) then
			completeSteal(carry)
		elseif clock - carry.StartedAt > GameConfig.CarryTimeoutSeconds then
			endCarry(carry, "You took too long and dropped the brainrot!")
		else
			local victim = carry.VictimPlot.Owner
			local victimRoot = if victim then getLiveCharacter(victim) else nil
			if victim and victimRoot and (victimRoot.Position - rootPart.Position).Magnitude <= GameConfig.CatchDistance then
				endCarry(carry, "You got caught! The brainrot went back.")
				reportActivity(victim, "Catch")
			end
		end
	end
end

-- The spawn sign, brainrot levels and the slow tick (a block, so its helpers
-- aren't top-level locals; see Tuning).
local slowTick: () -> ()
do
	local spawnSignLabel: TextLabel? = nil
	do
		local spawnSign = conveyorFolder:FindFirstChild("SpawnSign", true)
		if spawnSign and spawnSign:IsA("BasePart") then
			local surfaceGui = Instance.new("SurfaceGui")
			surfaceGui.Name = "SignGui"
			surfaceGui.Face = Enum.NormalId.Front
			surfaceGui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
			surfaceGui.PixelsPerStud = 40
			surfaceGui.LightInfluence = 0

			local label = Instance.new("TextLabel")
			label.BackgroundColor3 = Color3.fromRGB(20, 24, 40)
			label.Size = UDim2.fromScale(1, 1)
			label.Font = Enum.Font.FredokaOne
			label.RichText = true
			label.TextScaled = true
			label.TextColor3 = Color3.new(1, 1, 1)
			label.Parent = surfaceGui
			surfaceGui.Parent = spawnSign
			spawnSignLabel = label
		end
	end

	local function updateSpawnSign()
		local label = spawnSignLabel
		if label == nil then
			return
		end
		local now = Workspace:GetServerTimeNow()
		local lines: { string } = {}
		for index = #GameConfig.GuaranteedRarities, 1, -1 do
			local rule = GameConfig.GuaranteedRarities[index]
			local rarity = BrainrotConfig.RarityByName[rule.Rarity]
			local colour = if rarity then rarity.Color:ToHex() else "ffffff"
			table.insert(
				lines,
				string.format(
					'Guaranteed <font color="#%s">%s</font> in %s',
					colour,
					rule.Rarity,
					NumberFormat.duration((nextGuaranteedAt[rule.Rarity] or now) - now)
				)
			)
		end
		label.Text = table.concat(lines, "\n")
	end

	-- Brainrots on their pedestals level up over time (lucky blocks don't).
	local levelsDirtyAt: { [Plot]: number } = {}
	Tuning.LEVEL_SAVE_SECONDS = 30

	local function levelUp(occupant: Occupant, owner: Player)
		if BrainrotConfig.isLuckyBlock(occupant.Definition) or occupant.OpeningResult then
			return
		end
		local before = ExtrasConfig.levelOf(occupant.Seconds)
		occupant.Seconds += Tuning.SLOW_TICK_SECONDS
		local after = ExtrasConfig.levelOf(occupant.Seconds)
		local plot = occupant.Plot
		levelsDirtyAt[plot] = levelsDirtyAt[plot] or os.clock()
		if after ~= before then
			refreshOccupantInfo(occupant)
			-- A new level is saved right away.
			levelsDirtyAt[plot] = nil
			saveBrainrots(plot)
			notify(
				owner,
				string.format("⭐ %s reached level %d! (+%d%% income)", occupant.Definition.DisplayName, after, math.floor(ExtrasConfig.IncomePerLevel * (after - 1) * 100 + 0.5)),
				"Success",
				"LevelUp"
			)
		end
	end

	-- Runs every Tuning.SLOW_TICK_SECONDS: income onto the pads, lock timers and signs.
	slowTick = function()
		local now = Workspace:GetServerTimeNow()
		for _, plot in plots do
			if plot.LockEndsAt > 0 and now >= plot.LockEndsAt then
				plot.LockEndsAt = 0
				plot.Model:SetAttribute("LockEndsAt", 0)
				setLasersActive(plot, false)
			end

			local owner = plot.Owner
			if owner then
				refreshUnlockedFloors(plot)
				local multiplier, boostInfo = getIncomeMultiplier(owner)
				local incomePerSecond = 0
				for index, occupant in plot.Occupants do
					if occupant.Carrier == nil and occupant.Walk == nil then
						local income = occupantIncome(occupant) * multiplier
						incomePerSecond += income
						plot.PadCash[index] = (plot.PadCash[index] or 0) + income * Tuning.SLOW_TICK_SECONDS
						levelUp(occupant, owner)
					end
				end
				owner:SetAttribute("IncomePerSecond", incomePerSecond)
				owner:SetAttribute("IncomeMultiplier", multiplier)
				-- Level time is saved every little while, not every second.
				local dirtySince = levelsDirtyAt[plot]
				if dirtySince and os.clock() - dirtySince >= Tuning.LEVEL_SAVE_SECONDS then
					levelsDirtyAt[plot] = nil
					saveBrainrots(plot)
				end
				owner:SetAttribute("BoostInfo", table.concat(boostInfo, "\n"))
				DataApi.SetPadCash:Invoke(owner, padCashList(plot))
				updatePadLabels(plot)
			end
			updatePlotLabels(plot)
		end
		updateSpawnSign()
	end
end

local function runLoop(intervalSeconds: number, name: string, callback: () -> ())
	task.spawn(function()
		while true do
			task.wait(intervalSeconds)
			xpcall(callback, function(err: any)
				warn(string.format("%s %s failed: %s", LOG_PREFIX, name, tostring(err)))
			end)
		end
	end)
end

--------------------------------------------------------------------------------
-- Mutation events
--------------------------------------------------------------------------------

local function notifyAll(message: string, kind: NotifyKind, sound: string?)
	for _, player in Players:GetPlayers() do
		notify(player, message, kind, sound)
	end
end

local function eventMessage(event: GameEvent): string
	local duration = NumberFormat.duration(GameConfig.EventDurationSeconds)
	local boost = event.TagBoost
	if event.AdminAbuse then
		return string.format(
			"ADMIN ABUSE!!! For %s: every brainrot is mutated, prices are cut, %sx luck, traits everywhere and Cash is raining!",
			duration,
			tostring(event.Luck or 1)
		)
	elseif event.Boss then
		return "BOSS RAID! A giant brainrot is stomping around the middle of the map. Click it (or slap it) to beat it together!"
	elseif event.Heist then
		return string.format("BANK HEIST! The vault is open for %s. Grab loot bags and run them home!", duration)
	elseif boost then
		return string.format(
			"%s! Half the brainrots are %s brainrots, and %s-mutated ones can spawn, for %s!",
			event.Name,
			boost.Tag,
			boost.Tag,
			duration
		)
	elseif event.CashRain then
		return string.format("%s! Grab the Cash falling from the sky (and look out for Cash brainrots) for %s!", event.Name, duration)
	elseif event.Luck then
		return string.format("%s! Rare brainrots are %sx more likely, and Lucky ones can spawn, for %s!", event.Name, tostring(event.Luck), duration)
	elseif event.Mutation and event.MutationChance then
		return string.format("%s! %s brainrots can spawn on the conveyor for %s!", event.Name, event.Mutation, duration)
	elseif event.Mutation then
		return string.format(
			"%s! %s brainrots are %sx more common for %s!",
			event.Name,
			event.Mutation,
			tostring(event.ChanceMultiplier or 1),
			duration
		)
	end
	return string.format("%s for %s!", event.Name, duration)
end

-- Cash Rain: coins land around the map; the first player to touch one gets
-- Cash worth a few seconds of their income.
local spawnCoinWave: () -> ()
local clearCoins: () -> ()
local collectCoins: () -> ()
do
	local coinExpiresAt: { [BasePart]: number } = {}
	local coinArea: { Min: Vector3, Max: Vector3 }? = nil
	do
		local baseplate = Workspace:FindFirstChild("Baseplate")
		if baseplate and baseplate:IsA("BasePart") then
			local half = baseplate.Size / 2 - Vector3.new(24, 0, 24)
			local top = baseplate.Position.Y + baseplate.Size.Y / 2
			coinArea = {
				Min = Vector3.new(baseplate.Position.X - half.X, top, baseplate.Position.Z - half.Z),
				Max = Vector3.new(baseplate.Position.X + half.X, top, baseplate.Position.Z + half.Z),
			}
		end
	end

	local function coinSpot(): Vector3?
		local area = coinArea
		if area == nil then
			return nil
		end
		for _ = 1, 8 do
			local x = rng:NextNumber(area.Min.X, area.Max.X)
			local z = rng:NextNumber(area.Min.Z, area.Max.Z)
			-- Only on open ground: not on a roof or inside a base.
			local hit = Workspace:Raycast(Vector3.new(x, area.Min.Y + 80, z), Vector3.new(0, -100, 0))
			if hit and hit.Position.Y <= area.Min.Y + 1.5 and not hit.Instance:IsDescendantOf(plotsFolder) then
				return Vector3.new(x, hit.Position.Y, z)
			end
		end
		return nil
	end

	spawnCoinWave = function()
		local expiresAt = os.clock() + GameConfig.CashRainWaveSeconds * 2.5
		for _ = 1, GameConfig.CashRainCoinsPerWave do
			local spot = coinSpot()
			if spot then
				local coin = Instance.new("Part")
				coin.Name = "Coin"
				coin.Shape = Enum.PartType.Cylinder
				coin.Size = Vector3.new(0.5, 3, 3)
				coin.Material = Enum.Material.Neon
				coin.Color = Color3.fromRGB(255, 205, 50)
				coin.Anchored = true
				coin.CanCollide = false
				coin.CanQuery = false
				coin.CanTouch = false
				coin.CFrame = CFrame.new(spot + Vector3.new(0, 2.2, 0))
				coin:SetAttribute("Spin", true)
				coin.Parent = coinsFolder
				coinExpiresAt[coin] = expiresAt
			end
		end
	end

	clearCoins = function()
		for coin in coinExpiresAt do
			coin:Destroy()
		end
		table.clear(coinExpiresAt)
	end

	-- Called from the fast tick.
	collectCoins = function()
		if next(coinExpiresAt) == nil then
			return
		end
		local clock = os.clock()
		local roots: { [Player]: BasePart } = {}
		for _, player in Players:GetPlayers() do
			local rootPart = getLiveCharacter(player)
			if rootPart then
				roots[player] = rootPart
			end
		end
		for coin, expiresAt in coinExpiresAt do
			if clock >= expiresAt or coin.Parent == nil then
				coinExpiresAt[coin] = nil
				coin:Destroy()
				continue
			end
			for player, rootPart in roots do
				if (rootPart.Position - coin.Position).Magnitude <= 5 then
					local income = tonumber(player:GetAttribute("IncomePerSecond")) or 0
					local amount = math.max(GameConfig.CashRainMinCoin, math.floor(income * GameConfig.CashRainCoinIncomeSeconds))
					coinExpiresAt[coin] = nil
					coin:Destroy()
					if addCash(player, amount) then
						playSound(player, "Collect")
						notify(player, "+" .. NumberFormat.cash(amount) .. " from the Cash Rain!", "Success")
					end
					break
				end
			end
		end
	end
end

Api.eventChangedEvent = Instance.new("BindableEvent")
Api.eventChangedEvent.Name = "EventChanged"
Api.eventChangedEvent.Parent = Api.gameplayApi

local function runEvent(event: GameEvent)
	local endsAt = Workspace:GetServerTimeNow() + GameConfig.EventDurationSeconds
	activeEvent = event
	ReplicatedStorage:SetAttribute("EventName", event.Name)
	ReplicatedStorage:SetAttribute("EventMutation", event.Mutation)
	ReplicatedStorage:SetAttribute("EventSky", event.Sky)
	ReplicatedStorage:SetAttribute("EventParticles", event.Particles)
	ReplicatedStorage:SetAttribute("EventAdmin", event.AdminAbuse == true)
	ReplicatedStorage:SetAttribute("EventEndsAt", endsAt)
	notifyAll(eventMessage(event), "Info", "Event")
	-- Boss raids and bank heists are run by RaidManager.
	Api.eventChangedEvent:Fire(event.Name)
	-- The EventEndsAt attribute is the end time: /endevent moves it to now.
	local nextWave = 0
	while true do
		local now = Workspace:GetServerTimeNow()
		endsAt = tonumber(ReplicatedStorage:GetAttribute("EventEndsAt")) or 0
		if now >= endsAt then
			break
		end
		if event.CashRain and now >= nextWave then
			spawnCoinWave()
			nextWave = now + GameConfig.CashRainWaveSeconds
		end
		task.wait(math.clamp(endsAt - now, 0.1, 1))
	end
	activeEvent = nil
	clearCoins()
	ReplicatedStorage:SetAttribute("EventName", nil)
	ReplicatedStorage:SetAttribute("EventMutation", nil)
	ReplicatedStorage:SetAttribute("EventSky", nil)
	ReplicatedStorage:SetAttribute("EventParticles", nil)
	ReplicatedStorage:SetAttribute("EventAdmin", false)
	ReplicatedStorage:SetAttribute("EventEndsAt", 0)
	Api.eventChangedEvent:Fire(nil)
	notifyAll(event.Name .. " is over.", "Info")
end

--------------------------------------------------------------------------------
-- Rebirth
--------------------------------------------------------------------------------

Api.requestRebirthFunction.OnServerInvoke = function(player: Player): (boolean, string)
	local now = os.clock()
	local last = lastRebirthRequest[player]
	if last and now - last < Tuning.REBIRTH_REQUEST_COOLDOWN_SECONDS then
		return false, "Slow down!"
	end
	lastRebirthRequest[player] = now

	local data = getPlayerData(player)
	if data == nil then
		return false, "Your data is still loading."
	end
	local rebirths = tonumber(data.Rebirths) or 0
	local cash = tonumber(data.Cash) or 0
	local cost = GameConfig.getRebirthCost(rebirths)
	if cash < cost then
		return false, string.format("You need %s to rebirth.", NumberFormat.cash(cost))
	end
	-- Each rebirth also needs certain brainrots at home in your base.
	local plot = plotByPlayer[player]
	local missing: { string } = {}
	for _, brainrotId in FeatureConfig.getRebirthRequirement(rebirths) do
		local found = false
		if plot then
			for _, occupant in plot.Occupants do
				if occupant.Definition.Id == brainrotId and occupant.Walk == nil and occupant.Carrier == nil then
					found = true
					break
				end
			end
		end
		if not found then
			local definition = BrainrotConfig.ById[brainrotId]
			table.insert(missing, if definition then definition.DisplayName else brainrotId)
		end
	end
	if #missing > 0 then
		return false, "You also need " .. table.concat(missing, " and ") .. " in your base to rebirth."
	end

	-- Rebirthing resets Cash and the pads to 0 and keeps your brainrots.
	if not spendCash(player, cash) then
		return false, "Rebirth failed, try again."
	end
	DataApi.AddRebirths:Invoke(player, 1)
	reportActivity(player, "Rebirth")
	if plot then
		clearPads(plot)
		refreshUnlockedFloors(plot)
	end
	DataApi.SetPadCash:Invoke(player, if plot then padCashList(plot) else {})

	local message = string.format(
		"Rebirth %d! Your income is now x%s.",
		rebirths + 1,
		tostring(GameConfig.getRebirthIncomeMultiplier(rebirths + 1))
	)
	for _, other in Players:GetPlayers() do
		if other ~= player then
			notify(other, string.format("%s just reached Rebirth %d!", player.DisplayName, rebirths + 1), "Info")
		end
	end
	return true, message
end

--------------------------------------------------------------------------------
-- Pedestal upgrades
--------------------------------------------------------------------------------

onUpgradeTriggered = function(occupant: Occupant, player: Player)
	local plot = occupant.Plot
	local slotIndex = occupant.SlotIndex
	if plot.Owner ~= player or occupant.Walk ~= nil or occupant.Carrier ~= nil or plot.Occupants[slotIndex] ~= occupant then
		return
	end
	if not isPlayerNear(player, occupant.PromptAttachment.WorldPosition) then
		return
	end
	local level = plot.Levels[slotIndex] or 1
	local cost = FeatureConfig.PedestalCosts[level]
	if cost == nil then
		notify(player, "This pedestal is already max level!", "Info")
		return
	end
	if not spendCash(player, cost) then
		notify(player, string.format("You need %s to upgrade this pedestal.", NumberFormat.cash(cost)), "Error")
		return
	end
	if plot.Owner ~= player then
		addCash(player, cost)
		return
	end
	plot.Levels[slotIndex] = level + 1
	setProgress(player, "Pedestals", plot.Levels)
	updatePedestalLook(plot, slotIndex)
	refreshUpgradePrompt(occupant)
	refreshOccupantInfo(occupant)
	notify(
		player,
		string.format("Pedestal upgraded to Lv %d! Brainrots here earn %s.", level + 1, percent(FeatureConfig.PedestalBonus * level)),
		"Success",
		"Purchase"
	)
	reportActivity(player, "Upgrade")
end

--------------------------------------------------------------------------------
-- Lucky blocks
--------------------------------------------------------------------------------

onOpenTriggered = function(occupant: Occupant, player: Player)
	local plot = occupant.Plot
	local slotIndex = occupant.SlotIndex
	local odds = occupant.Definition.Odds
	if
		odds == nil
		or plot.Owner ~= player
		or occupant.Walk ~= nil
		or occupant.Carrier ~= nil
		or occupant.OpeningResult ~= nil
		or plot.Occupants[slotIndex] ~= occupant
	then
		return
	end
	if not isPlayerNear(player, occupant.PromptAttachment.WorldPosition) then
		return
	end
	local definition = rollFromOdds(odds)
	if definition == nil then
		return
	end
	local mutation = rollMutation()
	local trait = rollTrait()
	local entry = entryOf(definition, mutation, trait)

	-- Saved as the result straight away, so leaving mid-reveal loses nothing.
	occupant.OpeningResult = entry
	if not saveBrainrots(plot) then
		occupant.OpeningResult = nil
		return
	end
	occupant.Model:SetAttribute("State", "Opening")
	setPromptFlag(occupant, "Carried", true)
	Api.luckyRevealEvent:FireAllClients(player.UserId, occupant.Definition.Id, entry, occupant.Root.Position)
	reportActivity(player, "OpenBlock")

	-- The block shakes while the client shows a roulette, then pops.
	task.delay(2.8, function()
		if plot.Owner ~= player or plot.Occupants[slotIndex] ~= occupant then
			return
		end
		plot.Occupants[slotIndex] = nil
		destroyOccupant(occupant)
		local placed = placeOccupant(plot, slotIndex, definition, mutation, trait, nil, nil)
		if placed then
			placed.Model:SetAttribute("Arrived", Workspace:GetServerTimeNow())
		end
		saveBrainrots(plot)
		discover(player, definition, mutation)
		local name = fullName(definition, mutation, trait)
		notify(player, string.format("Your %s opened into %s!", occupant.Definition.DisplayName, name), "Success", "StealSuccess")
		if definition.Rarity == "Secret" or definition.Rarity == "Brainrot God" or definition.Rarity == "OG" then
			for _, other in Players:GetPlayers() do
				if other ~= player then
					notify(other, string.format("%s unboxed %s (%s)!", player.DisplayName, name, definition.Rarity), "Info", "Event")
				end
			end
		end
	end)
end

--------------------------------------------------------------------------------
-- Gifts, fusing and trading (for RewardsManager, FuseManager, TradeManager)
--------------------------------------------------------------------------------

do
	local MAX_PENDING = 50

	local function freeSlotCount(plot: Plot): number
		local limit = math.min(#plot.Slots, plot.UnlockedFloors * GameConfig.SlotsPerFloor)
		local count = 0
		for index = 1, limit do
			if plot.Occupants[index] == nil and not plot.Reserved[index] then
				count += 1
			end
		end
		return count
	end

	placePending = function(player: Player)
		local plot = plotByPlayer[player]
		if plot == nil or plot.Owner ~= player then
			return
		end
		local pending = getProgress(player, "Pending")
		if typeof(pending) ~= "table" or #pending == 0 or findFreeSlot(plot) == nil then
			return
		end
		local remaining: { string } = {}
		local placed = 0
		for _, entry in pending do
			if typeof(entry) ~= "string" then
				continue
			end
			local definition, mutation, trait = BrainrotConfig.decode(entry)
			if definition == nil then
				continue
			end
			local slotIndex = findFreeSlot(plot)
			local occupant = if slotIndex then placeOccupant(plot, slotIndex, definition, mutation, trait, nil, nil) else nil
			if occupant then
				placed += 1
				occupant.Model:SetAttribute("Arrived", Workspace:GetServerTimeNow())
				discover(player, definition, mutation)
				notify(player, string.format("%s arrived in your base!", fullName(definition, mutation, trait)), "Success", "Purchase")
			else
				table.insert(remaining, entry)
			end
		end
		if placed > 0 then
			saveBrainrots(plot)
			setProgress(player, "Pending", remaining)
		end
	end

	-- Puts a brainrot (or lucky block) in the player's base, or queues it until
	-- a pedestal is free.
	local function giveBrainrot(player: Player, entry: string): string?
		local definition, mutation, trait = BrainrotConfig.decode(entry)
		if definition == nil or player.Parent ~= Players then
			return nil
		end
		local plot = plotByPlayer[player]
		local slotIndex = if plot then findFreeSlot(plot) else nil
		if plot and slotIndex then
			local occupant = placeOccupant(plot, slotIndex, definition, mutation, trait, nil, nil)
			if occupant then
				occupant.Model:SetAttribute("Arrived", Workspace:GetServerTimeNow())
				saveBrainrots(plot)
				discover(player, definition, mutation)
				return "Placed"
			end
		end
		local pending = getProgress(player, "Pending")
		local list = if typeof(pending) == "table" then pending else {}
		if #list >= MAX_PENDING then
			return nil
		end
		table.insert(list, entry)
		if not setProgress(player, "Pending", list) then
			return nil
		end
		notify(
			player,
			string.format("No room for %s yet! It'll show up when a pedestal is free.", fullName(definition, mutation, trait)),
			"Warning"
		)
		return "Pending"
	end

	-- The player's brainrots on these pedestals, if every one is at home and
	-- free to hand over (not walking, carried or being opened).
	local function idleOccupants(player: Player, slots: any): { Occupant }?
		local plot = plotByPlayer[player]
		if plot == nil or typeof(slots) ~= "table" or #slots > 16 then
			return nil
		end
		local list: { Occupant } = {}
		local seen: { [number]: boolean } = {}
		for _, slotIndex in slots do
			if typeof(slotIndex) ~= "number" or seen[slotIndex] then
				return nil
			end
			seen[slotIndex] = true
			local occupant = plot.Occupants[slotIndex]
			if occupant == nil or occupant.Walk ~= nil or occupant.Carrier ~= nil or occupant.OpeningResult ~= nil or occupant.Sniping then
				return nil
			end
			table.insert(list, occupant)
		end
		return list
	end

	local function takeBrainrots(player: Player, slots: any): { string }?
		local occupants = idleOccupants(player, slots)
		local plot = plotByPlayer[player]
		if occupants == nil or plot == nil or #occupants == 0 then
			return nil
		end
		local entries: { string } = {}
		for _, occupant in occupants do
			plot.Occupants[occupant.SlotIndex] = nil
			table.insert(entries, occupantEntry(occupant))
		end
		if not saveBrainrots(plot) then
			for _, occupant in occupants do
				plot.Occupants[occupant.SlotIndex] = occupant
			end
			return nil
		end
		for _, occupant in occupants do
			destroyOccupant(occupant)
			returnHat(occupant, player)
		end
		return entries
	end

	-- Swaps brainrots between two bases in one step: all of it happens or none.
	local function tradeBrainrots(first: Player, firstSlots: any, second: Player, secondSlots: any): boolean
		if first == second or getPlayerData(first) == nil or getPlayerData(second) == nil then
			return false
		end
		local firstPlot, secondPlot = plotByPlayer[first], plotByPlayer[second]
		local fromFirst, fromSecond = idleOccupants(first, firstSlots), idleOccupants(second, secondSlots)
		if firstPlot == nil or secondPlot == nil or fromFirst == nil or fromSecond == nil then
			return false
		end
		if #fromFirst + #fromSecond == 0 or #fromFirst > FeatureConfig.MaxTradeItems or #fromSecond > FeatureConfig.MaxTradeItems then
			return false
		end
		if freeSlotCount(firstPlot) + #fromFirst < #fromSecond or freeSlotCount(secondPlot) + #fromSecond < #fromFirst then
			return false
		end
		for _, occupant in fromFirst do
			firstPlot.Occupants[occupant.SlotIndex] = nil
		end
		for _, occupant in fromSecond do
			secondPlot.Occupants[occupant.SlotIndex] = nil
		end
		local function move(occupants: { Occupant }, plot: Plot, receiver: Player, giver: Player)
			for _, occupant in occupants do
				returnHat(occupant, giver)
				local slotIndex = findFreeSlot(plot)
				if slotIndex then
					local placed = placeOccupant(
						plot,
						slotIndex,
						occupant.Definition,
						occupant.Mutation,
						occupant.Trait,
						nil,
						occupant.Price,
						nil,
						occupant.Seconds
					)
					if placed then
						placed.Model:SetAttribute("Arrived", Workspace:GetServerTimeNow())
					end
					discover(receiver, occupant.Definition, occupant.Mutation)
				end
				destroyOccupant(occupant)
			end
		end
		move(fromFirst, secondPlot, second, first)
		move(fromSecond, firstPlot, first, second)
		saveBrainrots(firstPlot)
		saveBrainrots(secondPlot)
		DataApi.SaveNow:Invoke(first)
		DataApi.SaveNow:Invoke(second)
		placePending(first)
		placePending(second)
		return true
	end

	local function createApiFunction(name: string, callback: (...any) -> ...any)
		local bindable = Instance.new("BindableFunction")
		bindable.Name = name
		bindable.OnInvoke = callback
		bindable.Parent = Api.gameplayApi
	end

	local function asPlayer(value: any): Player?
		if typeof(value) == "Instance" and value:IsA("Player") then
			return value
		end
		return nil
	end

	createApiFunction("GiveBrainrot", function(playerArg: any, entry: any): string?
		local player = asPlayer(playerArg)
		if player == nil or typeof(entry) ~= "string" then
			return nil
		end
		local result = giveBrainrot(player, entry)
		placePending(player)
		return result
	end)

	createApiFunction("TakeBrainrots", function(playerArg: any, slots: any): { string }?
		local player = asPlayer(playerArg)
		return if player then takeBrainrots(player, slots) else nil
	end)

	createApiFunction("TradeBrainrots", function(firstArg: any, firstSlots: any, secondArg: any, secondSlots: any): boolean
		local first, second = asPlayer(firstArg), asPlayer(secondArg)
		return first ~= nil and second ~= nil and tradeBrainrots(first, firstSlots, second, secondSlots)
	end)

	createApiFunction("DescribeSlots", function(playerArg: any, slots: any): { string }?
		local player = asPlayer(playerArg)
		local occupants = if player then idleOccupants(player, slots) else nil
		if occupants == nil then
			return nil
		end
		local entries: { string } = {}
		for _, occupant in occupants do
			table.insert(entries, occupantEntry(occupant))
		end
		return entries
	end)

	-- Every brainrot in the player's base (not lucky blocks), as a list of
	-- infos with their Slot. (A list, because Bindables copy tables and a
	-- table keyed by slot numbers with gaps doesn't survive the copy.)
	createApiFunction("DescribeOccupants", function(playerArg: any): { { [string]: any } }?
		local player = asPlayer(playerArg)
		local plot = if player then plotByPlayer[player] else nil
		if plot == nil then
			return nil
		end
		local result: { { [string]: any } } = {}
		for slotIndex, occupant in plot.Occupants do
			if not BrainrotConfig.isLuckyBlock(occupant.Definition) and occupant.OpeningResult == nil then
				table.insert(result, {
					Slot = slotIndex,
					Entry = occupantEntry(occupant),
					Hat = occupant.Hat,
					Level = ExtrasConfig.levelOf(occupant.Seconds),
					Rarity = occupant.Definition.Rarity,
					Home = occupant.Walk == nil and occupant.Carrier == nil,
				})
			end
		end
		return result
	end)

	-- Hats: the owner puts one on (from their pile) or takes it off.
	local manageFunction = Instance.new("RemoteFunction")
	manageFunction.Name = "ManageBrainrot"
	manageFunction.Parent = Api.remotesFolder
	local lastManage: { [Player]: number } = {}
	manageFunction.OnServerInvoke = function(player: Player, action: any, slotIndex: any, argument: any): (boolean, string?, any)
		local now = os.clock()
		if action ~= "Info" and now - (lastManage[player] or 0) < 0.3 then
			return false, "Slow down!"
		end
		lastManage[player] = now
		local plot = plotByPlayer[player]
		local occupant = if plot and typeof(slotIndex) == "number" then plot.Occupants[slotIndex] else nil
		if plot == nil or occupant == nil or plot.Owner ~= player or BrainrotConfig.isLuckyBlock(occupant.Definition) then
			return false, "That brainrot isn't in your base."
		end
		if action == "Info" then
			return true, nil, {
				Level = ExtrasConfig.levelOf(occupant.Seconds),
				NextLevelIn = ExtrasConfig.secondsToNextLevel(occupant.Seconds),
				Hat = occupant.Hat,
				Income = occupantIncome(occupant),
				Hats = DataApi.GetHats:Invoke(player) or {},
			}
		end
		if occupant.Walk ~= nil or occupant.Carrier ~= nil or occupant.OpeningResult ~= nil then
			return false, "Wait until it's back on its pedestal."
		end
		if action == "PutHat" then
			local hat = if typeof(argument) == "string" then ExtrasConfig.HatByName[argument] else nil
			if hat == nil then
				return false, "You don't have that hat."
			end
			if occupant.Hat == hat.Name then
				return false, "It's already wearing one!"
			end
			if DataApi.TakeHat:Invoke(player, hat.Name) ~= true then
				return false, "You don't have that hat."
			end
			returnHat(occupant, player)
			occupant.Hat = hat.Name
			refreshOccupantInfo(occupant)
			saveBrainrots(plot)
			playSound(player, "Purchase")
			return true, string.format("%s is wearing the %s: +%d%% income!", occupant.Definition.DisplayName, hat.DisplayName, math.floor(hat.Bonus * 100 + 0.5))
		elseif action == "RemoveHat" then
			if occupant.Hat == nil then
				return false, "It isn't wearing a hat."
			end
			returnHat(occupant, player)
			refreshOccupantInfo(occupant)
			saveBrainrots(plot)
			return true, "Hat taken off."
		end
		return false, nil
	end
	Players.PlayerRemoving:Connect(function(player: Player)
		lastManage[player] = nil
	end)

	createApiFunction("GetIncome", function(playerArg: any): number
		local player = asPlayer(playerArg)
		return if player then tonumber(player:GetAttribute("IncomePerSecond")) or 0 else 0
	end)

	DataApi.ProgressChanged.Event:Connect(function(playerArg: any, key: any)
		local player = asPlayer(playerArg)
		if player == nil then
			return
		end
		if key == "Pending" then
			placePending(player)
		elseif key == "Skins" then
			local plot = plotByPlayer[player]
			if plot then
				applySkin(plot, equippedSkin(player))
			end
		end
	end)
end

--------------------------------------------------------------------------------
-- Friends, Premium and the group (income boosts)
--------------------------------------------------------------------------------

local updateSocial: (player: Player) -> ()
local onChatted: (player: Player, message: string) -> ()
local startEvent: (event: GameEvent) -> ()

updateSocial = function(player: Player)
	local friends = friendsOf[player] or {}
	friendsOf[player] = friends
	for _, other in Players:GetPlayers() do
		if other ~= player and friends[other.UserId] == nil then
			local ok, isFriend = pcall(function(): boolean
				return player:IsFriendsWithAsync(other.UserId)
			end)
			if ok then
				friends[other.UserId] = isFriend == true
				local theirs = friendsOf[other]
				if theirs then
					theirs[player.UserId] = isFriend == true
				end
				if isFriend == true and player.Parent == Players then
					notify(player, string.format("%s is your friend: +%d%% income for you both!", other.DisplayName, math.floor(FeatureConfig.FriendBoost * 100)), "Success")
					notify(other, string.format("%s is your friend: +%d%% income for you both!", player.DisplayName, math.floor(FeatureConfig.FriendBoost * 100)), "Success")
				end
			end
		end
	end
	if FeatureConfig.GroupId ~= 0 and inGroup[player] == nil then
		local ok, member = pcall(function(): boolean
			return player:IsInGroupAsync(FeatureConfig.GroupId)
		end)
		inGroup[player] = ok and member == true
	end
end

--------------------------------------------------------------------------------
-- Admin event commands (chat):
--   /events          list the events and these commands
--   /event <name>    start an event now, e.g. /event gold rush or /event lava
--   /abuse           start ADMIN ABUSE
--   /endevent        end the current event now
-- Starting an event ends the one running first. Only admins can use them:
-- FeatureConfig.AdminUserIds, the place's owner, and anyone in Studio.
-- They reach the server three ways (the new chat's TextChatCommands, the
-- client passing those on, and Player.Chatted); each command runs once.
--------------------------------------------------------------------------------

do
	local function isAdmin(player: Player): boolean
		if RunService:IsStudio() or table.find(FeatureConfig.AdminUserIds, player.UserId) ~= nil then
			return true
		end
		return game.CreatorType == Enum.CreatorType.User and game.CreatorId == player.UserId
	end

	startEvent = function(event: GameEvent)
		xpcall(runEvent, function(err: any)
			activeEvent = nil
			clearCoins()
			warn(string.format("%s Event failed: %s", LOG_PREFIX, tostring(err)))
		end, event)
	end

	local allEvents: { GameEvent } = table.clone(GameConfig.Events)
	table.insert(allEvents, GameConfig.AdminAbuseEvent)

	-- "Gold Rush" -> "goldrush"
	local function squash(text: string): string
		return (string.gsub(string.lower(text), "[^%w]", ""))
	end

	-- Exact name first, then the start of a name, then anywhere in one.
	local function findEvent(query: string): GameEvent?
		local key = squash(query)
		if key == "" then
			return nil
		end
		for pass = 1, 3 do
			for _, event in allEvents do
				local name = squash(event.Name)
				if
					(pass == 1 and name == key)
					or (pass == 2 and string.sub(name, 1, #key) == key)
					or (pass == 3 and string.find(name, key, 1, true) ~= nil)
				then
					return event
				end
			end
		end
		return nil
	end

	-- Ends the running event and waits for it to clean up. False if it didn't.
	local function endCurrentEvent(): boolean
		if activeEvent == nil then
			return true
		end
		ReplicatedStorage:SetAttribute("EventEndsAt", Workspace:GetServerTimeNow())
		local giveUpAt = Workspace:GetServerTimeNow() + 5
		while activeEvent ~= nil and Workspace:GetServerTimeNow() < giveUpAt do
			task.wait(0.1)
		end
		return activeEvent == nil
	end

	local function startByCommand(player: Player, event: GameEvent)
		if not endCurrentEvent() then
			notify(player, "The current event didn't end. Try again in a moment.", "Warning")
			return
		end
		notify(player, "Starting " .. event.Name .. "!", "Success")
		task.spawn(startEvent, event)
	end

	local function listEvents(player: Player)
		local names = {}
		for _, event in allEvents do
			table.insert(names, event.Name)
		end
		notify(player, "Events: " .. table.concat(names, ", "), "Info")
		notify(player, "Chat /event <name> to start one, /abuse for ADMIN ABUSE, /endevent to stop it.", "Info")
	end

	-- The same command can arrive more than once (see above).
	local lastCommand: { [Player]: { text: string, at: number } } = setmetatable({}, { __mode = "k" }) :: any

	onChatted = function(player: Player, message: string)
		local word, rest = string.match(message, "^%s*/(%S+)%s*(.-)%s*$")
		if word == nil or rest == nil then
			return
		end
		local command = string.lower(word)
		if command ~= "events" and command ~= "event" and command ~= "abuse" and command ~= "endevent" then
			return
		end
		local now = Workspace:GetServerTimeNow()
		local last = lastCommand[player]
		if last and last.text == message and now - last.at < 2 then
			return
		end
		lastCommand[player] = { text = message, at = now }
		print(string.format("%s %s used %s", LOG_PREFIX, player.Name, message))
		if not isAdmin(player) then
			notify(player, "Only admins can use /" .. command .. ".", "Warning")
			print(string.format("%s To let %s use commands, add %d to FeatureConfig.AdminUserIds.", LOG_PREFIX, player.Name, player.UserId))
			return
		end

		if command == "events" then
			listEvents(player)
		elseif command == "abuse" then
			startByCommand(player, GameConfig.AdminAbuseEvent)
		elseif command == "endevent" then
			local current = activeEvent
			if current == nil then
				notify(player, "No event is running.", "Warning")
			elseif endCurrentEvent() then
				notify(player, "Ended " .. current.Name .. ".", "Success")
			end
		elseif rest == "" then
			notify(player, "Say which event, like /event gold rush. Chat /events to see them all.", "Warning")
		else
			local event = findEvent(rest)
			if event then
				startByCommand(player, event)
			else
				notify(player, string.format('No event called "%s". Chat /events to see them all.', rest), "Warning")
			end
		end
	end

	-- Register the commands with the new chat, so they don't show up in chat.
	-- Always: ChatVersion is deprecated and can still say LegacyChatService
	-- while the new chat runs, and Player.Chatted doesn't fire there.
	local okChat, textChatService = pcall(function(): TextChatService
		return game:GetService("TextChatService")
	end)
	if okChat and textChatService then
		for _, alias in { "/events", "/event", "/abuse", "/endevent" } do
			local chatCommand = Instance.new("TextChatCommand")
			chatCommand.Name = "BrainrotEvent" .. string.sub(alias, 2)
			chatCommand.PrimaryAlias = alias
			chatCommand.AutocompleteVisible = false
			chatCommand.Triggered:Connect(function(source: TextSource, text: string)
				local player = Players:GetPlayerByUserId(source.UserId)
				if player then
					onChatted(player, text)
				end
			end)
			chatCommand.Parent = textChatService
		end
	end
	Api.chatCommandEvent.OnServerEvent:Connect(function(player: Player, text: any)
		if typeof(text) == "string" and #text <= 200 then
			onChatted(player, text)
		end
	end)
end

--------------------------------------------------------------------------------
-- Purchase announcements
--------------------------------------------------------------------------------

DataApi.EMPLaserOverriderPurchased.Event:Connect(function(player: any, durationSeconds: any)
	if typeof(player) == "Instance" and player:IsA("Player") then
		notify(player, string.format("EMP active! Walk through laser doors for %d seconds.", tonumber(durationSeconds) or 0), "Success", "Purchase")
	end
end)

DataApi.ServerRarityBoostChanged.Event:Connect(function(multiplier: any, _endsAt: any, purchaser: any)
	local boost = tonumber(multiplier) or 1
	if boost <= 1 or typeof(purchaser) ~= "Instance" or not purchaser:IsA("Player") then
		return
	end
	notifyAll(
		string.format("%s activated a x%s Rarity Boost for the whole server!", purchaser.DisplayName, tostring(boost)),
		"Success",
		"Event"
	)
end)

--------------------------------------------------------------------------------
-- Player lifecycle
--------------------------------------------------------------------------------

local function onCharacterAdded(player: Player, character: Model)
	local rootPart = character:WaitForChild("HumanoidRootPart", 10)
	if rootPart and player.Character == character then
		task.defer(teleportToPlot, player)
	end
end

local function onPlayerAdded(player: Player)
	player:SetAttribute("Carrying", false)
	player.CharacterAdded:Connect(function(character: Model)
		onCharacterAdded(player, character)
	end)
	player.Chatted:Connect(function(message: string)
		onChatted(player, message)
	end)
	task.spawn(updateSocial, player)

	if player:GetAttribute("DataLoaded") == true then
		assignPlot(player)
		return
	end
	local connection: RBXScriptConnection? = nil
	connection = player:GetAttributeChangedSignal("DataLoaded"):Connect(function()
		if player:GetAttribute("DataLoaded") == true then
			if connection then
				connection:Disconnect()
			end
			assignPlot(player)
		end
	end)
end

local function onPlayerRemoving(player: Player)
	releasePlot(player)
	lastRebirthRequest[player] = nil
	friendsOf[player] = nil
	inGroup[player] = nil
end

--------------------------------------------------------------------------------
-- Startup
--------------------------------------------------------------------------------

do
	local ok, result, missing = pcall(prepareImportedModels)
	if not ok then
		warn(string.format("%s Couldn't set up the imported brainrot models: %s", LOG_PREFIX, tostring(result)))
	elseif result > 0 then
		print(string.format("%s Using %d imported brainrot models.", LOG_PREFIX, result))
		if typeof(missing) == "table" and #missing > 0 then
			local names = {}
			for _, brainrotId in missing do
				table.insert(names, string.format("%s (One/%s.glb)", BrainrotConfig.ById[brainrotId].DisplayName, brainrotId))
			end
			warn(
				string.format(
					"%s %d brainrots have no imported model, so they're built from blocks: %s. To add one, import BrainrotModels/Import/One/<Id>.glb (File > Import 3D) and play again.",
					LOG_PREFIX,
					#missing,
					table.concat(names, ", ")
				)
			)
		end
	else
		warn(
			string.format(
				"%s No imported brainrot models yet, so the ones made on Customuse and Higgsfield are built from rough blocks and look mushy. For the real models, import BrainrotModels/Import/BrainrotModels.glb (File > Import 3D), save and play again.",
				LOG_PREFIX
			)
		)
	end
	-- In Studio, the StudioNotice banner says how many brainrots made on
	-- Customuse or Higgsfield have no imported model (they look mushy).
	if RunService:IsStudio() then
		local notImported = 0
		for _, definition in BrainrotConfig.Brainrots do
			if definition.Kind == "Brainrot" and not definition.BlockBuilt and TemplateModels.get(definition.Id) == nil then
				notImported += 1
			end
		end
		ReplicatedStorage:SetAttribute("ModelsNotImported", notImported)
	end
end

do
	local plotModels = plotsFolder:GetChildren()
	table.sort(plotModels, function(a, b)
		local aNumber = tonumber(string.match(a.Name, "%d+")) or math.huge
		local bNumber = tonumber(string.match(b.Name, "%d+")) or math.huge
		return aNumber < bNumber
	end)
	for _, model in plotModels do
		local plot = loadPlot(model, #plots + 1)
		if plot then
			table.insert(plots, plot)
		end
	end
	if #plots == 0 then
		warn(string.format("%s No usable plots found in %s.", LOG_PREFIX, plotsFolder:GetFullName()))
	end
end

ReplicatedStorage:SetAttribute("EventEndsAt", 0)
ReplicatedStorage:SetAttribute("EventAdmin", false)
-- Every API function exists by now.
Api.gameplayApi.Parent = ServerStorage

Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(onPlayerRemoving)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

runLoop(Tuning.FAST_TICK_SECONDS, "Fast tick", fastTick)
runLoop(Tuning.FAST_TICK_SECONDS, "Cash Rain", collectCoins)
runLoop(Tuning.SLOW_TICK_SECONDS, "Slow tick", slowTick)

RunService.Heartbeat:Connect(function(dt: number)
	xpcall(stepWalkers, function(err: any)
		warn(string.format("%s Walking failed: %s", LOG_PREFIX, tostring(err)))
	end, dt)
end)

task.spawn(function()
	while true do
		task.wait(GameConfig.ConveyorSpawnIntervalSeconds)
		if conveyorItemCount < GameConfig.MaxConveyorBrainrots then
			xpcall(spawnConveyorBrainrot, function(err: any)
				warn(string.format("%s Conveyor spawn failed: %s", LOG_PREFIX, tostring(err)))
			end)
		end
	end
end)

task.spawn(function()
	while true do
		task.wait(rng:NextNumber(GameConfig.EventMinGapSeconds, GameConfig.EventMaxGapSeconds))
		local events = GameConfig.Events
		if #events > 0 and activeEvent == nil then
			local event = events[rng:NextInteger(1, #events)]
			if rng:NextNumber() < FeatureConfig.AdminAbuseChance then
				event = GameConfig.AdminAbuseEvent
			end
			startEvent(event)
		end
	end
end)

--!strict
-- Gameplay tuning shared by GameplayManager and the client HUD.

export type TagBoost = { Tag: string, Multiplier: number }

export type GameEvent = {
	Name: string,
	Mutation: string?,
	ChanceMultiplier: number?,
	MutationChance: number?,
	TagBoost: TagBoost?,
	Luck: number?,
	CashRain: boolean?,
	Sky: string?,
	Particles: string?,
	-- Admin Abuse: every conveyor brainrot gets a mutation, prices are
	-- multiplied by PriceMultiplier, and traits are TraitLuck times likelier.
	AllMutated: boolean?,
	PriceMultiplier: number?,
	TraitLuck: number?,
	AdminAbuse: boolean?,
}

local EVENTS: { GameEvent } = {
	table.freeze({ Name = "Gold Rush", Mutation = "Gold", ChanceMultiplier = 5, Sky = "Gold", Particles = "Sparkles" }),
	table.freeze({ Name = "Diamond Storm", Mutation = "Diamond", ChanceMultiplier = 6, Sky = "Diamond", Particles = "Crystals" }),
	table.freeze({ Name = "Rainbow Party", Mutation = "Rainbow", ChanceMultiplier = 10, Sky = "Rainbow", Particles = "Confetti" }),
	table.freeze({ Name = "Blood Moon", Mutation = "Bloodrot", MutationChance = 0.12, Sky = "Blood", Particles = "Embers" }),
	table.freeze({ Name = "Galaxy Night", Mutation = "Galaxy", MutationChance = 0.08, Sky = "Galaxy", Particles = "Stars" }),
	table.freeze({ Name = "Lava Rain", Mutation = "Lava", MutationChance = 0.1, Sky = "Lava", Particles = "Meteors" }),
	table.freeze({ Name = "Frost Storm", Mutation = "Frozen", MutationChance = 0.14, Sky = "Frost", Particles = "Snow" }),
	table.freeze({ Name = "Taco Tuesday", TagBoost = table.freeze({ Tag = "Taco", Multiplier = 8 }), Sky = "Taco", Particles = "Tacos" }),
	table.freeze({ Name = "Lucky Hour", Luck = 3, Sky = "Lucky", Particles = "Clovers" }),
	table.freeze({ Name = "Cash Rain", CashRain = true, Sky = "Cash", Particles = "Cash" }),
}

-- Replaces a normal event now and then (FeatureConfig.AdminAbuseChance), or
-- starts when an admin chats "/abuse" (or "/event admin").
local ADMIN_ABUSE: GameEvent = table.freeze({
	Name = "ADMIN ABUSE",
	Luck = 10,
	CashRain = true,
	AllMutated = true,
	PriceMultiplier = 0.5,
	TraitLuck = 5,
	AdminAbuse = true,
	Sky = "Admin",
	Particles = "Confetti",
})

local GameConfig = {
	-- Conveyor
	ConveyorSpawnIntervalSeconds = 2.5,
	ConveyorSpeedStudsPerSecond = 10,
	MaxConveyorBrainrots = 24,
	-- A bought brainrot walks to its buyer's base this fast (studs per second).
	-- Until it walks through the door, other players can buy it off its buyer.
	BrainrotWalkSpeed = 8,
	-- Long walks speed up so none takes longer than this.
	MaxWalkSeconds = 25,

	-- Interaction
	PromptDistance = 10,
	-- Extra studs the server allows on top of PromptDistance for lag.
	InteractionTolerance = 6,
	StealHoldSeconds = 1.2,

	-- Stealing
	DefaultWalkSpeed = 16,
	CarryWalkSpeed = 11,
	CarryTimeoutSeconds = 90,
	-- Extra studs per check a thief may move before the steal counts as a teleport.
	CarrySpeedToleranceStuds = 8,
	CatchDistance = 6,

	-- Guaranteed spawns: when a timer runs out, the next conveyor brainrot is
	-- of that rarity. Listed from rarest; a natural spawn also resets its timer.
	GuaranteedRarities = table.freeze({
		table.freeze({ Rarity = "Secret", IntervalSeconds = 45 * 60 }),
		table.freeze({ Rarity = "Brainrot God", IntervalSeconds = 20 * 60 }),
		table.freeze({ Rarity = "Mythic", IntervalSeconds = 10 * 60 }),
		table.freeze({ Rarity = "Legendary", IntervalSeconds = 4 * 60 }),
	}),

	-- Bases: 8 pedestals on each of 4 floors. A floor opens at this many rebirths.
	SlotsPerFloor = 8,
	FloorUnlockRebirths = table.freeze({ 0, 1, 2, 3 }),

	-- Base lock
	LockDurationSeconds = 60,

	-- Collect pads and offline cash: brainrots fill the pad in front of them
	-- with Cash; stepping on the pad collects it. While you're away they keep
	-- earning this fraction of their income, for up to OfflineMaxHours.
	OfflineIncomeFraction = 1,
	OfflineMaxHours = 8,
	OfflineMinSeconds = 60,

	-- Events: every few minutes one runs for a few minutes. Each can make a
	-- mutation more common (ChanceMultiplier) or give an event-only mutation a
	-- chance (MutationChance), boost brainrots with a tag (TagBoost), make rare
	-- brainrots more common (Luck), or rain Cash (CashRain). Sky and Particles
	-- choose what players see.
	EventMinGapSeconds = 5 * 60,
	EventMaxGapSeconds = 8 * 60,
	EventDurationSeconds = 3 * 60,
	Events = table.freeze(EVENTS),
	AdminAbuseEvent = ADMIN_ABUSE,
	-- Cash Rain: coins land around the map; each is worth this many seconds of
	-- the collector's income (at least CashRainMinCoin).
	CashRainCoinsPerWave = 12,
	CashRainWaveSeconds = 10,
	CashRainCoinIncomeSeconds = 20,
	CashRainMinCoin = 150,

	-- Day and night, and weather that changes every few minutes.
	DayLengthSeconds = 10 * 60,
	WeatherMinSeconds = 3 * 60,
	WeatherMaxSeconds = 5 * 60,
	Weather = table.freeze({
		table.freeze({ Name = "Clear", Weight = 5 }),
		table.freeze({ Name = "Rain", Weight = 2 }),
		table.freeze({ Name = "Snow", Weight = 1 }),
		table.freeze({ Name = "Thunderstorm", Weight = 1 }),
		table.freeze({ Name = "Fog", Weight = 1 }),
	}),

	-- Economy
	SellRefundFraction = 0.5,
	StarterBrainrotId = "NoobiniPizzanini",
	RebirthBaseCost = 100000,
	RebirthCostGrowth = 2.5,
	RebirthIncomeBonus = 0.5,
}

function GameConfig.getRebirthCost(rebirths: number): number
	return math.floor(GameConfig.RebirthBaseCost * GameConfig.RebirthCostGrowth ^ rebirths)
end

function GameConfig.getRebirthIncomeMultiplier(rebirths: number): number
	return 1 + GameConfig.RebirthIncomeBonus * rebirths
end

-- How many floors of a base are open at this many rebirths.
function GameConfig.getUnlockedFloors(rebirths: number): number
	local floors = 0
	for floor, needed in GameConfig.FloorUnlockRebirths do
		if rebirths >= needed then
			floors = floor
		end
	end
	return math.max(floors, 1)
end

return table.freeze(GameConfig)

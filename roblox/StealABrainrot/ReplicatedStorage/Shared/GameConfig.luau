--!strict
-- Gameplay tuning shared by GameplayManager and the client HUD.

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
		table.freeze({ Rarity = "Mythic", IntervalSeconds = 15 * 60 }),
		table.freeze({ Rarity = "Legendary", IntervalSeconds = 4 * 60 }),
	}),

	-- Base lock
	LockDurationSeconds = 60,

	-- Collect pads and offline cash: brainrots fill the pad in front of them
	-- with Cash; stepping on the pad collects it. While you're away they keep
	-- earning this fraction of their income, for up to OfflineMaxHours.
	OfflineIncomeFraction = 1,
	OfflineMaxHours = 8,
	OfflineMinSeconds = 60,

	-- Mutation events: every few minutes one mutation becomes far more common.
	EventMinGapSeconds = 7 * 60,
	EventMaxGapSeconds = 11 * 60,
	EventDurationSeconds = 3 * 60,
	Events = table.freeze({
		table.freeze({ Name = "Gold Rush", Mutation = "Gold", ChanceMultiplier = 5 }),
		table.freeze({ Name = "Diamond Storm", Mutation = "Diamond", ChanceMultiplier = 6 }),
		table.freeze({ Name = "Rainbow Party", Mutation = "Rainbow", ChanceMultiplier = 10 }),
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

return table.freeze(GameConfig)

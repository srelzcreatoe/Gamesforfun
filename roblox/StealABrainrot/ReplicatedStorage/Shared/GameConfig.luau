--!strict
-- Gameplay tuning shared by GameplayManager and the client HUD.

local GameConfig = {
	-- Conveyor
	ConveyorSpawnIntervalSeconds = 2.5,
	ConveyorSpeedStudsPerSecond = 10,
	MaxConveyorBrainrots = 24,
	WalkToBaseSeconds = 1.5,

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

	-- Base lock
	LockDurationSeconds = 60,

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

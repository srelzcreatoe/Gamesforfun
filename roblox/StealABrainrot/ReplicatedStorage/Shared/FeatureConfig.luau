--!strict
-- Tuning for the extra systems: index rewards, rebirth requirements, upgrades,
-- base skins, income boosts, the spin wheel, daily and playtime rewards,
-- codes, quests, badges, fusing, trading and Admin Abuse. Read by the server
-- scripts that run them and by the client menus that show them.

local BrainrotConfig = require(script.Parent:WaitForChild("BrainrotConfig"))
local NumberFormat = require(script.Parent:WaitForChild("NumberFormat"))

local rgb = Color3.fromRGB

-- What a reward gives. Cash rewards scale with the player's income so they
-- stay worth having: `Minutes` of income, at least `Min`.
export type Reward = {
	Kind: "Cash" | "Spins" | "Block" | "Brainrot" | "Boost" | "Hat",
	Minutes: number?,
	Min: number?,
	Count: number?,
	-- A lucky block or brainrot Id (Block, Brainrot).
	Id: string?,
	-- Cash Boost length (Boost).
	Seconds: number?,
	-- A hat's name (ExtrasConfig.Hats), or "Random".
	Hat: string?,
}

export type SpinPrize = {
	Name: string,
	Reward: Reward,
	Weight: number,
	Color: Color3,
}

export type QuestInfo = {
	Id: string,
	-- What counts, as reported by the Activity event (see GameplayManager).
	Activity: string,
	Target: number,
	Text: string,
	Reward: Reward,
}

export type BaseSkin = {
	Name: string,
	-- Cash price, or nil when it's sold for Robux (ProductKey).
	Price: number?,
	ProductKey: string?,
	Wall: Color3,
	WallMaterial: Enum.Material,
	Floor: Color3,
	FloorMaterial: Enum.Material,
	Trim: Color3,
	-- Animated on the client: "Rainbow" cycles colours, "Galaxy" twinkles.
	Effect: string?,
}

local function cash(minutes: number, min: number): Reward
	local reward: Reward = { Kind = "Cash", Minutes = minutes, Min = min }
	return table.freeze(reward)
end
local function spins(count: number): Reward
	local reward: Reward = { Kind = "Spins", Count = count }
	return table.freeze(reward)
end
local function block(id: string): Reward
	local reward: Reward = { Kind = "Block", Id = id }
	return table.freeze(reward)
end
local function brainrot(id: string): Reward
	local reward: Reward = { Kind = "Brainrot", Id = id }
	return table.freeze(reward)
end
local function boost(seconds: number): Reward
	local reward: Reward = { Kind = "Boost", Seconds = seconds }
	return table.freeze(reward)
end

local FeatureConfig = {}

--------------------------------------------------------------------------------
-- Index: finding every brainrot of a rarity (or every brainrot in a
-- mutation) pays out once and adds a permanent income bonus.
--------------------------------------------------------------------------------

FeatureConfig.IndexRewards = table.freeze({
	["Common"] = table.freeze({ Bonus = 0.05, Cash = 5000 }),
	["Rare"] = table.freeze({ Bonus = 0.05, Cash = 25000 }),
	["Epic"] = table.freeze({ Bonus = 0.1, Cash = 150000 }),
	["Legendary"] = table.freeze({ Bonus = 0.1, Cash = 1000000 }),
	["Mythic"] = table.freeze({ Bonus = 0.15, Cash = 5000000 }),
	["Brainrot God"] = table.freeze({ Bonus = 0.2, Cash = 25000000 }),
	["Secret"] = table.freeze({ Bonus = 0.25, Cash = 100000000 }),
})
-- Index pages for mutations: every brainrot in that mutation.
FeatureConfig.MutationIndex = table.freeze({ "Gold", "Diamond", "Rainbow" })
FeatureConfig.MutationIndexRewards = table.freeze({
	Gold = table.freeze({ Bonus = 0.1, Cash = 2000000 }),
	Diamond = table.freeze({ Bonus = 0.15, Cash = 10000000 }),
	Rainbow = table.freeze({ Bonus = 0.3, Cash = 50000000 }),
})

--------------------------------------------------------------------------------
-- Rebirths: besides the Cash, each rebirth needs these brainrots in your
-- base (any mutation or trait). You keep them. Past the list, the last
-- entry repeats.
--------------------------------------------------------------------------------

FeatureConfig.RebirthRequirements = table.freeze({
	table.freeze({ "TungTungTungSahur", "TrippiTroppi" }),
	table.freeze({ "BrrBrrPatapim", "CappuccinoAssassino" }),
	table.freeze({ "ChimpanziniBananini", "BallerinaCappuccina" }),
	table.freeze({ "Cioccolatone", "PeperoncinoFigo" }),
	table.freeze({ "BombardiroCrocodilo", "TralaleroTralala" }),
	table.freeze({ "RattoSchiaffone", "CoccodrilloTacorito" }),
	table.freeze({ "GattoPizzanave" }),
	table.freeze({ "PiccioneMacchina", "TacoplanoBombardino" }),
	table.freeze({ "SpaghettiTualetti" }),
	table.freeze({ "TacoritaBicicleta", "SessantaSette" }),
})

function FeatureConfig.getRebirthRequirement(rebirths: number): { string }
	local list = FeatureConfig.RebirthRequirements
	return list[math.clamp(rebirths + 1, 1, #list)]
end

--------------------------------------------------------------------------------
-- Upgrades
--------------------------------------------------------------------------------

-- Walk speed: each level adds SpeedPerLevel (and a little carry speed).
FeatureConfig.SpeedPerLevel = 2
FeatureConfig.CarrySpeedPerLevel = 0.5
FeatureConfig.SpeedCosts = table.freeze({ 5000, 20000, 80000, 300000, 1000000, 3500000, 12000000, 40000000, 130000000, 400000000 })

-- Pedestals: each level above 1 adds PedestalBonus to what the brainrot on it earns.
FeatureConfig.PedestalBonus = 0.25
FeatureConfig.PedestalCosts = table.freeze({ 5000, 60000, 750000, 9000000 })
FeatureConfig.PedestalColors = table.freeze({
	rgb(90, 230, 110),
	rgb(70, 160, 255),
	rgb(190, 90, 255),
	rgb(255, 200, 40),
})

function FeatureConfig.maxPedestalLevel(): number
	return #FeatureConfig.PedestalCosts + 1
end

-- Base skins recolour the walls, floors and neon trim of your base.
FeatureConfig.BaseSkins = table.freeze({
	table.freeze({
		Name = "Classic",
		Price = 0,
		Wall = rgb(92, 97, 112),
		WallMaterial = Enum.Material.Plastic,
		Floor = rgb(184, 186, 194),
		FloorMaterial = Enum.Material.Plastic,
		Trim = rgb(255, 255, 255),
		Effect = "Classic",
	}),
	table.freeze({
		Name = "Candy",
		Price = 250000,
		Wall = rgb(255, 170, 210),
		WallMaterial = Enum.Material.SmoothPlastic,
		Floor = rgb(255, 235, 245),
		FloorMaterial = Enum.Material.SmoothPlastic,
		Trim = rgb(120, 230, 255),
	}),
	table.freeze({
		Name = "Jungle",
		Price = 1000000,
		Wall = rgb(90, 130, 60),
		WallMaterial = Enum.Material.Grass,
		Floor = rgb(120, 85, 50),
		FloorMaterial = Enum.Material.WoodPlanks,
		Trim = rgb(180, 255, 80),
	}),
	table.freeze({
		Name = "Ice",
		Price = 2500000,
		Wall = rgb(170, 220, 255),
		WallMaterial = Enum.Material.Ice,
		Floor = rgb(225, 245, 255),
		FloorMaterial = Enum.Material.Glacier,
		Trim = rgb(90, 200, 255),
	}),
	table.freeze({
		Name = "Lava",
		Price = 10000000,
		Wall = rgb(60, 40, 40),
		WallMaterial = Enum.Material.Basalt,
		Floor = rgb(90, 50, 40),
		FloorMaterial = Enum.Material.CrackedLava,
		Trim = rgb(255, 110, 20),
	}),
	table.freeze({
		Name = "Gold",
		Price = 50000000,
		Wall = rgb(230, 180, 50),
		WallMaterial = Enum.Material.Metal,
		Floor = rgb(255, 225, 120),
		FloorMaterial = Enum.Material.DiamondPlate,
		Trim = rgb(255, 245, 170),
	}),
	table.freeze({
		Name = "Galaxy",
		ProductKey = "GalaxySkin",
		Wall = rgb(40, 20, 80),
		WallMaterial = Enum.Material.Glass,
		Floor = rgb(25, 15, 55),
		FloorMaterial = Enum.Material.Glass,
		Trim = rgb(190, 110, 255),
		Effect = "Galaxy",
	}),
	table.freeze({
		Name = "Rainbow",
		ProductKey = "RainbowSkin",
		Wall = rgb(250, 250, 250),
		WallMaterial = Enum.Material.SmoothPlastic,
		Floor = rgb(245, 245, 245),
		FloorMaterial = Enum.Material.SmoothPlastic,
		Trim = rgb(255, 80, 80),
		Effect = "Rainbow",
	}),
} :: { BaseSkin })

local skinByName: { [string]: BaseSkin } = {}
for _, skin in FeatureConfig.BaseSkins do
	skinByName[skin.Name] = skin
end
FeatureConfig.SkinByName = table.freeze(skinByName)

--------------------------------------------------------------------------------
-- Income boosts
--------------------------------------------------------------------------------

-- +10% for each friend in the server, up to +50%.
FeatureConfig.FriendBoost = 0.1
FeatureConfig.MaxFriendBoost = 0.5
-- Roblox Premium members earn more and get an extra daily spin.
FeatureConfig.PremiumBoost = 0.1
FeatureConfig.PremiumDailySpins = 1
-- The VIP game pass: more income and another free spin every day.
FeatureConfig.VipBoost = 0.15
FeatureConfig.VipDailySpins = 1
-- Your Roblox group: members earn more and can open the Group Chest once.
-- 0 turns the group perks off; put your group's ID here.
FeatureConfig.GroupId = 0
FeatureConfig.GroupBoost = 0.1
FeatureConfig.GroupChest = block("MythicLuckyBlock")

-- The base lock lasts this much longer with the Long Lock game pass.
FeatureConfig.LongLockMultiplier = 2

--------------------------------------------------------------------------------
-- Spin wheel: one free spin a day, more from spin packs, playtime, quests and
-- daily rewards.
--------------------------------------------------------------------------------

FeatureConfig.SpinPrizes = table.freeze({
	table.freeze({ Name = "Cash", Reward = cash(5, 2500), Weight = 30, Color = rgb(60, 200, 90) }),
	table.freeze({ Name = "Lucky Block", Reward = block("LuckyBlock"), Weight = 18, Color = rgb(255, 200, 40) }),
	table.freeze({ Name = "2x Cash 10m", Reward = boost(10 * 60), Weight = 12, Color = rgb(40, 170, 255) }),
	table.freeze({ Name = "Big Cash", Reward = cash(20, 10000), Weight = 15, Color = rgb(30, 150, 70) }),
	table.freeze({ Name = "+1 Spin", Reward = spins(1), Weight = 10, Color = rgb(255, 130, 40) }),
	table.freeze({ Name = "Mythic Block", Reward = block("MythicLuckyBlock"), Weight = 8, Color = rgb(255, 60, 90) }),
	table.freeze({ Name = "Legendary!", Reward = brainrot("ChimpanziniBananini"), Weight = 5, Color = rgb(190, 90, 255) }),
	table.freeze({ Name = "GOD BLOCK", Reward = block("GodLuckyBlock"), Weight = 2, Color = rgb(255, 110, 255) }),
} :: { SpinPrize })

--------------------------------------------------------------------------------
-- Daily login streak (7 days, then it starts over). Miss a day and the
-- streak resets.
--------------------------------------------------------------------------------

FeatureConfig.DailyRewards = table.freeze({
	cash(10, 1000),
	spins(1),
	block("LuckyBlock"),
	cash(30, 5000),
	spins(2),
	block("MythicLuckyBlock"),
	block("GodLuckyBlock"),
} :: { Reward })

--------------------------------------------------------------------------------
-- Playtime gifts: minutes played today (UTC) to unlock each one.
--------------------------------------------------------------------------------

FeatureConfig.PlaytimeRewards = table.freeze({
	table.freeze({ Minutes = 3, Reward = cash(3, 500) }),
	table.freeze({ Minutes = 8, Reward = spins(1) }),
	table.freeze({ Minutes = 15, Reward = block("LuckyBlock") }),
	table.freeze({ Minutes = 25, Reward = cash(15, 5000) }),
	table.freeze({ Minutes = 40, Reward = boost(15 * 60) }),
	table.freeze({ Minutes = 60, Reward = block("MythicLuckyBlock") }),
})

--------------------------------------------------------------------------------
-- Codes (case doesn't matter). Each works once per player.
--------------------------------------------------------------------------------

FeatureConfig.Codes = table.freeze({
	BRAINROT = cash(5, 5000),
	LUCKY = block("LuckyBlock"),
	SPIN = spins(2),
	TUNGTUNG = brainrot("TungTungTungSahur"),
	RELEASE = boost(15 * 60),
} :: { [string]: Reward })

--------------------------------------------------------------------------------
-- Daily quests: three a day from this pool, plus a bonus for finishing all.
--------------------------------------------------------------------------------

FeatureConfig.QuestsPerDay = 3
FeatureConfig.QuestBonus = block("MythicLuckyBlock")
FeatureConfig.Quests = table.freeze({
	table.freeze({ Id = "Buy5", Activity = "Buy", Target = 5, Text = "Buy 5 brainrots", Reward = cash(10, 2000) }),
	table.freeze({ Id = "BuyEpic", Activity = "BuyEpic", Target = 1, Text = "Buy an Epic or better", Reward = spins(1) }),
	table.freeze({ Id = "Steal2", Activity = "Steal", Target = 2, Text = "Steal 2 brainrots", Reward = block("LuckyBlock") }),
	table.freeze({ Id = "Collect15", Activity = "Collect", Target = 15, Text = "Collect cash 15 times", Reward = cash(8, 1500) }),
	table.freeze({ Id = "Open1", Activity = "OpenBlock", Target = 1, Text = "Open a Lucky Block", Reward = cash(15, 3000) }),
	table.freeze({ Id = "Slap5", Activity = "Slap", Target = 5, Text = "Slap 5 players", Reward = cash(5, 1000) }),
	table.freeze({ Id = "Lock3", Activity = "Lock", Target = 3, Text = "Lock your base 3 times", Reward = cash(5, 1000) }),
	table.freeze({ Id = "Fuse1", Activity = "Fuse", Target = 1, Text = "Fuse brainrots once", Reward = block("LuckyBlock") }),
	table.freeze({ Id = "Spin1", Activity = "Spin", Target = 1, Text = "Spin the wheel", Reward = cash(5, 1000) }),
	table.freeze({ Id = "Upgrade1", Activity = "Upgrade", Target = 1, Text = "Upgrade a pedestal", Reward = spins(1) }),
	table.freeze({ Id = "Trade1", Activity = "Trade", Target = 1, Text = "Finish a trade", Reward = block("LuckyBlock") }),
	table.freeze({ Id = "Catch1", Activity = "Catch", Target = 1, Text = "Stop a thief", Reward = cash(10, 2000) }),
} :: { QuestInfo })

local questById: { [string]: QuestInfo } = {}
for _, quest in FeatureConfig.Quests do
	questById[quest.Id] = quest
end
FeatureConfig.QuestById = table.freeze(questById)

--------------------------------------------------------------------------------
-- Badges: create them in the Creator Dashboard and paste their IDs here
-- (0 = not created yet, skipped).
--------------------------------------------------------------------------------

FeatureConfig.Badges = table.freeze({
	Welcome = 0,
	FirstSteal = 0,
	FirstRebirth = 0,
	Rebirth5 = 0,
	LuckyOpener = 0,
	FirstFuse = 0,
	FirstTrade = 0,
	SecretOwner = 0,
	Millionaire = 0,
	IndexMaster = 0,
	WeekStreak = 0,
})

--------------------------------------------------------------------------------
-- Tutorial: finishing it pays this much.
--------------------------------------------------------------------------------

FeatureConfig.TutorialReward = 1000
FeatureConfig.TutorialSteps = table.freeze({
	"Buy a brainrot from the red carpet!",
	"Step on the green pad in front of it to collect Cash!",
	"Press the red button in your base to lock your door!",
})

--------------------------------------------------------------------------------
-- Fusing and trading
--------------------------------------------------------------------------------

-- Three brainrots of one rarity become one of the next rarity up. If all three
-- share a mutation the result keeps it.
FeatureConfig.FuseCount = 3
FeatureConfig.FuseSeconds = 3
-- Most brainrots each side can offer in one trade.
FeatureConfig.MaxTradeItems = 4
FeatureConfig.TradeCountdownSeconds = 5
FeatureConfig.TradeRequestSeconds = 20

--------------------------------------------------------------------------------
-- Admin Abuse: sometimes an event is replaced by this. Players listed in
-- AdminUserIds can start it by chatting "/abuse", and any event with
-- "/event <name>" (see GameplayManager's admin event commands).
--------------------------------------------------------------------------------

FeatureConfig.AdminAbuseChance = 0.1
FeatureConfig.AdminUserIds = table.freeze({} :: { number })

-- Settings players can change (saved).
FeatureConfig.DefaultSettings = table.freeze({ Music = 0.6, Sfx = 1, LowGraphics = false, Station = "Mix" })

-- Cash from a Cash reward for a player earning `income` per second.
function FeatureConfig.cashAmount(reward: Reward, income: number): number
	return math.max(reward.Min or 0, math.floor(income * 60 * (reward.Minutes or 0)))
end

-- Short text for a reward: "$12.5K", "+2 Spins", "Lucky Block", ...
-- Without `income`, Cash rewards say how many minutes of income they are.
function FeatureConfig.describeReward(reward: Reward, income: number?): string
	if reward.Kind == "Cash" then
		if income then
			return NumberFormat.cash(FeatureConfig.cashAmount(reward, income))
		end
		return string.format("%d min of Cash", reward.Minutes or 0)
	elseif reward.Kind == "Spins" then
		local count = reward.Count or 1
		return string.format("+%d Spin%s", count, if count == 1 then "" else "s")
	elseif reward.Kind == "Boost" then
		return string.format("2x Cash %d min", (reward.Seconds or 0) // 60)
	elseif reward.Kind == "Hat" then
		local name = reward.Hat or "Random"
		if name == "Random" then
			return "Random Hat"
		end
		-- "TopHat" -> "Top Hat" (ExtrasConfig has the display names; it needs this module).
		return (string.gsub(name, "(%l)(%u)", "%1 %2"))
	end
	local definition = if reward.Id then BrainrotConfig.ById[reward.Id] else nil
	return if definition then definition.DisplayName else "???"
end

return table.freeze(FeatureConfig)

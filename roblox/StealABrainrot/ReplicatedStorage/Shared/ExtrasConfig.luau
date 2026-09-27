--!strict
-- Settings for the features the original game doesn't have: brainrot levels
-- and hats, guard brainrots, pets, revenge, bounties, crews, the season pass,
-- the weekly limited shop, boss raids and bank heists. Shared by the server
-- scripts and the client UI.

local FeatureConfig = require(script.Parent:WaitForChild("FeatureConfig"))

type Reward = FeatureConfig.Reward

local rgb = Color3.fromRGB

local ExtrasConfig = {}

--------------------------------------------------------------------------------
-- Brainrot levels: a brainrot on its pedestal (or earning offline) levels up
-- over time, each level adding income. A stolen brainrot starts over at 1.
--------------------------------------------------------------------------------

-- Minutes on a pedestal to reach each level (level 1 is where it starts).
ExtrasConfig.LevelMinutes = table.freeze({ 0, 5, 15, 30, 60, 100, 150, 210, 280, 360 })
ExtrasConfig.MaxLevel = #ExtrasConfig.LevelMinutes
ExtrasConfig.IncomePerLevel = 0.1

function ExtrasConfig.levelOf(seconds: number): number
	local minutes = seconds / 60
	local level = 1
	for index, needed in ExtrasConfig.LevelMinutes do
		if minutes >= needed then
			level = index
		end
	end
	return level
end

function ExtrasConfig.levelMultiplier(level: number): number
	return 1 + ExtrasConfig.IncomePerLevel * (math.clamp(level, 1, ExtrasConfig.MaxLevel) - 1)
end

-- Seconds still needed for the next level (nil at the top level).
function ExtrasConfig.secondsToNextLevel(seconds: number): number?
	local level = ExtrasConfig.levelOf(seconds)
	local nextMinutes = ExtrasConfig.LevelMinutes[level + 1]
	if nextMinutes == nil then
		return nil
	end
	return math.max(0, nextMinutes * 60 - seconds)
end

--------------------------------------------------------------------------------
-- Hats: worn by a brainrot for extra income. Won from the season pass, boss
-- raids and Hat Crates. A hat goes back to its owner when the brainrot is
-- sold, stolen, traded or fused.
--------------------------------------------------------------------------------

export type Hat = {
	Name: string,
	DisplayName: string,
	-- Extra income for the brainrot wearing it.
	Bonus: number,
	-- How likely a random hat (crate, boss drop) is this one.
	Weight: number,
	Color: Color3,
	Icon: string,
}

ExtrasConfig.Hats = table.freeze({
	table.freeze({ Name = "PartyHat", DisplayName = "Party Hat", Bonus = 0.05, Weight = 30, Color = rgb(255, 90, 170), Icon = "🥳" }),
	table.freeze({ Name = "ChefHat", DisplayName = "Chef Hat", Bonus = 0.07, Weight = 24, Color = rgb(245, 245, 245), Icon = "🍝" }),
	table.freeze({ Name = "CowboyHat", DisplayName = "Cowboy Hat", Bonus = 0.1, Weight = 18, Color = rgb(170, 110, 60), Icon = "🤠" }),
	table.freeze({ Name = "TopHat", DisplayName = "Top Hat", Bonus = 0.12, Weight = 12, Color = rgb(35, 35, 40), Icon = "🎩" }),
	table.freeze({ Name = "VikingHelmet", DisplayName = "Viking Helmet", Bonus = 0.15, Weight = 8, Color = rgb(190, 195, 205), Icon = "⚔️" }),
	table.freeze({ Name = "WizardHat", DisplayName = "Wizard Hat", Bonus = 0.18, Weight = 5, Color = rgb(90, 60, 200), Icon = "🧙" }),
	table.freeze({ Name = "Halo", DisplayName = "Halo", Bonus = 0.22, Weight = 2.5, Color = rgb(255, 235, 120), Icon = "😇" }),
	table.freeze({ Name = "Crown", DisplayName = "Crown", Bonus = 0.25, Weight = 1, Color = rgb(255, 205, 50), Icon = "👑" }),
} :: { Hat })

local hatByName: { [string]: Hat } = {}
for _, hat in ExtrasConfig.Hats do
	hatByName[hat.Name] = hat
end
ExtrasConfig.HatByName = table.freeze(hatByName)

-- A random hat by weight; `roll` is a number from 0 to 1.
function ExtrasConfig.randomHat(roll: number): Hat
	local total = 0
	for _, hat in ExtrasConfig.Hats do
		total += hat.Weight
	end
	local left = roll * total
	for _, hat in ExtrasConfig.Hats do
		left -= hat.Weight
		if left <= 0 then
			return hat
		end
	end
	return ExtrasConfig.Hats[1]
end

--------------------------------------------------------------------------------
-- Guard brainrots: one brainrot per base stands guard in front of its door,
-- pacing across it. When someone who isn't the owner (or in their crew) comes
-- close, it shouts ("!"), then charges and knocks them back; a thief it
-- catches drops what they carry. Then it rests a while.
--
-- Balanced so stealing still works: it's slower than a walking player (only
-- a thief carrying a brainrot is slower than it), gives a moment's warning,
-- never chases far from its post, ignores cloaked players, rests after every
-- hit, and a slap dazes it for a few seconds.
--------------------------------------------------------------------------------

-- How far in front of the door it stands, and how far either side it paces.
ExtrasConfig.GuardPostDistance = 7
ExtrasConfig.GuardPatrolWidth = 5
-- It notices intruders this close to its post, and never chases further.
ExtrasConfig.GuardRadius = 14
ExtrasConfig.GuardLeash = 20
-- The "!" before it charges.
ExtrasConfig.GuardWindupSeconds = 0.8
-- (Players walk at 16, or 11 carrying a brainrot.)
ExtrasConfig.GuardChaseSpeed = 13
ExtrasConfig.GuardPatrolSpeed = 4
ExtrasConfig.GuardHitDistance = 4
ExtrasConfig.GuardKnockback = 60
ExtrasConfig.GuardStunSeconds = 1
-- A slap glove dazes it this long.
ExtrasConfig.GuardDazeSeconds = 6
-- Seconds between hits, by the guard's rarity. The Super Guard pass halves it.
ExtrasConfig.GuardCooldowns = table.freeze({
	Common = 24,
	Rare = 22,
	Epic = 20,
	Legendary = 18,
	Mythic = 16,
	["Brainrot God"] = 14,
	Secret = 12,
	OG = 10,
} :: { [string]: number })
ExtrasConfig.SuperGuardCooldownMultiplier = 0.5

--------------------------------------------------------------------------------
-- Pets: brainrots from your base follow you around, each making you faster:
-- the fastest one in full, the others a quarter each, up to PetSpeedCap.
-- Everyone starts with one pet slot; more cost Cash (the Pets button), and
-- each costs a lot more than the last.
--------------------------------------------------------------------------------

ExtrasConfig.PetSpeedBonus = table.freeze({
	Common = 1,
	Rare = 1.5,
	Epic = 2,
	Legendary = 2.5,
	Mythic = 3,
	["Brainrot God"] = 3.5,
	Secret = 4,
	OG = 5,
} :: { [string]: number })
ExtrasConfig.PetSpeedCap = 8
ExtrasConfig.PetExtraSpeedShare = 0.25
-- The price of each pet slot (the first is free).
ExtrasConfig.PetSlotPrices = table.freeze({ 0, 1_000_000, 25_000_000, 500_000_000, 10_000_000_000, 100_000_000_000 } :: { number })
ExtrasConfig.MaxPetSlots = #ExtrasConfig.PetSlotPrices

-- Walk speed from a set of pets (their rarities).
function ExtrasConfig.petSpeed(rarities: { string }): number
	local bonuses: { number } = {}
	for _, rarity in rarities do
		table.insert(bonuses, ExtrasConfig.PetSpeedBonus[rarity] or 1)
	end
	table.sort(bonuses, function(a, b)
		return a > b
	end)
	local total = 0
	for index, bonus in bonuses do
		total += if index == 1 then bonus else bonus * ExtrasConfig.PetExtraSpeedShare
	end
	return math.min(total, ExtrasConfig.PetSpeedCap)
end

-- Height of a pet in studs (its model is shrunk to this).
ExtrasConfig.PetHeight = 2.8

--------------------------------------------------------------------------------
-- Revenge: someone steals from you, you get a minute to get them back.
--------------------------------------------------------------------------------

ExtrasConfig.RevengeSeconds = 60
ExtrasConfig.RevengeSpeedBonus = 6
-- Stealing from your thief during revenge pays this many seconds of your income.
ExtrasConfig.RevengeIncomeSeconds = 120
ExtrasConfig.RevengeMinCash = 500

--------------------------------------------------------------------------------
-- Bounties: the server's top thief has a price on their head.
--------------------------------------------------------------------------------

-- Steals this session before a bounty appears.
ExtrasConfig.BountyMinSteals = 3
-- Bounty: this much, plus this many seconds of the holder's income per steal.
ExtrasConfig.BountyBase = 1000
ExtrasConfig.BountyIncomeSecondsPerSteal = 20
ExtrasConfig.BountyMaxIncomeSeconds = 600

--------------------------------------------------------------------------------
-- Crews: team up with other players in the server.
--------------------------------------------------------------------------------

ExtrasConfig.CrewMaxSize = 4
-- Extra income for each other crew member in the server.
ExtrasConfig.CrewBoostPerMember = 0.05
ExtrasConfig.CrewInviteSeconds = 30
ExtrasConfig.CrewNames = table.freeze({
	"Brainrot Bandits",
	"Tung Tung Squad",
	"Pizza Mafia",
	"Noob Army",
	"Sahur Syndicate",
	"Crocodilo Crew",
	"Taco Gang",
	"Guest Legion",
	"Bacon Brigade",
	"Oof Society",
	"Lirili Legends",
	"Cappuccino Club",
})
ExtrasConfig.CrewColors = table.freeze({
	rgb(255, 80, 80),
	rgb(255, 170, 40),
	rgb(250, 230, 60),
	rgb(80, 220, 110),
	rgb(60, 200, 255),
	rgb(90, 120, 255),
	rgb(190, 90, 255),
	rgb(255, 110, 200),
})

--------------------------------------------------------------------------------
-- Season pass: play to earn XP, climb 30 tiers. Everyone gets the free
-- rewards; the Season Pass game pass adds the premium ones.
--------------------------------------------------------------------------------

ExtrasConfig.SeasonDays = 28
-- Season 1 starts on this date (UTC); a new one starts every SeasonDays.
ExtrasConfig.SeasonEpoch = 1767225600 -- 2026-01-01
ExtrasConfig.TierXP = 150
ExtrasConfig.PlaytimeXPPerMinute = 2
-- XP for each thing you do (the Activity kinds GameplayManager reports).
ExtrasConfig.ActivityXP = table.freeze({
	Buy = 4,
	BuyEpic = 10,
	Steal = 25,
	Collect = 1,
	OpenBlock = 15,
	Lock = 3,
	Upgrade = 8,
	Catch = 15,
	Fuse = 20,
	Trade = 10,
	Rebirth = 150,
	Slap = 2,
	Spin = 5,
	Secret = 100,
	Quest = 40,
	Revenge = 30,
	Bounty = 60,
	BossHit = 1,
	BossWin = 60,
	Heist = 20,
} :: { [string]: number })

local function cash(minutes: number, min: number): Reward
	local reward: Reward = { Kind = "Cash", Minutes = minutes, Min = min }
	return table.freeze(reward)
end
local function spins(count: number): Reward
	local reward: Reward = { Kind = "Spins", Count = count }
	return table.freeze(reward)
end
local function boost(minutes: number): Reward
	local reward: Reward = { Kind = "Boost", Seconds = minutes * 60 }
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
local function hat(name: string): Reward
	local reward: Reward = { Kind = "Hat", Hat = name }
	return table.freeze(reward)
end

-- Tier N: { Free, Premium }.
ExtrasConfig.SeasonTiers = table.freeze({
	{ cash(5, 1000), cash(15, 3000) },
	{ spins(1), hat("CowboyHat") },
	{ cash(10, 2000), spins(3) },
	{ hat("PartyHat"), block("LuckyBlock") },
	{ block("LuckyBlock"), boost(20) },
	{ cash(15, 3000), cash(30, 6000) },
	{ boost(10), hat("TopHat") },
	{ spins(2), block("MythicLuckyBlock") },
	{ cash(20, 4000), spins(5) },
	{ hat("ChefHat"), brainrot("GuestiGuacanini") },
	{ block("LuckyBlock"), cash(45, 9000) },
	{ cash(25, 5000), hat("VikingHelmet") },
	{ spins(2), boost(30) },
	{ boost(15), block("MythicLuckyBlock") },
	{ block("MythicLuckyBlock"), hat("WizardHat") },
	{ cash(30, 6000), cash(60, 12000) },
	{ hat("CowboyHat"), block("GodLuckyBlock") },
	{ spins(3), spins(5) },
	{ cash(40, 8000), hat("Halo") },
	{ block("MythicLuckyBlock"), brainrot("OrcaleroOrcala") },
	{ boost(20), cash(90, 18000) },
	{ cash(50, 10000), boost(45) },
	{ hat("TopHat"), block("GodLuckyBlock") },
	{ spins(3), hat("Crown") },
	{ block("GodLuckyBlock"), spins(8) },
	{ cash(60, 12000), cash(120, 25000) },
	{ hat("VikingHelmet"), block("SecretLuckyBlock") },
	{ boost(30), boost(60) },
	{ cash(90, 18000), cash(180, 40000) },
	{ block("GodLuckyBlock"), brainrot("AdminoSupremo") },
} :: { { Reward } })
ExtrasConfig.SeasonTierCount = #ExtrasConfig.SeasonTiers

-- The current season number (1, 2, ...) and when it ends (os.time()).
function ExtrasConfig.season(now: number): (number, number)
	local length = ExtrasConfig.SeasonDays * 86400
	local number = math.max(0, (now - ExtrasConfig.SeasonEpoch) // length) + 1
	return number, ExtrasConfig.SeasonEpoch + number * length
end

function ExtrasConfig.tierOf(xp: number): number
	return math.clamp(xp // ExtrasConfig.TierXP, 0, ExtrasConfig.SeasonTierCount)
end

--------------------------------------------------------------------------------
-- Weekly limited brainrots: one famous-Roblox-limited brainrot is on sale
-- (for Robux) each week, then it's gone until it comes round again. They're
-- OG, rarer and stronger than any Secret, and the conveyor spawns one only
-- very rarely (BrainrotConfig.OGChance).
--------------------------------------------------------------------------------

export type Limited = {
	Id: string,
	-- MonetizationConfig.ProductIds key.
	Product: string,
	Robux: number,
}

ExtrasConfig.LimitedRotation = table.freeze({
	table.freeze({ Id = "KorbloxoScheletrino", Product = "LimitedKorbloxo", Robux = 799 }),
	table.freeze({ Id = "ValkyrioPolpetto", Product = "LimitedValkyrio", Robux = 999 }),
	table.freeze({ Id = "HeadlessoZuccone", Product = "LimitedHeadless", Robux = 1299 }),
	table.freeze({ Id = "DominussoCappuccinoso", Product = "LimitedDominus", Robux = 1499 }),
	table.freeze({ Id = "SparklinoFedorino", Product = "LimitedSparkle", Robux = 1999 }),
} :: { Limited })
-- Weeks start on Mondays at 00:00 UTC.
ExtrasConfig.LimitedWeekEpoch = 1767571200 -- Monday 2026-01-05

-- This week's limited brainrot and when the week ends (os.time()).
function ExtrasConfig.currentLimited(now: number): (Limited, number)
	local week = (now - ExtrasConfig.LimitedWeekEpoch) // (7 * 86400)
	local rotation = ExtrasConfig.LimitedRotation
	local index = week % #rotation + 1
	return rotation[index], ExtrasConfig.LimitedWeekEpoch + (week + 1) * 7 * 86400
end

--------------------------------------------------------------------------------
-- Boss raids: a giant brainrot rampages around the middle of the map.
-- Everyone clicks (or slaps) it. Each boss is a random tier: harder ones are
-- bigger and tougher, attack faster with more attacks (stomps, aimed lasers,
-- grabbing and throwing players, meteor rain, jump slams) and rage below
-- BossRageFraction health, but drop better loot: lucky blocks for the top
-- raiders (and on Hard and Mega for everyone who helped), Cash and hats.
--------------------------------------------------------------------------------

ExtrasConfig.BossIds = table.freeze({
	"LaVacaSaturnoSaturnita",
	"SessantaSette",
	"NuclearoDinossauro",
	"StrawberryElephant",
	"OofosauroRex",
	"TralaleroTralala",
	"BombardiroCrocodilo",
	"TungTungTungSahur",
})
-- A Normal boss; tiers scale these.
ExtrasConfig.BossHeight = 26
ExtrasConfig.BossSpeed = 7
ExtrasConfig.BossHealthPerPlayer = 450
ExtrasConfig.BossMinHealth = 900
ExtrasConfig.BossClickDamage = 5
ExtrasConfig.BossClickCooldown = 0.12
ExtrasConfig.BossSlapDamage = 45
ExtrasConfig.BossClickRange = 60
ExtrasConfig.BossStompRadius = 22
ExtrasConfig.BossStompKnockback = 75

export type BossTier = {
	Name: string,
	-- Shown on the health bar and in the announcement.
	Label: string,
	Colour: Color3,
	-- How often it's picked, against the other tiers.
	Weight: number,
	-- Multipliers for health, size and walking speed.
	Health: number,
	Size: number,
	Speed: number,
	-- Seconds between attacks, and which it can use.
	AttackSeconds: number,
	Attacks: { string },
	-- Lucky blocks for the top raiders (1st, 2nd, 3rd), one for everyone else
	-- who helped (or none), and a multiplier for the helpers' Cash.
	Prizes: { string },
	EveryonePrize: string?,
	CashMultiplier: number,
}

ExtrasConfig.BossTiers = table.freeze({
	table.freeze({
		Name = "Easy",
		Label = "🟢 EASY",
		Colour = Color3.fromRGB(90, 220, 90),
		Weight = 30,
		Health = 0.6,
		Size = 0.85,
		Speed = 0.85,
		AttackSeconds = 8,
		Attacks = table.freeze({ "Stomp", "Laser" }),
		Prizes = table.freeze({ "MythicLuckyBlock", "LuckyBlock", "LuckyBlock" }),
		EveryonePrize = nil,
		CashMultiplier = 1,
	}),
	table.freeze({
		Name = "Normal",
		Label = "🟡 NORMAL",
		Colour = Color3.fromRGB(255, 210, 60),
		Weight = 35,
		Health = 1,
		Size = 1,
		Speed = 1,
		AttackSeconds = 6.5,
		Attacks = table.freeze({ "Stomp", "Laser", "Throw" }),
		Prizes = table.freeze({ "GodLuckyBlock", "MythicLuckyBlock", "MythicLuckyBlock" }),
		EveryonePrize = nil,
		CashMultiplier = 1.5,
	}),
	table.freeze({
		Name = "Hard",
		Label = "🟠 HARD",
		Colour = Color3.fromRGB(255, 130, 30),
		Weight = 25,
		Health = 1.8,
		Size = 1.2,
		Speed = 1.15,
		AttackSeconds = 5,
		Attacks = table.freeze({ "Stomp", "Laser", "Throw", "Meteors", "Slam" }),
		Prizes = table.freeze({ "GodLuckyBlock", "GodLuckyBlock", "MythicLuckyBlock" }),
		EveryonePrize = "MythicLuckyBlock",
		CashMultiplier = 2,
	}),
	table.freeze({
		Name = "Mega",
		Label = "💀 MEGA",
		Colour = Color3.fromRGB(200, 60, 255),
		Weight = 10,
		Health = 3,
		Size = 1.5,
		Speed = 1.3,
		AttackSeconds = 4,
		Attacks = table.freeze({ "Stomp", "Laser", "Throw", "Meteors", "Slam", "Laser" }),
		Prizes = table.freeze({ "SecretLuckyBlock", "GodLuckyBlock", "GodLuckyBlock" }),
		EveryonePrize = "MythicLuckyBlock",
		CashMultiplier = 3,
	}),
} :: { BossTier })
ExtrasConfig.BossTierByName = {} :: { [string]: BossTier }
for _, tier in ExtrasConfig.BossTiers do
	ExtrasConfig.BossTierByName[tier.Name] = tier
end
table.freeze(ExtrasConfig.BossTierByName)

-- Below this much health it rages: attacks and walks this much faster.
ExtrasConfig.BossRageFraction = 0.3
ExtrasConfig.BossRageSpeedup = 1.4
-- Laser: a red line shows where it'll fire, then a beam knocks back anyone in it.
ExtrasConfig.BossLaserWindup = 1.2
ExtrasConfig.BossLaserRange = 90
ExtrasConfig.BossLaserWidth = 3.5
ExtrasConfig.BossLaserKnockback = 60
-- Throw: a red ring under someone; whoever's still in it gets grabbed and thrown.
ExtrasConfig.BossThrowWindup = 1
ExtrasConfig.BossThrowRange = 40
ExtrasConfig.BossThrowRadius = 7
ExtrasConfig.BossThrowStrength = 150
-- Meteors: red circles, then a meteor lands on each.
ExtrasConfig.BossMeteorCount = 6
ExtrasConfig.BossMeteorWindup = 1.5
ExtrasConfig.BossMeteorRadius = 8
ExtrasConfig.BossMeteorKnockback = 70
-- Slam: it leaps onto someone (they see the ring where it'll land).
ExtrasConfig.BossSlamWindup = 1.4
ExtrasConfig.BossSlamRadius = 26
ExtrasConfig.BossSlamKnockback = 95
-- Everyone who helped (at least BossMinShare of the damage) gets Cash worth
-- BossCashMinutes of their income (times the tier's multiplier) and a
-- BossHatChance chance of a random hat.
ExtrasConfig.BossMinShare = 0.02
ExtrasConfig.BossCashMinutes = 4
ExtrasConfig.BossMinCash = 2500
ExtrasConfig.BossHatChance = 0.35

--------------------------------------------------------------------------------
-- Bank heists: the vault opens. Grab loot from the piles (cash, gold bars or
-- the odd pile of diamonds, each worth more and heavier to carry) and get it
-- to your base. Security lasers sweep the vault: touch one and you're zapped
-- back (dropping your bag). In the last minute the alarm goes off: faster
-- lasers, double loot. The best robber wins a lucky block.
--------------------------------------------------------------------------------

export type HeistLoot = {
	Name: string,
	Label: string,
	Colour: Color3,
	-- How often a pile holds it, against the others.
	Weight: number,
	-- Worth this many seconds of your income (at least Min).
	IncomeSeconds: number,
	Min: number,
	-- Walk speed while carrying it.
	Speed: number,
}

ExtrasConfig.HeistLoot = table.freeze({
	table.freeze({ Name = "Cash", Label = "💵 Cash Bag", Colour = Color3.fromRGB(110, 190, 80), Weight = 60, IncomeSeconds = 45, Min = 800, Speed = -3 }),
	table.freeze({ Name = "Gold", Label = "🟨 Gold Bars", Colour = Color3.fromRGB(255, 200, 40), Weight = 30, IncomeSeconds = 90, Min = 2000, Speed = -5 }),
	table.freeze({ Name = "Diamond", Label = "💎 Diamonds", Colour = Color3.fromRGB(90, 230, 255), Weight = 10, IncomeSeconds = 180, Min = 5000, Speed = -6 }),
} :: { HeistLoot })
ExtrasConfig.HeistGrabSeconds = 1.2
ExtrasConfig.HeistRespawnSeconds = 6
-- Security lasers: bars at leg height (jump over them) sweeping the vault.
ExtrasConfig.HeistLaserCount = 3
ExtrasConfig.HeistLaserSpeed = 7
ExtrasConfig.HeistLaserKnockback = 45
-- The alarm: the last this many seconds of the heist.
ExtrasConfig.HeistAlarmSeconds = 60
ExtrasConfig.HeistAlarmLaserSpeed = 13
ExtrasConfig.HeistAlarmMultiplier = 2
-- Whoever banks the most loot wins this.
ExtrasConfig.HeistTopPrize = "MythicLuckyBlock"

--------------------------------------------------------------------------------
-- Walk speed from these features: each sets its own player attribute and the
-- walk speed adds them up (GameplayManager and GearManager).
--------------------------------------------------------------------------------

ExtrasConfig.SpeedAttributes = table.freeze({ "RevengeSpeed", "PetSpeed", "LootSpeed" })

function ExtrasConfig.speedBonusOf(player: Player): number
	local total = 0
	for _, name in ExtrasConfig.SpeedAttributes do
		total += tonumber(player:GetAttribute(name)) or 0
	end
	return math.clamp(total, -10, 20)
end

return table.freeze(ExtrasConfig)

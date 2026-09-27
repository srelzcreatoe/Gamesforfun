--!strict
-- Robux products and game passes. Read by DataAndMonetizationManager on the
-- server and by the shop UI on the client, so the IDs only live here.
-- Replace every ID with the real ones from the Creator Dashboard.

local NumberFormat = require(script.Parent:WaitForChild("NumberFormat"))

export type ShopProduct = {
	Key: string,
	ProductId: number,
	DisplayName: string,
	Description: string,
	-- Upload the matching image from ProductIcons/ and paste its image ID here
	-- to show it in the shop. 0 uses the product's own icon once the product
	-- exists, or a coloured tile with IconText until then.
	IconAssetId: number,
	IconText: string,
	IconColor: Color3,
	-- A game pass (ProductId is then its pass ID): bought once, kept forever.
	GamePass: boolean?,
}

local ProductIds = table.freeze({
	SmallCashBundle = 100001,
	MediumCashBundle = 100002,
	EMPLaserOverrider = 100003,
	ServerRarityBoost = 100004,
	FreezeRay = 100005,
	SpikeTrap = 100006,
	LandMine = 100007,
	BoogieBomb = 100008,
	GodLuckyBlock = 100009,
	SecretLuckyBlock = 100010,
	SpinPack = 100011,
	CashBoost = 100012,
	GalaxySkin = 100013,
	RainbowSkin = 100014,
	-- A random hat for a brainrot (ExtrasConfig.Hats).
	HatCrate = 100015,
	-- One season pass tier.
	SeasonTierSkip = 100016,
	-- The weekly limited brainrots (ExtrasConfig.LimitedRotation), one each.
	LimitedKorbloxo = 100017,
	LimitedValkyrio = 100018,
	LimitedHeadless = 100019,
	LimitedDominus = 100020,
	LimitedSparkle = 100021,
})

-- Lucky blocks bought with Robux land in your base (or wait until there's room).
local LuckyBlockProducts: { [string]: string } = table.freeze({
	GodLuckyBlock = "GodLuckyBlock",
	SecretLuckyBlock = "SecretLuckyBlock",
})

-- Base skins bought with Robux (see GameConfig.BaseSkins).
local SkinProducts: { [string]: string } = table.freeze({
	GalaxySkin = "Galaxy",
	RainbowSkin = "Rainbow",
})

-- Troll items: each purchase adds this many uses of the tool (saved).
local ItemCharges: { [string]: number } = table.freeze({
	FreezeRay = 3,
	SpikeTrap = 3,
	LandMine = 3,
	BoogieBomb = 2,
})

local GamePasses: { [string]: number } = table.freeze({
	-- +15% income and an extra free spin every day (FeatureConfig).
	VIP = 200001,
	DoubleCash = 200002,
	-- Your base lock lasts twice as long.
	LongLock = 200003,
	-- The premium rewards on every season pass tier.
	SeasonPass = 200004,
	-- Your guard brainrot recovers twice as fast.
	SuperGuard = 200005,
})

local SMALL_CASH_BUNDLE_AMOUNT = 5000
local MEDIUM_CASH_BUNDLE_AMOUNT = 25000
local LASER_BYPASS_DURATION_SECONDS = 30
local SERVER_RARITY_BOOST_DURATION_SECONDS = 15 * 60
local SERVER_RARITY_BOOST_MULTIPLIER = 2
local SPIN_PACK_SPINS = 3
local CASH_BOOST_SECONDS = 30 * 60
local CASH_BOOST_MULTIPLIER = 2

-- Game passes come first in the shop.
local ShopProducts: { ShopProduct } = {
	{
		Key = "VIP",
		ProductId = GamePasses.VIP,
		DisplayName = "VIP",
		Description = "+15% income forever, plus an extra free spin every day.",
		IconAssetId = 0,
		IconText = "VIP",
		IconColor = Color3.fromRGB(255, 190, 30),
		GamePass = true,
	},
	{
		Key = "DoubleCash",
		ProductId = GamePasses.DoubleCash,
		DisplayName = "2x Cash Forever",
		Description = "Every brainrot you own earns double. Forever!",
		IconAssetId = 0,
		IconText = "2x",
		IconColor = Color3.fromRGB(30, 170, 80),
		GamePass = true,
	},
	{
		Key = "LongLock",
		ProductId = GamePasses.LongLock,
		DisplayName = "Long Lock",
		Description = "Your base lock lasts twice as long.",
		IconAssetId = 0,
		IconText = "🔒",
		IconColor = Color3.fromRGB(70, 110, 220),
		GamePass = true,
	},
	{
		Key = "SeasonPass",
		ProductId = GamePasses.SeasonPass,
		DisplayName = "Season Pass",
		Description = "Premium rewards on every season tier, up to the exclusive Admino Supremo.",
		IconAssetId = 0,
		IconText = "🏆",
		IconColor = Color3.fromRGB(255, 150, 20),
		GamePass = true,
	},
	{
		Key = "SuperGuard",
		ProductId = GamePasses.SuperGuard,
		DisplayName = "Super Guard",
		Description = "Your guard brainrot gets back up twice as fast.",
		IconAssetId = 0,
		IconText = "🛡️",
		IconColor = Color3.fromRGB(150, 80, 230),
		GamePass = true,
	},
	{
		Key = "SmallCashBundle",
		ProductId = ProductIds.SmallCashBundle,
		DisplayName = "Small Cash Bundle",
		Description = string.format("+%s Cash instantly", NumberFormat.commas(SMALL_CASH_BUNDLE_AMOUNT)),
		IconAssetId = 0,
		IconText = "$",
		IconColor = Color3.fromRGB(46, 204, 113),
	},
	{
		Key = "MediumCashBundle",
		ProductId = ProductIds.MediumCashBundle,
		DisplayName = "Medium Cash Bundle",
		Description = string.format("+%s Cash instantly", NumberFormat.commas(MEDIUM_CASH_BUNDLE_AMOUNT)),
		IconAssetId = 0,
		IconText = "$$$",
		IconColor = Color3.fromRGB(26, 160, 220),
	},
	{
		Key = "EMPLaserOverrider",
		ProductId = ProductIds.EMPLaserOverrider,
		DisplayName = "EMP Laser Overrider",
		Description = string.format("Walk through every laser door for %d seconds", LASER_BYPASS_DURATION_SECONDS),
		IconAssetId = 0,
		IconText = "EMP",
		IconColor = Color3.fromRGB(60, 90, 220),
	},
	{
		Key = "ServerRarityBoost",
		ProductId = ProductIds.ServerRarityBoost,
		DisplayName = "Server Rarity Boost",
		Description = string.format(
			"x%d rare brainrot chance for the whole server for %d minutes",
			SERVER_RARITY_BOOST_MULTIPLIER,
			SERVER_RARITY_BOOST_DURATION_SECONDS // 60
		),
		IconAssetId = 0,
		IconText = "x2",
		IconColor = Color3.fromRGB(200, 60, 200),
	},
	{
		Key = "FreezeRay",
		ProductId = ProductIds.FreezeRay,
		DisplayName = "Freeze Ray x3",
		Description = "Freeze a player solid for 4 seconds. Thieves drop what they carry!",
		IconAssetId = 0,
		IconText = "ICE",
		IconColor = Color3.fromRGB(80, 200, 255),
	},
	{
		Key = "SpikeTrap",
		ProductId = ProductIds.SpikeTrap,
		DisplayName = "Spike Trap x3",
		Description = "Spikes that trap whoever steps on them for 3 seconds.",
		IconAssetId = 0,
		IconText = "!!",
		IconColor = Color3.fromRGB(240, 110, 40),
	},
	{
		Key = "LandMine",
		ProductId = ProductIds.LandMine,
		DisplayName = "Land Mine x3",
		Description = "BOOM! Launches anyone who steps on it into the air.",
		IconAssetId = 0,
		IconText = "*",
		IconColor = Color3.fromRGB(70, 150, 60),
	},
	{
		Key = "BoogieBomb",
		ProductId = ProductIds.BoogieBomb,
		DisplayName = "Boogie Bomb x2",
		Description = "Everyone near you can't stop dancing for 4 seconds.",
		IconAssetId = 0,
		IconText = "♪",
		IconColor = Color3.fromRGB(230, 70, 200),
	},
	{
		Key = "GodLuckyBlock",
		ProductId = ProductIds.GodLuckyBlock,
		DisplayName = "Brainrot God Lucky Block",
		Description = "Opens into a Mythic, a Brainrot God or even a Secret!",
		IconAssetId = 0,
		IconText = "?",
		IconColor = Color3.fromRGB(255, 120, 255),
	},
	{
		Key = "SecretLuckyBlock",
		ProductId = ProductIds.SecretLuckyBlock,
		DisplayName = "Secret Lucky Block",
		Description = "Opens into a Brainrot God or a Secret. 30% Secret!",
		IconAssetId = 0,
		IconText = "?",
		IconColor = Color3.fromRGB(30, 30, 30),
	},
	{
		Key = "SpinPack",
		ProductId = ProductIds.SpinPack,
		DisplayName = string.format("%d Wheel Spins", SPIN_PACK_SPINS),
		Description = "Spin the prize wheel for cash, lucky blocks and boosts.",
		IconAssetId = 0,
		IconText = "SPIN",
		IconColor = Color3.fromRGB(255, 170, 40),
	},
	{
		Key = "CashBoost",
		ProductId = ProductIds.CashBoost,
		DisplayName = "2x Cash (30 min)",
		Description = "Every brainrot earns double for 30 minutes. Stacks up!",
		IconAssetId = 0,
		IconText = "2x",
		IconColor = Color3.fromRGB(40, 190, 90),
	},
	{
		Key = "HatCrate",
		ProductId = ProductIds.HatCrate,
		DisplayName = "Hat Crate",
		Description = "A random hat for one of your brainrots: up to +25% income. Crowns are rare!",
		IconAssetId = 0,
		IconText = "🎩",
		IconColor = Color3.fromRGB(150, 90, 230),
	},
	{
		Key = "GalaxySkin",
		ProductId = ProductIds.GalaxySkin,
		DisplayName = "Galaxy Base Skin",
		Description = "Purple space neon for your whole base. Yours forever.",
		IconAssetId = 0,
		IconText = "*",
		IconColor = Color3.fromRGB(120, 60, 230),
	},
	{
		Key = "RainbowSkin",
		ProductId = ProductIds.RainbowSkin,
		DisplayName = "Rainbow Base Skin",
		Description = "Your base glows through every colour. Yours forever.",
		IconAssetId = 0,
		IconText = "~",
		IconColor = Color3.fromRGB(255, 90, 160),
	},
}

return table.freeze({
	ProductIds = ProductIds,
	GamePasses = GamePasses,
	SmallCashBundleAmount = SMALL_CASH_BUNDLE_AMOUNT,
	MediumCashBundleAmount = MEDIUM_CASH_BUNDLE_AMOUNT,
	LaserBypassDurationSeconds = LASER_BYPASS_DURATION_SECONDS,
	ServerRarityBoostDurationSeconds = SERVER_RARITY_BOOST_DURATION_SECONDS,
	ServerRarityBoostMultiplier = SERVER_RARITY_BOOST_MULTIPLIER,
	DoubleCashIncomeMultiplier = 2,
	ItemCharges = ItemCharges,
	LuckyBlockProducts = LuckyBlockProducts,
	SkinProducts = SkinProducts,
	SpinPackSpins = SPIN_PACK_SPINS,
	CashBoostSeconds = CASH_BOOST_SECONDS,
	CashBoostMultiplier = CASH_BOOST_MULTIPLIER,
	ShopProducts = table.freeze(ShopProducts),
})

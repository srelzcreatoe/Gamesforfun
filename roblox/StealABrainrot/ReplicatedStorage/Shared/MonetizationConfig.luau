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
})

local SMALL_CASH_BUNDLE_AMOUNT = 5000
local MEDIUM_CASH_BUNDLE_AMOUNT = 25000
local LASER_BYPASS_DURATION_SECONDS = 30
local SERVER_RARITY_BOOST_DURATION_SECONDS = 15 * 60
local SERVER_RARITY_BOOST_MULTIPLIER = 2
local SPIN_PACK_SPINS = 3
local CASH_BOOST_SECONDS = 30 * 60
local CASH_BOOST_MULTIPLIER = 2

local ShopProducts: { ShopProduct } = {
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

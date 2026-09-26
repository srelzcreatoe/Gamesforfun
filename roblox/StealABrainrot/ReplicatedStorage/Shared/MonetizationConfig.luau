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
})

local GamePasses: { [string]: number } = table.freeze({
	VIP = 200001,
	DoubleCash = 200002,
})

local SMALL_CASH_BUNDLE_AMOUNT = 5000
local MEDIUM_CASH_BUNDLE_AMOUNT = 25000
local LASER_BYPASS_DURATION_SECONDS = 30
local SERVER_RARITY_BOOST_DURATION_SECONDS = 15 * 60
local SERVER_RARITY_BOOST_MULTIPLIER = 2

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
	ShopProducts = table.freeze(ShopProducts),
})

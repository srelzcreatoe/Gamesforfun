--!strict
--[[
	GameClient
	Location: StarterPlayer.StarterPlayerScripts (LocalScript)

	Builds the HUD in the style of the original game: square Index / Rebirth /
	Shop buttons with Higgsfield icons on the left, big green Cash at the bottom
	left with "+$" pop-ups and your income multiplier, boost, Cash Boost and
	event timers at the top, the Robux shop, the Gear Shop, the rebirth screen
	(with the brainrots each rebirth needs), the brainrot Index (pages for
	every brainrot and for Gold, Diamond and Rainbow ones, with the rewards for
	finishing each) and pop-up messages. It also plays the music and sound
	effects (volume is in Settings, see FeaturesClient), points out your base,
	opens the shops from their stalls, adds clouds, and hides ProximityPrompts
	that don't apply to this player (Steal on your own brainrots; Sell,
	Upgrade and Open on someone else's; Buy on your own brainrot while it
	walks home).

	Nothing here can change game state. Purchases go through Roblox's purchase
	prompt and ProcessReceipt on the server, and the server re-checks every
	prompt, rebirth and gear request.
]]

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local AssetLoader = require(Shared:WaitForChild("AssetLoader"))
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))
local FeatureConfig = require(Shared:WaitForChild("FeatureConfig"))
local GameConfig = require(Shared:WaitForChild("GameConfig"))
local GearConfig = require(Shared:WaitForChild("GearConfig"))
local MonetizationConfig = require(Shared:WaitForChild("MonetizationConfig"))
local NumberFormat = require(Shared:WaitForChild("NumberFormat"))
local Sounds = require(Shared:WaitForChild("Sounds"))
local UIKit = require(Shared:WaitForChild("UIKit"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local notifyEvent = remotes:WaitForChild("Notify") :: RemoteEvent
local playSoundEvent = remotes:WaitForChild("PlaySound") :: RemoteEvent
local requestRebirthFunction = remotes:WaitForChild("RequestRebirth") :: RemoteFunction

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui") :: PlayerGui

local COLORS = {
	Panel = Color3.fromRGB(30, 32, 52),
	PanelLight = Color3.fromRGB(48, 52, 82),
	Text = Color3.new(1, 1, 1),
	Muted = Color3.fromRGB(190, 196, 225),
	Cash = Color3.fromRGB(80, 255, 110),
	Income = Color3.fromRGB(255, 230, 70),
	Buy = Color3.fromRGB(46, 204, 113),
	Shop = Color3.fromRGB(140, 70, 215),
	Rebirth = Color3.fromRGB(40, 175, 230),
	Index = Color3.fromRGB(245, 170, 40),
	SideButton = Color3.fromRGB(58, 64, 82),
	-- Side buttons, bright like the original's
	IndexButton = Color3.fromRGB(70, 205, 90),
	RebirthButton = Color3.fromRGB(125, 90, 255),
	ShopButton = Color3.fromRGB(255, 185, 35),
	Close = Color3.fromRGB(235, 70, 70),
	Disabled = Color3.fromRGB(95, 98, 118),
	Boost = Color3.fromRGB(205, 60, 205),
	Emp = Color3.fromRGB(60, 120, 255),
	Owned = Color3.fromRGB(46, 204, 113),
	Gear = Color3.fromRGB(40, 140, 255),
	Music = Color3.fromRGB(255, 120, 190),
}
-- Mutation events: chip colour and the sky tint.
-- Event chip colour by the event's sky.
local EVENT_COLORS: { [string]: Color3 } = {
	Gold = Color3.fromRGB(255, 200, 40),
	Diamond = Color3.fromRGB(90, 210, 255),
	Rainbow = Color3.fromRGB(255, 90, 200),
	Blood = Color3.fromRGB(200, 20, 40),
	Galaxy = Color3.fromRGB(130, 70, 240),
	Lava = Color3.fromRGB(255, 110, 20),
	Frost = Color3.fromRGB(120, 200, 255),
	Taco = Color3.fromRGB(240, 170, 40),
	Lucky = Color3.fromRGB(60, 190, 80),
	Cash = Color3.fromRGB(46, 180, 100),
	Admin = Color3.fromRGB(255, 70, 200),
}
-- Sounds for pop-up messages that don't name their own.
local TOAST_SOUNDS: { [string]: string } = {
	Error = "Error",
	Warning = "Notify",
}
local TOAST_COLORS: { [string]: Color3 } = {
	Info = Color3.fromRGB(70, 130, 255),
	Success = Color3.fromRGB(46, 180, 100),
	Warning = Color3.fromRGB(240, 160, 30),
	Error = Color3.fromRGB(225, 65, 65),
}
local MAX_TOASTS = 4
local TOAST_SECONDS = 4
local MAX_CASH_POPUPS = 3

--------------------------------------------------------------------------------
-- UI helpers (shared with the other menus, see UIKit)
--------------------------------------------------------------------------------

local create = UIKit.create
local corner = UIKit.corner
local stroke = UIKit.stroke
local gloss = UIKit.gloss
local label = UIKit.label
local button = UIKit.button
local setImage = UIKit.setImage

--------------------------------------------------------------------------------
-- Layout
--------------------------------------------------------------------------------

local screenGui = create("ScreenGui", {
	Name = "GameHud",
	ResetOnSpawn = false,
	ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
}) :: ScreenGui

-- Cash (bottom left, like the original)
local cashLabel = label({
	Name = "Cash",
	AnchorPoint = Vector2.new(0, 1),
	Position = UDim2.new(0, 18, 1, -14),
	Size = UDim2.fromOffset(340, 64),
	Text = "$0",
	TextColor3 = COLORS.Cash,
	TextSize = 60,
	TextXAlignment = Enum.TextXAlignment.Left,
	OutlineThickness = 3,
})
cashLabel.Parent = screenGui

local incomeLabel = label({
	Name = "Income",
	AnchorPoint = Vector2.new(0, 1),
	Position = UDim2.new(0, 20, 1, -80),
	Size = UDim2.fromOffset(260, 28),
	Text = "+$0/s",
	TextColor3 = COLORS.Income,
	TextSize = 26,
	TextXAlignment = Enum.TextXAlignment.Left,
})
incomeLabel.Parent = screenGui

-- Boost timers (top centre)
local chipRow = create("Frame", {
	Name = "Boosts",
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 8),
	Size = UDim2.fromOffset(820, 34),
	BackgroundTransparency = 1,
}, {
	create("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		Padding = UDim.new(0, 8),
	}),
}) :: Frame
chipRow.Parent = screenGui

local function chip(color: Color3, iconKey: string): TextLabel
	local chipLabel = label({
		Size = UDim2.fromOffset(260, 34),
		BackgroundTransparency = 0,
		BackgroundColor3 = color,
		TextSize = 22,
		Visible = false,
	})
	corner(17).Parent = chipLabel
	gloss().Parent = chipLabel

	local iconImage = AssetLoader.getProductIcon(iconKey)
	if iconImage then
		create("UIPadding", { PaddingLeft = UDim.new(0, 34) }).Parent = chipLabel
		local icon = create("ImageLabel", {
			Name = "Icon",
			AnchorPoint = Vector2.new(0, 0.5),
			Position = UDim2.new(0, -32, 0.5, 0),
			Size = UDim2.fromOffset(30, 30),
			BackgroundTransparency = 1,
		}, { corner(15) }) :: ImageLabel
		setImage(icon, iconImage)
		icon.Parent = chipLabel
	end

	chipLabel.Parent = chipRow
	return chipLabel
end

local boostChip = chip(COLORS.Boost, "ServerRarityBoost")
local empChip = chip(COLORS.Emp, "EMPLaserOverrider")
local eventChip = chip(EVENT_COLORS.Gold, "ServerRarityBoost")
local cashBoostChip = chip(Color3.fromRGB(40, 190, 90), "CashBoost")
UIKit.autoScale(chipRow)

-- Your income multiplier (bottom left, by the income); tap it for the list of
-- boosts (rebirths, passes, friends, Premium, Index...).
local boostPill = button("x1", Color3.fromRGB(255, 170, 40), {
	Name = "BoostPill",
	AnchorPoint = Vector2.new(0, 1),
	Position = UDim2.new(0, 20, 1, -112),
	Size = UDim2.fromOffset(96, 30),
	Visible = false,
})
boostPill.Parent = screenGui
local boostTip = label({
	Name = "BoostInfo",
	AnchorPoint = Vector2.new(0, 1),
	Position = UDim2.new(0, 124, 1, -112),
	Size = UDim2.fromOffset(260, 120),
	BackgroundTransparency = 0.1,
	BackgroundColor3 = COLORS.Panel,
	Text = "",
	TextSize = 20,
	TextXAlignment = Enum.TextXAlignment.Left,
	TextYAlignment = Enum.TextYAlignment.Bottom,
	Visible = false,
})
corner(10).Parent = boostTip
create("UIPadding", { PaddingLeft = UDim.new(0, 10), PaddingBottom = UDim.new(0, 8), PaddingTop = UDim.new(0, 8) }).Parent = boostTip
boostTip.Parent = screenGui
boostPill.Activated:Connect(function()
	boostTip.Visible = not boostTip.Visible
end)
boostPill.MouseEnter:Connect(function()
	boostTip.Visible = true
end)
boostPill.MouseLeave:Connect(function()
	boostTip.Visible = false
end)

-- Big square buttons (left middle): Index, Rebirth, Shop. Chunky and bright
-- like the original: a glossy colour block with a thick black outline and a
-- shadow under it, the icon popping out of the top and a bold label. They
-- bounce when hovered, squish when pressed and their icons bob about.
local sideButtons = UIKit.sideColumn(screenGui, "SideButtons", 3, {
	AnchorPoint = Vector2.new(0, 0.5),
	Position = UDim2.new(0, 16, 0.5, 10),
})

UIKit.autoScale(sideButtons)

local function sideButton(name: string, text: string, color: Color3, iconName: string, order: number): TextButton
	return UIKit.sideButton(sideButtons, name, text, color, iconName, order)
end

local indexButton = sideButton("IndexButton", "Index", COLORS.IndexButton, "Index", 1)
local rebirthButton = sideButton("RebirthButton", "Rebirth", COLORS.RebirthButton, "Rebirth", 2)
local shopButton = sideButton("ShopButton", "Shop", COLORS.ShopButton, "Shop", 3)

-- A pulsing "NEW!" badge on the Shop button.
local shopBadge = label({
	Name = "Badge",
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.new(1, -4, 0, 4),
	Size = UDim2.fromOffset(54, 26),
	BackgroundTransparency = 0,
	BackgroundColor3 = Color3.fromRGB(235, 40, 60),
	Text = "NEW!",
	TextSize = 20,
	Rotation = 12,
	ZIndex = 6,
})
corner(13).Parent = shopBadge
create("UIStroke", { Color = Color3.new(1, 1, 1), Thickness = 2, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }).Parent = shopBadge
shopBadge.Parent = shopButton

-- The badge pulses.
RunService.RenderStepped:Connect(function()
	local pulse = 1 + math.max(0, math.sin(os.clock() * 4)) * 0.12
	shopBadge.Size = UDim2.fromOffset(54 * pulse, 26 * pulse)
end)

local function modal(name: string, title: string, accent: Color3, size: Vector2): (Frame, Frame)
	return UIKit.modal(screenGui, name, title, accent, size)
end

local toggleModal = UIKit.toggleModal

--------------------------------------------------------------------------------
-- Shop
--------------------------------------------------------------------------------

local shopFrame, shopBody = modal("Shop", "ROBUX SHOP", Color3.fromRGB(215, 70, 170), Vector2.new(700, 500))
local shopList = create("ScrollingFrame", {
	Name = "Products",
	Size = UDim2.fromScale(1, 1),
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	ScrollBarThickness = 8,
	ScrollBarImageColor3 = Color3.fromRGB(215, 70, 170),
	CanvasSize = UDim2.new(),
	AutomaticCanvasSize = Enum.AutomaticSize.Y,
	ScrollingDirection = Enum.ScrollingDirection.Y,
}, {
	create("UIGridLayout", {
		CellSize = UDim2.new(0.5, -10, 0, 170),
		CellPadding = UDim2.fromOffset(12, 12),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}),
	create("UIPadding", { PaddingRight = UDim.new(0, 8) }),
}) :: ScrollingFrame
shopList.Parent = shopBody

-- Only trust product details that belong to this experience's creator, so a
-- placeholder ID never shows another game's product.
local function fetchOwnProductInfo(productId: number): { [string]: any }?
	local ok, info = pcall(function()
		return MarketplaceService:GetProductInfoAsync(productId, Enum.InfoType.Product)
	end)
	if not ok or typeof(info) ~= "table" or game.CreatorId == 0 then
		return nil
	end
	local creator = info.Creator
	if typeof(creator) ~= "table" or creator.CreatorTargetId ~= game.CreatorId then
		return nil
	end
	return info
end

for index, product in MonetizationConfig.ShopProducts do
	local card = create("Frame", {
		Name = product.Key,
		BackgroundColor3 = COLORS.PanelLight,
		LayoutOrder = index,
	}, { corner(14), stroke(product.IconColor, 2) }) :: Frame

	local iconFrame = create("Frame", {
		Name = "Icon",
		Position = UDim2.fromOffset(10, 10),
		Size = UDim2.new(0.38, 0, 1, -20),
		BackgroundColor3 = product.IconColor,
	}, {
		corner(12),
		create("UIAspectRatioConstraint", { AspectRatio = 1 }),
	}) :: Frame
	iconFrame.Parent = card

	local iconText = label({
		Size = UDim2.fromScale(1, 1),
		Text = product.IconText,
		TextSize = 48,
	})
	iconText.Parent = iconFrame

	local iconImage = create("ImageLabel", {
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		Visible = false,
	}, { corner(12) }) :: ImageLabel
	iconImage.Parent = iconFrame

	local function showIcon(assetId: number)
		iconImage.Image = "rbxassetid://" .. tostring(assetId)
		iconImage.Visible = true
		iconText.Visible = false
	end

	-- Icon priority: an uploaded image ID from MonetizationConfig, then the
	-- Higgsfield icon packed into ReplicatedStorage.Assets, then the product's own.
	local hasIcon = false
	if product.IconAssetId > 0 then
		showIcon(product.IconAssetId)
		hasIcon = true
	elseif setImage(iconImage, AssetLoader.getProductIcon(product.Key)) then
		iconText.Visible = false
		hasIcon = true
	end

	label({
		Name = "ProductName",
		Position = UDim2.new(0.42, 0, 0, 10),
		Size = UDim2.new(0.56, 0, 0.26, 0),
		Text = product.DisplayName,
		TextSize = 24,
		TextXAlignment = Enum.TextXAlignment.Left,
	}).Parent = card

	label({
		Name = "Description",
		Position = UDim2.new(0.42, 0, 0.3, 0),
		Size = UDim2.new(0.56, 0, 0.36, 0),
		Text = product.Description,
		TextColor3 = COLORS.Muted,
		TextSize = 17,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
		OutlineThickness = 1,
	}).Parent = card

	local buyButton = button("BUY", COLORS.Buy, {
		Name = "BuyButton",
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.new(0.42, 0, 1, -10),
		Size = UDim2.new(0.55, 0, 0.26, 0),
	})
	buyButton.Parent = card
	buyButton.Activated:Connect(function()
		local ok, err = pcall(function()
			MarketplaceService:PromptProductPurchase(player, product.ProductId)
		end)
		if not ok then
			warn("[GameClient] Could not open the purchase prompt: " .. tostring(err))
		end
	end)

	task.spawn(function()
		local info = fetchOwnProductInfo(product.ProductId)
		if info == nil then
			return
		end
		local price = tonumber(info.PriceInRobux)
		if price then
			buyButton.Text = "R$ " .. NumberFormat.commas(price)
		end
		local iconId = tonumber(info.IconImageAssetId)
		if not hasIcon and iconId and iconId > 0 then
			showIcon(iconId)
		end
	end)

	card.Parent = shopList
end

--------------------------------------------------------------------------------
-- Rebirth
--------------------------------------------------------------------------------

local rebirthFrame, rebirthBody = modal("Rebirth", "REBIRTH", COLORS.Rebirth, Vector2.new(520, 460))

local rebirthInfo = label({
	Name = "Info",
	Size = UDim2.new(1, 0, 0.34, 0),
	Text = "",
	TextSize = 26,
	TextWrapped = true,
})
rebirthInfo.Parent = rebirthBody

-- The brainrots this rebirth needs in your base (you keep them).
local rebirthNeeds = label({
	Name = "Needs",
	Position = UDim2.fromScale(0, 0.36),
	Size = UDim2.new(1, 0, 0.18, 0),
	BackgroundTransparency = 0.2,
	BackgroundColor3 = COLORS.PanelLight,
	Text = "",
	TextSize = 22,
	TextWrapped = true,
})
corner(12).Parent = rebirthNeeds
rebirthNeeds.Parent = rebirthBody

local progressBack = create("Frame", {
	Name = "Progress",
	Position = UDim2.fromScale(0, 0.58),
	Size = UDim2.new(1, 0, 0.12, 0),
	BackgroundColor3 = COLORS.PanelLight,
}, { corner(12), stroke(Color3.new(0, 0, 0), 2) }) :: Frame
progressBack.Parent = rebirthBody

local progressFill = create("Frame", {
	Size = UDim2.fromScale(0, 1),
	BackgroundColor3 = COLORS.Rebirth,
}, { corner(12), gloss() }) :: Frame
progressFill.Parent = progressBack

local progressText = label({
	Size = UDim2.fromScale(1, 1),
	Text = "",
	TextSize = 22,
	ZIndex = 2,
})
progressText.Parent = progressBack

local confirmRebirthButton = button("REBIRTH", COLORS.Rebirth, {
	Name = "ConfirmButton",
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.fromScale(0.5, 1),
	Size = UDim2.new(0.7, 0, 0.2, 0),
})
confirmRebirthButton.Parent = rebirthBody

--------------------------------------------------------------------------------
-- Index: every brainrot, with a spinning 3D preview
--------------------------------------------------------------------------------

local indexFrame, indexBody = modal("Index", "INDEX", COLORS.Index, Vector2.new(760, 580))

-- Pages: every brainrot, then every Gold, Diamond and Rainbow one.
local INDEX_PAGES = { "Normal" }
for _, mutationName in FeatureConfig.MutationIndex do
	table.insert(INDEX_PAGES, mutationName)
end
local indexPage = "Normal"
local indexTabs = create("Frame", {
	Name = "Tabs",
	Size = UDim2.new(1, 0, 0, 38),
	BackgroundTransparency = 1,
}, {
	create("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }),
}) :: Frame
indexTabs.Parent = indexBody
local indexTabButtons: { [string]: TextButton } = {}
-- Per page: how many you've found and what finishing it gives.
local indexRewards = label({
	Name = "Rewards",
	Position = UDim2.fromOffset(0, 44),
	Size = UDim2.new(1, 0, 0, 46),
	BackgroundTransparency = 0.2,
	BackgroundColor3 = COLORS.PanelLight,
	RichText = true,
	Text = "",
	TextSize = 18,
	TextWrapped = true,
})
corner(10).Parent = indexRewards
indexRewards.Parent = indexBody

local indexList = create("ScrollingFrame", {
	Name = "List",
	Position = UDim2.fromOffset(0, 98),
	Size = UDim2.new(1, 0, 1, -98),
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	ScrollBarThickness = 8,
	AutomaticCanvasSize = Enum.AutomaticSize.Y,
	CanvasSize = UDim2.new(),
}, {
	create("UIGridLayout", {
		CellSize = UDim2.fromOffset(160, 210),
		CellPadding = UDim2.fromOffset(10, 10),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}),
}) :: ScrollingFrame
indexList.Parent = indexBody

type IndexCard = {
	Frame: Frame,
	Viewport: ViewportFrame,
	Owned: TextLabel,
	Name: TextLabel,
	Stroke: UIStroke,
	Definition: BrainrotConfig.Brainrot,
	Model: Model?,
}

local indexCards: { [string]: IndexCard } = {}
local rarityOrder: { [string]: number } = {}
for order, rarity in BrainrotConfig.Rarities do
	rarityOrder[rarity.Name] = order
end

for _, definition in BrainrotConfig.Brainrots do
	local rarity = BrainrotConfig.RarityByName[definition.Rarity]
	local rarityColour = if rarity then rarity.Color else Color3.new(1, 1, 1)
	local card = create("Frame", {
		Name = definition.Id,
		BackgroundColor3 = COLORS.PanelLight,
		LayoutOrder = (rarityOrder[definition.Rarity] or 0) * 1000000000 + definition.Price,
	}, { corner(12), stroke(rarityColour, 3) }) :: Frame
	local cardStroke = card:FindFirstChildOfClass("UIStroke") :: UIStroke

	local viewport = create("ViewportFrame", {
		Name = "Preview",
		Position = UDim2.fromOffset(8, 8),
		Size = UDim2.new(1, -16, 0, 110),
		BackgroundColor3 = rarityColour:Lerp(Color3.new(0, 0, 0), 0.55),
		Ambient = Color3.fromRGB(200, 200, 200),
		LightColor = Color3.new(1, 1, 1),
		LightDirection = Vector3.new(-0.4, -1, 0.6),
	}, { corner(10) }) :: ViewportFrame
	viewport.Parent = card

	local nameLabel = label({
		Name = "BrainrotName",
		Position = UDim2.fromOffset(6, 120),
		Size = UDim2.new(1, -12, 0, 22),
		Text = definition.DisplayName,
		TextSize = 20,
	})
	nameLabel.Parent = card
	label({
		Name = "Rarity",
		Position = UDim2.fromOffset(6, 142),
		Size = UDim2.new(1, -12, 0, 20),
		Text = definition.Rarity,
		TextColor3 = rarityColour,
		TextSize = 18,
	}).Parent = card
	label({
		Name = "Stats",
		Position = UDim2.fromOffset(6, 162),
		Size = UDim2.new(1, -12, 0, 20),
		Text = NumberFormat.cash(definition.IncomePerSecond) .. "/s  " .. NumberFormat.cash(definition.Price),
		TextColor3 = COLORS.Income,
		TextSize = 17,
	}).Parent = card
	local owned = label({
		Name = "Owned",
		Position = UDim2.fromOffset(6, 184),
		Size = UDim2.new(1, -12, 0, 20),
		Text = "",
		TextColor3 = COLORS.Owned,
		TextSize = 17,
	})
	owned.Parent = card

	card.Parent = indexList
	indexCards[definition.Id] = {
		Frame = card,
		Viewport = viewport,
		Owned = owned,
		Name = nameLabel,
		Stroke = cardStroke,
		Definition = definition,
		Model = nil,
	}
end

local indexModelsLoaded = false

local previewModel = UIKit.previewModel

local function loadIndexModels()
	if indexModelsLoaded then
		return
	end
	indexModelsLoaded = true
	for brainrotId, card in indexCards do
		task.spawn(function()
			local model = previewModel(brainrotId, 4)
			if model == nil then
				return
			end
			model.Parent = card.Viewport
			local camera = Instance.new("Camera")
			camera.FieldOfView = 40
			-- Models face -Z, so look at them from the front.
			camera.CFrame = CFrame.lookAt(Vector3.new(0, 0.6, -8.5), Vector3.zero)
			camera.Parent = card.Viewport
			card.Viewport.CurrentCamera = camera
			card.Model = model
		end)
	end
end

local function ownBrainrotCounts(): { [string]: number }
	local counts: { [string]: number } = {}
	local map = Workspace:FindFirstChild("Map")
	local folder = if map then map:FindFirstChild("Brainrots") else nil
	if folder == nil then
		return counts
	end
	for _, model in folder:GetChildren() do
		local brainrotId = model:GetAttribute("BrainrotId")
		if typeof(brainrotId) == "string" and model:GetAttribute("OwnerUserId") == player.UserId then
			counts[brainrotId] = (counts[brainrotId] or 0) + 1
		end
	end
	return counts
end

local function discoveredSet(): { [string]: boolean }
	local found: { [string]: boolean } = {}
	local list = player:GetAttribute("Discovered")
	if typeof(list) == "string" then
		for _, key in string.split(list, ",") do
			found[key] = true
		end
	end
	return found
end

-- Brainrots you've never had show as black silhouettes named "???".
local function refreshIndex()
	local counts = ownBrainrotCounts()
	local found = discoveredSet()
	local mutation = if indexPage ~= "Normal" then BrainrotConfig.MutationByName[indexPage] else nil
	for brainrotId, card in indexCards do
		local count = counts[brainrotId] or 0
		card.Owned.Text = if count > 0 then string.format("OWNED x%d", count) else ""
		local key = if mutation then brainrotId .. ":" .. mutation.Name else brainrotId
		local seen = found[key] == true
		local definition = card.Definition
		card.Viewport.ImageColor3 = if not seen then Color3.new(0, 0, 0) elseif mutation then mutation.Color:Lerp(Color3.new(1, 1, 1), 0.35) else Color3.new(1, 1, 1)
		card.Name.Text = if not seen then "???" elseif mutation then mutation.Name .. " " .. definition.DisplayName else definition.DisplayName
		local rarity = BrainrotConfig.RarityByName[definition.Rarity]
		card.Stroke.Color = if mutation then mutation.Color elseif rarity then rarity.Color else Color3.new(1, 1, 1)
	end

	-- What each page is worth.
	local parts: { string } = {}
	if mutation then
		local total, have = 0, 0
		for _, definition in BrainrotConfig.Brainrots do
			total += 1
			if found[definition.Id .. ":" .. mutation.Name] then
				have += 1
			end
		end
		local reward = FeatureConfig.MutationIndexRewards[mutation.Name]
		table.insert(parts, string.format("%s %d/%d", mutation.Name, have, total))
		if reward then
			table.insert(
				parts,
				string.format(
					'%s <font color="#50ff78">+%d%% income forever and %s</font>',
					if have >= total then "✅ Done:" else "Find them all:",
					math.floor(reward.Bonus * 100 + 0.5),
					NumberFormat.cash(reward.Cash)
				)
			)
		end
	else
		for _, rarity in BrainrotConfig.Rarities do
			local choices = BrainrotConfig.ByRarity[rarity.Name]
			local have = 0
			for _, definition in choices do
				if found[definition.Id] then
					have += 1
				end
			end
			local reward = FeatureConfig.IndexRewards[rarity.Name]
			local done = have >= #choices and #choices > 0
			table.insert(
				parts,
				string.format(
					'<font color="#%s">%s</font> %d/%d%s',
					rarity.Color:ToHex(),
					rarity.Name,
					have,
					#choices,
					if done then " ✅" elseif reward then string.format(" (+%d%%)", math.floor(reward.Bonus * 100 + 0.5)) else ""
				)
			)
		end
	end
	indexRewards.Text = table.concat(parts, "   ")
	for name, tab in indexTabButtons do
		tab.BackgroundColor3 = if name == indexPage then COLORS.Index else COLORS.PanelLight
	end
end

for order, pageName in INDEX_PAGES do
	local tab = button(pageName, COLORS.PanelLight, {
		Name = pageName .. "Tab",
		Size = UDim2.new(1 / #INDEX_PAGES, -8, 1, 0),
		LayoutOrder = order,
	})
	tab.Parent = indexTabs
	indexTabButtons[pageName] = tab
	tab.Activated:Connect(function()
		indexPage = pageName
		refreshIndex()
	end)
end
player:GetAttributeChangedSignal("Discovered"):Connect(function()
	if indexFrame.Visible then
		refreshIndex()
	end
end)

RunService.RenderStepped:Connect(function()
	if not indexFrame.Visible then
		return
	end
	local spin = CFrame.Angles(0, os.clock() * 0.8, 0)
	for _, card in indexCards do
		local model = card.Model
		if model then
			model:PivotTo(spin)
		end
	end
end)

--------------------------------------------------------------------------------
-- Toasts
--------------------------------------------------------------------------------

local toastContainer = create("Frame", {
	Name = "Toasts",
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.new(0.5, 0, 1, -120),
	Size = UDim2.fromOffset(500, 210),
	BackgroundTransparency = 1,
}, {
	create("UIListLayout", {
		VerticalAlignment = Enum.VerticalAlignment.Bottom,
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		Padding = UDim.new(0, 6),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}),
}) :: Frame
toastContainer.Parent = screenGui
UIKit.autoScale(toastContainer)

local toastCount = 0

local function showToast(message: string, kind: string)
	toastCount += 1
	local toast = label({
		Size = UDim2.fromOffset(500, 42),
		BackgroundTransparency = 0.05,
		BackgroundColor3 = TOAST_COLORS[kind] or TOAST_COLORS.Info,
		Text = message,
		TextSize = 24,
		TextWrapped = true,
		LayoutOrder = toastCount,
	})
	corner(12).Parent = toast
	gloss().Parent = toast
	create("UIPadding", { PaddingLeft = UDim.new(0, 12), PaddingRight = UDim.new(0, 12) }).Parent = toast
	toast.Parent = toastContainer

	local toasts: { TextLabel } = {}
	for _, child in toastContainer:GetChildren() do
		if child:IsA("TextLabel") then
			table.insert(toasts, child)
		end
	end
	table.sort(toasts, function(a, b)
		return a.LayoutOrder < b.LayoutOrder
	end)
	for index = 1, #toasts - MAX_TOASTS do
		toasts[index]:Destroy()
	end

	task.delay(TOAST_SECONDS, function()
		if toast.Parent == nil then
			return
		end
		local fade = TweenService:Create(toast, TweenInfo.new(0.4), { BackgroundTransparency = 1, TextTransparency = 1 })
		fade.Completed:Connect(function()
			toast:Destroy()
		end)
		fade:Play()
	end)
end

UIKit.setToastHandler(showToast)

notifyEvent.OnClientEvent:Connect(function(message: any, kind: any, sound: any)
	if typeof(message) ~= "string" then
		return
	end
	local toastKind = if typeof(kind) == "string" then kind else "Info"
	showToast(message, toastKind)
	local soundName = if typeof(sound) == "string" then sound else TOAST_SOUNDS[toastKind]
	if soundName then
		Sounds.play(soundName)
	end
end)

playSoundEvent.OnClientEvent:Connect(function(sound: any)
	if typeof(sound) == "string" then
		Sounds.play(sound)
	end
end)

--------------------------------------------------------------------------------
-- Gear Shop (opened from the Gear Shop stall)
--------------------------------------------------------------------------------

local gearFrame, gearBody = modal("GearShop", "GEAR SHOP", COLORS.Gear, Vector2.new(660, 500))
create("UIListLayout", {
	Padding = UDim.new(0, 10),
	SortOrder = Enum.SortOrder.LayoutOrder,
}).Parent = gearBody

type GearCard = { Button: TextButton, Gear: GearConfig.Gear }
local gearCards: { GearCard } = {}
local gearPending = false

local function ownsGear(gearId: string): boolean
	local owned = player:GetAttribute("OwnedGear")
	if typeof(owned) ~= "string" then
		return false
	end
	return table.find(string.split(owned, ","), gearId) ~= nil
end

local function refreshGearShop()
	for _, card in gearCards do
		local owned = ownsGear(card.Gear.Id)
		card.Button.Text = if owned
			then "OWNED"
			elseif card.Gear.Price <= 0 then "FREE"
			else NumberFormat.cash(card.Gear.Price)
		card.Button.BackgroundColor3 = if owned then COLORS.Disabled else COLORS.Buy
	end
end

for _, gear in GearConfig.Gear do
	local card = create("Frame", {
		Name = gear.Id,
		Size = UDim2.new(1, 0, 0.25, -8),
		BackgroundColor3 = COLORS.PanelLight,
		LayoutOrder = gear.Order,
	}, { corner(14), stroke(gear.Color, 2) }) :: Frame

	local tile = create("Frame", {
		Name = "Icon",
		Position = UDim2.fromOffset(8, 8),
		Size = UDim2.new(0.14, 0, 1, -16),
		BackgroundColor3 = gear.Color,
	}, {
		corner(12),
		gloss(),
		create("UIAspectRatioConstraint", { AspectRatio = 1 }),
	}) :: Frame
	label({
		Size = UDim2.fromScale(1, 1),
		Text = string.sub(gear.DisplayName, 1, 1),
		TextSize = 40,
		OutlineThickness = 3,
	}).Parent = tile
	tile.Parent = card

	label({
		Name = "GearName",
		Position = UDim2.new(0.17, 0, 0, 6),
		Size = UDim2.new(0.55, 0, 0.42, 0),
		Text = gear.DisplayName,
		TextSize = 26,
		TextXAlignment = Enum.TextXAlignment.Left,
	}).Parent = card
	label({
		Name = "Description",
		Position = UDim2.new(0.17, 0, 0.46, 0),
		Size = UDim2.new(0.55, 0, 0.48, 0),
		Text = gear.Description,
		TextColor3 = COLORS.Muted,
		TextSize = 16,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
		OutlineThickness = 1,
	}).Parent = card

	local buyButton = button("", COLORS.Buy, {
		Name = "BuyButton",
		AnchorPoint = Vector2.new(1, 0.5),
		Position = UDim2.new(1, -10, 0.5, 0),
		Size = UDim2.new(0.24, 0, 0.6, 0),
	})
	buyButton.Parent = card
	buyButton.Activated:Connect(function()
		if gearPending or ownsGear(gear.Id) then
			return
		end
		gearPending = true
		local ok, success, message = pcall(function()
			local buyGear = remotes:WaitForChild("BuyGear", 10)
			if buyGear == nil or not buyGear:IsA("RemoteFunction") then
				return false, "The Gear Shop is closed right now."
			end
			return buyGear:InvokeServer(gear.Id)
		end)
		gearPending = false
		local bought = ok and success == true
		showToast(if ok and typeof(message) == "string" then message else "Couldn't buy that, try again.", if bought then "Success" else "Error")
		Sounds.play(if bought then "Purchase" else "Error")
		refreshGearShop()
	end)

	card.Parent = gearBody
	table.insert(gearCards, { Button = buyButton, Gear = gear })
end
refreshGearShop()
player:GetAttributeChangedSignal("OwnedGear"):Connect(refreshGearShop)

--------------------------------------------------------------------------------
-- Live values
--------------------------------------------------------------------------------

local cashValue: IntValue? = nil
local rebirthsValue: IntValue? = nil
local shownCash: number? = nil
local cashPopups = 0

local function getCash(): number
	return if cashValue then cashValue.Value else 0
end

local function getRebirths(): number
	return if rebirthsValue then rebirthsValue.Value else 0
end

-- "+$X" rising above the Cash counter when Cash goes up.
local function showCashPopup(amount: number)
	if cashPopups >= MAX_CASH_POPUPS then
		return
	end
	cashPopups += 1
	local popup = label({
		Name = "CashPopup",
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.new(0, 22, 1, -108),
		Size = UDim2.fromOffset(260, 30),
		Text = "+" .. NumberFormat.cash(amount),
		TextColor3 = COLORS.Cash,
		TextSize = 30,
		TextXAlignment = Enum.TextXAlignment.Left,
	})
	popup.Parent = screenGui
	local rise = TweenService:Create(popup, TweenInfo.new(1.2, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		Position = UDim2.new(0, 22, 1, -170),
		TextTransparency = 1,
	})
	rise.Completed:Connect(function()
		cashPopups -= 1
		popup:Destroy()
	end)
	rise:Play()
end

local function refreshRebirthScreen()
	local rebirths = getRebirths()
	local cash = getCash()
	local cost = GameConfig.getRebirthCost(rebirths)
	rebirthInfo.Text = string.format(
		"Rebirth %d  ->  %d\nIncome x%s  ->  x%s\nResets your Cash. You keep your brainrots.",
		rebirths,
		rebirths + 1,
		tostring(GameConfig.getRebirthIncomeMultiplier(rebirths)),
		tostring(GameConfig.getRebirthIncomeMultiplier(rebirths + 1))
	)
	local progress = math.clamp(cash / cost, 0, 1)
	progressFill.Size = UDim2.fromScale(progress, 1)
	progressText.Text = string.format("%s / %s", NumberFormat.cash(cash), NumberFormat.cash(cost))
	-- Which of the brainrots this rebirth needs are in your base.
	local counts = ownBrainrotCounts()
	local needs: { string } = {}
	local haveAll = true
	for _, brainrotId in FeatureConfig.getRebirthRequirement(rebirths) do
		local definition = BrainrotConfig.ById[brainrotId]
		local has = (counts[brainrotId] or 0) > 0
		haveAll = haveAll and has
		table.insert(needs, (if has then "✅ " else "❌ ") .. (if definition then definition.DisplayName else brainrotId))
	end
	rebirthNeeds.Text = "Needs in your base: " .. table.concat(needs, "   ")
	rebirthNeeds.TextColor3 = if haveAll then COLORS.Owned else Color3.new(1, 1, 1)
	confirmRebirthButton.BackgroundColor3 = if cash >= cost and haveAll then COLORS.Rebirth else COLORS.Disabled
end

local function refreshCash()
	local cash = getCash()
	local previous = shownCash
	if previous and cash > previous then
		showCashPopup(cash - previous)
	end
	shownCash = cash
	cashLabel.Text = NumberFormat.cash(cash)
	if rebirthFrame.Visible then
		refreshRebirthScreen()
	end
end

task.spawn(function()
	local leaderstats = player:WaitForChild("leaderstats")
	local cash = leaderstats:WaitForChild("Cash")
	local rebirths = leaderstats:WaitForChild("Rebirths")
	if cash:IsA("IntValue") then
		cashValue = cash
		cash.Changed:Connect(refreshCash)
	end
	if rebirths:IsA("IntValue") then
		rebirthsValue = rebirths
		rebirths.Changed:Connect(refreshCash)
	end
	refreshCash()
end)

local function openShop()
	if not shopFrame.Visible then
		toggleModal(shopFrame)
	end
end

shopButton.Activated:Connect(function()
	toggleModal(shopFrame)
end)

rebirthButton.Activated:Connect(function()
	if toggleModal(rebirthFrame) then
		refreshRebirthScreen()
	end
end)

indexButton.Activated:Connect(function()
	if toggleModal(indexFrame) then
		refreshIndex()
		loadIndexModels()
	end
end)

local rebirthPending = false
confirmRebirthButton.Activated:Connect(function()
	if rebirthPending then
		return
	end
	rebirthPending = true
	local ok, success, message = pcall(function()
		return requestRebirthFunction:InvokeServer()
	end)
	rebirthPending = false
	if ok and typeof(message) == "string" then
		showToast(message, if success == true then "Success" else "Error")
		Sounds.play(if success == true then "Rebirth" else "Error")
		if success == true then
			rebirthFrame.Visible = false
		end
	else
		showToast("Rebirth failed, try again.", "Error")
		Sounds.play("Error")
	end
end)

-- The stalls between the bases open the Robux Shop and the Gear Shop.
local function connectStall(stallName: string, promptName: string, open: () -> ())
	task.spawn(function()
		local map = Workspace:WaitForChild("Map", 30)
		local stall = if map then map:WaitForChild(stallName, 30) else nil
		local counter = if stall then stall:WaitForChild("Counter", 30) else nil
		local prompt = if counter then counter:WaitForChild(promptName, 30) else nil
		if prompt and prompt:IsA("ProximityPrompt") then
			prompt.Triggered:Connect(open)
		end
	end)
end

connectStall("ShopStall", "ShopPrompt", openShop)
connectStall("GearShop", "GearPrompt", function()
	if not gearFrame.Visible then
		toggleModal(gearFrame)
		refreshGearShop()
	end
end)

-- Music volume lives in Settings (FeaturesClient).
Sounds.startMusic()

--------------------------------------------------------------------------------
-- Timers, income, "YOUR BASE" marker and clouds
--------------------------------------------------------------------------------

local baseMarker = create("BillboardGui", {
	Name = "YourBaseMarker",
	Size = UDim2.fromOffset(300, 110),
	StudsOffsetWorldSpace = Vector3.new(0, 9, 0),
	AlwaysOnTop = true,
	LightInfluence = 0,
	Enabled = false,
}, {
	label({
		Name = "Title",
		Size = UDim2.new(1, 0, 0.6, 0),
		Text = "YOUR BASE",
		TextSize = 48,
		OutlineThickness = 3,
	}) :: Instance,
	label({
		Name = "Arrow",
		Position = UDim2.fromScale(0, 0.55),
		Size = UDim2.new(1, 0, 0.45, 0),
		Text = "▼",
		TextSize = 40,
		OutlineThickness = 3,
	}) :: Instance,
}) :: BillboardGui
baseMarker.Parent = playerGui

local function findOwnSign(): BasePart?
	local map = Workspace:FindFirstChild("Map")
	local plotsFolder = if map then map:FindFirstChild("Plots") else nil
	if plotsFolder == nil then
		return nil
	end
	for _, plot in plotsFolder:GetChildren() do
		if plot:GetAttribute("OwnerUserId") == player.UserId then
			local sign = plot:FindFirstChild("Sign")
			if sign and sign:IsA("BasePart") then
				return sign
			end
		end
	end
	return nil
end

do
	local terrain = Workspace:FindFirstChildOfClass("Terrain")
	if terrain and terrain:FindFirstChildOfClass("Clouds") == nil then
		create("Clouds", { Cover = 0.55, Density = 0.55, Color = Color3.new(1, 1, 1) }).Parent = terrain
	end
end

task.spawn(function()
	while true do
		local now = Workspace:GetServerTimeNow()

		local boostEndsAt = tonumber(ReplicatedStorage:GetAttribute("ServerRarityBoostEndsAt")) or 0
		local boostMultiplier = tonumber(ReplicatedStorage:GetAttribute("ServerRarityMultiplier")) or 1
		boostChip.Visible = boostEndsAt > now and boostMultiplier > 1
		if boostChip.Visible then
			boostChip.Text = string.format("x%s RARITY BOOST  %s", tostring(boostMultiplier), NumberFormat.duration(boostEndsAt - now))
		end

		local empEndsAt = tonumber(player:GetAttribute("LaserBypassEndsAt")) or 0
		empChip.Visible = empEndsAt > now
		if empChip.Visible then
			empChip.Text = "EMP LASER BYPASS  " .. NumberFormat.duration(empEndsAt - now)
		end

		local eventName = ReplicatedStorage:GetAttribute("EventName")
		local eventEndsAt = tonumber(ReplicatedStorage:GetAttribute("EventEndsAt")) or 0
		eventChip.Visible = typeof(eventName) == "string" and eventEndsAt > now
		if eventChip.Visible then
			eventChip.Text = string.format("%s  %s", string.upper(tostring(eventName)), NumberFormat.duration(eventEndsAt - now))
			local sky = ReplicatedStorage:GetAttribute("EventSky")
			eventChip.BackgroundColor3 = if typeof(sky) == "string" then EVENT_COLORS[sky] or COLORS.Boost else COLORS.Boost
		end

		local cashBoostEndsAt = tonumber(player:GetAttribute("CashBoostEndsAt")) or 0
		cashBoostChip.Visible = cashBoostEndsAt > now
		if cashBoostChip.Visible then
			cashBoostChip.Text = "2X CASH  " .. NumberFormat.duration(cashBoostEndsAt - now)
		end

		local income = tonumber(player:GetAttribute("IncomePerSecond")) or 0
		incomeLabel.Text = "+" .. NumberFormat.cash(income) .. "/s"
		local multiplier = tonumber(player:GetAttribute("IncomeMultiplier")) or 1
		boostPill.Visible = multiplier > 1.001
		boostPill.Text = string.format("x%.2f", multiplier):gsub("%.?0+$", "")
		local info = player:GetAttribute("BoostInfo")
		boostTip.Text = if typeof(info) == "string" and info ~= "" then info else "No boosts yet"

		local sign = findOwnSign()
		if sign then
			baseMarker.Adornee = sign
		end
		baseMarker.Enabled = sign ~= nil

		task.wait(0.25)
	end
end)

--------------------------------------------------------------------------------
-- Prompt filtering
--------------------------------------------------------------------------------

local function refreshPrompt(prompt: ProximityPrompt)
	local kind = prompt:GetAttribute("PromptKind")
	local ownedByMe = prompt:GetAttribute("OwnerUserId") == player.UserId
	if kind == "Snipe" then
		-- Someone else's brainrot walking home can be bought off them.
		prompt.Enabled = prompt:GetAttribute("Snipeable") == true and not ownedByMe
		return
	end
	if kind ~= "Steal" and kind ~= "Sell" and kind ~= "Upgrade" and kind ~= "Open" then
		return
	end
	local busy = prompt:GetAttribute("Carried") == true or prompt:GetAttribute("Walking") == true
	-- Only the owner sells, upgrades pedestals and opens lucky blocks.
	local forMe = if kind == "Steal" then not ownedByMe else ownedByMe
	if kind == "Upgrade" and prompt:GetAttribute("MaxLevel") == true then
		forMe = false
	end
	prompt.Enabled = not busy and forMe
end

local function trackPrompt(instance: Instance)
	if not instance:IsA("ProximityPrompt") then
		return
	end
	refreshPrompt(instance)
	for _, attribute in { "Carried", "Walking", "Snipeable", "OwnerUserId", "MaxLevel" } do
		instance:GetAttributeChangedSignal(attribute):Connect(function()
			refreshPrompt(instance)
		end)
	end
end

Workspace.DescendantAdded:Connect(trackPrompt)
for _, descendant in Workspace:GetDescendants() do
	trackPrompt(descendant)
end

screenGui.Parent = playerGui

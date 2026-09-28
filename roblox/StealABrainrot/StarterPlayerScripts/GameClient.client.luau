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
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local AssetLoader = require(Shared:WaitForChild("AssetLoader"))
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))
local ExtrasConfig = require(Shared:WaitForChild("ExtrasConfig"))
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
-- What a controller has selected gets a yellow outline.
playerGui.SelectionImageObject = UIKit.selectionHighlight()

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

-- Your income multiplier (bottom-right corner); tap it for the list of
-- boosts (rebirths, passes, friends, Premium, Index...).
local boostPill = button("x1", Color3.fromRGB(255, 170, 40), {
	Name = "BoostPill",
	AnchorPoint = Vector2.new(1, 1),
	Position = UDim2.new(1, -16, 1, -16),
	Size = UDim2.fromOffset(110, 40),
	Visible = false,
})
boostPill.Parent = screenGui
local boostTip = label({
	Name = "BoostInfo",
	AnchorPoint = Vector2.new(1, 1),
	Position = UDim2.new(1, -16, 1, -64),
	Size = UDim2.fromOffset(280, 130),
	BackgroundTransparency = 0.1,
	BackgroundColor3 = COLORS.Panel,
	Text = "",
	TextSize = 20,
	TextXAlignment = Enum.TextXAlignment.Left,
	TextYAlignment = Enum.TextYAlignment.Bottom,
	Visible = false,
})
corner(10).Parent = boostTip
create("UIPadding", { PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10), PaddingBottom = UDim.new(0, 8), PaddingTop = UDim.new(0, 8) }).Parent = boostTip
boostTip.Parent = screenGui
-- The Cash, income and boost pill shrink on small screens, like the side
-- buttons. On phones and tablets Roblox's jump button sits in the
-- bottom-right corner, so the boost pill goes above it there.
local function placeMoney()
	local camera = Workspace.CurrentCamera
	local size = if camera then camera.ViewportSize else nil
	local viewport = if typeof(size) == "Vector2" and size.Y > 1 then size else Vector2.new(1280, 760)
	local factor = math.clamp(math.min(viewport.Y / 760, viewport.X / 1280), 0.6, 1)
	cashLabel.Size = UDim2.fromOffset(340 * factor, 64 * factor)
	incomeLabel.Size = UDim2.fromOffset(260 * factor, 28 * factor)
	incomeLabel.Position = UDim2.new(0, 20, 1, -14 - 66 * factor)
	local touchOnly = UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled
	local bottom = if not touchOnly then 16 elseif math.min(viewport.X, viewport.Y) <= 500 then 110 else 230
	boostPill.Size = UDim2.fromOffset(110 * factor, 40 * factor)
	boostPill.Position = UDim2.new(1, -16, 1, -bottom)
	boostTip.Position = UDim2.new(1, -16, 1, -bottom - 40 * factor - 8)
end
placeMoney()
if Workspace.CurrentCamera then
	Workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(placeMoney)
end
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
local sideButtons = UIKit.sideColumn(screenGui, "SideButtons", 3, {})

UIKit.placeSideColumn(sideButtons, false, 0)

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
-- Shop, like Grow a Garden's: a wooden window with a studded green title bar.
-- This week's OG limited brainrot on a rainbow LIMITED TIME card (with a
-- countdown and every OG in the rotation), the lucky blocks on cards showing
-- what they open into, then a coloured band per section with a tile for each
-- item: its icon, name and a green Robux button. The window takes the room
-- the screen has, so on a phone its buttons stay big and it has fewer
-- columns; a controller starts on the limited's Buy button and B closes it.
--------------------------------------------------------------------------------

local GARDEN = UIKit.Garden
local shopFrame, shopBody = modal("Shop", "Robux Shop", GARDEN.Green, Vector2.new(820, 620))
UIKit.gardenStyle(shopFrame)
-- A scrolling list of dark wood, for the shops' cards, bands and tiles.
local function woodList(name: string): ScrollingFrame
	return create("ScrollingFrame", {
		Name = name,
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = GARDEN.WoodDark,
		BorderSizePixel = 0,
		ScrollBarThickness = if UserInputService.TouchEnabled then 14 else 10,
		ScrollBarImageColor3 = Color3.fromRGB(235, 195, 125),
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ScrollingDirection = Enum.ScrollingDirection.Y,
		SelectionGroup = true,
	}, {
		corner(10),
		stroke(GARDEN.WoodEdge, 3),
		create("UIPadding", {
			PaddingLeft = UDim.new(0, 10),
			PaddingRight = UDim.new(0, 20),
			PaddingTop = UDim.new(0, 10),
			PaddingBottom = UDim.new(0, 12),
		}),
		create("UIListLayout", {
			Padding = UDim.new(0, 12),
			SortOrder = Enum.SortOrder.LayoutOrder,
			HorizontalAlignment = Enum.HorizontalAlignment.Center,
		}),
	}) :: ScrollingFrame
end

-- A coloured band across a list with a section's title and a note.
local function sectionBand(name: string, title: string, note: string, colour: Color3, order: number): Frame
	local band = create("Frame", {
		Name = name,
		LayoutOrder = order,
		Size = UDim2.new(1, 0, 0, 52),
		BackgroundColor3 = colour,
	}, {
		corner(10),
		stroke(colour:Lerp(Color3.new(0, 0, 0), 0.55), 3),
		gloss(),
	}) :: Frame
	UIKit.addStuds(band, 26, 0.6)
	label({
		Name = "Title",
		Position = UDim2.fromOffset(16, 4),
		Size = UDim2.new(0.6, 0, 1, -8),
		Text = title,
		TextSize = 36,
		TextXAlignment = Enum.TextXAlignment.Left,
		OutlineThickness = 3,
	}).Parent = band
	label({
		Name = "Note",
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -16, 0, 10),
		Size = UDim2.new(0.36, 0, 1, -20),
		Text = note,
		TextColor3 = Color3.fromRGB(255, 240, 150),
		TextSize = 24,
		TextXAlignment = Enum.TextXAlignment.Right,
	}).Parent = band
	return band
end

-- A grid of tiles, and a function laying it out for a list `width` wide: up
-- to 4 columns of tiles at least `minWidth` (166) wide, so fewer, bigger ones
-- on a phone, and no taller than `maxHeight` if given (so a whole tile shows).
-- A `balanced` grid uses as few columns as fit its tiles in the same number of
-- rows (2 by 2, not 3 and 1).
local function tileGrid(
	name: string,
	order: number,
	minWidth: number?,
	balanced: boolean?
): (Frame, (width: number, maxHeight: number?) -> ())
	local layout = create("UIGridLayout", {
		CellPadding = UDim2.fromOffset(10, 10),
		SortOrder = Enum.SortOrder.LayoutOrder,
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
	}) :: UIGridLayout
	local grid = create("Frame", {
		Name = name,
		LayoutOrder = order,
		BackgroundTransparency = 1,
	}) :: Frame
	layout.Parent = grid
	return grid, function(width: number, maxHeight: number?)
		local count = 0
		for _, child in grid:GetChildren() do
			if child:IsA("GuiObject") then
				count += 1
			end
		end
		local columns = math.clamp(math.floor((width + 10) / ((minWidth or 166) + 10)), 2, 4)
		local rows = math.ceil(count / columns)
		while balanced and columns > 2 and math.ceil(count / (columns - 1)) == rows do
			columns -= 1
		end
		local cellWidth = math.floor((width - (columns - 1) * 10) / columns)
		if maxHeight then
			cellWidth = math.min(cellWidth, math.floor(maxHeight / 1.58))
		end
		local cellHeight = math.floor(cellWidth * 1.58)
		layout.CellSize = UDim2.fromOffset(cellWidth, cellHeight)
		grid.Size = UDim2.new(1, 0, 0, rows * cellHeight + math.max(0, rows - 1) * 10)
	end
end

local shopList = woodList("Products")
shopList.Parent = shopBody

-- Only trust product details that belong to this experience's creator, so a
-- placeholder ID never shows another game's product.
local function fetchOwnProductInfo(productId: number, infoType: Enum.InfoType): { [string]: any }?
	local ok, info = pcall(function()
		return MarketplaceService:GetProductInfoAsync(productId, infoType)
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

-- Roblox's purchase window for a product or pass (never for a placeholder ID).
local function promptPurchase(productId: number, gamePass: boolean?)
	if not MonetizationConfig.isSetUp(productId) then
		UIKit.toast(MonetizationConfig.NotSetUpMessage, "Warning")
		Sounds.play("Error")
		return
	end
	local ok, err = pcall(function()
		if gamePass then
			MarketplaceService:PromptGamePassPurchase(player, productId)
		else
			MarketplaceService:PromptProductPurchase(player, productId)
		end
	end)
	if not ok then
		warn("[GameClient] Could not open the purchase prompt: " .. tostring(err))
	end
end

-- A product's icon filling `holder`: an uploaded image (MonetizationConfig),
-- else the icon packed in ReplicatedStorage.Assets, else its IconText. Returns
-- a function to show the product's own Roblox icon if it has none of those.
local function productIcon(holder: GuiObject, product: MonetizationConfig.ShopProduct): (number) -> ()
	local image = create("ImageLabel", {
		Name = "Image",
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		Visible = false,
	}, { corner(10) }) :: ImageLabel
	image.Parent = holder
	local iconText = label({
		Name = "IconText",
		Size = UDim2.fromScale(1, 1),
		Text = product.IconText,
		TextSize = 48,
	})
	iconText.Parent = holder
	local function show(assetId: number)
		image.Image = "rbxassetid://" .. tostring(assetId)
		image.Visible = true
		iconText.Visible = false
	end
	if product.IconAssetId > 0 then
		show(product.IconAssetId)
	elseif setImage(image, AssetLoader.getProductIcon(product.Key)) then
		iconText.Visible = false
	end
	return function(assetId: number)
		if not image.Visible then
			show(assetId)
		end
	end
end

-- A product's green Robux button: its price (the real one once Roblox has
-- it), OWNED for a pass you have, and the purchase when pressed.
local function sellOn(buy: TextButton, setPrice: (string, boolean) -> (), product: MonetizationConfig.ShopProduct, onIcon: ((number) -> ())?)
	local owned = false
	setPrice(NumberFormat.commas(product.Robux), true)
	local function showOwned()
		owned = true
		setPrice("OWNED", false)
		UIKit.setEnabled(buy, false, GARDEN.Buy)
	end
	-- A pass sold as a developer product: bought like one, owned per the server.
	local soldAsProduct = product.GamePass == true and MonetizationConfig.PassesSoldAsProducts[product.Key] == true
	local isPass = product.GamePass == true and not soldAsProduct
	buy.Activated:Connect(function()
		if not owned then
			promptPurchase(product.ProductId, isPass)
		end
	end)
	if soldAsProduct then
		local attribute = "OwnsGamePass_" .. product.Key
		local function checkOwned()
			if not owned and player:GetAttribute(attribute) == true then
				showOwned()
			end
		end
		player:GetAttributeChangedSignal(attribute):Connect(checkOwned)
		checkOwned()
	elseif isPass and MonetizationConfig.isSetUp(product.ProductId) then
		task.spawn(function()
			local ok, has = pcall(function()
				return MarketplaceService:UserOwnsGamePassAsync(player.UserId, product.ProductId)
			end)
			if ok and has == true then
				showOwned()
			end
		end)
		MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(who: Player, passId: number, purchased: boolean)
			if who == player and passId == product.ProductId and purchased then
				showOwned()
			end
		end)
	end
	task.spawn(function()
		local info = fetchOwnProductInfo(product.ProductId, if isPass then Enum.InfoType.GamePass else Enum.InfoType.Product)
		if info == nil then
			return
		end
		local price = tonumber(info.PriceInRobux)
		if price and not owned then
			setPrice(NumberFormat.commas(price), true)
		end
		local iconId = tonumber(info.IconImageAssetId)
		if onIcon and iconId and iconId > 0 then
			onIcon(iconId)
		end
	end)
end

-- A brainrot's picture in a slot, with a label along the bottom.
local function brainrotSlot(brainrotId: string, caption: string, captionColour: Color3, highlight: boolean): Frame
	local slot = create("Frame", {
		Name = brainrotId,
		BackgroundColor3 = Color3.new(0, 0, 0),
		BackgroundTransparency = 0.45,
	}, {
		corner(10),
		stroke(if highlight then Color3.fromRGB(255, 225, 60) else Color3.new(1, 1, 1), if highlight then 4 else 2),
	}) :: Frame
	UIKit.brainrotViewport(brainrotId, Color3.fromRGB(40, 30, 60), {
		Name = "Picture",
		Position = UDim2.fromOffset(4, 4),
		Size = UDim2.new(1, -8, 1, -8),
		BackgroundTransparency = 1,
	}).Parent = slot
	label({
		Name = "Caption",
		AnchorPoint = Vector2.new(1, 1),
		Position = UDim2.new(1, -4, 1, -2),
		Size = UDim2.new(1, -8, 0.3, 0),
		Text = caption,
		TextColor3 = captionColour,
		TextSize = 26,
		TextXAlignment = Enum.TextXAlignment.Right,
		OutlineThickness = 3,
	}).Parent = slot
	return slot
end

local RAINBOW_CARD = ColorSequence.new({
	ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 80, 200)),
	ColorSequenceKeypoint.new(0.25, Color3.fromRGB(255, 200, 40)),
	ColorSequenceKeypoint.new(0.5, Color3.fromRGB(70, 220, 90)),
	ColorSequenceKeypoint.new(0.75, Color3.fromRGB(40, 170, 255)),
	ColorSequenceKeypoint.new(1, Color3.fromRGB(150, 80, 255)),
})

-- Resizes everything for the window's width (see the end of this section).
local shopLayouts: { (width: number) -> () } = {}

-- 1. This week's limited brainrot (OG), for a limited time.
local limitedBuyButton: TextButton
do
	local card = create("Frame", {
		Name = "Limited",
		LayoutOrder = 1,
		Size = UDim2.new(1, 0, 0, 236),
		BackgroundColor3 = Color3.new(1, 1, 1),
	}, {
		corner(14),
		stroke(GARDEN.WoodEdge, 4),
		create("UIGradient", { Color = RAINBOW_CARD, Rotation = 20 }),
	}) :: Frame
	UIKit.addStuds(card, 30, 0.78)
	local badge = label({
		Name = "OG",
		Position = UDim2.fromOffset(14, 6),
		Size = UDim2.fromOffset(90, 42),
		Rotation = -6,
		Text = "OG!",
		TextColor3 = Color3.fromRGB(255, 235, 60),
		TextSize = 40,
		OutlineThickness = 3,
	})
	badge.Parent = card
	-- (Between the OG badge and the countdown.)
	local title = label({
		Name = "Title",
		Position = UDim2.fromOffset(110, 8),
		Size = UDim2.new(0.73, -122, 0, 42),
		Text = "",
		TextSize = 40,
		OutlineThickness = 3,
	})
	title.Parent = card
	label({
		Name = "LimitedTime",
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -12, 0, 6),
		Size = UDim2.new(0.25, 0, 0, 26),
		Text = "LIMITED TIME!",
		TextColor3 = Color3.fromRGB(255, 60, 60),
		TextSize = 26,
		OutlineThickness = 3,
	}).Parent = card
	local timer = label({
		Name = "Timer",
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -12, 0, 32),
		Size = UDim2.new(0.25, 0, 0, 24),
		Text = "",
		TextColor3 = Color3.fromRGB(255, 215, 215),
		TextSize = 26,
		OutlineThickness = 3,
	})
	timer.Parent = card
	local icon = create("Frame", {
		Name = "Icon",
		Position = UDim2.fromOffset(10, 56),
		Size = UDim2.fromOffset(166, 166),
		Rotation = -6,
		BackgroundTransparency = 1,
	}) :: Frame
	icon.Parent = card
	local iconImage = create("ImageLabel", {
		Name = "Image",
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		Visible = false,
	}, { corner(14), stroke(GARDEN.WoodEdge, 3) }) :: ImageLabel
	iconImage.Parent = icon
	local slots = create("Frame", {
		Name = "Slots",
		Position = UDim2.fromOffset(188, 58),
		Size = UDim2.new(1, -200, 0, 112),
		BackgroundTransparency = 1,
	}, {
		create("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			Padding = UDim.new(0, 8),
			SortOrder = Enum.SortOrder.LayoutOrder,
			VerticalAlignment = Enum.VerticalAlignment.Center,
		}),
	}) :: Frame
	slots.Parent = card
	local info = label({
		Name = "Info",
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.new(0, 188, 1, -12),
		Size = UDim2.new(1, -420, 0, 44),
		Text = "",
		TextSize = 22,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
	})
	info.Parent = card
	local buy, setPrice = UIKit.robuxButton({
		Name = "BuyLimited",
		AnchorPoint = Vector2.new(1, 1),
		Position = UDim2.new(1, -12, 1, -10),
		Size = UDim2.fromOffset(210, 50),
	})
	buy.Parent = card
	limitedBuyButton = buy
	card.Parent = shopList

	-- This week's limited and how long it has left, as the server tells it.
	local function weeklyLimited(): (ExtrasConfig.Limited, number)
		local id = ReplicatedStorage:GetAttribute("LimitedId")
		local endsAt = ReplicatedStorage:GetAttribute("LimitedEndsAt")
		for _, limited in ExtrasConfig.LimitedRotation do
			if limited.Id == id and typeof(endsAt) == "number" then
				return limited, endsAt - Workspace:GetServerTimeNow()
			end
		end
		local limited, localEndsAt = ExtrasConfig.currentLimited(os.time())
		return limited, localEndsAt - os.time()
	end
	local current: ExtrasConfig.Limited? = nil
	buy.Activated:Connect(function()
		if current then
			promptPurchase((MonetizationConfig.ProductIds :: { [string]: number })[current.Product] or 0, false)
		end
	end)
	local slotCount = 5
	local shown: string? = nil
	local function refresh()
		local limited, secondsLeft = weeklyLimited()
		local left = math.max(0, math.floor(secondsLeft))
		timer.Text = string.format("%02d:%02d:%02d:%02d", left // 86400, left // 3600 % 24, left // 60 % 60, left % 60)
		if shown == limited.Id .. slotCount then
			return
		end
		shown = limited.Id .. slotCount
		current = limited
		local definition = BrainrotConfig.ById[limited.Id]
		title.Text = if definition then string.upper(definition.DisplayName) .. "!" else ""
		info.Text = if definition
			then string.format("%s · %s/s · rarer than any Secret!", definition.Rarity, NumberFormat.cash(definition.IncomePerSecond))
			else ""
		setPrice(NumberFormat.commas(limited.Robux), true)
		if not setImage(iconImage, AssetLoader.getProductIcon(limited.Product)) then
			iconImage.Visible = false
			for _, child in icon:GetChildren() do
				if child:IsA("ViewportFrame") then
					child:Destroy()
				end
			end
			UIKit.brainrotViewport(limited.Id, Color3.fromRGB(60, 30, 90), { Size = UDim2.fromScale(1, 1) }).Parent = icon
		end
		-- Every OG in the rotation: this week's, then the weeks after.
		for _, child in slots:GetChildren() do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		local rotation = ExtrasConfig.LimitedRotation
		local start = table.find(rotation, limited) or 1
		for index = 1, math.min(slotCount, #rotation) do
			local entry = rotation[(start - 1 + index - 1) % #rotation + 1]
			local now = index == 1
			local slot = brainrotSlot(
				entry.Id,
				if now then "NOW!" else string.format("IN %d WK", index - 1),
				if now then Color3.fromRGB(120, 255, 120) else Color3.fromRGB(255, 255, 255),
				now
			)
			slot.LayoutOrder = index
			slot.Size = UDim2.new(1 / slotCount, -8 * (slotCount - 1) / slotCount, 1, 0)
			slot.Parent = slots
		end
	end
	refresh()
	task.spawn(function()
		while true do
			task.wait(1)
			if shopFrame.Visible then
				refresh()
			end
		end
	end)
	table.insert(shopLayouts, function(width: number)
		-- Narrow (a phone): fewer slots, and the text over the whole bottom.
		local narrow = width < 640
		slotCount = if width < 520 then 3 elseif narrow then 4 else 5
		info.Visible = not narrow
		refresh()
	end)
end

-- 2. The lucky blocks, on cards showing what each opens into and how likely.
local luckyOrder = 2
for _, product in MonetizationConfig.ShopProducts do
	if product.Section ~= "Lucky" then
		continue
	end
	local blockId = MonetizationConfig.LuckyBlockProducts[product.Key]
	local block = if blockId then BrainrotConfig.ById[blockId] else nil
	local card = create("Frame", {
		Name = product.Key,
		LayoutOrder = luckyOrder,
		Size = UDim2.new(1, 0, 0, 206),
		BackgroundColor3 = Color3.new(1, 1, 1),
	}, {
		corner(14),
		stroke(GARDEN.WoodEdge, 4),
		create("UIGradient", {
			Color = ColorSequence.new(
				(if block then block.BodyColor else product.IconColor):Lerp(Color3.new(1, 1, 1), 0.1),
				(if block then block.AccentColor else product.IconColor):Lerp(Color3.new(0, 0, 0), 0.25)
			),
			Rotation = 20,
		}),
	}) :: Frame
	luckyOrder += 1
	UIKit.addStuds(card, 30, 0.8)
	label({
		Name = "Title",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 70, 0, 6),
		Size = UDim2.new(1, -180, 0, 40),
		Text = string.upper(product.DisplayName) .. "!",
		TextSize = 36,
		OutlineThickness = 3,
	}).Parent = card
	local iconFrame = create("Frame", {
		Name = "Icon",
		Position = UDim2.fromOffset(10, 22),
		Size = UDim2.fromOffset(150, 150),
		Rotation = -6,
		BackgroundTransparency = 1,
	}) :: Frame
	iconFrame.Parent = card
	local onIcon = productIcon(iconFrame, product)
	-- A slot per rarity it opens into (showing that rarity's best brainrot)
	-- and one per particular brainrot it can give (with a gold border and no
	-- name), in a grid that wraps onto more rows (and a taller card) when
	-- they don't fit.
	local grid = create("UIGridLayout", {
		CellSize = UDim2.fromOffset(96, 96),
		CellPadding = UDim2.fromOffset(8, 8),
		SortOrder = Enum.SortOrder.LayoutOrder,
	}) :: UIGridLayout
	local slots = create("Frame", {
		Name = "Odds",
		Position = UDim2.fromOffset(172, 52),
		Size = UDim2.new(1, -184, 0, 96),
		BackgroundTransparency = 1,
	}) :: Frame
	grid.Parent = slots
	slots.Parent = card
	local entries: { BrainrotConfig.OddsEntry } = if block and block.Odds then BrainrotConfig.oddsList(block.Odds) else {}
	local total = 0
	for _, entry in entries do
		total += entry.Weight
	end
	for order, entry in entries do
		local rarity = BrainrotConfig.RarityByName[entry.Rarity]
		local shownId = if entry.Brainrot then entry.Brainrot.Id else nil
		if shownId == nil then
			-- The best of that rarity, to show off.
			local best: BrainrotConfig.Brainrot? = nil
			for _, choice in BrainrotConfig.DropsByRarity[entry.Rarity] do
				if best == nil or choice.Price > best.Price then
					best = choice
				end
			end
			shownId = if best then best.Id else nil
		end
		if shownId == nil or rarity == nil or total <= 0 then
			continue
		end
		local share = entry.Weight / total * 100
		-- (Secret's colour is black: white reads better on the dark slot.)
		local colour = if rarity.Style == "Secret" then Color3.new(1, 1, 1) else rarity.Color
		local slot = brainrotSlot(
			shownId,
			if share >= 1 then string.format("%d%%", math.floor(share + 0.5)) else string.format("%.1f%%", share),
			colour,
			entry.Brainrot ~= nil
		)
		slot.Name = entry.Key
		slot.LayoutOrder = order
		-- A rarity's slot says which; a particular brainrot's just shows it.
		if entry.Brainrot == nil then
			label({
				Name = "Rarity",
				Position = UDim2.fromOffset(4, 2),
				Size = UDim2.new(1, -8, 0.24, 0),
				Text = rarity.Name,
				TextColor3 = colour,
				TextSize = 16,
				TextXAlignment = Enum.TextXAlignment.Left,
			}).Parent = slot
		end
		slot.Parent = slots
	end
	local count = #slots:GetChildren() - 1
	table.insert(shopLayouts, function(width: number)
		local area = width - 184
		local columns = math.max(1, count)
		local cell = math.floor((area - 8 * (columns - 1)) / columns)
		if cell < 80 then
			columns = math.max(1, math.floor((area + 8) / 88))
			cell = math.floor((area - 8 * (columns - 1)) / columns)
		end
		cell = math.min(cell, 96)
		local rows = math.max(1, math.ceil(count / columns))
		local height = rows * cell + (rows - 1) * 8
		grid.CellSize = UDim2.fromOffset(cell, cell)
		slots.Size = UDim2.new(1, -184, 0, height)
		card.Size = UDim2.new(1, 0, 0, 206 + math.max(0, height - 96))
	end)
	label({
		Name = "Description",
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.new(0, 172, 1, -12),
		Size = UDim2.new(1, -404, 0, 40),
		Text = product.Description,
		TextSize = 20,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
	}).Parent = card
	local buy, setPrice = UIKit.robuxButton({
		Name = "BuyButton",
		AnchorPoint = Vector2.new(1, 1),
		Position = UDim2.new(1, -12, 1, -10),
		Size = UDim2.fromOffset(210, 50),
	})
	buy.Parent = card
	sellOn(buy, setPrice, product, onIcon)
	card.Parent = shopList
	table.insert(shopLayouts, function(width: number)
		local description = card:FindFirstChild("Description")
		if description and description:IsA("TextLabel") then
			description.Visible = width >= 640
		end
	end)
end

-- 3. A band and a grid of tiles per section.
local SHOP_SECTIONS = {
	{ Key = "Passes", Title = "Game Passes", Note = "Yours forever!", Color = Color3.fromRGB(205, 38, 38) },
	{ Key = "Boosts", Title = "Cash & Boosts", Note = "Instant!", Color = Color3.fromRGB(70, 165, 40) },
	{ Key = "Troll", Title = "Troll Items", Note = "Stop the thieves!", Color = Color3.fromRGB(140, 60, 205) },
	{ Key = "Skins", Title = "Skins & Hats", Note = "Look rich!", Color = Color3.fromRGB(35, 120, 215) },
}
local function productTile(product: MonetizationConfig.ShopProduct, order: number): Frame
	local tile = create("Frame", {
		Name = product.Key,
		LayoutOrder = order,
		BackgroundColor3 = GARDEN.Tile,
	}, { corner(12), stroke(GARDEN.WoodEdge, 3) }) :: Frame
	local iconFrame = create("Frame", {
		Name = "Icon",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 8),
		Size = UDim2.new(1, -16, 0.5, 0),
		BackgroundColor3 = product.IconColor:Lerp(Color3.new(0, 0, 0), 0.35),
	}, {
		corner(10),
		stroke(GARDEN.WoodEdge, 2),
		create("UIAspectRatioConstraint", { AspectRatio = 1 }),
	}) :: Frame
	iconFrame.Parent = tile
	local onIcon = productIcon(iconFrame, product)
	label({
		Name = "ProductName",
		Position = UDim2.new(0, 6, 0.545, 0),
		Size = UDim2.new(1, -12, 0.1, 0),
		Text = product.DisplayName,
		TextSize = 24,
	}).Parent = tile
	label({
		Name = "Description",
		Position = UDim2.new(0, 6, 0.65, 0),
		Size = UDim2.new(1, -12, 0.17, 0),
		Text = product.Description,
		TextColor3 = Color3.fromRGB(255, 236, 200),
		TextSize = 17,
		TextWrapped = true,
		OutlineThickness = 1,
	}).Parent = tile
	local buy, setPrice = UIKit.robuxButton({
		Name = "BuyButton",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -8),
		Size = UDim2.new(1, -16, 0.14, 0),
	})
	buy.Parent = tile
	sellOn(buy, setPrice, product, onIcon)
	return tile
end
local sectionOrder = 10
for _, section in SHOP_SECTIONS do
	sectionBand(section.Key .. "Band", section.Title, section.Note, section.Color, sectionOrder).Parent = shopList
	local grid, relayout = tileGrid(section.Key, sectionOrder + 1)
	for index, product in MonetizationConfig.ShopProducts do
		if product.Section == section.Key then
			productTile(product, index).Parent = grid
		end
	end
	grid.Parent = shopList
	sectionOrder += 2
	table.insert(shopLayouts, relayout)
end

-- The window takes the room the screen has (at least 0.8 size on a phone).
UIKit.fillScreen(shopFrame, Vector2.new(860, 640), Vector2.new(440, 330), 0.8, function(size: Vector2)
	-- The list's inside width: the window's body less the list's padding.
	local width = size.X - 32 - 30
	for _, relayout in shopLayouts do
		relayout(width)
	end
end)
UIKit.setDefaultSelection(shopFrame, limitedBuyButton)

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

local indexFrame, indexBody = modal("Index", "INDEX", COLORS.Index, Vector2.new(1240, 780))

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

-- Six brainrots a row, filling the window, scrolling down for more.
local INDEX_COLUMNS = 6
local indexCell = UIKit.gridCells(UIKit.bodySize(indexFrame).X, INDEX_COLUMNS, 10, 8)
local indexGrid = create("UIGridLayout", {
	CellSize = UDim2.fromOffset(indexCell, math.floor(indexCell * 1.3)),
	CellPadding = UDim2.fromOffset(10, 10),
	FillDirectionMaxCells = INDEX_COLUMNS,
	SortOrder = Enum.SortOrder.LayoutOrder,
}) :: UIGridLayout
local indexList = create("ScrollingFrame", {
	Name = "List",
	Position = UDim2.fromOffset(0, 98),
	Size = UDim2.new(1, 0, 1, -98),
	BackgroundTransparency = 1,
	BorderSizePixel = 0,
	ScrollBarThickness = 8,
	ScrollBarImageColor3 = COLORS.Index,
	AutomaticCanvasSize = Enum.AutomaticSize.Y,
	CanvasSize = UDim2.new(),
}, { indexGrid :: Instance }) :: ScrollingFrame
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
-- Cards run from the most common rarity to the rarest, cheapest first. A rank
-- rather than rarity * 1e9 + price, which LayoutOrder (32-bit) can't hold.
local indexOrder: { [string]: number } = {}
do
	local sorted = table.clone(BrainrotConfig.Brainrots)
	table.sort(sorted, function(a, b)
		local rarityA, rarityB = rarityOrder[a.Rarity] or 0, rarityOrder[b.Rarity] or 0
		if rarityA ~= rarityB then
			return rarityA < rarityB
		end
		if a.Price ~= b.Price then
			return a.Price < b.Price
		end
		return a.Id < b.Id
	end)
	for rank, definition in sorted do
		indexOrder[definition.Id] = rank
	end
end

for _, definition in BrainrotConfig.Brainrots do
	local rarity = BrainrotConfig.RarityByName[definition.Rarity]
	local rarityColour = if rarity then rarity.Color else Color3.new(1, 1, 1)
	local card = create("Frame", {
		Name = definition.Id,
		BackgroundColor3 = COLORS.PanelLight,
		LayoutOrder = indexOrder[definition.Id] or 0,
	}, { corner(12), stroke(rarityColour, 3) }) :: Frame
	local cardStroke = card:FindFirstChildOfClass("UIStroke") :: UIStroke

	-- Everything in a card scales with it (see the grid above).
	local viewport = create("ViewportFrame", {
		Name = "Preview",
		Position = UDim2.fromOffset(6, 6),
		Size = UDim2.new(1, -12, 0.56, -6),
		BackgroundColor3 = rarityColour:Lerp(Color3.new(0, 0, 0), 0.55),
		Ambient = Color3.fromRGB(200, 200, 200),
		LightColor = Color3.new(1, 1, 1),
		LightDirection = Vector3.new(-0.4, -1, 0.6),
	}, { corner(10) }) :: ViewportFrame
	viewport.Parent = card

	-- Say where limited brainrots (the weekly shop, or very rarely the conveyor
	-- as OGs), season ones, crate ones and God block specials come from.
	local badgeText, badgeColour = nil, Color3.fromRGB(230, 110, 30)
	if BrainrotConfig.hasTag(definition, "Limited") then
		badgeText, badgeColour = "⭐ LIMITED", Color3.fromRGB(230, 170, 20)
	elseif BrainrotConfig.hasTag(definition, "Season") then
		badgeText = "🏆 SEASON"
	elseif BrainrotConfig.hasTag(definition, "Crate") then
		badgeText, badgeColour = "📦 CRATE", Color3.fromRGB(60, 80, 170)
	elseif BrainrotConfig.hasTag(definition, "GodBlock") then
		badgeText, badgeColour = "🎁 GOD BLOCK", Color3.fromRGB(200, 70, 200)
	end
	if badgeText then
		local badge = label({
			Name = "Badge",
			AnchorPoint = Vector2.new(1, 0),
			Position = UDim2.new(1, -10, 0, 10),
			Size = UDim2.new(0.62, 0, 0.09, 0),
			BackgroundTransparency = 0,
			BackgroundColor3 = badgeColour,
			Text = badgeText,
			TextSize = 15,
			ZIndex = 3,
		})
		corner(6).Parent = badge
		badge.Parent = card
	end

	local nameLabel = label({
		Name = "BrainrotName",
		Position = UDim2.new(0, 6, 0.585, 0),
		Size = UDim2.new(1, -12, 0.1, 0),
		Text = definition.DisplayName,
		TextSize = 22,
	})
	nameLabel.Parent = card
	label({
		Name = "Rarity",
		Position = UDim2.new(0, 6, 0.69, 0),
		Size = UDim2.new(1, -12, 0.085, 0),
		Text = definition.Rarity,
		TextColor3 = rarityColour,
		TextSize = 20,
	}).Parent = card
	label({
		Name = "Stats",
		Position = UDim2.new(0, 6, 0.78, 0),
		Size = UDim2.new(1, -12, 0.085, 0),
		Text = NumberFormat.cash(definition.IncomePerSecond) .. "/s  " .. NumberFormat.cash(definition.Price),
		TextColor3 = COLORS.Income,
		TextSize = 19,
	}).Parent = card
	local owned = label({
		Name = "Owned",
		Position = UDim2.new(0, 6, 0.87, 0),
		Size = UDim2.new(1, -12, 0.085, 0),
		Text = "",
		TextColor3 = COLORS.Owned,
		TextSize = 19,
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
		-- Only brainrots on pedestals (not guard copies or pets) have a Slot.
		if typeof(brainrotId) == "string" and model:GetAttribute("OwnerUserId") == player.UserId and model:GetAttribute("Slot") ~= nil then
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
		for _, definition in BrainrotConfig.Obtainable do
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
			local choices = BrainrotConfig.DropsByRarity[rarity.Name]
			-- (OG has no page to fill: its brainrots are the limited ones.)
			if #choices == 0 then
				continue
			end
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
	-- Two even lines when there are many (the rarities), rather than one
	-- word wrapping onto a line of its own.
	if #parts > 4 then
		local half = math.ceil(#parts / 2)
		indexRewards.Text = table.concat(parts, "   ", 1, half) .. "\n" .. table.concat(parts, "   ", half + 1)
	else
		indexRewards.Text = table.concat(parts, "   ")
	end
	for name, tab in indexTabButtons do
		tab.BackgroundColor3 = if name == indexPage then COLORS.Index else COLORS.PanelLight
	end
end

for order, pageName in INDEX_PAGES do
	local tab = button(pageName, COLORS.PanelLight, {
		Name = pageName .. "Tab",
		-- The tabs fill the row exactly, with 8 pixels between them.
		Size = UDim2.new(1 / #INDEX_PAGES, -8 * (#INDEX_PAGES - 1) / #INDEX_PAGES, 1, 0),
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
-- Gear Shop (opened from the Gear Shop stall), dressed like the Robux shop: a
-- wooden window with a studded green title bar showing your Cash, and a tile
-- per gear with its picture and a green Cash price button (its price goes red
-- when you can't afford it yet). All 4 fit in a row, even on a phone.
--------------------------------------------------------------------------------

local gearFrame, gearBody = modal("GearShop", "Gear Shop", GARDEN.Green, Vector2.new(800, 400))
UIKit.gardenStyle(gearFrame)
local gearCash = label({
	Name = "Cash",
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, -66, 0, 13),
	Size = UDim2.new(0.4, -40, 0, 36),
	BackgroundTransparency = 0.35,
	BackgroundColor3 = Color3.fromRGB(30, 60, 20),
	Text = "",
	TextColor3 = Color3.fromRGB(255, 240, 150),
	TextSize = 26,
})
corner(10).Parent = gearCash
create("UIPadding", { PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10) }).Parent = gearCash
gearCash.Parent = gearFrame
local gearList = woodList("Items")
gearList.Parent = gearBody
local gearGrid, relayoutGear = tileGrid("Gear", 1, 140, true)
gearGrid.Parent = gearList

type GearCard = { Button: TextButton, SetPrice: (string, boolean) -> (), Gear: GearConfig.Gear }
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
	local stats = player:FindFirstChild("leaderstats")
	local cashStat = stats and stats:FindFirstChild("Cash")
	local cash = if cashStat and cashStat:IsA("IntValue") then cashStat.Value else 0
	gearCash.Text = "You have " .. NumberFormat.cash(cash)
	for _, card in gearCards do
		local owned = ownsGear(card.Gear.Id)
		card.SetPrice(if owned then "OWNED" elseif card.Gear.Price <= 0 then "FREE" else NumberFormat.cash(card.Gear.Price), false)
		UIKit.setEnabled(card.Button, not owned, GARDEN.Buy)
		local price = card.Button:FindFirstChild("Price", true)
		if price and price:IsA("TextLabel") then
			price.TextColor3 = if not owned and cash < card.Gear.Price then Color3.fromRGB(255, 120, 110) else Color3.new(1, 1, 1)
		end
	end
end

local function buyGear(gear: GearConfig.Gear)
	if gearPending or ownsGear(gear.Id) then
		return
	end
	gearPending = true
	local ok, success, message = pcall(function()
		local remote = remotes:WaitForChild("BuyGear", 10)
		if remote == nil or not remote:IsA("RemoteFunction") then
			return false, "The Gear Shop is closed right now."
		end
		return remote:InvokeServer(gear.Id)
	end)
	gearPending = false
	local bought = ok and success == true
	showToast(if ok and typeof(message) == "string" then message else "Couldn't buy that, try again.", if bought then "Success" else "Error")
	Sounds.play(if bought then "Purchase" else "Error")
	refreshGearShop()
end

for _, gear in GearConfig.Gear do
	local tile = create("Frame", {
		Name = gear.Id,
		LayoutOrder = gear.Order,
		BackgroundColor3 = GARDEN.Tile,
	}, { corner(12), stroke(GARDEN.WoodEdge, 3) }) :: Frame
	local iconFrame = create("Frame", {
		Name = "Icon",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 8),
		Size = UDim2.new(1, -16, 0.5, 0),
		BackgroundColor3 = gear.Color:Lerp(Color3.new(0, 0, 0), 0.35),
	}, {
		corner(10),
		stroke(GARDEN.WoodEdge, 2),
		create("UIAspectRatioConstraint", { AspectRatio = 1 }),
	}) :: Frame
	local picture = create("ImageLabel", {
		Name = "Image",
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		Visible = false,
	}, { corner(10) }) :: ImageLabel
	picture.Parent = iconFrame
	if not setImage(picture, AssetLoader.getProductIcon(gear.Id)) then
		label({
			Name = "IconText",
			Size = UDim2.fromScale(1, 1),
			Text = string.sub(gear.DisplayName, 1, 1),
			TextSize = 48,
			OutlineThickness = 3,
		}).Parent = iconFrame
	end
	iconFrame.Parent = tile
	label({
		Name = "GearName",
		Position = UDim2.new(0, 6, 0.545, 0),
		Size = UDim2.new(1, -12, 0.1, 0),
		Text = gear.DisplayName,
		TextSize = 24,
	}).Parent = tile
	label({
		Name = "Description",
		Position = UDim2.new(0, 6, 0.65, 0),
		Size = UDim2.new(1, -12, 0.17, 0),
		Text = gear.Description,
		TextColor3 = Color3.fromRGB(255, 236, 200),
		TextSize = 17,
		TextWrapped = true,
		OutlineThickness = 1,
	}).Parent = tile
	local buyButton, setPrice = UIKit.robuxButton({
		Name = "BuyButton",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -8),
		Size = UDim2.new(1, -16, 0.14, 0),
	})
	buyButton.Parent = tile
	buyButton.Activated:Connect(function()
		buyGear(gear)
	end)
	tile.Parent = gearGrid
	table.insert(gearCards, { Button = buyButton, SetPrice = setPrice, Gear = gear })
end
-- Like the Robux shop, the window takes the room the screen has; a
-- controller starts on the first gear you don't have yet.
UIKit.fillScreen(gearFrame, Vector2.new(800, 400), Vector2.new(440, 330), 0.8, function(size: Vector2)
	-- The list's inside: the window's body less the list's padding.
	relayoutGear(size.X - 32 - 30, size.Y - 90 - 22)
end)
local function selectFirstGear()
	for _, card in gearCards do
		if not ownsGear(card.Gear.Id) then
			UIKit.setDefaultSelection(gearFrame, card.Button)
			return
		end
	end
	UIKit.setDefaultSelection(gearFrame, gearCards[1].Button)
end
selectFirstGear()
refreshGearShop()
player:GetAttributeChangedSignal("OwnedGear"):Connect(function()
	refreshGearShop()
	selectFirstGear()
end)

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
	if gearFrame.Visible then
		refreshGearShop()
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
	-- Studs plus a few pixels: sized like the world up close, still readable far away.
	Size = UDim2.new(10, 60, 3.7, 22),
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
	if kind ~= "Steal" and kind ~= "Sell" and kind ~= "Upgrade" and kind ~= "Open" and kind ~= "Manage" then
		return
	end
	local busy = prompt:GetAttribute("Carried") == true or prompt:GetAttribute("Walking") == true
	-- Only the owner sells, upgrades pedestals, opens lucky blocks and
	-- manages (hats, guard, pet).
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

-- Admin chat commands (/event, /events, /abuse, /endevent): pass them on to
-- the server too, in case it doesn't hear them itself (it runs each once).
task.spawn(function()
	local chatCommandEvent = remotes:WaitForChild("ChatCommand") :: RemoteEvent
	local textChatService = game:GetService("TextChatService")
	local function hookCommand(child: Instance)
		if child:IsA("TextChatCommand") and string.sub(child.Name, 1, 13) == "BrainrotEvent" then
			child.Triggered:Connect(function(source: TextSource, text: string)
				if source.UserId == player.UserId then
					chatCommandEvent:FireServer(text)
				end
			end)
		end
	end
	textChatService.ChildAdded:Connect(hookCommand)
	for _, child in textChatService:GetChildren() do
		hookCommand(child)
	end
end)

screenGui.Parent = playerGui

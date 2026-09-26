--!strict
--[[
	GameClient
	Location: StarterPlayer.StarterPlayerScripts (LocalScript)

	Builds the HUD: Cash and income, boost timers, the Robux shop, the rebirth
	screen and pop-up messages. It also hides ProximityPrompts that don't apply to
	this player (Steal on your own brainrots, Sell on someone else's).

	Nothing here can change game state. Purchases go through Roblox's purchase
	prompt and ProcessReceipt on the server, and the server re-checks every
	prompt and rebirth request.
]]

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local GameConfig = require(Shared:WaitForChild("GameConfig"))
local MonetizationConfig = require(Shared:WaitForChild("MonetizationConfig"))
local NumberFormat = require(Shared:WaitForChild("NumberFormat"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local notifyEvent = remotes:WaitForChild("Notify") :: RemoteEvent
local requestRebirthFunction = remotes:WaitForChild("RequestRebirth") :: RemoteFunction

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui") :: PlayerGui

local FONT = Enum.Font.FredokaOne
local COLORS = {
	Panel = Color3.fromRGB(28, 30, 46),
	PanelLight = Color3.fromRGB(44, 47, 70),
	Text = Color3.new(1, 1, 1),
	Muted = Color3.fromRGB(185, 190, 215),
	Cash = Color3.fromRGB(90, 255, 120),
	Shop = Color3.fromRGB(46, 204, 113),
	Rebirth = Color3.fromRGB(160, 90, 255),
	Close = Color3.fromRGB(235, 70, 70),
	Disabled = Color3.fromRGB(90, 92, 110),
	Boost = Color3.fromRGB(200, 60, 200),
	Emp = Color3.fromRGB(60, 120, 255),
}
local TOAST_COLORS: { [string]: Color3 } = {
	Info = Color3.fromRGB(70, 130, 255),
	Success = Color3.fromRGB(46, 180, 100),
	Warning = Color3.fromRGB(240, 160, 30),
	Error = Color3.fromRGB(225, 65, 65),
}
local MAX_TOASTS = 4
local TOAST_SECONDS = 4

--------------------------------------------------------------------------------
-- UI helpers
--------------------------------------------------------------------------------

local function create(className: string, properties: { [string]: any }, children: { Instance }?): Instance
	local instance = Instance.new(className)
	for key, value in properties do
		(instance :: any)[key] = value
	end
	if children then
		for _, child in children do
			child.Parent = instance
		end
	end
	return instance
end

local function corner(radius: number): Instance
	return create("UICorner", { CornerRadius = UDim.new(0, radius) })
end

local function stroke(color: Color3, thickness: number): Instance
	return create("UIStroke", { Color = color, Thickness = thickness, ApplyStrokeMode = Enum.ApplyStrokeMode.Border })
end

local function label(properties: { [string]: any }): TextLabel
	local defaults: { [string]: any } = {
		BackgroundTransparency = 1,
		Font = FONT,
		TextColor3 = COLORS.Text,
		TextScaled = true,
	}
	for key, value in properties do
		defaults[key] = value
	end
	local textLabel = create("TextLabel", defaults) :: TextLabel
	create("UITextSizeConstraint", { MaxTextSize = properties.TextSize or 32 }).Parent = textLabel
	return textLabel
end

local function button(text: string, color: Color3, properties: { [string]: any }): TextButton
	local defaults: { [string]: any } = {
		BackgroundColor3 = color,
		AutoButtonColor = true,
		Font = FONT,
		Text = text,
		TextColor3 = COLORS.Text,
		TextScaled = true,
	}
	for key, value in properties do
		defaults[key] = value
	end
	local textButton = create("TextButton", defaults, {
		corner(10),
		stroke(Color3.new(0, 0, 0), 2),
		create("UIPadding", {
			PaddingLeft = UDim.new(0, 8),
			PaddingRight = UDim.new(0, 8),
			PaddingTop = UDim.new(0, 4),
			PaddingBottom = UDim.new(0, 4),
		}),
		create("UITextSizeConstraint", { MaxTextSize = 28 }),
	}) :: TextButton
	return textButton
end

--------------------------------------------------------------------------------
-- Layout
--------------------------------------------------------------------------------

local screenGui = create("ScreenGui", {
	Name = "GameHud",
	ResetOnSpawn = false,
	ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
}) :: ScreenGui

-- Cash and income (top centre)
local cashLabel = label({
	Name = "Cash",
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 6),
	Size = UDim2.fromOffset(320, 44),
	Text = "$0",
	TextColor3 = COLORS.Cash,
	TextSize = 40,
	TextStrokeTransparency = 0.2,
})
cashLabel.Parent = screenGui

local incomeLabel = label({
	Name = "Income",
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 50),
	Size = UDim2.fromOffset(240, 24),
	Text = "+$0/s",
	TextColor3 = COLORS.Muted,
	TextSize = 22,
	TextStrokeTransparency = 0.4,
})
incomeLabel.Parent = screenGui

-- Boost timers (under the Cash counter)
local chipRow = create("Frame", {
	Name = "Boosts",
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 80),
	Size = UDim2.fromOffset(520, 30),
	BackgroundTransparency = 1,
}, {
	create("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		Padding = UDim.new(0, 8),
	}),
}) :: Frame
chipRow.Parent = screenGui

local function chip(color: Color3): TextLabel
	local chipLabel = label({
		Size = UDim2.fromOffset(250, 30),
		BackgroundTransparency = 0,
		BackgroundColor3 = color,
		TextSize = 20,
		Visible = false,
	})
	corner(15).Parent = chipLabel
	chipLabel.Parent = chipRow
	return chipLabel
end

local boostChip = chip(COLORS.Boost)
local empChip = chip(COLORS.Emp)

-- Side buttons (left middle)
local sideButtons = create("Frame", {
	Name = "SideButtons",
	AnchorPoint = Vector2.new(0, 0.5),
	Position = UDim2.new(0, 12, 0.5, 0),
	Size = UDim2.fromOffset(150, 124),
	BackgroundTransparency = 1,
}, {
	create("UIListLayout", { Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder }),
}) :: Frame
sideButtons.Parent = screenGui

local shopButton = button("SHOP", COLORS.Shop, { Name = "ShopButton", Size = UDim2.fromOffset(150, 54), LayoutOrder = 1 })
shopButton.Parent = sideButtons
local rebirthButton = button("REBIRTH", COLORS.Rebirth, { Name = "RebirthButton", Size = UDim2.fromOffset(150, 54), LayoutOrder = 2 })
rebirthButton.Parent = sideButtons

local function modal(name: string, title: string, size: Vector2): (Frame, Frame)
	local frame = create("Frame", {
		Name = name,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		-- Fills most of a small screen, capped at the design size on large ones.
		Size = UDim2.fromScale(0.92, 0.8),
		BackgroundColor3 = COLORS.Panel,
		Visible = false,
	}, {
		corner(16),
		stroke(Color3.new(0, 0, 0), 3),
		create("UISizeConstraint", { MaxSize = size }),
		create("UIAspectRatioConstraint", { AspectRatio = size.X / size.Y }),
	}) :: Frame

	label({
		Name = "Title",
		Position = UDim2.fromOffset(20, 10),
		Size = UDim2.new(1, -90, 0, 44),
		Text = title,
		TextSize = 36,
		TextXAlignment = Enum.TextXAlignment.Left,
	}).Parent = frame

	local closeButton = button("X", COLORS.Close, {
		Name = "CloseButton",
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -12, 0, 12),
		Size = UDim2.fromOffset(44, 44),
	})
	closeButton.Parent = frame
	closeButton.Activated:Connect(function()
		frame.Visible = false
	end)

	local body = create("Frame", {
		Name = "Body",
		Position = UDim2.fromOffset(16, 64),
		Size = UDim2.new(1, -32, 1, -80),
		BackgroundTransparency = 1,
	}) :: Frame
	body.Parent = frame
	frame.Parent = screenGui
	return frame, body
end

--------------------------------------------------------------------------------
-- Shop
--------------------------------------------------------------------------------

local shopFrame, shopBody = modal("Shop", "SHOP", Vector2.new(640, 460))
create("UIGridLayout", {
	CellSize = UDim2.new(0.5, -8, 0.5, -8),
	CellPadding = UDim2.fromOffset(12, 12),
	SortOrder = Enum.SortOrder.LayoutOrder,
}).Parent = shopBody

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
	}, { corner(12) }) :: Frame

	local iconFrame = create("Frame", {
		Name = "Icon",
		Position = UDim2.fromOffset(10, 10),
		Size = UDim2.new(0.38, 0, 1, -20),
		BackgroundColor3 = product.IconColor,
	}, {
		corner(10),
		create("UIAspectRatioConstraint", { AspectRatio = 1 }),
	}) :: Frame
	iconFrame.Parent = card

	local iconText = label({
		Size = UDim2.fromScale(1, 1),
		Text = product.IconText,
		TextSize = 48,
		TextStrokeTransparency = 0.2,
	})
	iconText.Parent = iconFrame

	local iconImage = create("ImageLabel", {
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		Visible = false,
	}, { corner(10) }) :: ImageLabel
	iconImage.Parent = iconFrame

	local function showIcon(assetId: number)
		iconImage.Image = "rbxassetid://" .. tostring(assetId)
		iconImage.Visible = true
		iconText.Visible = false
	end
	if product.IconAssetId > 0 then
		showIcon(product.IconAssetId)
	end

	label({
		Name = "ProductName",
		Position = UDim2.new(0.42, 0, 0, 10),
		Size = UDim2.new(0.56, 0, 0.26, 0),
		Text = product.DisplayName,
		TextSize = 22,
		TextXAlignment = Enum.TextXAlignment.Left,
	}).Parent = card

	label({
		Name = "Description",
		Position = UDim2.new(0.42, 0, 0.3, 0),
		Size = UDim2.new(0.56, 0, 0.36, 0),
		Text = product.Description,
		TextColor3 = COLORS.Muted,
		TextSize = 16,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
	}).Parent = card

	local buyButton = button("BUY", COLORS.Shop, {
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
		if product.IconAssetId == 0 and iconId and iconId > 0 then
			showIcon(iconId)
		end
	end)

	card.Parent = shopBody
end

--------------------------------------------------------------------------------
-- Rebirth
--------------------------------------------------------------------------------

local rebirthFrame, rebirthBody = modal("Rebirth", "REBIRTH", Vector2.new(460, 360))

local rebirthInfo = label({
	Name = "Info",
	Size = UDim2.new(1, 0, 0.42, 0),
	Text = "",
	TextSize = 24,
	TextWrapped = true,
})
rebirthInfo.Parent = rebirthBody

local progressBack = create("Frame", {
	Name = "Progress",
	Position = UDim2.fromScale(0, 0.48),
	Size = UDim2.new(1, 0, 0.12, 0),
	BackgroundColor3 = COLORS.PanelLight,
}, { corner(10) }) :: Frame
progressBack.Parent = rebirthBody

local progressFill = create("Frame", {
	Size = UDim2.fromScale(0, 1),
	BackgroundColor3 = COLORS.Rebirth,
}, { corner(10) }) :: Frame
progressFill.Parent = progressBack

local progressText = label({
	Size = UDim2.fromScale(1, 1),
	Text = "",
	TextSize = 20,
	TextStrokeTransparency = 0.3,
	ZIndex = 2,
})
progressText.Parent = progressBack

local confirmRebirthButton = button("REBIRTH", COLORS.Rebirth, {
	Name = "ConfirmButton",
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.fromScale(0.5, 1),
	Size = UDim2.new(0.7, 0, 0.24, 0),
})
confirmRebirthButton.Parent = rebirthBody

--------------------------------------------------------------------------------
-- Toasts
--------------------------------------------------------------------------------

local toastContainer = create("Frame", {
	Name = "Toasts",
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.new(0.5, 0, 1, -110),
	Size = UDim2.fromOffset(480, 200),
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

local toastCount = 0

local function showToast(message: string, kind: string)
	toastCount += 1
	local toast = label({
		Size = UDim2.fromOffset(480, 40),
		BackgroundTransparency = 0.05,
		BackgroundColor3 = TOAST_COLORS[kind] or TOAST_COLORS.Info,
		Text = message,
		TextSize = 22,
		TextWrapped = true,
		LayoutOrder = toastCount,
	})
	corner(10).Parent = toast
	create("UIPadding", { PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10) }).Parent = toast
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

notifyEvent.OnClientEvent:Connect(function(message: any, kind: any)
	if typeof(message) == "string" then
		showToast(message, if typeof(kind) == "string" then kind else "Info")
	end
end)

--------------------------------------------------------------------------------
-- Live values
--------------------------------------------------------------------------------

local cashValue: IntValue? = nil
local rebirthsValue: IntValue? = nil

local function getCash(): number
	return if cashValue then cashValue.Value else 0
end

local function getRebirths(): number
	return if rebirthsValue then rebirthsValue.Value else 0
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
	confirmRebirthButton.BackgroundColor3 = if cash >= cost then COLORS.Rebirth else COLORS.Disabled
end

local function refreshCash()
	cashLabel.Text = NumberFormat.cash(getCash())
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

shopButton.Activated:Connect(function()
	shopFrame.Visible = not shopFrame.Visible
	rebirthFrame.Visible = false
end)

rebirthButton.Activated:Connect(function()
	rebirthFrame.Visible = not rebirthFrame.Visible
	shopFrame.Visible = false
	refreshRebirthScreen()
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
		if success == true then
			rebirthFrame.Visible = false
		end
	else
		showToast("Rebirth failed, try again.", "Error")
	end
end)

--------------------------------------------------------------------------------
-- Timers, income and "YOUR BASE" marker
--------------------------------------------------------------------------------

local baseMarker = create("BillboardGui", {
	Name = "YourBaseMarker",
	Size = UDim2.fromOffset(220, 50),
	StudsOffsetWorldSpace = Vector3.new(0, 6, 0),
	AlwaysOnTop = true,
	LightInfluence = 0,
	Enabled = false,
}, {
	label({
		Size = UDim2.fromScale(1, 1),
		Text = "YOUR BASE",
		TextColor3 = Color3.fromRGB(255, 230, 80),
		TextSize = 36,
		TextStrokeTransparency = 0,
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

		local income = tonumber(player:GetAttribute("IncomePerSecond")) or 0
		incomeLabel.Text = "+" .. NumberFormat.cash(income) .. "/s"

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
	if kind ~= "Steal" and kind ~= "Sell" then
		return
	end
	local ownedByMe = prompt:GetAttribute("OwnerUserId") == player.UserId
	local carried = prompt:GetAttribute("Carried") == true
	prompt.Enabled = not carried and (if kind == "Steal" then not ownedByMe else ownedByMe)
end

local function trackPrompt(instance: Instance)
	if not instance:IsA("ProximityPrompt") then
		return
	end
	refreshPrompt(instance)
	instance:GetAttributeChangedSignal("Carried"):Connect(function()
		refreshPrompt(instance)
	end)
	instance:GetAttributeChangedSignal("OwnerUserId"):Connect(function()
		refreshPrompt(instance)
	end)
end

Workspace.DescendantAdded:Connect(trackPrompt)
for _, descendant in Workspace:GetDescendants() do
	trackPrompt(descendant)
end

screenGui.Parent = playerGui

-- The skin shop window: survivor and monster skins, bought with coins (or
-- Robux, for skins with a Game Pass).

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Config"))
local UI = require(script.Parent.UI)

local create, round = UI.create, UI.round
local FONT, RED, WHITE = UI.FONT, UI.RED, UI.WHITE
local player = Players.LocalPlayer

local Shop = {}

function Shop.Init(hud: ScreenGui)
	local remotes = ReplicatedStorage:WaitForChild("Remotes")
	local shopRemote = remotes:WaitForChild("Shop")


	local shopButton = create("TextButton", {
		AnchorPoint = Vector2.new(0, 0.5),
		Position = UDim2.new(0, 12, 0.5, 0),
		Size = UDim2.new(0, 84, 0, 44),
		BackgroundColor3 = Color3.fromRGB(40, 40, 50),
		Font = FONT,
		TextSize = 18,
		TextColor3 = WHITE,
		Text = "SHOP",
		Parent = hud,
	})
	round(shopButton)
	create("UIStroke", { Color = RED, Thickness = 2, ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Parent = shopButton })

	local shopFrame = create("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromScale(0.92, 0.8),
		BackgroundColor3 = Color3.fromRGB(20, 20, 26),
		Visible = false,
		ZIndex = 5,
		Parent = hud,
	})
	round(shopFrame, 12)
	create("UISizeConstraint", { MaxSize = Vector2.new(640, 460), Parent = shopFrame })
	create("UIStroke", { Color = RED, Thickness = 2, Parent = shopFrame })

	create("TextLabel", {
		Position = UDim2.new(0, 16, 0, 10),
		Size = UDim2.new(0.5, 0, 0, 30),
		BackgroundTransparency = 1,
		Font = FONT,
		TextSize = 24,
		TextColor3 = WHITE,
		TextXAlignment = Enum.TextXAlignment.Left,
		Text = "SKIN SHOP",
		Parent = shopFrame,
	})

	local coinsLabel = create("TextLabel", {
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -56, 0, 10),
		Size = UDim2.new(0, 170, 0, 30),
		BackgroundTransparency = 1,
		Font = FONT,
		TextSize = 20,
		TextColor3 = Color3.fromRGB(255, 210, 70),
		TextXAlignment = Enum.TextXAlignment.Right,
		Text = "",
		Parent = shopFrame,
	})

	local closeButton = create("TextButton", {
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -10, 0, 8),
		Size = UDim2.new(0, 36, 0, 34),
		BackgroundColor3 = Color3.fromRGB(150, 30, 30),
		Font = FONT,
		TextSize = 20,
		TextColor3 = WHITE,
		Text = "X",
		Parent = shopFrame,
	})
	round(closeButton)

	local currentTab = "Survivor"
	local tabs = {}
	for index, tabName in { "Survivor", "Monster" } do
		local tab = create("TextButton", {
			Position = UDim2.new(0, 16 + (index - 1) * 130, 0, 48),
			Size = UDim2.new(0, 120, 0, 32),
			Font = FONT,
			TextSize = 16,
			TextColor3 = WHITE,
			Text = tabName .. "s",
			Parent = shopFrame,
		})
		round(tab)
		tabs[tabName] = tab
	end

	local grid = create("ScrollingFrame", {
		Position = UDim2.new(0, 12, 0, 90),
		Size = UDim2.new(1, -24, 1, -100),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 6,
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ScrollingDirection = Enum.ScrollingDirection.Y,
		Parent = shopFrame,
	})
	create("UIGridLayout", {
		CellSize = UDim2.new(0, 132, 0, 196),
		CellPadding = UDim2.new(0, 10, 0, 10),
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		SortOrder = Enum.SortOrder.LayoutOrder,
		Parent = grid,
	})
	create("UIPadding", { PaddingTop = UDim.new(0, 4), PaddingBottom = UDim.new(0, 4), Parent = grid })

	local function getCoins(): number
		local leaderstats = player:FindFirstChild("leaderstats")
		local coins = leaderstats and leaderstats:FindFirstChild("Coins")
		return if coins and coins:IsA("IntValue") then coins.Value else 0
	end

	local function getOwnedSkins(): { [string]: boolean }
		local owned = {}
		local list = player:GetAttribute("OwnedSkins")
		if typeof(list) == "string" then
			for _, skinId in string.split(list, ",") do
				owned[skinId] = true
			end
		end
		return owned
	end

	-- A tiny blocky figure in the skin's colors.
	local function makePreview(skin, parent: Instance)
		local figure = create("Frame", {
			AnchorPoint = Vector2.new(0.5, 0),
			Position = UDim2.new(0.5, 0, 0, 10),
			Size = UDim2.new(0, 56, 0, 80),
			BackgroundTransparency = 1,
			Parent = parent,
		})
		local gray = Color3.fromRGB(150, 150, 150)
		local head, torso, arms, legs
		if skin.Type == "Monster" then
			head, torso, arms, legs = skin.HeadColor, skin.BodyColor, skin.BodyColor, skin.BodyColor
		else
			head, torso, arms, legs = skin.HeadColor or gray, skin.TorsoColor or gray, skin.ArmColor or gray, skin.LegColor or gray
		end
		local function block(position: UDim2, size: UDim2, color: Color3)
			local part = create("Frame", {
				Position = position,
				Size = size,
				BackgroundColor3 = color,
				BackgroundTransparency = skin.Transparency or 0,
				BorderSizePixel = 0,
				Parent = figure,
			})
			if skin.Outline then
				create("UIStroke", { Color = skin.Outline, Thickness = 1.5, Parent = part })
			end
			return part
		end
		local headBlock = block(UDim2.fromScale(0.3, 0), UDim2.fromScale(0.4, 0.25), head)
		block(UDim2.fromScale(0.25, 0.27), UDim2.fromScale(0.5, 0.36), torso)
		block(UDim2.fromScale(0, 0.27), UDim2.fromScale(0.23, 0.36), arms)
		block(UDim2.fromScale(0.77, 0.27), UDim2.fromScale(0.23, 0.36), arms)
		block(UDim2.fromScale(0.25, 0.64), UDim2.fromScale(0.24, 0.36), legs)
		block(UDim2.fromScale(0.51, 0.64), UDim2.fromScale(0.24, 0.36), legs)
		if skin.Type == "Monster" then
			for _, x in { 0.2, 0.62 } do
				create("Frame", {
					Position = UDim2.fromScale(x, 0.4),
					Size = UDim2.fromScale(0.18, 0.25),
					BackgroundColor3 = skin.EyeColor,
					BorderSizePixel = 0,
					Parent = headBlock,
				})
			end
		elseif skin.Id == Config.DefaultSurvivorSkin then
			create("TextLabel", {
				Size = UDim2.fromScale(1, 1),
				BackgroundTransparency = 1,
				Font = FONT,
				TextScaled = true,
				TextColor3 = WHITE,
				Text = "?",
				Parent = headBlock,
			})
		end
	end

	local function rebuildShop()
		for _, child in grid:GetChildren() do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		local coins = getCoins()
		coinsLabel.Text = `{coins} coins`
		for tabName, tab in tabs do
			tab.BackgroundColor3 = if tabName == currentTab then Color3.fromRGB(150, 30, 30) else Color3.fromRGB(50, 50, 60)
		end

		local owned = getOwnedSkins()
		local equipped = player:GetAttribute(currentTab .. "Skin")
		for index, skin in Config.Skins do
			if skin.Type ~= currentTab then
				continue
			end
			local card = create("Frame", {
				BackgroundColor3 = Color3.fromRGB(38, 38, 48),
				LayoutOrder = index,
				Parent = grid,
			})
			round(card, 10)
			makePreview(skin, card)
			create("TextLabel", {
				Position = UDim2.new(0, 6, 0, 96),
				Size = UDim2.new(1, -12, 0, 22),
				BackgroundTransparency = 1,
				Font = FONT,
				TextSize = 16,
				TextColor3 = WHITE,
				TextTruncate = Enum.TextTruncate.AtEnd,
				Text = skin.Name,
				Parent = card,
			})

			local isOwned = owned[skin.Id] == true
			local isEquipped = equipped == skin.Id
			local text, color
			if isEquipped then
				text, color = "Equipped", Color3.fromRGB(40, 120, 60)
			elseif isOwned then
				text, color = "Equip", Color3.fromRGB(50, 90, 170)
			else
				text = `{skin.Price} coins`
				color = if coins >= skin.Price then Color3.fromRGB(150, 30, 30) else Color3.fromRGB(80, 60, 60)
			end
			local button = create("TextButton", {
				Position = UDim2.new(0, 8, 0, 122),
				Size = UDim2.new(1, -16, 0, 30),
				BackgroundColor3 = color,
				AutoButtonColor = not isEquipped,
				Font = FONT,
				TextSize = 14,
				TextColor3 = WHITE,
				Text = text,
				Parent = card,
			})
			round(button, 6)
			button.Activated:Connect(function()
				if not isEquipped then
					shopRemote:FireServer(if isOwned then "Equip" else "Buy", skin.Id)
				end
			end)

			local gamePassId = skin.GamePassId
			if not isOwned and gamePassId and gamePassId ~= 0 then
				local robuxButton = create("TextButton", {
					Position = UDim2.new(0, 8, 0, 158),
					Size = UDim2.new(1, -16, 0, 28),
					BackgroundColor3 = Color3.fromRGB(0, 150, 90),
					Font = FONT,
					TextSize = 14,
					TextColor3 = WHITE,
					Text = "Buy with Robux",
					Parent = card,
				})
				round(robuxButton, 6)
				robuxButton.Activated:Connect(function()
					MarketplaceService:PromptGamePassPurchase(player, gamePassId)
				end)
			end
		end
	end

	local function refreshShop()
		if shopFrame.Visible then
			rebuildShop()
		end
	end

	local function setShopOpen(open: boolean)
		shopFrame.Visible = open
		refreshShop()
	end

	shopButton.Activated:Connect(function()
		setShopOpen(not shopFrame.Visible)
	end)
	closeButton.Activated:Connect(function()
		setShopOpen(false)
	end)
	for tabName, tab in tabs do
		tab.Activated:Connect(function()
			currentTab = tabName
			refreshShop()
		end)
	end

	for _, attribute in { "OwnedSkins", "SurvivorSkin", "MonsterSkin" } do
		player:GetAttributeChangedSignal(attribute):Connect(refreshShop)
	end
	-- Close the shop when a round puts you in the map.
	player:GetAttributeChangedSignal("Role"):Connect(function()
		if player:GetAttribute("Role") ~= nil then
			setShopOpen(false)
		end
	end)
	task.spawn(function()
		local coins = player:WaitForChild("leaderstats"):WaitForChild("Coins")
		coins.Changed:Connect(refreshShop)
	end)

	-- The shop stall in the lobby opens it too.
	remotes:WaitForChild("OpenShop").OnClientEvent:Connect(function()
		setShopOpen(true)
	end)
end

return Shop

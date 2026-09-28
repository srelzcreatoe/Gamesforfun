--!strict
--[[
	ExtrasClient
	Location: StarterPlayer.StarterPlayerScripts (LocalScript)

	The menus and effects for the features the original game doesn't have,
	in the same chunky style as the rest of the HUD (see UIKit):
	  * the Manage menu (the G prompt on your own brainrot): its level, income
	    and hat, guard duty and pet
	  * a column of side buttons on the right: Season (the season pass), Crew
	    and Pets (which brainrots follow you, and more pet slots)
	  * crew invites, the Limited Shop on the map (this week's brainrot on its
	    display, a countdown and the purchase window)
	  * the boss's health bar and stomp shockwaves, the revenge arrow, the
	    loot bag and bounty banners
	  * pets: every player's pet brainrots follow them around (drawn here,
	    animated by BrainrotVisuals)

	Nothing here decides anything: every button asks the server (the
	ManageBrainrot, Companion, Crew, Season and Rewards remotes), which checks
	it and answers.
]]

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ProximityPromptService = game:GetService("ProximityPromptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))
local ExtrasConfig = require(Shared:WaitForChild("ExtrasConfig"))
local FeatureConfig = require(Shared:WaitForChild("FeatureConfig"))
local HatModels = require(Shared:WaitForChild("HatModels"))
local MonetizationConfig = require(Shared:WaitForChild("MonetizationConfig"))
local NumberFormat = require(Shared:WaitForChild("NumberFormat"))
local Sounds = require(Shared:WaitForChild("Sounds"))
local TemplateModels = require(Shared:WaitForChild("TemplateModels"))
local UIKit = require(Shared:WaitForChild("UIKit"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local manageFunction = remotes:WaitForChild("ManageBrainrot") :: RemoteFunction
local companionFunction = remotes:WaitForChild("Companion") :: RemoteFunction
local crewFunction = remotes:WaitForChild("Crew") :: RemoteFunction
local crewEvent = remotes:WaitForChild("CrewEvent") :: RemoteEvent
local seasonFunction = remotes:WaitForChild("Season") :: RemoteFunction
local seasonStateEvent = remotes:WaitForChild("SeasonState") :: RemoteEvent

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui") :: PlayerGui
local map = Workspace:WaitForChild("Map")
local brainrotsFolder = map:WaitForChild("Brainrots")

local create = UIKit.create
local label = UIKit.label
local button = UIKit.button
local corner = UIKit.corner
local stroke = UIKit.stroke
local COLORS = UIKit.Colors
local ACCENTS = {
	Manage = Color3.fromRGB(60, 190, 150),
	Season = Color3.fromRGB(255, 170, 30),
	Crew = Color3.fromRGB(80, 140, 255),
	Pets = Color3.fromRGB(235, 120, 60),
	Limited = Color3.fromRGB(255, 200, 40),
	Premium = Color3.fromRGB(255, 190, 40),
}

local screen = create("ScreenGui", {
	Name = "ExtrasHud",
	ResetOnSpawn = false,
	ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	DisplayOrder = 1,
}) :: ScreenGui

-- Asks the server through a RemoteFunction; shows its answer as a pop-up.
local function ask(remote: RemoteFunction, ...: any): (boolean, any)
	local args = table.pack(...)
	local ok, success, message, extra = pcall(function()
		return remote:InvokeServer(table.unpack(args, 1, args.n))
	end)
	if not ok then
		UIKit.toast("Couldn't reach the server, try again.", "Error")
		return false, nil
	end
	if typeof(message) == "string" then
		UIKit.toast(message, if success == true then "Success" else "Error")
		Sounds.play(if success == true then "Purchase" else "Error")
	end
	return success == true, extra
end

-- Asks quietly (for state that fills a window).
local function fetch(remote: RemoteFunction, ...: any): any
	local args = table.pack(...)
	local ok, success, _, extra = pcall(function()
		return remote:InvokeServer(table.unpack(args, 1, args.n))
	end)
	if ok and success == true then
		return extra
	end
	return nil
end

local function promptProduct(key: string)
	local productId = MonetizationConfig.ProductIds[key]
	if productId and not MonetizationConfig.isSetUp(productId) then
		UIKit.toast(MonetizationConfig.NotSetUpMessage, "Warning")
	elseif productId then
		pcall(function()
			MarketplaceService:PromptProductPurchase(player, productId)
		end)
	end
end

local function promptPass(key: string)
	local passId = MonetizationConfig.GamePasses[key]
	if passId and not MonetizationConfig.isSetUp(passId) then
		UIKit.toast(MonetizationConfig.NotSetUpMessage, "Warning")
	elseif passId then
		pcall(function()
			if MonetizationConfig.PassesSoldAsProducts[key] then
				MarketplaceService:PromptProductPurchase(player, passId)
			else
				MarketplaceService:PromptGamePassPurchase(player, passId)
			end
		end)
	end
end

local function duration(seconds: number): string
	local total = math.max(0, math.floor(seconds))
	if total >= 86400 then
		return string.format("%dd %dh", total // 86400, total // 3600 % 24)
	elseif total >= 3600 then
		return string.format("%dh %dm", total // 3600, total // 60 % 60)
	end
	return string.format("%dm %02ds", total // 60, total % 60)
end

-- A 3D hat spinning in a little window.
local function hatViewport(hatName: string, properties: { [string]: any }): ViewportFrame
	local viewport = create("ViewportFrame", {
		BackgroundColor3 = COLORS.PanelDark,
		Ambient = Color3.fromRGB(200, 200, 200),
		LightColor = Color3.new(1, 1, 1),
		LightDirection = Vector3.new(-0.4, -1, 0.6),
	}, { corner(10) }) :: ViewportFrame
	for key, value in properties do
		(viewport :: any)[key] = value
	end
	local model = HatModels.build(hatName, 2)
	if model then
		model:PivotTo(CFrame.new(0, -0.6, 0))
		model.Parent = viewport
		local camera = Instance.new("Camera")
		camera.FieldOfView = 40
		camera.CFrame = CFrame.lookAt(Vector3.new(2.2, 1.8, -3.4), Vector3.new(0, 0, 0))
		camera.Parent = viewport
		viewport.CurrentCamera = camera
	end
	return viewport
end

--------------------------------------------------------------------------------
-- Side buttons (right, next to Trade/Upgrade/Settings)
--------------------------------------------------------------------------------

local column = UIKit.sideColumn(screen, "ExtraButtons", 3, {})
UIKit.placeSideColumn(column, true, 1)
local seasonButton = UIKit.sideButton(column, "SeasonButton", "Season", ACCENTS.Season, "Season", 1, "🏆")
local crewButton = UIKit.sideButton(column, "CrewButton", "Crew", ACCENTS.Crew, "Crew", 2, "👥")
local petsButton = UIKit.sideButton(column, "PetsButton", "Pets", ACCENTS.Pets, "Pets", 3, "🐾")

--------------------------------------------------------------------------------
-- Manage menu: level, hat, guard and pet for one of your brainrots
--------------------------------------------------------------------------------

local manageFrame, manageBody = UIKit.modal(screen, "ManageMenu", "Your Brainrot", ACCENTS.Manage, Vector2.new(640, 600))
local manageSlot: number? = nil
local refreshManage: () -> ()
do
	local preview = create("Frame", {
		Name = "Preview",
		Size = UDim2.new(0.34, 0, 0.36, 0),
		BackgroundColor3 = COLORS.PanelDark,
	}, { corner(12), stroke(Color3.new(0, 0, 0), 2) }) :: Frame
	preview.Parent = manageBody

	local function info(name: string, y: number, height: number, colour: Color3): TextLabel
		local line = label({
			Name = name,
			Position = UDim2.new(0.37, 0, y, 0),
			Size = UDim2.new(0.63, 0, height, 0),
			Text = "",
			TextColor3 = colour,
			TextXAlignment = Enum.TextXAlignment.Left,
			TextSize = 26,
		})
		line.Parent = manageBody
		return line
	end
	local nameLabel = info("BrainrotName", 0, 0.09, COLORS.Text)
	local rarityLabel = info("Rarity", 0.09, 0.065, COLORS.Muted)
	local levelLabel = info("Level", 0.16, 0.07, Color3.fromRGB(140, 230, 255))
	local nextLabel = info("NextLevel", 0.23, 0.055, COLORS.Muted)
	local incomeLabel = info("Income", 0.29, 0.065, COLORS.Income)

	local buttons = create("Frame", {
		Name = "Roles",
		Position = UDim2.new(0, 0, 0.39, 0),
		Size = UDim2.new(1, 0, 0.1, 0),
		BackgroundTransparency = 1,
	}, {
		create("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			Padding = UDim.new(0.02, 0),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	}) :: Frame
	buttons.Parent = manageBody
	local guardButton = button("🛡️ Make Guard", Color3.fromRGB(60, 140, 230), { Name = "GuardButton", Size = UDim2.new(0.32, 0, 1, 0), LayoutOrder = 1 })
	guardButton.Parent = buttons
	local petButton = button("🐾 Make Pet", Color3.fromRGB(230, 120, 60), { Name = "PetButton", Size = UDim2.new(0.32, 0, 1, 0), LayoutOrder = 2 })
	petButton.Parent = buttons
	local superButton = button("⚡ Super Guard", Color3.fromRGB(150, 80, 230), { Name = "SuperGuardButton", Size = UDim2.new(0.32, 0, 1, 0), LayoutOrder = 3 })
	superButton.Parent = buttons

	local hatTitle = label({
		Name = "HatTitle",
		Position = UDim2.new(0, 0, 0.51, 0),
		Size = UDim2.new(0.62, 0, 0.065, 0),
		Text = "🎩 Hats: more income for whoever wears one",
		TextXAlignment = Enum.TextXAlignment.Left,
		TextSize = 22,
	})
	hatTitle.Parent = manageBody
	local removeHatButton = button("Take hat off", COLORS.Close, {
		Name = "RemoveHat",
		Position = UDim2.new(0.64, 0, 0.505, 0),
		Size = UDim2.new(0.36, 0, 0.075, 0),
	})
	removeHatButton.Parent = manageBody

	local hatList = create("ScrollingFrame", {
		Name = "HatList",
		Position = UDim2.new(0, 0, 0.59, 0),
		Size = UDim2.new(1, 0, 0.3, 0),
		BackgroundTransparency = 1,
		ScrollBarThickness = 8,
		CanvasSize = UDim2.new(0, 0, 0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.X,
		ScrollingDirection = Enum.ScrollingDirection.X,
	}, {
		create("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			Padding = UDim.new(0, 10),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	}) :: ScrollingFrame
	hatList.Parent = manageBody

	local crateButton = button("🎁 Hat Crate (random hat)", Color3.fromRGB(150, 90, 230), {
		Name = "HatCrate",
		Position = UDim2.new(0.2, 0, 0.91, 0),
		Size = UDim2.new(0.6, 0, 0.085, 0),
	})
	crateButton.Parent = manageBody
	crateButton.Activated:Connect(function()
		promptProduct("HatCrate")
	end)
	superButton.Activated:Connect(function()
		promptPass("SuperGuard")
	end)

	type HatCard = { Frame: Frame, Count: TextLabel, Wear: TextButton }
	local hatCards: { [string]: HatCard } = {}
	for order, hat in ExtrasConfig.Hats do
		local card = create("Frame", {
			Name = hat.Name,
			Size = UDim2.new(0, 120, 1, -12),
			BackgroundColor3 = COLORS.PanelLight,
			LayoutOrder = order,
		}, { corner(12), stroke(hat.Color, 3) }) :: Frame
		hatViewport(hat.Name, { Name = "Preview", Position = UDim2.new(0, 6, 0, 6), Size = UDim2.new(1, -12, 0.42, 0) }).Parent = card
		label({ Name = "HatName", Position = UDim2.new(0, 2, 0.46, 0), Size = UDim2.new(1, -4, 0.14, 0), Text = hat.DisplayName, TextSize = 16 }).Parent = card
		label({
			Name = "Bonus",
			Position = UDim2.new(0, 2, 0.59, 0),
			Size = UDim2.new(1, -4, 0.12, 0),
			Text = string.format("+%d%% income", math.floor(hat.Bonus * 100 + 0.5)),
			TextColor3 = COLORS.Cash,
			TextSize = 15,
		}).Parent = card
		local count = label({ Name = "Count", Position = UDim2.new(0, 2, 0.7, 0), Size = UDim2.new(1, -4, 0.11, 0), Text = "x0", TextColor3 = COLORS.Muted, TextSize = 14 })
		count.Parent = card
		local wear = button("Wear", COLORS.Buy, { Name = "Wear", Position = UDim2.new(0.08, 0, 0.82, 0), Size = UDim2.new(0.84, 0, 0.16, 0) })
		wear.Parent = card
		wear.Activated:Connect(function()
			if manageSlot then
				ask(manageFunction, "PutHat", manageSlot, hat.Name)
				refreshManage()
			end
		end)
		card.Parent = hatList
		hatCards[hat.Name] = { Frame = card, Count = count, Wear = wear }
	end

	local guardSlot: number? = nil
	local petSlotList: { number } = {}
	guardButton.Activated:Connect(function()
		if manageSlot then
			ask(companionFunction, if guardSlot == manageSlot then "Unguard" else "Guard", manageSlot)
			refreshManage()
		end
	end)
	petButton.Activated:Connect(function()
		if manageSlot then
			ask(companionFunction, if table.find(petSlotList, manageSlot) then "Unpet" else "Pet", manageSlot)
			refreshManage()
		end
	end)
	removeHatButton.Activated:Connect(function()
		if manageSlot then
			ask(manageFunction, "RemoveHat", manageSlot)
			refreshManage()
		end
	end)

	local shownPreview: string? = nil
	refreshManage = function()
		local slot = manageSlot
		if slot == nil then
			return
		end
		local infoData = fetch(manageFunction, "Info", slot)
		local roles = fetch(companionFunction, "State")
		if manageSlot ~= slot or typeof(infoData) ~= "table" then
			return
		end
		guardSlot = if typeof(roles) == "table" then roles.Guard else nil
		petSlotList = if typeof(roles) == "table" and typeof(roles.Pets) == "table" then roles.Pets else {}

		-- Which brainrot is on that pedestal (from its model).
		local entryId: string? = nil
		local mutationName: string? = nil
		for _, model in brainrotsFolder:GetChildren() do
			if model:GetAttribute("OwnerUserId") == player.UserId and model:GetAttribute("Slot") == slot then
				local id = model:GetAttribute("BrainrotId")
				entryId = if typeof(id) == "string" then id else nil
				local mutation = model:GetAttribute("Mutation")
				mutationName = if typeof(mutation) == "string" then mutation else nil
			end
		end
		local definition = if entryId then BrainrotConfig.ById[entryId] else nil
		if definition then
			local rarity = BrainrotConfig.RarityByName[definition.Rarity]
			nameLabel.Text = (if mutationName then mutationName .. " " else "") .. definition.DisplayName
			rarityLabel.Text = definition.Rarity
			rarityLabel.TextColor3 = if rarity then rarity.Color else COLORS.Muted
			if shownPreview ~= definition.Id then
				shownPreview = definition.Id
				for _, child in preview:GetChildren() do
					if child:IsA("ViewportFrame") then
						child:Destroy()
					end
				end
				UIKit.brainrotViewport(definition.Id, if rarity then rarity.Color:Lerp(Color3.new(0, 0, 0), 0.55) else COLORS.PanelDark, {
					Size = UDim2.fromScale(1, 1),
				}).Parent = preview
			end
		end
		local level = tonumber(infoData.Level) or 1
		levelLabel.Text = string.format("⭐ Level %d / %d  (+%d%% income)", level, ExtrasConfig.MaxLevel, math.floor(ExtrasConfig.IncomePerLevel * (level - 1) * 100 + 0.5))
		local nextIn = tonumber(infoData.NextLevelIn)
		nextLabel.Text = if nextIn then "Next level in " .. duration(nextIn) .. " on its pedestal" else "MAX LEVEL!"
		incomeLabel.Text = NumberFormat.cash(tonumber(infoData.Income) or 0) .. "/s"

		guardButton.Text = if guardSlot == slot then "🛡️ Stop Guarding" else "🛡️ Make Guard"
		petButton.Text = if table.find(petSlotList, slot) then "🐾 Stop Pet" else "🐾 Make Pet"
		local hats = if typeof(infoData.Hats) == "table" then infoData.Hats else {}
		local wearing = if typeof(infoData.Hat) == "string" then infoData.Hat else nil
		local worn = if wearing then ExtrasConfig.HatByName[wearing] else nil
		hatTitle.Text = if worn
			then string.format("🎩 Wearing: %s %s (+%d%%)", worn.Icon, worn.DisplayName, math.floor(worn.Bonus * 100 + 0.5))
			else "🎩 Hats: more income for whoever wears one"
		removeHatButton.Visible = worn ~= nil
		for hatName, card in hatCards do
			local count = tonumber(hats[hatName]) or 0
			card.Count.Text = "You have x" .. count
			UIKit.setEnabled(card.Wear, count > 0 and wearing ~= hatName, COLORS.Buy)
			card.Wear.Text = if wearing == hatName then "Wearing" else "Wear"
		end
	end
end

ProximityPromptService.PromptTriggered:Connect(function(prompt: ProximityPrompt, who: Player)
	if who ~= player then
		return
	end
	local kind = prompt:GetAttribute("PromptKind")
	if kind == "Manage" then
		local model = prompt:FindFirstAncestorWhichIsA("Model")
		local slot = if model then model:GetAttribute("Slot") else nil
		if typeof(slot) == "number" then
			manageSlot = slot
			UIKit.openModal(manageFrame)
			task.spawn(refreshManage)
		end
	end
end)

--------------------------------------------------------------------------------
-- Season pass
--------------------------------------------------------------------------------

local seasonFrame, seasonBody = UIKit.modal(screen, "SeasonMenu", "Season Pass", ACCENTS.Season, Vector2.new(800, 600))
local seasonState: { [string]: any }? = nil
local renderSeason: () -> ()
do
	local header = label({
		Name = "SeasonInfo",
		Size = UDim2.new(0.55, 0, 0.07, 0),
		Text = "Season 1",
		TextXAlignment = Enum.TextXAlignment.Left,
		TextSize = 26,
	})
	header.Parent = seasonBody
	local bar, setBar = UIKit.progressBar(ACCENTS.Season, {
		Name = "XPBar",
		Position = UDim2.new(0, 0, 0.08, 0),
		Size = UDim2.new(0.55, 0, 0.06, 0),
	})
	bar.Parent = seasonBody

	local claimAll = button("Claim all", COLORS.Buy, { Name = "ClaimAll", Position = UDim2.new(0.57, 0, 0, 0), Size = UDim2.new(0.2, 0, 0.065, 0) })
	claimAll.Parent = seasonBody
	local skip = button("Skip a tier", Color3.fromRGB(80, 160, 255), { Name = "SkipTier", Position = UDim2.new(0.79, 0, 0, 0), Size = UDim2.new(0.21, 0, 0.065, 0) })
	skip.Parent = seasonBody
	local getPass = button("👑 Get the Season Pass", ACCENTS.Premium, { Name = "GetPass", Position = UDim2.new(0.57, 0, 0.075, 0), Size = UDim2.new(0.43, 0, 0.065, 0) })
	getPass.Parent = seasonBody
	claimAll.Activated:Connect(function()
		local ok, state = ask(seasonFunction, "ClaimAll")
		if ok and typeof(state) == "table" then
			seasonState = state
			renderSeason()
		end
	end)
	skip.Activated:Connect(function()
		promptProduct("SeasonTierSkip")
	end)
	getPass.Activated:Connect(function()
		promptPass("SeasonPass")
	end)

	local columns = create("Frame", {
		Name = "Columns",
		Position = UDim2.new(0, 0, 0.155, 0),
		Size = UDim2.new(1, -12, 0.05, 0),
		BackgroundTransparency = 1,
	}) :: Frame
	columns.Parent = seasonBody
	label({ Size = UDim2.new(0.12, 0, 1, 0), Text = "Tier", TextSize = 20, TextColor3 = COLORS.Muted }).Parent = columns
	label({ Position = UDim2.new(0.13, 0, 0, 0), Size = UDim2.new(0.43, 0, 1, 0), Text = "Free", TextSize = 20, TextColor3 = COLORS.Muted }).Parent = columns
	label({ Position = UDim2.new(0.57, 0, 0, 0), Size = UDim2.new(0.43, 0, 1, 0), Text = "👑 Premium", TextSize = 20, TextColor3 = ACCENTS.Premium }).Parent = columns

	local list = create("ScrollingFrame", {
		Name = "Tiers",
		Position = UDim2.new(0, 0, 0.21, 0),
		Size = UDim2.new(1, 0, 0.79, 0),
		BackgroundTransparency = 1,
		ScrollBarThickness = 8,
		CanvasSize = UDim2.new(0, 0, 0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, {
		create("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }),
	}) :: ScrollingFrame
	list.Parent = seasonBody

	type Cell = { Frame: Frame, Button: TextButton, Text: TextLabel }
	type Row = { Frame: Frame, Tier: TextLabel, Free: Cell, Premium: Cell }
	local rows: { Row } = {}

	local function cell(parent: Frame, x: number, reward: FeatureConfig.Reward, premium: boolean, tier: number): Cell
		local frame = create("Frame", {
			Position = UDim2.new(x, 0, 0, 3),
			Size = UDim2.new(0.43, 0, 1, -6),
			BackgroundColor3 = if premium then Color3.fromRGB(70, 55, 25) else COLORS.PanelLight,
		}, { corner(10), stroke(if premium then ACCENTS.Premium else Color3.new(0, 0, 0), 2) }) :: Frame
		local text = label({
			Position = UDim2.new(0, 8, 0, 0),
			Size = UDim2.new(0.62, -8, 1, 0),
			Text = FeatureConfig.describeReward(reward),
			TextXAlignment = Enum.TextXAlignment.Left,
			TextSize = 18,
		})
		text.Parent = frame
		local claim = button("Claim", COLORS.Buy, { Position = UDim2.new(0.64, 0, 0.12, 0), Size = UDim2.new(0.34, 0, 0.76, 0) })
		claim.Parent = frame
		claim.Activated:Connect(function()
			local ok, state = ask(seasonFunction, "Claim", { Tier = tier, Track = if premium then "Premium" else "Free" })
			if ok and typeof(state) == "table" then
				seasonState = state
				renderSeason()
			end
		end)
		frame.Parent = parent
		return { Frame = frame, Button = claim, Text = text }
	end

	for tier, rewards in ExtrasConfig.SeasonTiers do
		local row = create("Frame", {
			Name = "Tier" .. tier,
			Size = UDim2.new(1, -12, 0, 54),
			BackgroundTransparency = 1,
			LayoutOrder = tier,
		}) :: Frame
		local tierLabel = label({
			Size = UDim2.new(0.12, 0, 1, 0),
			Text = tostring(tier),
			TextSize = 28,
			BackgroundTransparency = 0,
			BackgroundColor3 = COLORS.PanelDark,
		})
		corner(10).Parent = tierLabel
		tierLabel.Parent = row
		rows[tier] = {
			Frame = row,
			Tier = tierLabel,
			Free = cell(row, 0.13, rewards[1], false, tier),
			Premium = cell(row, 0.57, rewards[2], true, tier),
		}
		row.Parent = list
	end

	renderSeason = function()
		local state = seasonState
		if state == nil then
			return
		end
		local xp = tonumber(state.XP) or 0
		local tier = tonumber(state.Tier) or 0
		local premium = state.Premium == true
		local endsAt = tonumber(state.EndsAt) or 0
		header.Text = string.format("Season %d  ·  ends in %s", tonumber(state.Season) or 1, duration(endsAt - Workspace:GetServerTimeNow()))
		if tier >= ExtrasConfig.SeasonTierCount then
			setBar(1, "Every tier done! 🏆")
		else
			local into = xp - tier * ExtrasConfig.TierXP
			setBar(into / ExtrasConfig.TierXP, string.format("Tier %d → %d:  %d / %d XP", tier, tier + 1, math.floor(into), ExtrasConfig.TierXP))
		end
		getPass.Visible = not premium
		local free = if typeof(state.Free) == "table" then state.Free else {}
		local claimedPremium = if typeof(state.PremiumClaimed) == "table" then state.PremiumClaimed else {}
		local waiting = false
		for index, row in rows do
			local reached = index <= tier
			row.Tier.BackgroundColor3 = if reached then ACCENTS.Season else COLORS.PanelDark
			for _, track in { "Free", "Premium" } do
				local cellInfo = if track == "Free" then row.Free else row.Premium
				local claimed = table.find(if track == "Free" then free else claimedPremium, index) ~= nil
				local locked = track == "Premium" and not premium
				if claimed then
					cellInfo.Button.Text = "✅"
					UIKit.setEnabled(cellInfo.Button, false, COLORS.Buy)
				elseif not reached then
					cellInfo.Button.Text = "🔒"
					UIKit.setEnabled(cellInfo.Button, false, COLORS.Buy)
				elseif locked then
					cellInfo.Button.Text = "👑"
					UIKit.setEnabled(cellInfo.Button, false, COLORS.Buy)
				else
					cellInfo.Button.Text = "Claim"
					UIKit.setEnabled(cellInfo.Button, true, COLORS.Buy)
					waiting = true
				end
			end
		end
		UIKit.setAlert(seasonButton, waiting)
	end

	seasonStateEvent.OnClientEvent:Connect(function(state: any)
		if typeof(state) == "table" then
			seasonState = state
			renderSeason()
		end
	end)
	task.spawn(function()
		local state = fetch(seasonFunction, "State")
		if typeof(state) == "table" then
			seasonState = state
			renderSeason()
		end
	end)
end

seasonButton.Activated:Connect(function()
	if UIKit.toggleModal(seasonFrame) then
		renderSeason()
	end
end)

--------------------------------------------------------------------------------
-- Crews
--------------------------------------------------------------------------------

local crewFrame, crewBody = UIKit.modal(screen, "CrewMenu", "Crew", ACCENTS.Crew, Vector2.new(660, 560))
local crewState: { [string]: any } = { Invites = {} }
local renderCrew: () -> ()
do
	local nameIndex = 1
	local colorIndex = 1

	-- Starting a crew.
	local startPage = create("Frame", { Name = "Start", Size = UDim2.fromScale(1, 0.5), BackgroundTransparency = 1 }) :: Frame
	startPage.Parent = crewBody
	label({ Size = UDim2.new(1, 0, 0.18, 0), Text = "Start a crew: +5% income for each crewmate here!", TextSize = 22 }).Parent = startPage
	local previous = button("◀", COLORS.PanelLight, { Position = UDim2.new(0, 0, 0.22, 0), Size = UDim2.new(0.1, 0, 0.2, 0) })
	previous.Parent = startPage
	local crewName = label({ Name = "CrewName", Position = UDim2.new(0.12, 0, 0.22, 0), Size = UDim2.new(0.76, 0, 0.2, 0), Text = "", TextSize = 32 })
	crewName.Parent = startPage
	local nextName = button("▶", COLORS.PanelLight, { Position = UDim2.new(0.9, 0, 0.22, 0), Size = UDim2.new(0.1, 0, 0.2, 0) })
	nextName.Parent = startPage
	local swatches = create("Frame", {
		Position = UDim2.new(0.1, 0, 0.47, 0),
		Size = UDim2.new(0.8, 0, 0.18, 0),
		BackgroundTransparency = 1,
	}, {
		create("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			HorizontalAlignment = Enum.HorizontalAlignment.Center,
			Padding = UDim.new(0, 8),
		}),
	}) :: Frame
	swatches.Parent = startPage
	local swatchButtons: { TextButton } = {}
	for index, colour in ExtrasConfig.CrewColors do
		local swatch = create("TextButton", {
			Size = UDim2.new(0, 40, 1, 0),
			BackgroundColor3 = colour,
			Text = "",
		}, { corner(8), stroke(Color3.new(0, 0, 0), 2) }) :: TextButton
		swatch.Activated:Connect(function()
			colorIndex = index
			renderCrew()
		end)
		swatch.Parent = swatches
		swatchButtons[index] = swatch
	end
	local createButton = button("Start crew", COLORS.Buy, { Name = "CreateCrew", Position = UDim2.new(0.3, 0, 0.72, 0), Size = UDim2.new(0.4, 0, 0.2, 0) })
	createButton.Parent = startPage
	previous.Activated:Connect(function()
		nameIndex = (nameIndex - 2) % #ExtrasConfig.CrewNames + 1
		renderCrew()
	end)
	nextName.Activated:Connect(function()
		nameIndex = nameIndex % #ExtrasConfig.CrewNames + 1
		renderCrew()
	end)
	createButton.Activated:Connect(function()
		local ok, state = ask(crewFunction, "Create", { Name = nameIndex, Color = colorIndex })
		if ok and typeof(state) == "table" then
			crewState = state
		end
		renderCrew()
	end)

	-- In a crew.
	local crewPage = create("Frame", { Name = "InCrew", Size = UDim2.fromScale(1, 0.5), BackgroundTransparency = 1 }) :: Frame
	crewPage.Parent = crewBody
	local crewTitle = label({ Name = "CrewTitle", Size = UDim2.new(0.7, 0, 0.18, 0), Text = "", TextSize = 32, TextXAlignment = Enum.TextXAlignment.Left })
	crewTitle.Parent = crewPage
	local leave = button("Leave", COLORS.Close, { Name = "LeaveCrew", Position = UDim2.new(0.75, 0, 0, 0), Size = UDim2.new(0.25, 0, 0.16, 0) })
	leave.Parent = crewPage
	leave.Activated:Connect(function()
		local ok, state = ask(crewFunction, "Leave")
		if ok and typeof(state) == "table" then
			crewState = state
		end
		renderCrew()
	end)
	local members = create("Frame", {
		Name = "Members",
		Position = UDim2.new(0, 0, 0.2, 0),
		Size = UDim2.new(1, 0, 0.8, 0),
		BackgroundTransparency = 1,
	}, { create("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }) }) :: Frame
	members.Parent = crewPage

	-- Invites for you, and players you can invite.
	local lower = create("ScrollingFrame", {
		Name = "People",
		Position = UDim2.new(0, 0, 0.52, 0),
		Size = UDim2.new(1, 0, 0.48, 0),
		BackgroundTransparency = 1,
		ScrollBarThickness = 8,
		CanvasSize = UDim2.new(0, 0, 0, 0),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, { create("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }) }) :: ScrollingFrame
	lower.Parent = crewBody

	local function row(parent: Instance, text: string, order: number, colour: Color3?): Frame
		local frame = create("Frame", {
			Size = UDim2.new(1, -12, 0, 40),
			BackgroundColor3 = colour or COLORS.PanelLight,
			LayoutOrder = order,
		}, { corner(8) }) :: Frame
		label({ Position = UDim2.new(0, 10, 0, 0), Size = UDim2.new(0.62, 0, 1, 0), Text = text, TextSize = 20, TextXAlignment = Enum.TextXAlignment.Left }).Parent = frame
		frame.Parent = parent
		return frame
	end

	local function rowButton(frame: Frame, text: string, colour: Color3, x: number, width: number, callback: () -> ())
		local rowAction = button(text, colour, { Position = UDim2.new(x, 0, 0.1, 0), Size = UDim2.new(width, 0, 0.8, 0) })
		rowAction.Parent = frame
		rowAction.Activated:Connect(callback)
	end

	renderCrew = function()
		local crew = crewState.Crew
		startPage.Visible = crew == nil
		crewPage.Visible = crew ~= nil
		crewName.Text = ExtrasConfig.CrewNames[nameIndex]
		crewName.TextColor3 = ExtrasConfig.CrewColors[colorIndex]
		for index, swatch in swatchButtons do
			local swatchStroke = swatch:FindFirstChildOfClass("UIStroke")
			if swatchStroke then
				swatchStroke.Thickness = if index == colorIndex then 4 else 2
				swatchStroke.Color = if index == colorIndex then Color3.new(1, 1, 1) else Color3.new(0, 0, 0)
			end
		end
		for _, child in members:GetChildren() do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		for _, child in lower:GetChildren() do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		local inCrew: { [number]: boolean } = {}
		if crew then
			local colour = ExtrasConfig.CrewColors[tonumber(crew.ColorIndex) or 1] or Color3.new(1, 1, 1)
			local count = if typeof(crew.Members) == "table" then #crew.Members else 1
			crewTitle.Text = string.format("%s  (+%d%%)", tostring(crew.Name), math.floor(ExtrasConfig.CrewBoostPerMember * math.max(0, count - 1) * 100 + 0.5))
			crewTitle.TextColor3 = colour
			local lead = crew.Leader == player.UserId
			for order, member in crew.Members or {} do
				inCrew[member.UserId] = true
				local memberRow = row(members, (if member.UserId == crew.Leader then "👑 " else "") .. tostring(member.Name), order)
				if lead and member.UserId ~= player.UserId then
					rowButton(memberRow, "Kick", COLORS.Close, 0.74, 0.24, function()
						local ok, state = ask(crewFunction, "Kick", member.UserId)
						if ok and typeof(state) == "table" then
							crewState = state
						end
						renderCrew()
					end)
				end
			end
		end
		local order = 0
		for _, invite in crewState.Invites or {} do
			order += 1
			local inviteRow = row(lower, string.format("📩 %s invited you to %s", tostring(invite.From), tostring(invite.CrewName)), order, Color3.fromRGB(50, 80, 140))
			rowButton(inviteRow, "Join", COLORS.Buy, 0.64, 0.17, function()
				local ok, state = ask(crewFunction, "Accept", invite.CrewId)
				if ok and typeof(state) == "table" then
					crewState = state
				end
				renderCrew()
			end)
			rowButton(inviteRow, "No", COLORS.Close, 0.82, 0.16, function()
				local _, state = ask(crewFunction, "Decline", invite.CrewId)
				if typeof(state) == "table" then
					crewState = state
				end
				renderCrew()
			end)
		end
		if crew then
			for _, other in Players:GetPlayers() do
				if other ~= player and not inCrew[other.UserId] then
					order += 1
					local otherRow = row(lower, other.DisplayName, order)
					rowButton(otherRow, "Invite", Color3.fromRGB(80, 140, 255), 0.7, 0.28, function()
						ask(crewFunction, "Invite", other.UserId)
					end)
				end
			end
			if order == 0 then
				row(lower, "Nobody else to invite right now.", 1, COLORS.PanelDark)
			end
		end
		UIKit.setAlert(crewButton, #(crewState.Invites or {}) > 0)
	end

	-- A pop-up when someone invites you.
	local popup = create("Frame", {
		Name = "CrewInvite",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -170),
		Size = UDim2.fromOffset(460, 110),
		BackgroundColor3 = COLORS.Panel,
		Visible = false,
	}, { corner(14), stroke(ACCENTS.Crew, 3) }) :: Frame
	popup.Parent = screen
	UIKit.autoScale(popup)
	local popupText = label({ Position = UDim2.new(0, 10, 0, 6), Size = UDim2.new(1, -20, 0.45, 0), Text = "", TextSize = 22 })
	popupText.Parent = popup
	local popupJoin = button("Join", COLORS.Buy, { Position = UDim2.new(0.1, 0, 0.55, 0), Size = UDim2.new(0.38, 0, 0.36, 0) })
	popupJoin.Parent = popup
	local popupNo = button("No thanks", COLORS.Close, { Position = UDim2.new(0.52, 0, 0.55, 0), Size = UDim2.new(0.38, 0, 0.36, 0) })
	popupNo.Parent = popup
	local popupCrewId: string? = nil
	popupJoin.Activated:Connect(function()
		popup.Visible = false
		if popupCrewId then
			local ok, state = ask(crewFunction, "Accept", popupCrewId)
			if ok and typeof(state) == "table" then
				crewState = state
			end
			renderCrew()
		end
	end)
	popupNo.Activated:Connect(function()
		popup.Visible = false
		if popupCrewId then
			local _, state = ask(crewFunction, "Decline", popupCrewId)
			if typeof(state) == "table" then
				crewState = state
			end
			renderCrew()
		end
	end)

	crewEvent.OnClientEvent:Connect(function(kind: any, data: any)
		if kind == "State" and typeof(data) == "table" then
			crewState = data
			renderCrew()
		elseif kind == "Invite" and typeof(data) == "table" then
			popupCrewId = if typeof(data.CrewId) == "string" then data.CrewId else nil
			popupText.Text = string.format("%s invited you to the %s!", tostring(data.From), tostring(data.CrewName))
			popup.Visible = true
			Sounds.play("Notify")
			local shown = popupCrewId
			task.delay(ExtrasConfig.CrewInviteSeconds, function()
				if popupCrewId == shown then
					popup.Visible = false
				end
			end)
		end
	end)
	task.spawn(function()
		local state = fetch(crewFunction, "State")
		if typeof(state) == "table" then
			crewState = state
		end
		renderCrew()
	end)
end

crewButton.Activated:Connect(function()
	if UIKit.toggleModal(crewFrame) then
		renderCrew()
	end
end)

--------------------------------------------------------------------------------
-- Pets: which of your brainrots follow you, and buying more pet slots
--------------------------------------------------------------------------------

local petsFrame, petsBody = UIKit.modal(screen, "PetsMenu", "PETS", ACCENTS.Pets, Vector2.new(760, 580))
local renderPets: () -> ()
do
	local summary = label({
		Name = "Summary",
		Size = UDim2.new(0.62, 0, 0, 34),
		Text = "",
		TextSize = 26,
		TextXAlignment = Enum.TextXAlignment.Left,
	})
	summary.Parent = petsBody
	local speedLabel = label({
		Name = "Speed",
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.fromScale(1, 0),
		Size = UDim2.new(0.38, 0, 0, 34),
		Text = "",
		TextColor3 = COLORS.Cash,
		TextSize = 24,
		TextXAlignment = Enum.TextXAlignment.Right,
	})
	speedLabel.Parent = petsBody

	-- One tile per pet slot: its pet, empty, or locked with its price.
	local slotRow = create("Frame", {
		Name = "Slots",
		Position = UDim2.fromOffset(0, 42),
		Size = UDim2.new(1, 0, 0, 92),
		BackgroundTransparency = 1,
	}, {
		create("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }),
	}) :: Frame
	slotRow.Parent = petsBody
	type SlotTile = { Frame: Frame, Text: TextLabel }
	local slotTiles: { SlotTile } = {}
	local slotCount = ExtrasConfig.MaxPetSlots
	for index = 1, slotCount do
		local tile = create("Frame", {
			Name = "Slot" .. index,
			Size = UDim2.new(1 / slotCount, -8 * (slotCount - 1) / slotCount, 1, 0),
			BackgroundColor3 = COLORS.PanelLight,
			LayoutOrder = index,
		}, { corner(12), stroke(COLORS.Outline, 2) }) :: Frame
		local text = label({
			Name = "Text",
			Position = UDim2.fromOffset(4, 4),
			Size = UDim2.new(1, -8, 1, -8),
			Text = "",
			TextSize = 18,
			TextWrapped = true,
		})
		text.Parent = tile
		tile.Parent = slotRow
		table.insert(slotTiles, { Frame = tile, Text = text })
	end

	local buyButton = button("", COLORS.Buy, {
		Name = "BuySlot",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 144),
		Size = UDim2.new(0.7, 0, 0, 52),
	})
	buyButton.Parent = petsBody
	buyButton.Activated:Connect(function()
		ask(companionFunction, "BuySlot")
		renderPets()
	end)

	label({
		Name = "ListTitle",
		Position = UDim2.fromOffset(0, 206),
		Size = UDim2.new(1, 0, 0, 28),
		Text = "Your brainrots: pick who follows you",
		TextSize = 22,
		TextXAlignment = Enum.TextXAlignment.Left,
	}).Parent = petsBody
	local list = create("ScrollingFrame", {
		Name = "List",
		Position = UDim2.fromOffset(0, 240),
		Size = UDim2.new(1, 0, 1, -240),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 8,
		ScrollBarImageColor3 = ACCENTS.Pets,
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		CanvasSize = UDim2.new(),
	}, {
		create("UIGridLayout", {
			CellSize = UDim2.fromOffset(UIKit.gridCells(UIKit.bodySize(petsFrame).X, 4, 10, 8), 122),
			CellPadding = UDim2.fromOffset(10, 10),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	}) :: ScrollingFrame
	list.Parent = petsBody

	local function cashNow(): number
		local stats = player:FindFirstChild("leaderstats")
		local cash = if stats then stats:FindFirstChild("Cash") else nil
		return if cash and cash:IsA("ValueBase") then tonumber((cash :: any).Value) or 0 else 0
	end

	renderPets = function()
		local roles = fetch(companionFunction, "State")
		local pets: { number } = if typeof(roles) == "table" and typeof(roles.Pets) == "table" then roles.Pets else {}
		local owned = if typeof(roles) == "table" and typeof(roles.PetSlots) == "number" then roles.PetSlots else 1
		local guarding = if typeof(roles) == "table" then roles.Guard else nil
		-- Your brainrots, by pedestal.
		local mine: { [number]: Model } = {}
		for _, model in brainrotsFolder:GetChildren() do
			local slot = model:GetAttribute("Slot")
			if model:IsA("Model") and model:GetAttribute("OwnerUserId") == player.UserId and typeof(slot) == "number" then
				mine[slot] = model
			end
		end
		local function nameOf(model: Model?): string?
			local id = if model then model:GetAttribute("BrainrotId") else nil
			local definition = if typeof(id) == "string" then BrainrotConfig.ById[id] else nil
			return if definition then definition.DisplayName else nil
		end

		summary.Text = string.format("🐾 Pets following you: %d / %d", #pets, owned)
		speedLabel.Text = string.format("+%s walk speed", tostring(tonumber(player:GetAttribute("PetSpeed")) or 0))
		for index, tile in slotTiles do
			if index <= owned then
				local name = if pets[index] then nameOf(mine[pets[index]]) else nil
				tile.Text.Text = if name then "🐾 " .. name else "Empty"
				tile.Frame.BackgroundColor3 = if name then ACCENTS.Pets:Lerp(COLORS.PanelLight, 0.45) else COLORS.PanelLight
			else
				tile.Text.Text = "🔒\n" .. NumberFormat.cash(ExtrasConfig.PetSlotPrices[index])
				tile.Frame.BackgroundColor3 = COLORS.PanelDark
			end
		end
		local price = ExtrasConfig.PetSlotPrices[owned + 1]
		if price then
			buyButton.Text = string.format("Unlock pet slot %d: %s", owned + 1, NumberFormat.cash(price))
			UIKit.setEnabled(buyButton, cashNow() >= price, COLORS.Buy)
		else
			buyButton.Text = "Every pet slot unlocked!"
			UIKit.setEnabled(buyButton, false, COLORS.Buy)
		end

		for _, child in list:GetChildren() do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		local order: { number } = {}
		for slot in mine do
			table.insert(order, slot)
		end
		table.sort(order)
		for position, slot in order do
			local model = mine[slot]
			local id = model:GetAttribute("BrainrotId")
			local definition = if typeof(id) == "string" then BrainrotConfig.ById[id] else nil
			if definition == nil or BrainrotConfig.isLuckyBlock(definition) then
				continue
			end
			local rarity = BrainrotConfig.RarityByName[definition.Rarity]
			local mutation = model:GetAttribute("Mutation")
			local following = table.find(pets, slot) ~= nil
			local card = create("Frame", {
				Name = "Slot" .. slot,
				BackgroundColor3 = COLORS.PanelLight,
				LayoutOrder = position,
			}, { corner(12), stroke(if rarity then rarity.Color else COLORS.Outline, 2) }) :: Frame
			label({
				Name = "BrainrotName",
				Position = UDim2.fromOffset(6, 6),
				Size = UDim2.new(1, -12, 0, 26),
				Text = (if typeof(mutation) == "string" then mutation .. " " else "") .. definition.DisplayName,
				TextSize = 20,
			}).Parent = card
			label({
				Name = "Info",
				Position = UDim2.fromOffset(6, 34),
				Size = UDim2.new(1, -12, 0, 22),
				Text = string.format("%s   +%s speed", definition.Rarity, tostring(ExtrasConfig.PetSpeedBonus[definition.Rarity] or 1)),
				TextColor3 = if rarity then rarity.Color else COLORS.Muted,
				TextSize = 17,
			}).Parent = card
			local isGuard = slot == guarding
			local action = button(if following then "Stop following" elseif isGuard then "🛡️ Guarding" else "🐾 Follow", if following then COLORS.Close else ACCENTS.Pets, {
				Name = "Action",
				Position = UDim2.new(0, 8, 1, -52),
				Size = UDim2.new(1, -16, 0, 44),
			})
			if isGuard then
				UIKit.setEnabled(action, false, ACCENTS.Pets)
			end
			action.Activated:Connect(function()
				if not isGuard then
					ask(companionFunction, if following then "Unpet" else "Pet", slot)
					renderPets()
				end
			end)
			action.Parent = card
			card.Parent = list
		end
	end
end

petsButton.Activated:Connect(function()
	if UIKit.toggleModal(petsFrame) then
		renderPets()
	end
end)
for _, attribute in { "PetBaseSlots", "PetCapacity" } do
	player:GetAttributeChangedSignal(attribute):Connect(function()
		if petsFrame.Visible then
			renderPets()
		end
	end)
end

--------------------------------------------------------------------------------
-- The Limited Shop: this week's limited brainrot
--------------------------------------------------------------------------------

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

local limitedFrame, limitedBody = UIKit.modal(screen, "LimitedMenu", "⭐ LIMITED ⭐", ACCENTS.Limited, Vector2.new(560, 560))
UIKit.gardenStyle(limitedFrame)
local refreshLimited: () -> ()
do
	local preview = create("Frame", {
		Name = "Preview",
		Size = UDim2.new(0.45, 0, 0.55, 0),
		BackgroundColor3 = COLORS.PanelDark,
	}, { corner(12), stroke(ACCENTS.Limited, 3) }) :: Frame
	preview.Parent = limitedBody
	local function line(name: string, y: number, height: number, colour: Color3, size: number): TextLabel
		local text = label({
			Name = name,
			Position = UDim2.new(0.48, 0, y, 0),
			Size = UDim2.new(0.52, 0, height, 0),
			Text = "",
			TextColor3 = colour,
			TextXAlignment = Enum.TextXAlignment.Left,
			TextSize = size,
		})
		text.Parent = limitedBody
		return text
	end
	local nameLabel = line("BrainrotName", 0, 0.12, COLORS.Text, 30)
	local rarityLabel = line("Rarity", 0.12, 0.08, COLORS.Muted, 24)
	local incomeLabel = line("Income", 0.2, 0.08, COLORS.Income, 24)
	local endsLabel = line("EndsIn", 0.3, 0.08, Color3.fromRGB(255, 120, 120), 22)
	local nextLabel = line("NextWeek", 0.4, 0.1, COLORS.Muted, 18)
	label({
		Name = "About",
		Position = UDim2.new(0, 0, 0.58, 0),
		Size = UDim2.new(1, 0, 0.16, 0),
		Text = "A famous Roblox limited, as an OG brainrot: rarer and stronger than any Secret! Sold this week only, then it's gone until it comes back round (or roll one on the conveyor, if you're very lucky).",
		TextSize = 18,
		TextWrapped = true,
		TextColor3 = COLORS.Muted,
	}).Parent = limitedBody
	local buy = button("Buy", ACCENTS.Limited, { Name = "BuyLimited", Position = UDim2.new(0.2, 0, 0.78, 0), Size = UDim2.new(0.6, 0, 0.14, 0) })
	buy.Parent = limitedBody
	local current: ExtrasConfig.Limited? = nil
	buy.Activated:Connect(function()
		if current then
			promptProduct(current.Product)
		end
	end)

	local shown: string? = nil
	refreshLimited = function()
		local limited, secondsLeft = weeklyLimited()
		current = limited
		local definition = BrainrotConfig.ById[limited.Id]
		if definition == nil then
			return
		end
		local rarity = BrainrotConfig.RarityByName[definition.Rarity]
		nameLabel.Text = definition.DisplayName
		rarityLabel.Text = definition.Rarity
		rarityLabel.TextColor3 = if rarity then rarity.Color else COLORS.Muted
		incomeLabel.Text = NumberFormat.cash(definition.IncomePerSecond) .. "/s"
		endsLabel.Text = "Ends in " .. duration(secondsLeft)
		local rotation = ExtrasConfig.LimitedRotation
		local following = rotation[(table.find(rotation, limited) or 0) % #rotation + 1]
		local nextDefinition = BrainrotConfig.ById[following.Id]
		nextLabel.Text = if nextDefinition then "Next week: " .. nextDefinition.DisplayName else ""
		buy.Text = string.format("Buy for R$ %d", limited.Robux)
		if shown ~= limited.Id then
			shown = limited.Id
			for _, child in preview:GetChildren() do
				if child:IsA("ViewportFrame") then
					child:Destroy()
				end
			end
			UIKit.brainrotViewport(limited.Id, if rarity then rarity.Color:Lerp(Color3.new(0, 0, 0), 0.55) else COLORS.PanelDark, {
				Size = UDim2.fromScale(1, 1),
			}).Parent = preview
		end
	end
end

-- The stall on the map: the brainrot turns on its display, with a sign.
do
	local shop = map:WaitForChild("LimitedShop", 30)
	local display = if shop then shop:FindFirstChild("LimitedDisplay") else nil
	local infoAnchor = if shop then shop:FindFirstChild("LimitedInfoAnchor") else nil
	local sign: TextLabel? = nil
	if infoAnchor and infoAnchor:IsA("BasePart") then
		local billboard = create("BillboardGui", {
			Name = "LimitedInfo",
			Adornee = infoAnchor,
			Size = UDim2.fromScale(14, 4.2),
			LightInfluence = 0,
			MaxDistance = 160,
		}) :: BillboardGui
		local text = label({ Size = UDim2.fromScale(1, 1), Text = "", TextSize = 40, TextColor3 = ACCENTS.Limited })
		text.RichText = true
		text.Parent = billboard
		billboard.Parent = infoAnchor
		sign = text
	end
	local displayModel: Model? = nil
	local displayId: string? = nil
	task.spawn(function()
		while true do
			local limited, secondsLeft = weeklyLimited()
			local definition = BrainrotConfig.ById[limited.Id]
			if sign and definition then
				sign.Text = string.format(
					'⭐ THIS WEEK ONLY ⭐\n<font color="#ffffff">%s</font>\nR$ %d · ends in %s',
					definition.DisplayName,
					limited.Robux,
					duration(secondsLeft)
				)
			end
			if display and display:IsA("BasePart") and displayId ~= limited.Id then
				displayId = limited.Id
				if displayModel then
					displayModel:Destroy()
				end
				local model = UIKit.previewModel(limited.Id, 5)
				if model then
					for _, part in model:GetDescendants() do
						if part:IsA("BasePart") then
							part.Anchored = true
							part.CanCollide = false
						end
					end
					model.Parent = Workspace
					displayModel = model
				end
			end
			if limitedFrame.Visible then
				refreshLimited()
			end
			task.wait(1)
		end
	end)
	-- It turns slowly on its display.
	RunService.RenderStepped:Connect(function()
		local model = displayModel
		if model and display and display:IsA("BasePart") then
			model:PivotTo(display.CFrame * CFrame.new(0, 2.5 + math.sin(os.clock() * 2) * 0.2, 0) * CFrame.Angles(0, os.clock() * 0.8, 0))
		end
	end)
end

ProximityPromptService.PromptTriggered:Connect(function(prompt: ProximityPrompt, who: Player)
	if who == player and prompt.Name == "LimitedPrompt" then
		refreshLimited()
		UIKit.openModal(limitedFrame)
	end
end)

--------------------------------------------------------------------------------
-- Banners: the boss, revenge, loot and bounty
--------------------------------------------------------------------------------

local banners = create("Frame", {
	Name = "Banners",
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 50),
	Size = UDim2.fromOffset(560, 200),
	BackgroundTransparency = 1,
}, {
	create("UIListLayout", {
		Padding = UDim.new(0, 6),
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		SortOrder = Enum.SortOrder.LayoutOrder,
	}),
}) :: Frame
banners.Parent = screen
UIKit.autoScale(banners)

local bossBar = create("Frame", {
	Name = "BossBar",
	Size = UDim2.fromOffset(540, 64),
	BackgroundColor3 = Color3.fromRGB(40, 12, 12),
	LayoutOrder = 1,
	Visible = false,
}, { corner(12), stroke(Color3.fromRGB(255, 80, 40), 3) }) :: Frame
bossBar.Parent = banners
local bossStroke = bossBar:FindFirstChildOfClass("UIStroke") :: UIStroke
local bossName = label({ Name = "BossName", Position = UDim2.new(0, 10, 0, 2), Size = UDim2.new(1, -20, 0.42, 0), Text = "", TextSize = 24, TextColor3 = Color3.fromRGB(255, 200, 120) })
bossName.Parent = bossBar
local bossHealth, setBossHealth = UIKit.progressBar(Color3.fromRGB(230, 40, 40), {
	Name = "Health",
	Position = UDim2.new(0, 10, 0.48, 0),
	Size = UDim2.new(1, -20, 0.42, 0),
})
bossHealth.Parent = bossBar

local function banner(name: string, order: number, colour: Color3): TextLabel
	local text = label({
		Name = name,
		Size = UDim2.fromOffset(520, 38),
		BackgroundTransparency = 0.15,
		BackgroundColor3 = colour,
		Text = "",
		TextSize = 24,
		LayoutOrder = order,
		Visible = false,
	})
	corner(10).Parent = text
	stroke(Color3.new(0, 0, 0), 2).Parent = text
	text.Parent = banners
	return text
end
local revengeBanner = banner("Revenge", 2, Color3.fromRGB(190, 30, 40))
local lootBanner = banner("Loot", 3, Color3.fromRGB(150, 110, 20))
local bountyBanner = banner("Bounty", 4, Color3.fromRGB(110, 60, 20))

local function updateBoss()
	local maxHealth = tonumber(ReplicatedStorage:GetAttribute("BossMaxHealth")) or 0
	local health = tonumber(ReplicatedStorage:GetAttribute("BossHealth")) or 0
	local name = ReplicatedStorage:GetAttribute("BossName")
	local tier = ReplicatedStorage:GetAttribute("BossTier")
	local colour = ReplicatedStorage:GetAttribute("BossTierColour")
	local enraged = ReplicatedStorage:GetAttribute("BossEnraged") == true
	bossBar.Visible = maxHealth > 0
	if maxHealth > 0 then
		-- The tier's colour on the frame; red hot when it rages.
		bossStroke.Color = if enraged then Color3.fromRGB(255, 40, 20) elseif typeof(colour) == "Color3" then colour else Color3.fromRGB(255, 80, 40)
		bossName.Text = string.format(
			"%s %s%s",
			if typeof(tier) == "string" then tier else "👹",
			if typeof(name) == "string" then name else "BOSS",
			if enraged then " — 😡 ENRAGED!" else " — click or slap it!"
		)
		setBossHealth(health / maxHealth, string.format("%s / %s", NumberFormat.commas(math.ceil(health)), NumberFormat.commas(maxHealth)))
	end
end
for _, attribute in { "BossMaxHealth", "BossHealth", "BossName", "BossTier", "BossTierColour", "BossEnraged" } do
	ReplicatedStorage:GetAttributeChangedSignal(attribute):Connect(updateBoss)
end
updateBoss()

-- Stomps: a shockwave ring on the ground and a shake if you're close.
local shakeUntil = 0
local function watchBoss(model: Instance)
	if not model:IsA("Model") or model:GetAttribute("State") ~= "Boss" then
		return
	end
	model:GetAttributeChangedSignal("Stomp"):Connect(function()
		local root = model:FindFirstChild("Root")
		if root == nil or not root:IsA("BasePart") then
			return
		end
		local ring = Instance.new("Part")
		ring.Shape = Enum.PartType.Cylinder
		ring.Material = Enum.Material.Neon
		ring.Color = Color3.fromRGB(255, 120, 40)
		ring.Anchored = true
		ring.CanCollide = false
		ring.CanQuery = false
		ring.CanTouch = false
		ring.Size = Vector3.new(0.4, 4, 4)
		ring.CFrame = CFrame.new(root.Position + Vector3.new(0, 0.3, 0)) * CFrame.Angles(0, 0, math.rad(90))
		ring.Transparency = 0.2
		ring.Parent = Workspace
		local radius = tonumber(model:GetAttribute("StompRadius")) or ExtrasConfig.BossStompRadius
		local diameter = radius * 2
		local tween = TweenService:Create(ring, TweenInfo.new(0.6, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
			Size = Vector3.new(0.4, diameter, diameter),
			Transparency = 1,
		})
		tween:Play()
		tween.Completed:Once(function()
			ring:Destroy()
		end)
		local character = player.Character
		local ownRoot = if character then character:FindFirstChild("HumanoidRootPart") else nil
		if ownRoot and ownRoot:IsA("BasePart") and (ownRoot.Position - root.Position).Magnitude < diameter then
			shakeUntil = os.clock() + 0.45
		end
		Sounds.play("Slap")
	end)
end
brainrotsFolder.ChildAdded:Connect(watchBoss)
for _, child in brainrotsFolder:GetChildren() do
	watchBoss(child)
end

-- The line to whoever you want revenge on.
local revengeBeam: Beam? = nil
local revengeFrom: Attachment? = nil
local revengeTo: Attachment? = nil
local function clearRevengeBeam()
	if revengeBeam then
		revengeBeam:Destroy()
		revengeBeam = nil
	end
	if revengeFrom then
		revengeFrom:Destroy()
		revengeFrom = nil
	end
	if revengeTo then
		revengeTo:Destroy()
		revengeTo = nil
	end
end

local function rootOf(someone: Player): BasePart?
	local character = someone.Character
	local root = if character then character:FindFirstChild("HumanoidRootPart") else nil
	return if root and root:IsA("BasePart") then root else nil
end

local lastBannerUpdate = 0
RunService.RenderStepped:Connect(function()
	local now = os.clock()
	-- Camera shake after a stomp nearby.
	if now < shakeUntil then
		local camera = Workspace.CurrentCamera
		if camera then
			local strength = (shakeUntil - now) * 0.08
			camera.CFrame *= CFrame.Angles((math.random() - 0.5) * strength, (math.random() - 0.5) * strength, 0)
		end
	end

	-- Revenge: a red line to the thief while it lasts.
	local targetId = player:GetAttribute("RevengeTarget")
	local endsAt = tonumber(player:GetAttribute("RevengeEndsAt")) or 0
	local target = if typeof(targetId) == "number" then Players:GetPlayerByUserId(targetId) else nil
	local left = endsAt - Workspace:GetServerTimeNow()
	local ownRoot = rootOf(player)
	local targetRoot = if target then rootOf(target) else nil
	if target and left > 0 and ownRoot and targetRoot then
		if revengeBeam == nil or (revengeFrom and revengeFrom.Parent ~= ownRoot) or (revengeTo and revengeTo.Parent ~= targetRoot) then
			clearRevengeBeam()
			local from = Instance.new("Attachment")
			from.Parent = ownRoot
			local to = Instance.new("Attachment")
			to.Parent = targetRoot
			local beam = Instance.new("Beam")
			beam.Attachment0 = from
			beam.Attachment1 = to
			beam.Color = ColorSequence.new(Color3.fromRGB(255, 50, 60))
			beam.Width0 = 0.4
			beam.Width1 = 0.4
			beam.FaceCamera = true
			beam.LightEmission = 1
			beam.Transparency = NumberSequence.new(0.3)
			beam.Parent = ownRoot
			revengeBeam, revengeFrom, revengeTo = beam, from, to
		end
	elseif revengeBeam then
		clearRevengeBeam()
	end

	if now - lastBannerUpdate < 0.25 then
		return
	end
	lastBannerUpdate = now
	revengeBanner.Visible = target ~= nil and left > 0
	if target and left > 0 then
		revengeBanner.Text = string.format("🎯 REVENGE on %s: %ds (you're faster!)", target.DisplayName, math.ceil(left))
	end
	local carrying = player:GetAttribute("CarryingLoot") == true
	lootBanner.Visible = carrying
	if carrying then
		local kind = player:GetAttribute("LootKind")
		lootBanner.Text = string.format(
			"%s %s: run it into your base!",
			if kind == "Diamond" then "💎 Diamonds" elseif kind == "Gold" then "🟨 Gold bars" else "💰 Loot bag",
			NumberFormat.cash(tonumber(player:GetAttribute("LootValue")) or 0)
		)
	end
	local holderId = ReplicatedStorage:GetAttribute("BountyHolder")
	local holder = if typeof(holderId) == "number" and holderId > 0 then Players:GetPlayerByUserId(holderId) else nil
	bountyBanner.Visible = holder ~= nil
	if holder then
		local bounty = NumberFormat.cash(tonumber(holder:GetAttribute("Bounty")) or 0)
		bountyBanner.Text = if holder == player
			then string.format("💰 YOU have a %s bounty! Everyone's coming for you.", bounty)
			else string.format("💰 Bounty on %s: steal from them for %s!", holder.DisplayName, bounty)
	end
end)

--------------------------------------------------------------------------------
-- Pets: each player's pets follow them, drawn on every client
--------------------------------------------------------------------------------

type Pet = { Entry: string, Model: Model, Root: BasePart }
local pets: { [Player]: { Pet } } = {}

-- Where each pet walks, behind its owner (in the owner's space): a V.
local PET_SPOTS = {
	Vector3.new(3, 0, 3.5),
	Vector3.new(-3, 0, 3.5),
	Vector3.new(0, 0, 5.5),
	Vector3.new(5.5, 0, 6.5),
	Vector3.new(-5.5, 0, 6.5),
	Vector3.new(0, 0, 8.5),
}

local function removePets(owner: Player)
	local list = pets[owner]
	if list then
		for _, pet in list do
			pet.Model:Destroy()
		end
	end
	pets[owner] = nil
end

local function makePet(owner: Player, index: number, entry: string, hat: string?): Pet?
	local definition, mutation, trait = BrainrotConfig.decode(entry)
	if definition == nil then
		return nil
	end
	local height = ExtrasConfig.PetHeight * (if trait then trait.Scale else 1)
	local model = Instance.new("Model")
	model.Name = string.format("Pet_%d_%d", owner.UserId, index)
	local root = Instance.new("Part")
	root.Name = "Root"
	root.Size = Vector3.one
	root.Transparency = 1
	root.Anchored = true
	root.CanCollide = false
	root.CanQuery = false
	root.CanTouch = false
	root.Parent = model
	model.PrimaryPart = root
	-- The imported model if there is one (else BrainrotVisuals builds it).
	local template = TemplateModels.get(definition.Id)
	if template then
		TemplateModels.build(model, root, template, height)
	end
	model:SetAttribute("BrainrotId", definition.Id)
	model:SetAttribute("FigureHeight", height)
	model:SetAttribute("CustomModel", template ~= nil)
	model:SetAttribute("Rarity", definition.Rarity)
	model:SetAttribute("Mutation", if mutation then mutation.Name else nil)
	model:SetAttribute("Trait", if trait then trait.Name else nil)
	model:SetAttribute("Motion", definition.Motion)
	model:SetAttribute("State", "Pet")
	model:SetAttribute("Hat", hat)
	local ownerRoot = rootOf(owner)
	local spot = PET_SPOTS[index] or PET_SPOTS[#PET_SPOTS]
	root.CFrame = if ownerRoot then ownerRoot.CFrame * CFrame.new(spot.X, -2.5, spot.Z) else CFrame.new(0, -100, 0)
	model.Parent = brainrotsFolder
	return { Entry = entry, Model = model, Root = root :: BasePart }
end

local function refreshPets(owner: Player)
	local entriesAttribute = owner:GetAttribute("PetEntries")
	local hatsAttribute = owner:GetAttribute("PetHats")
	local entries: { string } = if typeof(entriesAttribute) == "string" and entriesAttribute ~= "" then string.split(entriesAttribute, ",") else {}
	local hats: { string } = if typeof(hatsAttribute) == "string" then string.split(hatsAttribute, ",") else {}
	local current: { [number]: Pet } = table.clone(pets[owner] or {})
	local list: { Pet } = {}
	for index, entry in entries do
		local hat = hats[index]
		local wearing = if hat and hat ~= "" then hat else nil
		local existing = current[index]
		if existing and existing.Entry == entry then
			existing.Model:SetAttribute("Hat", wearing)
			current[index] = nil
			table.insert(list, existing)
		else
			local pet = makePet(owner, #list + 1, entry, wearing)
			if pet then
				table.insert(list, pet)
			end
		end
	end
	for _, leftover in current do
		leftover.Model:Destroy()
	end
	if #list > 0 then
		pets[owner] = list
	else
		pets[owner] = nil
	end
end

local function watchPlayer(someone: Player)
	for _, attribute in { "PetEntries", "PetHats" } do
		someone:GetAttributeChangedSignal(attribute):Connect(function()
			refreshPets(someone)
		end)
	end
	refreshPets(someone)
end
Players.PlayerAdded:Connect(watchPlayer)
Players.PlayerRemoving:Connect(removePets)
for _, someone in Players:GetPlayers() do
	task.spawn(watchPlayer, someone)
end

-- Pets trot along behind their owner, on the ground.
local groundParams = RaycastParams.new()
groundParams.FilterType = Enum.RaycastFilterType.Exclude
RunService.Heartbeat:Connect(function(dt: number)
	for owner, list in pets do
		local ownerRoot = rootOf(owner)
		if ownerRoot == nil then
			continue
		end
		local filter: { Instance } = {}
		for _, pet in list do
			table.insert(filter, pet.Model)
		end
		if owner.Character then
			table.insert(filter, owner.Character)
		end
		groundParams.FilterDescendantsInstances = filter
		for index, pet in list do
			if pet.Model.Parent == nil then
				continue
			end
			local spot = PET_SPOTS[index] or PET_SPOTS[#PET_SPOTS]
			local goal = ownerRoot.CFrame * CFrame.new(spot)
			local hit = Workspace:Raycast(goal.Position + Vector3.new(0, 2, 0), Vector3.new(0, -12, 0), groundParams)
			local groundY = if hit then hit.Position.Y else ownerRoot.Position.Y - 3
			local target = Vector3.new(goal.Position.X, groundY, goal.Position.Z)
			local position = pet.Root.Position
			local gap = target - position
			if gap.Magnitude > 60 then
				pet.Root.CFrame = CFrame.new(target) * ownerRoot.CFrame.Rotation
				continue
			end
			local alpha = 1 - math.exp(-dt * 6)
			local nextPosition = position:Lerp(target, alpha)
			local flatGap = Vector3.new(gap.X, 0, gap.Z)
			pet.Root.CFrame = if flatGap.Magnitude > 0.3
				then CFrame.lookAt(nextPosition, nextPosition + flatGap)
				else CFrame.new(nextPosition) * ownerRoot.CFrame.Rotation
		end
	end
end)

screen.Parent = playerGui

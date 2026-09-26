--!strict
--[[
	FeaturesClient
	Location: StarterPlayer.StarterPlayerScripts (LocalScript)

	The menus and effects for everything past the core loop, in the same
	chunky style as the HUD (see UIKit):
	  * a second column of side buttons (Spin, Quests, Gifts) and one on the
	    right (Trade, Upgrades, Settings); a red "!" shows when something waits
	  * the spin wheel, daily login streak, playtime gifts, codes, Group Chest
	  * daily quests with progress bars and a bonus for finishing all three
	  * Upgrades: walk speed levels and base skins
	  * Settings: music and sound volume, low graphics, the tutorial
	  * trading with other players and the Fuse Machine
	  * the lucky block roulette, the base alarm (red flashing, a siren and a
	    line to the thief), the tutorial arrows and the ADMIN ABUSE banner

	Nothing here decides anything: every button asks the server (Rewards,
	Trade and Fuse remotes), which checks it and answers.
]]

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))
local FeatureConfig = require(Shared:WaitForChild("FeatureConfig"))
local MonetizationConfig = require(Shared:WaitForChild("MonetizationConfig"))
local NumberFormat = require(Shared:WaitForChild("NumberFormat"))
local Sounds = require(Shared:WaitForChild("Sounds"))
local UIKit = require(Shared:WaitForChild("UIKit"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local rewardsFunction = remotes:WaitForChild("Rewards") :: RemoteFunction
local rewardsStateEvent = remotes:WaitForChild("RewardsState") :: RemoteEvent
local tradeFunction = remotes:WaitForChild("Trade") :: RemoteFunction
local tradeStateEvent = remotes:WaitForChild("TradeState") :: RemoteEvent
local fuseFunction = remotes:WaitForChild("Fuse") :: RemoteFunction
local luckyRevealEvent = remotes:WaitForChild("LuckyReveal") :: RemoteEvent
local baseAlarmEvent = remotes:WaitForChild("BaseAlarm") :: RemoteEvent

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui") :: PlayerGui

local create = UIKit.create
local label = UIKit.label
local button = UIKit.button
local corner = UIKit.corner
local stroke = UIKit.stroke
local COLORS = UIKit.Colors
local ACCENTS = {
	Spin = Color3.fromRGB(255, 150, 30),
	Quests = Color3.fromRGB(240, 190, 50),
	Gifts = Color3.fromRGB(170, 80, 240),
	Trade = Color3.fromRGB(40, 170, 255),
	Upgrades = Color3.fromRGB(60, 210, 120),
	Settings = Color3.fromRGB(140, 150, 175),
	Fuse = Color3.fromRGB(160, 70, 255),
	Alarm = Color3.fromRGB(235, 30, 40),
}

local screen = create("ScreenGui", {
	Name = "FeaturesHud",
	ResetOnSpawn = false,
	ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	DisplayOrder = 1,
}) :: ScreenGui

-- The player's rewards state from RewardsManager, and when it arrived (the
-- playtime clock ticks on from there).
local state: { [string]: any } = {}
local stateAt = os.clock()
local refreshers: { () -> () } = {}

local function refreshAll()
	for _, refresh in refreshers do
		task.spawn(refresh)
	end
end

-- Asks RewardsManager to do something; shows its answer as a pop-up.
local function ask(action: string, argument: any?): (boolean, any)
	local ok, success, message, extra = pcall(function()
		return rewardsFunction:InvokeServer(action, argument)
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

local function promptProduct(key: string)
	local productId = MonetizationConfig.ProductIds[key]
	if productId == nil then
		return
	end
	local ok, err = pcall(function()
		MarketplaceService:PromptProductPurchase(player, productId)
	end)
	if not ok then
		warn("[FeaturesClient] Could not open the purchase prompt: " .. tostring(err))
	end
end

local function clock(seconds: number): string
	local total = math.max(0, math.floor(seconds))
	return string.format("%d:%02d:%02d", total // 3600, total // 60 % 60, total % 60)
end

local function rarityIndex(rarityName: string): number
	for index, rarity in BrainrotConfig.Rarities do
		if rarity.Name == rarityName then
			return index
		end
	end
	return 0
end

type Owned = { Slot: number, Entry: string, Definition: BrainrotConfig.Brainrot, Mutation: string? }

-- Brainrots sitting in your base right now (not walking or being carried).
local function myBrainrots(): { Owned }
	local list: { Owned } = {}
	local map = Workspace:FindFirstChild("Map")
	local folder = if map then map:FindFirstChild("Brainrots") else nil
	if folder == nil then
		return list
	end
	for _, model in folder:GetChildren() do
		local slot = model:GetAttribute("Slot")
		local brainrotId = model:GetAttribute("BrainrotId")
		local definition = if typeof(brainrotId) == "string" then BrainrotConfig.ById[brainrotId] else nil
		if model:GetAttribute("OwnerUserId") == player.UserId and model:GetAttribute("State") == "Idle" and typeof(slot) == "number" and definition then
			local mutation = model:GetAttribute("Mutation")
			local trait = model:GetAttribute("Trait")
			table.insert(list, {
				Slot = slot,
				Entry = BrainrotConfig.encode(
					definition.Id,
					if typeof(mutation) == "string" then mutation else nil,
					if typeof(trait) == "string" then trait else nil
				),
				Definition = definition,
				Mutation = if typeof(mutation) == "string" then mutation else nil,
			})
		end
	end
	table.sort(list, function(a, b)
		local ra, rb = rarityIndex(a.Definition.Rarity), rarityIndex(b.Definition.Rarity)
		if ra ~= rb then
			return ra > rb
		end
		return a.Slot < b.Slot
	end)
	return list
end

local function findMyPlot(): Instance?
	local map = Workspace:FindFirstChild("Map")
	local plots = if map then map:FindFirstChild("Plots") else nil
	if plots == nil then
		return nil
	end
	for _, plot in plots:GetChildren() do
		if plot:GetAttribute("OwnerUserId") == player.UserId then
			return plot
		end
	end
	return nil
end

local function rootPart(character: Model?): BasePart?
	local root = if character then character:FindFirstChild("HumanoidRootPart") else nil
	return if root and root:IsA("BasePart") then root else nil
end

--------------------------------------------------------------------------------
-- Side buttons
--------------------------------------------------------------------------------

local leftColumn = UIKit.sideColumn(screen, "MoreButtons", 3, {})
local rightColumn = UIKit.sideColumn(screen, "RightButtons", 3, {})
-- Next to the Index / Rebirth / Shop column, and at the right edge.
UIKit.placeSideColumn(leftColumn, false, 1)
UIKit.placeSideColumn(rightColumn, true, 0)

local buttons = {
	Spin = UIKit.sideButton(leftColumn, "SpinButton", "Spin", ACCENTS.Spin, "Spin", 1, "🎡"),
	Quests = UIKit.sideButton(leftColumn, "QuestsButton", "Quests", ACCENTS.Quests, "Quests", 2, "📜"),
	Gifts = UIKit.sideButton(leftColumn, "GiftsButton", "Gifts", ACCENTS.Gifts, "Codes", 3, "🎁"),
	Trade = UIKit.sideButton(rightColumn, "TradeButton", "Trade", ACCENTS.Trade, "Trade", 1, "🔄"),
	Upgrades = UIKit.sideButton(rightColumn, "UpgradesButton", "Upgrade", ACCENTS.Upgrades, "Speed", 2, "👟"),
	Settings = UIKit.sideButton(rightColumn, "SettingsButton", "Settings", ACCENTS.Settings, "Settings", 3, "⚙️"),
}

--------------------------------------------------------------------------------
-- Spin wheel
--------------------------------------------------------------------------------

local spinFrame, spinBody = UIKit.modal(screen, "SpinWheel", "SPIN THE WHEEL", ACCENTS.Spin, Vector2.new(560, 640))
do
	local prizes = FeatureConfig.SpinPrizes
	local segment = 360 / #prizes

	local holder = create("Frame", {
		Name = "WheelHolder",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 30),
		Size = UDim2.new(0.8, 0, 0.8, 0),
		BackgroundTransparency = 1,
		SizeConstraint = Enum.SizeConstraint.RelativeXX,
	}, { create("UIAspectRatioConstraint", { AspectRatio = 1 }) }) :: Frame
	holder.Parent = spinBody

	-- The wheel turns as one; each slice is a fan of thin spokes, turned by a
	-- full-size frame so they all turn about the middle.
	local wheel = create("Frame", {
		Name = "Wheel",
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = COLORS.PanelDark,
	}, { UIKit.round() }) :: Frame
	wheel.Parent = holder
	local function spoke(angle: number, width: number, colour: Color3, zIndex: number): Frame
		local pivot = create("Frame", {
			Size = UDim2.fromScale(1, 1),
			BackgroundTransparency = 1,
			Rotation = angle,
			ZIndex = zIndex,
		}) :: Frame
		create("Frame", {
			AnchorPoint = Vector2.new(0.5, 0),
			Position = UDim2.fromScale(0.5, 0),
			Size = UDim2.fromScale(width, 0.5),
			BackgroundColor3 = colour,
			BorderSizePixel = 0,
			ZIndex = zIndex,
		}).Parent = pivot
		pivot.Parent = wheel
		return pivot
	end
	for index, prize in prizes do
		local middle = (index - 1) * segment
		for step = -segment / 2 + 2.5, segment / 2 - 2.5, 5 do
			local shade = if step % 10 == 0 then prize.Color else prize.Color:Lerp(Color3.new(1, 1, 1), 0.06)
			spoke(middle + step, 0.06, shade, 2)
		end
		spoke(middle + segment / 2, 0.012, COLORS.Outline, 3)
		local pivot = create("Frame", {
			Size = UDim2.fromScale(1, 1),
			BackgroundTransparency = 1,
			Rotation = middle,
			ZIndex = 4,
		}) :: Frame
		label({
			Name = "Prize" .. index,
			AnchorPoint = Vector2.new(0.5, 0),
			Position = UDim2.fromScale(0.5, 0.08),
			Size = UDim2.fromScale(0.32, 0.09),
			Text = prize.Name,
			TextSize = 22,
			ZIndex = 5,
		}).Parent = pivot
		pivot.Parent = wheel
	end

	-- Gold rim with blinking bulbs, a hub and the pointer (these don't turn).
	create("Frame", {
		Name = "Rim",
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		ZIndex = 6,
	}, { UIKit.round(), UIKit.stroke(COLORS.Gold, 10) }).Parent = holder
	local bulbs: { Frame } = {}
	for index = 1, 16 do
		local angle = math.rad((index - 1) * 22.5)
		local bulb = create("Frame", {
			AnchorPoint = Vector2.new(0.5, 0.5),
			Position = UDim2.fromScale(0.5 + 0.5 * math.sin(angle), 0.5 - 0.5 * math.cos(angle)),
			Size = UDim2.fromScale(0.035, 0.035),
			BackgroundColor3 = Color3.new(1, 1, 1),
			ZIndex = 7,
		}, { UIKit.round() }) :: Frame
		bulb.Parent = holder
		table.insert(bulbs, bulb)
	end
	create("Frame", {
		Name = "Hub",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromScale(0.16, 0.16),
		BackgroundColor3 = COLORS.Gold,
		ZIndex = 8,
	}, { UIKit.round(), UIKit.stroke(COLORS.Outline, 4), UIKit.gloss() }).Parent = holder
	label({
		Name = "Pointer",
		AnchorPoint = Vector2.new(0.5, 0.35),
		Position = UDim2.fromScale(0.5, 0),
		Size = UDim2.fromScale(0.14, 0.12),
		Text = "▼",
		TextColor3 = Color3.fromRGB(255, 60, 60),
		TextSize = 60,
		OutlineThickness = 3,
		ZIndex = 9,
	}).Parent = holder

	local spinsLabel = label({
		Name = "Spins",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -62),
		Size = UDim2.new(1, 0, 0, 30),
		Text = "",
		TextSize = 26,
	})
	spinsLabel.Parent = spinBody
	local spinButton = button("SPIN!", COLORS.Buy, {
		Name = "SpinButton",
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.new(0.05, 0, 1, -4),
		Size = UDim2.new(0.5, 0, 0, 52),
	})
	spinButton.Parent = spinBody
	local buyButton = button(string.format("+%d SPINS (R$)", MonetizationConfig.SpinPackSpins), Color3.fromRGB(215, 70, 170), {
		Name = "BuySpinsButton",
		AnchorPoint = Vector2.new(1, 1),
		Position = UDim2.new(0.95, 0, 1, -4),
		Size = UDim2.new(0.38, 0, 0, 52),
	})
	buyButton.Parent = spinBody
	buyButton.Activated:Connect(function()
		promptProduct("SpinPack")
	end)

	local rotation = Instance.new("NumberValue")
	rotation.Value = 0
	rotation:GetPropertyChangedSignal("Value"):Connect(function()
		wheel.Rotation = rotation.Value
	end)
	local spinning = false
	local lastTick = 0

	local function spinsLeft(): number
		local spins = state.Spins
		return if typeof(spins) == "table" then (tonumber(spins.Free) or 0) + (tonumber(spins.Extra) or 0) else 0
	end

	table.insert(refreshers, function()
		local spins = state.Spins
		local free = if typeof(spins) == "table" then tonumber(spins.Free) or 0 else 0
		local extra = if typeof(spins) == "table" then tonumber(spins.Extra) or 0 else 0
		if free > 0 then
			spinsLabel.Text = if extra > 0 then string.format("FREE spin ready! (+%d more)", extra) else "Your FREE spin is ready!"
		elseif extra > 0 then
			spinsLabel.Text = string.format("Spins left: %d", extra)
		else
			spinsLabel.Text = "Next free spin in " .. clock((tonumber(state.SecondsToNextDay) or 0) - (os.clock() - stateAt))
		end
		UIKit.setEnabled(spinButton, spinsLeft() > 0 and not spinning, COLORS.Buy)
		UIKit.setAlert(buttons.Spin, spinsLeft() > 0)
	end)

	spinButton.Activated:Connect(function()
		if spinning or spinsLeft() <= 0 then
			return
		end
		spinning = true
		local ok, success, message, extra = pcall(function()
			return rewardsFunction:InvokeServer("Spin")
		end)
		local index = if ok and success == true and typeof(extra) == "table" then tonumber(extra.Index) else nil
		if index == nil then
			spinning = false
			UIKit.toast(if ok and typeof(message) == "string" then message else "Couldn't spin, try again.", "Error")
			Sounds.play("Error")
			return
		end
		-- Land the chosen slice under the pointer after a few full turns.
		local current = rotation.Value
		local target = current - current % 360 + 360 * 5 + (360 - (index - 1) * segment) % 360
		target += (math.random() - 0.5) * segment * 0.6
		local tween = TweenService:Create(rotation, TweenInfo.new(4.5, Enum.EasingStyle.Quint, Enum.EasingDirection.Out), { Value = target })
		tween:Play()
		tween.Completed:Wait()
		spinning = false
		UIKit.confetti(screen, Vector2.new(0.5, 0.4), 40)
		Sounds.play("StealSuccess")
		UIKit.toast(if typeof(message) == "string" then message else "You won!", "Success")
		refreshAll()
	end)

	RunService.RenderStepped:Connect(function()
		if not spinFrame.Visible then
			return
		end
		local t = os.clock()
		for index, bulb in bulbs do
			local on = (math.floor(t * 4) + index) % 2 == 0
			bulb.BackgroundColor3 = if on then Color3.fromRGB(255, 250, 200) else Color3.fromRGB(120, 90, 40)
		end
		-- A tick each time a slice passes the pointer.
		local passed = math.floor(rotation.Value / segment)
		if passed ~= lastTick then
			lastTick = passed
			if spinning then
				Sounds.play("Click")
			end
		end
	end)
end

buttons.Spin.Activated:Connect(function()
	if UIKit.toggleModal(spinFrame) then
		refreshAll()
	end
end)

--------------------------------------------------------------------------------
-- Gifts: daily streak, playtime gifts, codes and the Group Chest
--------------------------------------------------------------------------------

local giftsFrame, giftsBody = UIKit.modal(screen, "Gifts", "FREE GIFTS", ACCENTS.Gifts, Vector2.new(720, 520))
do
	local pages = UIKit.tabs(giftsBody, { "Daily", "Playtime", "Codes", "Group" }, ACCENTS.Gifts)

	-- Daily: seven days in a row.
	local dailyGrid = create("Frame", {
		Name = "Days",
		Size = UDim2.new(1, 0, 0.72, 0),
		BackgroundTransparency = 1,
	}, {
		create("UIGridLayout", {
			CellSize = UDim2.new(1 / 7, -6, 1, 0),
			CellPadding = UDim2.fromOffset(6, 0),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	}) :: Frame
	dailyGrid.Parent = pages.Daily
	type DayCard = { Frame: Frame, Status: TextLabel }
	local dayCards: { DayCard } = {}
	for day, reward in FeatureConfig.DailyRewards do
		local card = create("Frame", {
			Name = "Day" .. day,
			BackgroundColor3 = COLORS.PanelLight,
			LayoutOrder = day,
		}, { corner(12), stroke(COLORS.Outline, 3) }) :: Frame
		label({ Name = "Title", Size = UDim2.new(1, 0, 0.2, 0), Text = "Day " .. day, TextSize = 22 }).Parent = card
		local emoji = if reward.Kind == "Cash"
			then "💰"
			elseif reward.Kind == "Spins" then "🎡"
			elseif reward.Kind == "Boost" then "⚡"
			else "🎁"
		label({ Name = "Emoji", Position = UDim2.fromScale(0, 0.2), Size = UDim2.new(1, 0, 0.35, 0), Text = emoji, TextSize = 46 }).Parent = card
		label({
			Name = "Reward",
			Position = UDim2.fromScale(0.05, 0.55),
			Size = UDim2.new(0.9, 0, 0.25, 0),
			Text = FeatureConfig.describeReward(reward),
			TextSize = 16,
			TextWrapped = true,
		}).Parent = card
		local status = label({ Name = "Status", Position = UDim2.fromScale(0, 0.8), Size = UDim2.new(1, 0, 0.18, 0), Text = "", TextSize = 20 })
		status.Parent = card
		card.Parent = dailyGrid
		dayCards[day] = { Frame = card, Status = status }
	end
	local claimDaily = button("CLAIM", COLORS.Buy, {
		Name = "ClaimDaily",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.fromScale(0.5, 1),
		Size = UDim2.new(0.5, 0, 0.18, 0),
	})
	claimDaily.Parent = pages.Daily
	claimDaily.Activated:Connect(function()
		if ask("ClaimDaily") then
			UIKit.confetti(screen, Vector2.new(0.5, 0.5), 30)
		end
	end)

	-- Playtime: gifts that open after minutes played today.
	local playGrid = create("Frame", {
		Name = "Gifts",
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
	}, {
		create("UIGridLayout", {
			CellSize = UDim2.new(1 / 3, -8, 0.5, -8),
			CellPadding = UDim2.fromOffset(8, 8),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	}) :: Frame
	playGrid.Parent = pages.Playtime
	type GiftCard = { Button: TextButton, Timer: TextLabel }
	local giftCards: { GiftCard } = {}
	for index, gift in FeatureConfig.PlaytimeRewards do
		local card = create("Frame", {
			Name = "Gift" .. index,
			BackgroundColor3 = COLORS.PanelLight,
			LayoutOrder = index,
		}, { corner(12), stroke(ACCENTS.Gifts, 3) }) :: Frame
		label({ Name = "Emoji", Size = UDim2.new(1, 0, 0.36, 0), Text = "🎁", TextSize = 50 }).Parent = card
		label({
			Name = "Reward",
			Position = UDim2.fromScale(0, 0.36),
			Size = UDim2.new(1, 0, 0.18, 0),
			Text = FeatureConfig.describeReward(gift.Reward),
			TextSize = 18,
		}).Parent = card
		local timer = label({ Name = "Timer", Position = UDim2.fromScale(0, 0.54), Size = UDim2.new(1, 0, 0.16, 0), Text = "", TextSize = 18, TextColor3 = COLORS.Muted })
		timer.Parent = card
		local open = button("OPEN", COLORS.Buy, {
			Name = "Open",
			AnchorPoint = Vector2.new(0.5, 1),
			Position = UDim2.new(0.5, 0, 1, -8),
			Size = UDim2.new(0.8, 0, 0.24, 0),
		})
		open.Parent = card
		open.Activated:Connect(function()
			if ask("ClaimPlaytime", index) then
				UIKit.confetti(screen, Vector2.new(0.5, 0.5), 25)
			end
		end)
		card.Parent = playGrid
		giftCards[index] = { Button = open, Timer = timer }
	end

	-- Codes.
	label({
		Name = "Hint",
		Size = UDim2.new(1, 0, 0.2, 0),
		Text = "Got a code? Type it here!",
		TextSize = 30,
	}).Parent = pages.Codes
	local codeBox = create("TextBox", {
		Name = "CodeBox",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.fromScale(0.5, 0.26),
		Size = UDim2.new(0.8, 0, 0.18, 0),
		BackgroundColor3 = Color3.new(1, 1, 1),
		Font = UIKit.Font,
		PlaceholderText = "ENTER CODE",
		PlaceholderColor3 = Color3.fromRGB(150, 150, 160),
		Text = "",
		TextColor3 = COLORS.Outline,
		TextScaled = true,
		ClearTextOnFocus = false,
	}, { corner(12), stroke(COLORS.Outline, 3), UIKit.padding(8) }) :: TextBox
	codeBox.Parent = pages.Codes
	local redeem = button("REDEEM", ACCENTS.Gifts, {
		Name = "Redeem",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.new(0.4, 0, 0.16, 0),
	})
	redeem.Parent = pages.Codes
	local function redeemCode()
		local text = codeBox.Text
		if #text == 0 then
			return
		end
		if ask("Redeem", text) then
			codeBox.Text = ""
			UIKit.confetti(screen, Vector2.new(0.5, 0.5), 30)
		end
	end
	redeem.Activated:Connect(redeemCode)
	codeBox.FocusLost:Connect(function(enterPressed: boolean)
		if enterPressed then
			redeemCode()
		end
	end)
	label({
		Name = "Follow",
		Position = UDim2.fromScale(0, 0.74),
		Size = UDim2.new(1, 0, 0.14, 0),
		Text = "Like the game and join the group for new codes!",
		TextColor3 = COLORS.Muted,
		TextSize = 20,
	}).Parent = pages.Codes

	-- Group Chest.
	local groupText = label({
		Name = "Info",
		Size = UDim2.new(1, 0, 0.5, 0),
		Text = "",
		TextSize = 28,
		TextWrapped = true,
	})
	groupText.Parent = pages.Group
	local groupButton = button("OPEN CHEST", COLORS.Gold, {
		Name = "OpenChest",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.fromScale(0.5, 0.6),
		Size = UDim2.new(0.5, 0, 0.18, 0),
	})
	groupButton.Parent = pages.Group
	groupButton.Activated:Connect(function()
		if ask("ClaimGroupChest") then
			UIKit.confetti(screen, Vector2.new(0.5, 0.5), 40)
		end
	end)

	local function playSeconds(): number
		local playtime = state.Playtime
		local base = if typeof(playtime) == "table" then tonumber(playtime.Seconds) or 0 else 0
		return base + (os.clock() - stateAt)
	end

	local function giftReady(index: number): boolean
		local playtime = state.Playtime
		local claimed = if typeof(playtime) == "table" and typeof(playtime.Claimed) == "table" then playtime.Claimed else {}
		return table.find(claimed, index) == nil and playSeconds() >= FeatureConfig.PlaytimeRewards[index].Minutes * 60
	end

	local function refresh()
		local daily = if typeof(state.Daily) == "table" then state.Daily else {}
		local todayIndex = tonumber(daily.Index) or 1
		local claimed = daily.Claimed == true
		for day, card in dayCards do
			local done = day < todayIndex or (day == todayIndex and claimed)
			card.Status.Text = if done then "✅" elseif day == todayIndex then "TODAY" else ""
			card.Frame.BackgroundColor3 = if day == todayIndex and not claimed then ACCENTS.Gifts else COLORS.PanelLight
		end
		claimDaily.Text = if claimed
			then "Next reward in " .. clock((tonumber(state.SecondsToNextDay) or 0) - (os.clock() - stateAt))
			else "CLAIM DAY " .. todayIndex
		UIKit.setEnabled(claimDaily, not claimed, COLORS.Buy)

		local anyGift = false
		local playtime = state.Playtime
		local claimedGifts = if typeof(playtime) == "table" and typeof(playtime.Claimed) == "table" then playtime.Claimed else {}
		for index, card in giftCards do
			local gift = FeatureConfig.PlaytimeRewards[index]
			local opened = table.find(claimedGifts, index) ~= nil
			local ready = giftReady(index)
			anyGift = anyGift or ready
			card.Timer.Text = if opened
				then "Opened ✅"
				elseif ready then "Ready!"
				else "in " .. NumberFormat.duration(gift.Minutes * 60 - playSeconds())
			card.Button.Visible = not opened
			UIKit.setEnabled(card.Button, ready, COLORS.Buy)
		end

		local groupEnabled = state.GroupEnabled == true
		local groupClaimed = state.GroupChest == true
		groupText.Text = if not groupEnabled
			then "Group rewards are coming soon!"
			elseif groupClaimed then "Thanks for being in the group! You earn +10% Cash."
			else string.format(
				"Join our group for +%d%% Cash forever and a free %s!",
				math.floor(FeatureConfig.GroupBoost * 100),
				FeatureConfig.describeReward(FeatureConfig.GroupChest)
			)
		groupButton.Visible = groupEnabled and not groupClaimed

		UIKit.setAlert(buttons.Gifts, not claimed or anyGift)
	end
	table.insert(refreshers, refresh)
	-- Timers tick every second while the window is open (and the alert
	-- notices a gift unlocking).
	task.spawn(function()
		while true do
			task.wait(1)
			refresh()
		end
	end)
end

buttons.Gifts.Activated:Connect(function()
	if UIKit.toggleModal(giftsFrame) then
		refreshAll()
	end
end)

--------------------------------------------------------------------------------
-- Quests
--------------------------------------------------------------------------------

local questsFrame, questsBody = UIKit.modal(screen, "Quests", "DAILY QUESTS", ACCENTS.Quests, Vector2.new(640, 520))
do
	local list = create("Frame", {
		Name = "List",
		Size = UDim2.new(1, 0, 0.72, 0),
		BackgroundTransparency = 1,
	}, {
		create("UIListLayout", { Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder }),
	}) :: Frame
	list.Parent = questsBody
	type QuestRow = { Frame: Frame, Text: TextLabel, Reward: TextLabel, SetBar: (number, string) -> (), Claim: TextButton }
	local rows: { QuestRow } = {}
	for index = 1, FeatureConfig.QuestsPerDay do
		local row = create("Frame", {
			Name = "Quest" .. index,
			Size = UDim2.new(1, 0, 1 / FeatureConfig.QuestsPerDay, -10),
			BackgroundColor3 = COLORS.PanelLight,
			LayoutOrder = index,
		}, { corner(12), stroke(COLORS.Outline, 3) }) :: Frame
		local text = label({
			Name = "QuestText",
			Position = UDim2.fromScale(0.03, 0.06),
			Size = UDim2.new(0.66, 0, 0.4, 0),
			Text = "",
			TextSize = 24,
			TextXAlignment = Enum.TextXAlignment.Left,
		})
		text.Parent = row
		local bar, setBar = UIKit.progressBar(ACCENTS.Quests, {
			Name = "Progress",
			Position = UDim2.fromScale(0.03, 0.55),
			Size = UDim2.new(0.5, 0, 0.32, 0),
		})
		bar.Parent = row
		local reward = label({
			Name = "Reward",
			Position = UDim2.fromScale(0.55, 0.55),
			Size = UDim2.new(0.18, 0, 0.32, 0),
			Text = "",
			TextColor3 = COLORS.Income,
			TextSize = 18,
		})
		reward.Parent = row
		local claim = button("CLAIM", COLORS.Buy, {
			Name = "Claim",
			AnchorPoint = Vector2.new(1, 0.5),
			Position = UDim2.new(1, -10, 0.5, 0),
			Size = UDim2.new(0.22, 0, 0.6, 0),
		})
		claim.Parent = row
		claim.Activated:Connect(function()
			if ask("ClaimQuest", index) then
				UIKit.confetti(screen, Vector2.new(0.5, 0.5), 25)
			end
		end)
		row.Parent = list
		rows[index] = { Frame = row, Text = text, Reward = reward, SetBar = setBar, Claim = claim }
	end
	local bonusRow = create("Frame", {
		Name = "Bonus",
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.fromScale(0, 0.9),
		Size = UDim2.new(1, 0, 0.15, 0),
		BackgroundColor3 = Color3.fromRGB(90, 60, 20),
	}, { corner(12), stroke(COLORS.Gold, 3) }) :: Frame
	bonusRow.Parent = questsBody
	label({
		Name = "Text",
		Position = UDim2.fromScale(0.03, 0),
		Size = UDim2.new(0.7, 0, 1, 0),
		Text = "Finish all 3: " .. FeatureConfig.describeReward(FeatureConfig.QuestBonus) .. "!",
		TextSize = 22,
		TextXAlignment = Enum.TextXAlignment.Left,
	}).Parent = bonusRow
	local bonusClaim = button("CLAIM", COLORS.Gold, {
		Name = "Claim",
		AnchorPoint = Vector2.new(1, 0.5),
		Position = UDim2.new(1, -10, 0.5, 0),
		Size = UDim2.new(0.22, 0, 0.7, 0),
	})
	bonusClaim.Parent = bonusRow
	bonusClaim.Activated:Connect(function()
		if ask("ClaimQuestBonus") then
			UIKit.confetti(screen, Vector2.new(0.5, 0.5), 50)
		end
	end)
	local resetLabel = label({
		Name = "Reset",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.fromScale(0.5, 1),
		Size = UDim2.new(1, 0, 0.08, 0),
		Text = "",
		TextColor3 = COLORS.Muted,
		TextSize = 18,
	})
	resetLabel.Parent = questsBody

	local function refresh()
		local quests = if typeof(state.Quests) == "table" then state.Quests else {}
		local anyReady = false
		local allClaimed = #quests > 0
		for index, row in rows do
			local quest = quests[index]
			row.Frame.Visible = quest ~= nil
			if quest then
				local target = tonumber(quest.Target) or 1
				local progress = tonumber(quest.Progress) or 0
				local done = progress >= target
				row.Text.Text = (if quest.Claimed then "✅ " else "") .. tostring(quest.Text)
				row.SetBar(progress / target, string.format("%s / %s", NumberFormat.abbreviate(progress), NumberFormat.abbreviate(target)))
				row.Reward.Text = tostring(quest.Reward)
				row.Claim.Text = if quest.Claimed then "DONE" else "CLAIM"
				UIKit.setEnabled(row.Claim, done and not quest.Claimed, COLORS.Buy)
				anyReady = anyReady or (done and not quest.Claimed)
				allClaimed = allClaimed and quest.Claimed == true
			end
		end
		local bonusReady = allClaimed and state.QuestBonus ~= true
		bonusClaim.Text = if state.QuestBonus == true then "DONE" else "CLAIM"
		UIKit.setEnabled(bonusClaim, bonusReady, COLORS.Gold)
		resetLabel.Text = "New quests in " .. clock((tonumber(state.SecondsToNextDay) or 0) - (os.clock() - stateAt))
		UIKit.setAlert(buttons.Quests, anyReady or bonusReady)
	end
	table.insert(refreshers, refresh)
	task.spawn(function()
		while true do
			task.wait(1)
			if questsFrame.Visible then
				refresh()
			end
		end
	end)
end

buttons.Quests.Activated:Connect(function()
	if UIKit.toggleModal(questsFrame) then
		refreshAll()
	end
end)

--------------------------------------------------------------------------------
-- Upgrades: speed and base skins
--------------------------------------------------------------------------------

local upgradesFrame, upgradesBody = UIKit.modal(screen, "Upgrades", "UPGRADES", ACCENTS.Upgrades, Vector2.new(720, 540))
do
	local pages = UIKit.tabs(upgradesBody, { "Speed", "Skins" }, ACCENTS.Upgrades)

	-- Speed.
	local speedIcon = create("ImageLabel", {
		Name = "Icon",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.fromScale(0.5, 0),
		Size = UDim2.fromScale(0.3, 0.3),
		SizeConstraint = Enum.SizeConstraint.RelativeYY,
		BackgroundTransparency = 1,
		Visible = false,
	}) :: ImageLabel
	speedIcon.Parent = pages.Speed
	local AssetLoader = require(Shared:WaitForChild("AssetLoader"))
	UIKit.setImage(speedIcon, AssetLoader.getUIIcon("Speed"))
	local speedTitle = label({ Name = "Level", Position = UDim2.fromScale(0, 0.32), Size = UDim2.new(1, 0, 0.12, 0), Text = "", TextSize = 36 })
	speedTitle.Parent = pages.Speed
	local speedInfo = label({
		Name = "Info",
		Position = UDim2.fromScale(0, 0.45),
		Size = UDim2.new(1, 0, 0.1, 0),
		Text = "",
		TextColor3 = COLORS.Muted,
		TextSize = 24,
	})
	speedInfo.Parent = pages.Speed
	local speedBar, setSpeedBar = UIKit.progressBar(ACCENTS.Upgrades, {
		Name = "Bar",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.fromScale(0.5, 0.58),
		Size = UDim2.new(0.8, 0, 0.1, 0),
	})
	speedBar.Parent = pages.Speed
	local buySpeed = button("", COLORS.Buy, {
		Name = "BuySpeed",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.fromScale(0.5, 0.74),
		Size = UDim2.new(0.5, 0, 0.16, 0),
	})
	buySpeed.Parent = pages.Speed
	buySpeed.Activated:Connect(function()
		ask("BuySpeed")
	end)

	-- Skins.
	local skinList = create("ScrollingFrame", {
		Name = "List",
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 8,
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, {
		create("UIGridLayout", {
			CellSize = UDim2.new(0.25, -8, 0, 190),
			CellPadding = UDim2.fromOffset(8, 8),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	}) :: ScrollingFrame
	skinList.Parent = pages.Skins
	type SkinCard = { Button: TextButton, Skin: FeatureConfig.BaseSkin }
	local skinCards: { SkinCard } = {}
	for order, skin in FeatureConfig.BaseSkins do
		local card = create("Frame", {
			Name = skin.Name,
			BackgroundColor3 = COLORS.PanelLight,
			LayoutOrder = order,
		}, { corner(12), stroke(skin.Trim, 3) }) :: Frame
		-- A little picture of the base: wall, floor and trim colours.
		local swatch = create("Frame", {
			Name = "Swatch",
			Position = UDim2.fromOffset(8, 8),
			Size = UDim2.new(1, -16, 0, 80),
			BackgroundColor3 = skin.Wall,
		}, { corner(10), stroke(COLORS.Outline, 2) }) :: Frame
		swatch.Parent = card
		create("Frame", {
			Name = "Floor",
			AnchorPoint = Vector2.new(0, 1),
			Position = UDim2.fromScale(0, 1),
			Size = UDim2.fromScale(1, 0.35),
			BackgroundColor3 = skin.Floor,
		}, { corner(10) }).Parent = swatch
		create("Frame", {
			Name = "Trim",
			Position = UDim2.fromScale(0, 0.2),
			Size = UDim2.fromScale(1, 0.1),
			BackgroundColor3 = skin.Trim,
			BorderSizePixel = 0,
		}).Parent = swatch
		if skin.Effect == "Rainbow" then
			create("UIGradient", {
				Color = ColorSequence.new({
					ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 70, 70)),
					ColorSequenceKeypoint.new(0.33, Color3.fromRGB(255, 230, 60)),
					ColorSequenceKeypoint.new(0.66, Color3.fromRGB(70, 200, 255)),
					ColorSequenceKeypoint.new(1, Color3.fromRGB(220, 80, 255)),
				}),
			}).Parent = swatch
		end
		label({ Name = "SkinName", Position = UDim2.fromOffset(4, 94), Size = UDim2.new(1, -8, 0, 30), Text = skin.Name, TextSize = 24 }).Parent = card
		local action = button("", COLORS.Buy, {
			Name = "Action",
			AnchorPoint = Vector2.new(0.5, 1),
			Position = UDim2.new(0.5, 0, 1, -8),
			Size = UDim2.new(1, -16, 0, 44),
		})
		action.Parent = card
		action.Activated:Connect(function()
			local skins = if typeof(state.Skins) == "table" then state.Skins else {}
			local owned = if typeof(skins.Owned) == "table" then skins.Owned else {}
			if skin.Price == 0 or table.find(owned, skin.Name) then
				ask("EquipSkin", skin.Name)
			elseif skin.ProductKey then
				promptProduct(skin.ProductKey)
			else
				ask("BuySkin", skin.Name)
			end
		end)
		card.Parent = skinList
		table.insert(skinCards, { Button = action, Skin = skin })
	end

	table.insert(refreshers, function()
		local level = tonumber(state.SpeedLevel) or 0
		local maxLevel = #FeatureConfig.SpeedCosts
		local cost = FeatureConfig.SpeedCosts[level + 1]
		local speed = 16 + level * FeatureConfig.SpeedPerLevel
		speedTitle.Text = string.format("SPEED LEVEL %d / %d", level, maxLevel)
		speedInfo.Text = if cost
			then string.format("Walk speed %d  →  %d", speed, speed + FeatureConfig.SpeedPerLevel)
			else string.format("Walk speed %d: MAXED OUT!", speed)
		setSpeedBar(level / maxLevel, string.format("%d / %d", level, maxLevel))
		buySpeed.Text = if cost then "UPGRADE  " .. NumberFormat.cash(cost) else "MAX"
		UIKit.setEnabled(buySpeed, cost ~= nil, COLORS.Buy)

		local skins = if typeof(state.Skins) == "table" then state.Skins else {}
		local owned = if typeof(skins.Owned) == "table" then skins.Owned else {}
		local equipped = if typeof(skins.Equipped) == "string" then skins.Equipped else "Classic"
		for _, card in skinCards do
			local skin = card.Skin
			local has = skin.Price == 0 or table.find(owned, skin.Name) ~= nil
			if skin.Name == equipped then
				card.Button.Text = "EQUIPPED"
				UIKit.setEnabled(card.Button, false, COLORS.Buy)
			elseif has then
				card.Button.Text = "EQUIP"
				UIKit.setEnabled(card.Button, true, Color3.fromRGB(40, 150, 255))
			elseif skin.ProductKey then
				card.Button.Text = "R$ BUY"
				UIKit.setEnabled(card.Button, true, Color3.fromRGB(215, 70, 170))
			else
				card.Button.Text = NumberFormat.cash(skin.Price or 0)
				UIKit.setEnabled(card.Button, true, COLORS.Buy)
			end
		end
	end)
end

buttons.Upgrades.Activated:Connect(function()
	if UIKit.toggleModal(upgradesFrame) then
		refreshAll()
	end
end)

--------------------------------------------------------------------------------
-- Settings
--------------------------------------------------------------------------------

local settingsFrame, settingsBody = UIKit.modal(screen, "Settings", "SETTINGS", ACCENTS.Settings, Vector2.new(520, 460))
do
	local settings = {
		Music = FeatureConfig.DefaultSettings.Music,
		Sfx = FeatureConfig.DefaultSettings.Sfx,
		LowGraphics = FeatureConfig.DefaultSettings.LowGraphics,
	}
	local loaded = false
	local saveToken = 0

	local function apply()
		Sounds.setMusicVolume(settings.Music)
		Sounds.setEffectsVolume(settings.Sfx)
		player:SetAttribute("LowGraphics", settings.LowGraphics)
	end
	local function save()
		saveToken += 1
		local token = saveToken
		task.delay(1, function()
			if token == saveToken then
				pcall(function()
					rewardsFunction:InvokeServer("SaveSettings", settings)
				end)
			end
		end)
	end

	create("UIListLayout", { Padding = UDim.new(0, 14), SortOrder = Enum.SortOrder.LayoutOrder }).Parent = settingsBody

	type Slider = { Set: (number) -> () }
	local function slider(name: string, text: string, order: number, onChange: (number) -> ()): Slider
		local row = create("Frame", {
			Name = name,
			Size = UDim2.new(1, 0, 0, 70),
			BackgroundTransparency = 1,
			LayoutOrder = order,
		}) :: Frame
		local title = label({ Name = "Title", Size = UDim2.new(1, 0, 0, 30), Text = text, TextSize = 26, TextXAlignment = Enum.TextXAlignment.Left })
		title.Parent = row
		local bar = create("TextButton", {
			Name = "Bar",
			Position = UDim2.fromOffset(0, 40),
			Size = UDim2.new(1, -20, 0, 18),
			BackgroundColor3 = COLORS.PanelDark,
			AutoButtonColor = false,
			Text = "",
		}, { UIKit.round(), stroke(COLORS.Outline, 2) }) :: TextButton
		bar.Parent = row
		local fill = create("Frame", { Name = "Fill", Size = UDim2.fromScale(1, 1), BackgroundColor3 = ACCENTS.Upgrades }, { UIKit.round(), UIKit.gloss() }) :: Frame
		fill.Parent = bar
		local knob = create("Frame", {
			Name = "Knob",
			AnchorPoint = Vector2.new(0.5, 0.5),
			Position = UDim2.fromScale(1, 0.5),
			Size = UDim2.fromOffset(30, 30),
			BackgroundColor3 = Color3.new(1, 1, 1),
			ZIndex = 2,
		}, { UIKit.round(), stroke(COLORS.Outline, 3) }) :: Frame
		knob.Parent = bar
		local function set(value: number)
			local fraction = math.clamp(value, 0, 1)
			fill.Size = UDim2.fromScale(fraction, 1)
			knob.Position = UDim2.fromScale(fraction, 0.5)
			title.Text = string.format("%s: %d%%", text, math.floor(fraction * 100 + 0.5))
		end
		local dragging = false
		local function update(x: number)
			local width = bar.AbsoluteSize.X
			if width <= 0 then
				return
			end
			local fraction = math.clamp((x - bar.AbsolutePosition.X) / width, 0, 1)
			set(fraction)
			onChange(fraction)
		end
		bar.InputBegan:Connect(function(input: InputObject)
			if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
				dragging = true
				update(input.Position.X)
			end
		end)
		UserInputService.InputChanged:Connect(function(input: InputObject)
			if dragging and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then
				update(input.Position.X)
			end
		end)
		UserInputService.InputEnded:Connect(function(input: InputObject)
			if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
				dragging = false
			end
		end)
		row.Parent = settingsBody
		return { Set = set }
	end

	local musicSlider = slider("Music", "Music", 1, function(value: number)
		settings.Music = value
		apply()
		save()
	end)
	local sfxSlider = slider("Sounds", "Sounds", 2, function(value: number)
		settings.Sfx = value
		apply()
		save()
	end)
	local graphicsButton = button("", COLORS.PanelLight, {
		Name = "LowGraphics",
		Size = UDim2.new(1, -20, 0, 54),
		LayoutOrder = 3,
	})
	graphicsButton.Parent = settingsBody
	local function showGraphics()
		graphicsButton.Text = if settings.LowGraphics then "LOW GRAPHICS: ON" else "LOW GRAPHICS: OFF"
		graphicsButton.BackgroundColor3 = if settings.LowGraphics then ACCENTS.Upgrades else COLORS.PanelLight
	end
	graphicsButton.Activated:Connect(function()
		settings.LowGraphics = not settings.LowGraphics
		showGraphics()
		apply()
		save()
	end)
	local tutorialButton = button("SKIP TUTORIAL", COLORS.PanelLight, {
		Name = "Tutorial",
		Size = UDim2.new(1, -20, 0, 54),
		LayoutOrder = 4,
	})
	tutorialButton.Parent = settingsBody
	tutorialButton.Activated:Connect(function()
		ask("SkipTutorial")
	end)
	musicSlider.Set(settings.Music)
	sfxSlider.Set(settings.Sfx)
	showGraphics()

	table.insert(refreshers, function()
		tutorialButton.Visible = (tonumber(player:GetAttribute("TutorialStep")) or 0) > 0
		-- Saved settings apply once, when they first arrive.
		if loaded or typeof(state.Settings) ~= "table" then
			return
		end
		loaded = true
		local saved = state.Settings
		settings.Music = math.clamp(tonumber(saved.Music) or settings.Music, 0, 1)
		settings.Sfx = math.clamp(tonumber(saved.Sfx) or settings.Sfx, 0, 1)
		settings.LowGraphics = saved.LowGraphics == true
		musicSlider.Set(settings.Music)
		sfxSlider.Set(settings.Sfx)
		showGraphics()
		apply()
	end)
	apply()
end

buttons.Settings.Activated:Connect(function()
	if UIKit.toggleModal(settingsFrame) then
		refreshAll()
	end
end)

--------------------------------------------------------------------------------
-- Trading
--------------------------------------------------------------------------------

local tradeFrame, tradeBody = UIKit.modal(screen, "Trade", "TRADE", ACCENTS.Trade, Vector2.new(620, 480))
local tradeWindow, tradeWindowBody = UIKit.modal(screen, "TradeWindow", "TRADING", ACCENTS.Trade, Vector2.new(900, 600))
do
	local function askTrade(action: string, argument: any?): boolean
		local ok, success, message = pcall(function()
			return tradeFunction:InvokeServer(action, argument)
		end)
		if ok and typeof(message) == "string" then
			UIKit.toast(message, if success == true then "Info" else "Error")
		end
		return ok and success == true
	end

	-- Who to trade with.
	local playerList = create("ScrollingFrame", {
		Name = "Players",
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 8,
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, {
		create("UIListLayout", { Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }),
	}) :: ScrollingFrame
	playerList.Parent = tradeBody
	local function refreshPlayers()
		for _, child in playerList:GetChildren() do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		local others = 0
		for _, other in Players:GetPlayers() do
			if other == player then
				continue
			end
			others += 1
			local row = create("Frame", {
				Name = other.Name,
				Size = UDim2.new(1, -10, 0, 64),
				BackgroundColor3 = COLORS.PanelLight,
			}, { corner(12), stroke(COLORS.Outline, 2) }) :: Frame
			label({
				Position = UDim2.fromOffset(14, 0),
				Size = UDim2.new(0.6, 0, 1, 0),
				Text = other.DisplayName,
				TextSize = 28,
				TextXAlignment = Enum.TextXAlignment.Left,
			}).Parent = row
			local requestButton = button("TRADE", ACCENTS.Trade, {
				Name = "Request",
				AnchorPoint = Vector2.new(1, 0.5),
				Position = UDim2.new(1, -10, 0.5, 0),
				Size = UDim2.new(0.3, 0, 0, 44),
			})
			requestButton.Parent = row
			requestButton.Activated:Connect(function()
				askTrade("Request", other.UserId)
			end)
			row.Parent = playerList
		end
		if others == 0 then
			local empty = create("Frame", { Size = UDim2.new(1, 0, 0, 80), BackgroundTransparency = 1 }) :: Frame
			label({ Size = UDim2.fromScale(1, 1), Text = "Nobody else is here yet!", TextSize = 28 }).Parent = empty
			empty.Parent = playerList
		end
	end
	buttons.Trade.Activated:Connect(function()
		if UIKit.toggleModal(tradeFrame) then
			refreshPlayers()
		end
	end)

	-- An incoming request pops up at the top.
	local requestBanner = create("Frame", {
		Name = "TradeRequest",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 110),
		Size = UDim2.fromOffset(460, 110),
		BackgroundColor3 = COLORS.Panel,
		Visible = false,
		ZIndex = 20,
	}, { corner(16), stroke(ACCENTS.Trade, 4) }) :: Frame
	requestBanner.Parent = screen
	UIKit.autoScale(requestBanner)
	local requestText = label({ Size = UDim2.new(1, -20, 0, 50), Position = UDim2.fromOffset(10, 4), Text = "", TextSize = 26, ZIndex = 21 })
	requestText.Parent = requestBanner
	local acceptButton = button("ACCEPT", COLORS.Buy, {
		Position = UDim2.new(0.06, 0, 0, 56),
		Size = UDim2.new(0.4, 0, 0, 44),
		ZIndex = 21,
	})
	acceptButton.Parent = requestBanner
	local declineButton = button("NO", COLORS.Close, {
		Position = UDim2.new(0.54, 0, 0, 56),
		Size = UDim2.new(0.4, 0, 0, 44),
		ZIndex = 21,
	})
	declineButton.Parent = requestBanner
	local requestFrom = 0
	local requestToken = 0
	local function answer(accept: boolean)
		requestBanner.Visible = false
		requestToken += 1
		askTrade("Respond", { From = requestFrom, Accept = accept })
	end
	acceptButton.Activated:Connect(function()
		answer(true)
	end)
	declineButton.Activated:Connect(function()
		answer(false)
	end)

	-- The trading table: your base on the left, both offers on the right.
	local mineGrid = create("ScrollingFrame", {
		Name = "YourBase",
		Position = UDim2.fromOffset(0, 34),
		Size = UDim2.new(0.44, 0, 1, -34),
		BackgroundColor3 = COLORS.PanelDark,
		BorderSizePixel = 0,
		ScrollBarThickness = 8,
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, {
		corner(12),
		UIKit.padding(6),
		create("UIGridLayout", { CellSize = UDim2.fromOffset(118, 150), CellPadding = UDim2.fromOffset(6, 6), SortOrder = Enum.SortOrder.LayoutOrder }),
	}) :: ScrollingFrame
	mineGrid.Parent = tradeWindowBody
	label({ Size = UDim2.new(0.44, 0, 0, 30), Text = "YOUR BASE (tap to offer)", TextSize = 22 }).Parent = tradeWindowBody

	local function offerBox(name: string, title: string, y: number): Frame
		label({ Name = name .. "Title", Position = UDim2.new(0.47, 0, y, 0), Size = UDim2.new(0.53, 0, 0, 30), Text = title, TextSize = 22 }).Parent = tradeWindowBody
		local box = create("Frame", {
			Name = name,
			Position = UDim2.new(0.47, 0, y, 34),
			Size = UDim2.new(0.53, 0, 0.36, -34),
			BackgroundColor3 = COLORS.PanelDark,
		}, {
			corner(12),
			UIKit.padding(6),
			create("UIGridLayout", { CellSize = UDim2.new(0.25, -6, 1, 0), CellPadding = UDim2.fromOffset(6, 0), SortOrder = Enum.SortOrder.LayoutOrder }),
		}) :: Frame
		box.Parent = tradeWindowBody
		return box
	end
	local myOfferBox = offerBox("YourOffer", "YOU GIVE", 0)
	local theirOfferBox = offerBox("TheirOffer", "THEY GIVE", 0.38)
	local statusLabel = label({
		Name = "Status",
		Position = UDim2.new(0.47, 0, 0.76, 0),
		Size = UDim2.new(0.53, 0, 0.08, 0),
		Text = "",
		TextSize = 22,
	})
	statusLabel.Parent = tradeWindowBody
	local readyButton = button("READY", COLORS.Buy, {
		Name = "Ready",
		Position = UDim2.new(0.47, 0, 0.86, 0),
		Size = UDim2.new(0.3, 0, 0.13, 0),
	})
	readyButton.Parent = tradeWindowBody
	local cancelButton = button("CANCEL", COLORS.Close, {
		Name = "Cancel",
		Position = UDim2.new(0.79, 0, 0.86, 0),
		Size = UDim2.new(0.21, 0, 0.13, 0),
	})
	cancelButton.Parent = tradeWindowBody

	local session: { [string]: any }? = nil
	local offered: { number } = {}
	local myReady = false

	local function clear(frame: Instance)
		for _, child in frame:GetChildren() do
			if child:IsA("GuiButton") then
				child:Destroy()
			end
		end
	end

	local function drawSession()
		local current = session
		if current == nil then
			return
		end
		offered = {}
		clear(myOfferBox)
		for order, item in current.Mine or {} do
			table.insert(offered, item.Slot)
			local card = UIKit.brainrotCard(item.Entry, { LayoutOrder = order })
			card.Parent = myOfferBox
			card.Activated:Connect(function()
				local slots = table.clone(offered)
				local at = table.find(slots, item.Slot)
				if at then
					table.remove(slots, at)
				end
				askTrade("Offer", slots)
			end)
		end
		clear(theirOfferBox)
		for order, item in current.Theirs or {} do
			UIKit.brainrotCard(item.Entry, { LayoutOrder = order, AutoButtonColor = false }).Parent = theirOfferBox
		end
		clear(mineGrid)
		for order, owned in myBrainrots() do
			if table.find(offered, owned.Slot) then
				continue
			end
			local card = UIKit.brainrotCard(owned.Entry, { LayoutOrder = order })
			card.Parent = mineGrid
			card.Activated:Connect(function()
				if #offered >= FeatureConfig.MaxTradeItems then
					UIKit.toast(string.format("You can offer up to %d brainrots.", FeatureConfig.MaxTradeItems), "Warning")
					return
				end
				local slots = table.clone(offered)
				table.insert(slots, owned.Slot)
				askTrade("Offer", slots)
			end)
		end
		myReady = current.MyReady == true
		readyButton.Text = if myReady then "NOT READY" else "READY"
		readyButton.BackgroundColor3 = if myReady then COLORS.Gold else COLORS.Buy
	end

	RunService.Heartbeat:Connect(function()
		local current = session
		if current == nil then
			return
		end
		local endsAt = tonumber(current.CountdownEndsAt) or 0
		local left = endsAt - Workspace:GetServerTimeNow()
		if endsAt > 0 and left > 0 then
			statusLabel.Text = string.format("Trading in %d...", math.ceil(left))
			statusLabel.TextColor3 = COLORS.Gold
		elseif current.TheirReady then
			statusLabel.Text = tostring(current.PartnerName) .. " is READY!"
			statusLabel.TextColor3 = COLORS.Buy
		else
			statusLabel.Text = "Waiting for " .. tostring(current.PartnerName) .. "..."
			statusLabel.TextColor3 = COLORS.Muted
		end
	end)

	readyButton.Activated:Connect(function()
		askTrade("Ready", not myReady)
	end)
	cancelButton.Activated:Connect(function()
		askTrade("Cancel")
	end)
	-- Closing the window cancels the trade.
	tradeWindow:GetPropertyChangedSignal("Visible"):Connect(function()
		if not tradeWindow.Visible and session ~= nil then
			askTrade("Cancel")
		end
	end)

	tradeStateEvent.OnClientEvent:Connect(function(message: any)
		if typeof(message) ~= "table" then
			return
		end
		if message.Kind == "Request" then
			requestFrom = tonumber(message.From) or 0
			requestText.Text = tostring(message.Name) .. " wants to trade!"
			requestBanner.Visible = true
			Sounds.play("Notify")
			requestToken += 1
			local token = requestToken
			task.delay(tonumber(message.ExpiresIn) or FeatureConfig.TradeRequestSeconds, function()
				if token == requestToken then
					requestBanner.Visible = false
				end
			end)
		elseif message.Kind == "Session" then
			local opening = session == nil
			session = message
			local title = tradeWindow:FindFirstChild("Title")
			if title and title:IsA("TextLabel") then
				title.Text = "TRADING WITH " .. string.upper(tostring(message.PartnerName))
			end
			if opening then
				UIKit.openModal(tradeWindow)
			end
			drawSession()
		elseif message.Kind == "Closed" then
			session = nil
			if tradeWindow.Visible then
				tradeWindow.Visible = false
			end
			if typeof(message.Message) == "string" then
				UIKit.toast(message.Message, "Info")
			end
		end
	end)
end

--------------------------------------------------------------------------------
-- Fuse Machine
--------------------------------------------------------------------------------

local fuseFrame, fuseBody = UIKit.modal(screen, "Fuse", "FUSE MACHINE", ACCENTS.Fuse, Vector2.new(900, 600))
do
	label({
		Name = "Hint",
		Size = UDim2.new(1, 0, 0, 30),
		Text = string.format("Pick %d brainrots of the same rarity. They fuse into one of the next rarity!", FeatureConfig.FuseCount),
		TextColor3 = COLORS.Muted,
		TextSize = 20,
	}).Parent = fuseBody
	local picker = create("ScrollingFrame", {
		Name = "YourBase",
		Position = UDim2.fromOffset(0, 36),
		Size = UDim2.new(0.58, 0, 1, -36),
		BackgroundColor3 = COLORS.PanelDark,
		BorderSizePixel = 0,
		ScrollBarThickness = 8,
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
	}, {
		corner(12),
		UIKit.padding(6),
		create("UIGridLayout", { CellSize = UDim2.fromOffset(118, 150), CellPadding = UDim2.fromOffset(6, 6), SortOrder = Enum.SortOrder.LayoutOrder }),
	}) :: ScrollingFrame
	picker.Parent = fuseBody
	local chamber = create("Frame", {
		Name = "Chamber",
		Position = UDim2.new(0.61, 0, 0, 36),
		Size = UDim2.new(0.39, 0, 0.3, 0),
		BackgroundColor3 = Color3.fromRGB(45, 20, 70),
	}, {
		corner(12),
		stroke(ACCENTS.Fuse, 3),
		UIKit.padding(6),
		create("UIGridLayout", { CellSize = UDim2.new(1 / 3, -6, 1, 0), CellPadding = UDim2.fromOffset(6, 0), SortOrder = Enum.SortOrder.LayoutOrder }),
	}) :: Frame
	chamber.Parent = fuseBody
	local arrow = label({
		Name = "Arrow",
		Position = UDim2.new(0.61, 0, 0.36, 0),
		Size = UDim2.new(0.39, 0, 0.1, 0),
		Text = "⬇",
		TextSize = 48,
	})
	arrow.Parent = fuseBody
	local resultBox = create("Frame", {
		Name = "Result",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.805, 0, 0.47, 0),
		Size = UDim2.new(0.2, 0, 0.3, 0),
		BackgroundColor3 = COLORS.PanelLight,
	}, { corner(12), stroke(COLORS.Gold, 3) }) :: Frame
	resultBox.Parent = fuseBody
	local resultText = label({ Name = "Text", Size = UDim2.fromScale(1, 1), Text = "?", TextSize = 60 })
	resultText.Parent = resultBox
	local fuseButton = button("FUSE!", ACCENTS.Fuse, {
		Name = "FuseButton",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.805, 0, 1, -4),
		Size = UDim2.new(0.36, 0, 0.14, 0),
	})
	fuseButton.Parent = fuseBody

	local picks: { Owned } = {}
	local fusing = false

	local function redraw()
		for _, frame in { picker :: Instance, chamber :: Instance } do
			for _, child in frame:GetChildren() do
				if child:IsA("GuiButton") then
					child:Destroy()
				end
			end
		end
		for _, child in resultBox:GetChildren() do
			if child:IsA("GuiButton") then
				child:Destroy()
			end
		end
		resultText.Visible = true
		local rarity = if #picks > 0 then picks[1].Definition.Rarity else nil
		for order, pick in picks do
			local card = UIKit.brainrotCard(pick.Entry, { LayoutOrder = order })
			card.Parent = chamber
			card.Activated:Connect(function()
				if fusing then
					return
				end
				table.remove(picks, table.find(picks, pick) or order)
				redraw()
			end)
		end
		for order, owned in myBrainrots() do
			local picked = false
			for _, pick in picks do
				if pick.Slot == owned.Slot then
					picked = true
				end
			end
			if picked or BrainrotConfig.isLuckyBlock(owned.Definition) or owned.Definition.Rarity == "Secret" then
				continue
			end
			local card = UIKit.brainrotCard(owned.Entry, { LayoutOrder = order })
			local fits = rarity == nil or owned.Definition.Rarity == rarity
			if not fits then
				card.BackgroundTransparency = 0.6
				card.AutoButtonColor = false
			end
			card.Parent = picker
			card.Activated:Connect(function()
				if fusing or not fits or #picks >= FeatureConfig.FuseCount then
					return
				end
				table.insert(picks, owned)
				redraw()
			end)
		end
		-- What comes out: the next rarity up.
		local nextRarity: string? = nil
		if rarity then
			local index = rarityIndex(rarity)
			local following = BrainrotConfig.Rarities[index + 1]
			nextRarity = if following then following.Name else nil
		end
		resultText.Text = if nextRarity then "?\n" .. nextRarity else "?"
		local nextInfo = if nextRarity then BrainrotConfig.RarityByName[nextRarity] else nil
		resultText.TextColor3 = if nextInfo then nextInfo.Color else Color3.new(1, 1, 1)
		UIKit.setEnabled(fuseButton, #picks == FeatureConfig.FuseCount and not fusing, ACCENTS.Fuse)
	end

	fuseButton.Activated:Connect(function()
		if fusing or #picks ~= FeatureConfig.FuseCount then
			return
		end
		fusing = true
		local slots: { number } = {}
		for _, pick in picks do
			table.insert(slots, pick.Slot)
		end
		UIKit.setEnabled(fuseButton, false, ACCENTS.Fuse)
		-- The chamber shakes and glows while the machine works.
		local shakeUntil = os.clock() + FeatureConfig.FuseSeconds
		local connection = RunService.RenderStepped:Connect(function()
			local t = os.clock()
			chamber.Rotation = math.sin(t * 60) * 3
			chamber.BackgroundColor3 = Color3.fromRGB(45, 20, 70):Lerp(ACCENTS.Fuse, 0.5 + 0.5 * math.sin(t * 20))
		end)
		Sounds.play("Zap")
		local ok, success, message, result = pcall(function()
			return fuseFunction:InvokeServer(slots)
		end)
		task.wait(math.max(0, shakeUntil - os.clock()))
		connection:Disconnect()
		chamber.Rotation = 0
		chamber.BackgroundColor3 = Color3.fromRGB(45, 20, 70)
		picks = {}
		fusing = false
		if ok and success == true and typeof(result) == "string" then
			redraw()
			resultText.Visible = false
			UIKit.brainrotCard(result, { Size = UDim2.fromScale(1, 1), AutoButtonColor = false }).Parent = resultBox
			UIKit.confetti(screen, Vector2.new(0.75, 0.55), 50)
			Sounds.play("StealSuccess")
			UIKit.toast(if typeof(message) == "string" then message else "Fused!", "Success")
		else
			redraw()
			UIKit.toast(if ok and typeof(message) == "string" then message else "The machine jammed, try again.", "Error")
			Sounds.play("Error")
		end
	end)

	local function open()
		picks = {}
		UIKit.openModal(fuseFrame)
		redraw()
	end
	task.spawn(function()
		local map = Workspace:WaitForChild("Map", 30)
		local machine = if map then map:WaitForChild("FuseMachine", 30) else nil
		local counter = if machine then machine:WaitForChild("Counter", 30) else nil
		local prompt = if counter then counter:WaitForChild("FusePrompt", 30) else nil
		if prompt and prompt:IsA("ProximityPrompt") then
			prompt.Triggered:Connect(open)
		end
	end)
end

--------------------------------------------------------------------------------
-- Lucky block roulette
--------------------------------------------------------------------------------

do
	local overlay = create("Frame", {
		Name = "LuckyReveal",
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Color3.new(0, 0, 0),
		BackgroundTransparency = 0.35,
		Visible = false,
		ZIndex = 30,
	}) :: Frame
	overlay.Parent = screen
	local content = create("Frame", {
		Name = "Content",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(700, 420),
		BackgroundTransparency = 1,
		ZIndex = 31,
	}) :: Frame
	content.Parent = overlay
	UIKit.autoScale(content, 560)
	local title = label({ Name = "Title", Size = UDim2.new(1, 0, 0, 60), Text = "LUCKY BLOCK!", TextSize = 56, OutlineThickness = 3, ZIndex = 32 })
	title.Parent = content
	local window = create("Frame", {
		Name = "Window",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 80),
		Size = UDim2.fromOffset(640, 170),
		BackgroundColor3 = COLORS.PanelDark,
		ClipsDescendants = true,
		ZIndex = 32,
	}, { corner(14), stroke(COLORS.Gold, 4) }) :: Frame
	window.Parent = content
	local strip = create("Frame", {
		Name = "Strip",
		Position = UDim2.fromOffset(0, 10),
		Size = UDim2.new(0, 0, 0, 150),
		BackgroundTransparency = 1,
		AutomaticSize = Enum.AutomaticSize.X,
		ZIndex = 33,
	}, {
		create("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			Padding = UDim.new(0, 8),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	}) :: Frame
	strip.Parent = window
	create("Frame", {
		Name = "Marker",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.fromScale(0.5, 0),
		Size = UDim2.new(0, 4, 1, 0),
		BackgroundColor3 = COLORS.Gold,
		ZIndex = 40,
	}).Parent = window
	local resultLabel = label({
		Name = "Result",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 270),
		Size = UDim2.new(1, 0, 0, 60),
		Text = "",
		TextSize = 48,
		OutlineThickness = 3,
		ZIndex = 32,
	})
	resultLabel.Parent = content
	local rarityLabel = label({
		Name = "Rarity",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 330),
		Size = UDim2.new(1, 0, 0, 44),
		Text = "",
		TextSize = 36,
		ZIndex = 32,
	})
	rarityLabel.Parent = content

	local CARD_WIDTH = 120
	local CARD_GAP = 8
	local WINNER_INDEX = 34

	local function tile(definition: BrainrotConfig.Brainrot, order: number): Frame
		local rarity = BrainrotConfig.RarityByName[definition.Rarity]
		local colour = if rarity then rarity.Color else Color3.new(1, 1, 1)
		local card = create("Frame", {
			Size = UDim2.fromOffset(CARD_WIDTH, 150),
			BackgroundColor3 = colour:Lerp(Color3.new(0, 0, 0), 0.45),
			LayoutOrder = order,
			ZIndex = 34,
		}, { corner(10), stroke(colour, 3) }) :: Frame
		label({
			Size = UDim2.new(1, -8, 0.6, 0),
			Position = UDim2.fromOffset(4, 4),
			Text = definition.DisplayName,
			TextSize = 20,
			TextWrapped = true,
			ZIndex = 35,
		}).Parent = card
		label({
			Position = UDim2.fromScale(0, 0.66),
			Size = UDim2.new(1, 0, 0.26, 0),
			Text = definition.Rarity,
			TextColor3 = colour,
			TextSize = 18,
			ZIndex = 35,
		}).Parent = card
		return card
	end

	-- Random brainrots in the proportions the block opens into.
	local function rollFiller(odds: { [string]: number }): BrainrotConfig.Brainrot?
		local total = 0
		for rarityName, weight in odds do
			if #BrainrotConfig.ByRarity[rarityName] > 0 then
				total += weight
			end
		end
		local roll = math.random() * total
		for rarityName, weight in odds do
			local choices = BrainrotConfig.ByRarity[rarityName]
			if #choices > 0 then
				roll -= weight
				if roll <= 0 then
					return choices[math.random(1, #choices)]
				end
			end
		end
		return BrainrotConfig.Brainrots[1]
	end

	local function reveal(blockId: string, entry: string)
		local block = BrainrotConfig.ById[blockId]
		local definition, mutation, trait = BrainrotConfig.decode(entry)
		if block == nil or block.Odds == nil or definition == nil then
			return
		end
		for _, child in strip:GetChildren() do
			if child:IsA("Frame") then
				child:Destroy()
			end
		end
		for index = 1, WINNER_INDEX + 4 do
			local shown = if index == WINNER_INDEX then definition else rollFiller(block.Odds :: { [string]: number })
			if shown then
				tile(shown, index).Parent = strip
			end
		end
		title.Text = string.upper(block.DisplayName) .. "!"
		resultLabel.Text = ""
		rarityLabel.Text = ""
		overlay.Visible = true
		strip.Position = UDim2.fromOffset(0, 10)
		-- Stop with the winner under the marker, a little off-centre so it
		-- feels like a real spin.
		local target = 320 - ((WINNER_INDEX - 1) * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2) + math.random(-40, 40)
		local tween = TweenService:Create(strip, TweenInfo.new(2.6, Enum.EasingStyle.Quint, Enum.EasingDirection.Out), {
			Position = UDim2.fromOffset(target, 10),
		})
		local lastCard = 0
		local ticking = RunService.RenderStepped:Connect(function()
			local passed = math.floor(-strip.Position.X.Offset / (CARD_WIDTH + CARD_GAP))
			if passed ~= lastCard then
				lastCard = passed
				Sounds.play("Click")
			end
		end)
		tween:Play()
		tween.Completed:Wait()
		ticking:Disconnect()
		local rarity = BrainrotConfig.RarityByName[definition.Rarity]
		resultLabel.Text = BrainrotConfig.fullName(definition, mutation, trait)
		rarityLabel.Text = definition.Rarity
		rarityLabel.TextColor3 = if rarity then rarity.Color else Color3.new(1, 1, 1)
		UIKit.confetti(screen, Vector2.new(0.5, 0.5), 60)
		Sounds.play(if definition.Rarity == "Secret" or definition.Rarity == "Brainrot God" then "Rebirth" else "StealSuccess")
		task.wait(2.5)
		overlay.Visible = false
	end

	-- Everyone sees the block burst in the world.
	local function burst(position: Vector3)
		local anchor = Instance.new("Part")
		anchor.Anchored = true
		anchor.CanCollide = false
		anchor.CanQuery = false
		anchor.CanTouch = false
		anchor.Transparency = 1
		anchor.Size = Vector3.one
		anchor.CFrame = CFrame.new(position + Vector3.new(0, 2, 0))
		local emitter = Instance.new("ParticleEmitter")
		emitter.Rate = 0
		emitter.Speed = NumberRange.new(12, 26)
		emitter.SpreadAngle = Vector2.new(180, 180)
		emitter.Lifetime = NumberRange.new(0.8, 1.6)
		emitter.Acceleration = Vector3.new(0, -20, 0)
		emitter.Size = NumberSequence.new(0.6, 0)
		emitter.LightEmission = 1
		emitter.Color = ColorSequence.new({
			ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 230, 60)),
			ColorSequenceKeypoint.new(0.5, Color3.fromRGB(255, 120, 220)),
			ColorSequenceKeypoint.new(1, Color3.fromRGB(90, 200, 255)),
		})
		emitter.Parent = anchor
		anchor.Parent = Workspace
		task.delay(2.8, function()
			emitter:Emit(120)
			task.delay(3, function()
				anchor:Destroy()
			end)
		end)
	end

	luckyRevealEvent.OnClientEvent:Connect(function(ownerUserId: any, blockId: any, entry: any, position: any)
		if typeof(position) == "Vector3" then
			burst(position)
		end
		if ownerUserId == player.UserId and typeof(blockId) == "string" and typeof(entry) == "string" then
			task.spawn(reveal, blockId, entry)
		end
	end)
	overlay.InputBegan:Connect(function(input: InputObject)
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			if resultLabel.Text ~= "" then
				overlay.Visible = false
			end
		end
	end)
end

--------------------------------------------------------------------------------
-- A glowing line from you to something, with a marker over it (the thief,
-- or where the tutorial wants you to go).
--------------------------------------------------------------------------------

type Pointer = { Set: (target: Vector3?, text: string?) -> () }

local function newPointer(colour: Color3, name: string): Pointer
	local anchor = Instance.new("Part")
	anchor.Name = name
	anchor.Anchored = true
	anchor.CanCollide = false
	anchor.CanQuery = false
	anchor.CanTouch = false
	anchor.Transparency = 1
	anchor.Size = Vector3.one
	local targetAttachment = Instance.new("Attachment")
	targetAttachment.Parent = anchor
	local beam = Instance.new("Beam")
	beam.Color = ColorSequence.new(colour)
	beam.Width0 = 0.5
	beam.Width1 = 0.5
	beam.FaceCamera = true
	beam.LightEmission = 1
	beam.Segments = 1
	beam.Transparency = NumberSequence.new(0.2)
	beam.Attachment1 = targetAttachment
	beam.Enabled = false
	beam.Parent = anchor
	local marker = create("BillboardGui", {
		Name = "Marker",
		Size = UDim2.fromOffset(220, 80),
		StudsOffsetWorldSpace = Vector3.new(0, 4, 0),
		AlwaysOnTop = true,
		LightInfluence = 0,
		Enabled = false,
	}) :: BillboardGui
	local markerText = label({ Size = UDim2.fromScale(1, 1), Text = "", TextColor3 = colour, TextSize = 40, OutlineThickness = 3 })
	markerText.Parent = marker
	marker.Adornee = anchor
	marker.Parent = anchor
	anchor.Parent = Workspace
	local fromAttachment: Attachment? = nil

	return {
		Set = function(target: Vector3?, text: string?)
			local root = rootPart(player.Character)
			if target == nil or root == nil then
				beam.Enabled = false
				marker.Enabled = false
				return
			end
			if fromAttachment == nil or fromAttachment.Parent ~= root then
				local attachment = Instance.new("Attachment")
				attachment.Name = name .. "From"
				attachment.Parent = root
				fromAttachment = attachment
				beam.Attachment0 = attachment
			end
			anchor.CFrame = CFrame.new(target)
			markerText.Text = text or ""
			beam.Enabled = true
			marker.Enabled = true
			local pulse = 0.5 + 0.5 * math.sin(os.clock() * 6)
			beam.Width0 = 0.35 + pulse * 0.3
			beam.Width1 = beam.Width0
		end,
	}
end

--------------------------------------------------------------------------------
-- Base alarm: flashing red, a siren and a line to the thief
--------------------------------------------------------------------------------

do
	local vignette = create("Frame", {
		Name = "Alarm",
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = ACCENTS.Alarm,
		BackgroundTransparency = 1,
		Visible = false,
		ZIndex = 2,
		Active = false,
	}) :: Frame
	vignette.Parent = screen
	local banner = label({
		Name = "AlarmBanner",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 56),
		Size = UDim2.fromOffset(760, 64),
		BackgroundTransparency = 0,
		BackgroundColor3 = ACCENTS.Alarm,
		Text = "",
		TextSize = 34,
		OutlineThickness = 3,
		Visible = false,
		ZIndex = 25,
	})
	corner(14).Parent = banner
	stroke(Color3.new(1, 1, 1), 3).Parent = banner
	banner.Parent = screen
	UIKit.autoScale(banner)
	local pointer = newPointer(ACCENTS.Alarm, "ThiefPointer")
	local thief: Player? = nil
	local stopSiren: (() -> ())? = nil

	baseAlarmEvent.OnClientEvent:Connect(function(who: any, name: any)
		if typeof(who) == "Instance" and who:IsA("Player") then
			thief = who
			banner.Text = string.format("🚨 %s IS STEALING YOUR %s! 🚨", string.upper(who.DisplayName), string.upper(tostring(name)))
			banner.Visible = true
			vignette.Visible = true
			if stopSiren == nil then
				stopSiren = Sounds.loop("Alarm", 1.4)
			end
		else
			thief = nil
			banner.Visible = false
			vignette.Visible = false
			pointer.Set(nil, nil)
			local stop = stopSiren
			if stop then
				stop()
				stopSiren = nil
			end
		end
	end)

	RunService.RenderStepped:Connect(function()
		local current = thief
		if current == nil then
			return
		end
		local t = os.clock()
		vignette.BackgroundTransparency = 0.72 + 0.18 * math.sin(t * 10)
		banner.Rotation = math.sin(t * 18) * 1.5
		local thiefRoot = rootPart(current.Character)
		pointer.Set(if thiefRoot then thiefRoot.Position else nil, "THIEF!")
	end)
end

--------------------------------------------------------------------------------
-- Tutorial
--------------------------------------------------------------------------------

do
	local banner = create("Frame", {
		Name = "Tutorial",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 56),
		Size = UDim2.fromOffset(640, 70),
		BackgroundColor3 = Color3.fromRGB(40, 150, 255),
		Visible = false,
		ZIndex = 15,
	}, { corner(16), stroke(Color3.new(1, 1, 1), 3), UIKit.gloss() }) :: Frame
	banner.Parent = screen
	UIKit.autoScale(banner)
	local stepText = label({
		Name = "StepText",
		Position = UDim2.fromOffset(14, 0),
		Size = UDim2.new(1, -140, 1, 0),
		Text = "",
		TextSize = 28,
		TextXAlignment = Enum.TextXAlignment.Left,
		ZIndex = 16,
	})
	stepText.Parent = banner
	local skip = button("SKIP", COLORS.PanelLight, {
		Name = "Skip",
		AnchorPoint = Vector2.new(1, 0.5),
		Position = UDim2.new(1, -12, 0.5, 0),
		Size = UDim2.fromOffset(100, 44),
		ZIndex = 16,
	})
	skip.Parent = banner
	skip.Activated:Connect(function()
		ask("SkipTutorial")
	end)
	local pointer = newPointer(Color3.fromRGB(80, 220, 255), "TutorialPointer")

	local function nearestConveyorBrainrot(from: Vector3): Vector3?
		local map = Workspace:FindFirstChild("Map")
		local folder = if map then map:FindFirstChild("Brainrots") else nil
		local best: Vector3? = nil
		local bestDistance = math.huge
		if folder then
			for _, model in folder:GetChildren() do
				local root = model:FindFirstChild("Root")
				if model:GetAttribute("State") == "Conveyor" and root and root:IsA("BasePart") then
					local distance = (root.Position - from).Magnitude
					if distance < bestDistance then
						best, bestDistance = root.Position, distance
					end
				end
			end
		end
		return best
	end

	local function target(step: number, from: Vector3): Vector3?
		local plot = findMyPlot()
		if step == 1 then
			return nearestConveyorBrainrot(from)
		elseif step == 2 and plot then
			local pads = plot:FindFirstChild("Pads")
			local owned = myBrainrots()
			local slot = if #owned > 0 then owned[#owned].Slot else 1
			local pad = if pads then pads:FindFirstChild("Pad" .. slot) or pads:FindFirstChild("Pad1") else nil
			return if pad and pad:IsA("BasePart") then pad.Position else nil
		elseif step == 3 and plot then
			local lock = plot:FindFirstChild("LockButton")
			return if lock and lock:IsA("BasePart") then lock.Position else nil
		end
		return nil
	end

	RunService.Heartbeat:Connect(function()
		local step = tonumber(player:GetAttribute("TutorialStep")) or 0
		local text = FeatureConfig.TutorialSteps[step]
		if step <= 0 or text == nil then
			banner.Visible = false
			pointer.Set(nil, nil)
			return
		end
		banner.Visible = true
		stepText.Text = string.format("STEP %d/%d: %s", step, #FeatureConfig.TutorialSteps, text)
		local root = rootPart(player.Character)
		pointer.Set(if root then target(step, root.Position) else nil, "⬇ HERE")
	end)
	player:GetAttributeChangedSignal("TutorialStep"):Connect(function()
		if (tonumber(player:GetAttribute("TutorialStep")) or 0) > 1 then
			Sounds.play("Returned")
		end
		refreshAll()
	end)
end

--------------------------------------------------------------------------------
-- ADMIN ABUSE banner
--------------------------------------------------------------------------------

do
	local banner = label({
		Name = "AdminAbuse",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 130),
		Size = UDim2.fromOffset(640, 90),
		Text = "ADMIN ABUSE!!!",
		TextSize = 80,
		OutlineThickness = 4,
		Visible = false,
		ZIndex = 26,
	})
	banner.Parent = screen
	UIKit.autoScale(banner)
	local gradient = create("UIGradient", {
		Color = ColorSequence.new({
			ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 70, 70)),
			ColorSequenceKeypoint.new(0.25, Color3.fromRGB(255, 220, 60)),
			ColorSequenceKeypoint.new(0.5, Color3.fromRGB(80, 255, 120)),
			ColorSequenceKeypoint.new(0.75, Color3.fromRGB(60, 170, 255)),
			ColorSequenceKeypoint.new(1, Color3.fromRGB(230, 90, 255)),
		}),
	}) :: UIGradient
	gradient.Parent = banner
	local shownAt = 0

	local function update()
		local active = ReplicatedStorage:GetAttribute("EventAdmin") == true
		if active and not banner.Visible then
			shownAt = os.clock()
			UIKit.confetti(screen, Vector2.new(0.5, 0.2), 80)
			Sounds.play("Event")
		end
		banner.Visible = active
	end
	ReplicatedStorage:GetAttributeChangedSignal("EventAdmin"):Connect(update)
	update()
	RunService.RenderStepped:Connect(function()
		if not banner.Visible then
			return
		end
		local t = os.clock()
		gradient.Offset = Vector2.new((t * 0.6) % 2 - 1, 0)
		-- Big and shaking at first, then it settles into a smaller banner.
		local fresh = math.clamp(1 - (t - shownAt) / 6, 0, 1)
		banner.Rotation = math.sin(t * 12) * (2 + 6 * fresh)
		banner.Size = UDim2.fromOffset(640 * (0.6 + 0.4 * fresh), 90 * (0.6 + 0.4 * fresh))
	end)
end

--------------------------------------------------------------------------------
-- State from the server
--------------------------------------------------------------------------------

rewardsStateEvent.OnClientEvent:Connect(function(newState: any)
	if typeof(newState) == "table" then
		state = newState
		stateAt = os.clock()
		refreshAll()
	end
end)

task.spawn(function()
	-- Ask until the server has our data.
	for _ = 1, 30 do
		local ok, success, _, extra = pcall(function()
			return rewardsFunction:InvokeServer("State")
		end)
		if ok and success == true and typeof(extra) == "table" then
			state = extra
			stateAt = os.clock()
			refreshAll()
			return
		end
		task.wait(2)
	end
end)

-- Robux purchases change spins and skins: refresh when the window opens
-- again; the server also pushes the new state.
refreshAll()
screen.Parent = playerGui

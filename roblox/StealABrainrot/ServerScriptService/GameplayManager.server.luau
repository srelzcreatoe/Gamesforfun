--!strict
--[[
	GameplayManager
	Location: ServerScriptService (Script)

	Runs the Steal a Brainrot loop on the server:
	  * gives each player one of the bases in Workspace.Map.Plots
	  * spawns brainrots on the conveyor (rarer ones more often during a Server
	    Rarity Boost) that players buy with Cash
	  * owned brainrots earn Cash every second and can be sold or stolen
	  * each base has a laser door its owner can lock; the EMP Laser Overrider
	    lets its buyer walk through any locked door
	  * rebirths reset Cash for a permanent income bonus

	Every decision is made here. Clients only press ProximityPrompts and call the
	RequestRebirth remote, and each request is re-checked on the server
	(ownership, distance, Cash, free slots). Cash and saved brainrots go through
	the DataAndMonetizationManager API in ServerStorage.

	Client-facing state:
	  ReplicatedStorage.Remotes.Notify (RemoteEvent, server -> client)
	  ReplicatedStorage.Remotes.RequestRebirth (RemoteFunction)
	  Player attribute IncomePerSecond (number)
	  Plot model attributes OwnerUserId (number, 0 = empty), LockEndsAt (server time)
	  ProximityPrompt attributes PromptKind ("Buy" | "Steal" | "Sell"),
	    OwnerUserId, Carried (used by the client to hide prompts that do not apply)
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))
local GameConfig = require(Shared:WaitForChild("GameConfig"))
local MonetizationConfig = require(Shared:WaitForChild("MonetizationConfig"))
local NumberFormat = require(Shared:WaitForChild("NumberFormat"))

local LOG_PREFIX = "[GameplayManager]"

-- Height of a carried brainrot's feet above the thief's HumanoidRootPart.
local CARRY_HEIGHT = 3.2
-- Height in studs of a brainrot with Scale 1.
local FIGURE_HEIGHT = 5.2
local FAST_TICK_SECONDS = 0.1
local SLOW_TICK_SECONDS = 1
local REBIRTH_REQUEST_COOLDOWN_SECONDS = 1

--------------------------------------------------------------------------------
-- Types
--------------------------------------------------------------------------------

type Definition = BrainrotConfig.Brainrot
type Mutation = BrainrotConfig.Mutation
type NotifyKind = "Info" | "Success" | "Warning" | "Error"

type Visual = {
	Model: Model,
	Root: BasePart,
	PromptAttachment: Attachment,
}

type Plot = {
	Index: number,
	Model: Model,
	Floor: BasePart,
	Interior: BasePart,
	LaserZone: BasePart,
	Lasers: { BasePart },
	SpawnPoint: BasePart,
	Slots: { BasePart },
	Occupants: { [number]: Occupant },
	Reserved: { [number]: boolean },
	Owner: Player?,
	LockEndsAt: number,
	IncomeRemainder: number,
	SignTitle: TextLabel,
	SignSubtitle: TextLabel,
	LockLabel: TextLabel,
}

type Occupant = {
	Definition: Definition,
	Mutation: Mutation?,
	Plot: Plot,
	SlotIndex: number,
	Model: Model,
	Root: BasePart,
	PromptAttachment: Attachment,
	StealPrompt: ProximityPrompt,
	SellPrompt: ProximityPrompt,
	WalkTween: Tween?,
	Carrier: Player?,
}

type Carry = {
	Thief: Player,
	Occupant: Occupant,
	VictimPlot: Plot,
	TargetPlot: Plot,
	TargetSlot: number,
	StartedAt: number,
	LastPosition: Vector3,
	LastCheckedAt: number,
	Weld: WeldConstraint,
}

type ConveyorItem = {
	Definition: Definition,
	Mutation: Mutation?,
	Price: number,
	Model: Model,
	Root: BasePart,
	PromptAttachment: Attachment,
	Tween: Tween,
	Sold: boolean,
}

--------------------------------------------------------------------------------
-- Data API (ServerStorage.DataAndMonetization)
--------------------------------------------------------------------------------

local dataApi = ServerStorage:WaitForChild("DataAndMonetization")

local function getBindableFunction(name: string): BindableFunction
	return dataApi:WaitForChild(name) :: BindableFunction
end

local function getBindableEvent(name: string): BindableEvent
	return dataApi:WaitForChild(name) :: BindableEvent
end

local addCashFunction = getBindableFunction("AddCash")
local spendCashFunction = getBindableFunction("SpendCash")
local addRebirthsFunction = getBindableFunction("AddRebirths")
local getPlayerDataFunction = getBindableFunction("GetPlayerData")
local getBrainrotsFunction = getBindableFunction("GetBrainrots")
local setBrainrotsFunction = getBindableFunction("SetBrainrots")
local isLaserBypassActiveFunction = getBindableFunction("IsLaserBypassActive")
local getServerRarityMultiplierFunction = getBindableFunction("GetServerRarityMultiplier")
local empLaserPurchasedEvent = getBindableEvent("EMPLaserOverriderPurchased")
local serverRarityBoostChangedEvent = getBindableEvent("ServerRarityBoostChanged")

local function addCash(player: Player, amount: number): boolean
	return addCashFunction:Invoke(player, amount) == true
end

local function spendCash(player: Player, amount: number): boolean
	return spendCashFunction:Invoke(player, amount) == true
end

local function getPlayerData(player: Player): { [string]: any }?
	local data = getPlayerDataFunction:Invoke(player)
	return if typeof(data) == "table" then data else nil
end

--------------------------------------------------------------------------------
-- Remotes
--------------------------------------------------------------------------------

local remotesFolder = Instance.new("Folder")
remotesFolder.Name = "Remotes"

local notifyEvent = Instance.new("RemoteEvent")
notifyEvent.Name = "Notify"
notifyEvent.Parent = remotesFolder

local requestRebirthFunction = Instance.new("RemoteFunction")
requestRebirthFunction.Name = "RequestRebirth"
requestRebirthFunction.Parent = remotesFolder

remotesFolder.Parent = ReplicatedStorage

local function notify(player: Player, message: string, kind: NotifyKind)
	notifyEvent:FireClient(player, message, kind)
end

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------

local map = Workspace:WaitForChild("Map")
local plotsFolder = map:WaitForChild("Plots")
local conveyorFolder = map:WaitForChild("Conveyor")
local conveyorStart = conveyorFolder:WaitForChild("ConveyorStart") :: BasePart
local conveyorEnd = conveyorFolder:WaitForChild("ConveyorEnd") :: BasePart

local brainrotsFolder = Instance.new("Folder")
brainrotsFolder.Name = "Brainrots"
brainrotsFolder.Parent = map

local plots: { Plot } = {}
local plotByPlayer: { [Player]: Plot } = {}
local carries: { [Player]: Carry } = {}
local conveyorItems: { [ConveyorItem]: boolean } = {}
local conveyorItemCount = 0
local lastRebirthRequest: { [Player]: number } = {}
local rng = Random.new()
local nextGuaranteedAt: { [string]: number } = {}
for _, rule in GameConfig.GuaranteedRarities do
	nextGuaranteedAt[rule.Rarity] = Workspace:GetServerTimeNow() + rule.IntervalSeconds
end

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------

local function getLiveCharacter(player: Player): (BasePart?, Humanoid?)
	local character = player.Character
	if character == nil then
		return nil, nil
	end
	local rootPart = character:FindFirstChild("HumanoidRootPart")
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if rootPart == nil or not rootPart:IsA("BasePart") or humanoid == nil or humanoid.Health <= 0 then
		return nil, nil
	end
	return rootPart, humanoid
end

local function isPlayerNear(player: Player, position: Vector3): boolean
	local rootPart = getLiveCharacter(player)
	return rootPart ~= nil
		and (rootPart.Position - position).Magnitude <= GameConfig.PromptDistance + GameConfig.InteractionTolerance
end

local function isInsidePart(part: BasePart, position: Vector3): boolean
	local localPosition = part.CFrame:PointToObjectSpace(position)
	local halfSize = part.Size / 2
	return math.abs(localPosition.X) <= halfSize.X
		and math.abs(localPosition.Y) <= halfSize.Y
		and math.abs(localPosition.Z) <= halfSize.Z
end

local function isLocked(plot: Plot): boolean
	return Workspace:GetServerTimeNow() < plot.LockEndsAt
end

local function findFreeSlot(plot: Plot): number?
	for index = 1, #plot.Slots do
		if plot.Occupants[index] == nil and not plot.Reserved[index] then
			return index
		end
	end
	return nil
end

local function getSlotCFrame(plot: Plot, slotIndex: number): CFrame
	local slot = plot.Slots[slotIndex]
	local top = slot.Position + Vector3.new(0, slot.Size.Y / 2, 0)
	return CFrame.new(top) * plot.Floor.CFrame.Rotation
end

local function mutationMultiplier(mutation: Mutation?): number
	return if mutation then mutation.Multiplier else 1
end

local function priceOf(definition: Definition, mutation: Mutation?): number
	return math.floor(definition.Price * mutationMultiplier(mutation))
end

local function incomeOf(definition: Definition, mutation: Mutation?): number
	return definition.IncomePerSecond * mutationMultiplier(mutation)
end

local function fullName(definition: Definition, mutation: Mutation?): string
	return if mutation then mutation.Name .. " " .. definition.DisplayName else definition.DisplayName
end

local function getBrainrotIds(plot: Plot): { string }
	local brainrotIds: { string } = {}
	for index = 1, #plot.Slots do
		local occupant = plot.Occupants[index]
		if occupant then
			local mutation = occupant.Mutation
			table.insert(brainrotIds, BrainrotConfig.encode(occupant.Definition.Id, if mutation then mutation.Name else nil))
		end
	end
	return brainrotIds
end

local function saveBrainrots(plot: Plot): boolean
	local owner = plot.Owner
	if owner == nil then
		return false
	end
	return setBrainrotsFunction:Invoke(owner, getBrainrotIds(plot)) == true
end

local function restoreWalkSpeed(player: Player)
	local _, humanoid = getLiveCharacter(player)
	if humanoid then
		humanoid.WalkSpeed = GameConfig.DefaultWalkSpeed
	end
end

--------------------------------------------------------------------------------
-- Brainrot visuals
--------------------------------------------------------------------------------

local function addBodyPart(
	model: Model,
	root: BasePart,
	name: string,
	shape: Enum.PartType,
	size: Vector3,
	offset: Vector3,
	color: Color3,
	material: Enum.Material
): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Shape = shape
	part.Size = size
	part.Color = color
	part.Material = material
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.CFrame = root.CFrame * CFrame.new(offset)
	part.Anchored = false
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Massless = true

	local weld = Instance.new("WeldConstraint")
	weld.Part0 = root
	weld.Part1 = part
	weld.Parent = part

	part.Parent = model
	return part
end

local function buildFigure(model: Model, root: BasePart, definition: Definition, glowColor: Color3?): number
	local s = definition.Scale
	local bodySize = if definition.BodyShape == "Ball" then Vector3.one * 2.8 * s else Vector3.new(2.6, 2.6, 2.2) * s
	local bodyShape = if definition.BodyShape == "Ball" then Enum.PartType.Ball else Enum.PartType.Block
	local white = Color3.new(1, 1, 1)
	local black = Color3.new(0.1, 0.1, 0.1)

	local body = addBodyPart(model, root, "Body", bodyShape, bodySize, Vector3.new(0, 1.5 * s, 0), definition.BodyColor, Enum.Material.SmoothPlastic)
	addBodyPart(model, root, "Head", Enum.PartType.Ball, Vector3.one * 2.1 * s, Vector3.new(0, 3.7 * s, 0), definition.BodyColor, Enum.Material.SmoothPlastic)
	for _, side in { -1, 1 } do
		addBodyPart(model, root, "Eye", Enum.PartType.Ball, Vector3.one * 0.7 * s, Vector3.new(0.45 * side * s, 3.85 * s, -0.8 * s), white, Enum.Material.SmoothPlastic)
		addBodyPart(model, root, "Pupil", Enum.PartType.Ball, Vector3.one * 0.35 * s, Vector3.new(0.45 * side * s, 3.85 * s, -1.1 * s), black, Enum.Material.SmoothPlastic)
		addBodyPart(model, root, "Foot", Enum.PartType.Block, Vector3.new(0.8, 0.5, 1) * s, Vector3.new(0.6 * side * s, 0.25 * s, 0), definition.AccentColor, Enum.Material.SmoothPlastic)
	end
	addBodyPart(model, root, "Hat", Enum.PartType.Block, Vector3.new(1.3, 0.6, 1.3) * s, Vector3.new(0, 4.85 * s, 0), definition.AccentColor, Enum.Material.SmoothPlastic)

	if glowColor then
		local light = Instance.new("PointLight")
		light.Color = glowColor
		light.Range = 12
		light.Brightness = 2
		light.Parent = body
	end

	return FIGURE_HEIGHT * s
end

-- Scales a model imported into ReplicatedStorage.BrainrotModels to the
-- brainrot's height and stands it on the root (the brainrot's feet).
local function buildCustomModel(model: Model, root: BasePart, template: Model, targetHeight: number): number
	local clone = template:Clone()
	local _, originalSize = clone:GetBoundingBox()
	if originalSize.Y > 0 then
		clone:ScaleTo(clone:GetScale() * targetHeight / originalSize.Y)
	end
	local boxCFrame, boxSize = clone:GetBoundingBox()
	local feet = boxCFrame.Position - Vector3.new(0, boxSize.Y / 2, 0)
	clone:PivotTo(clone:GetPivot() + (root.Position - feet))
	for _, descendant in clone:GetDescendants() do
		if descendant:IsA("BasePart") then
			descendant.Anchored = false
			descendant.CanCollide = false
			descendant.CanQuery = false
			descendant.CanTouch = false
			descendant.Massless = true
			local weld = Instance.new("WeldConstraint")
			weld.Part0 = root
			weld.Part1 = descendant
			weld.Parent = descendant
		end
	end
	clone.Parent = model
	return boxSize.Y
end

local RAINBOW = ColorSequence.new({
	ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 70, 70)),
	ColorSequenceKeypoint.new(0.2, Color3.fromRGB(255, 190, 40)),
	ColorSequenceKeypoint.new(0.4, Color3.fromRGB(90, 255, 90)),
	ColorSequenceKeypoint.new(0.6, Color3.fromRGB(60, 200, 255)),
	ColorSequenceKeypoint.new(0.8, Color3.fromRGB(150, 90, 255)),
	ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 80, 200)),
})

local function addInfoLabel(parent: Instance, text: string, color: Color3, textSize: number, order: number, rainbow: boolean?)
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.new(1, 0, 0, textSize + 6)
	label.Font = Enum.Font.FredokaOne
	label.Text = text
	label.TextColor3 = if rainbow then Color3.new(1, 1, 1) else color
	label.TextSize = textSize
	label.LayoutOrder = order

	local outline = Instance.new("UIStroke")
	outline.Color = Color3.new(0, 0, 0)
	outline.Thickness = 2
	outline.Parent = label

	if rainbow then
		local gradient = Instance.new("UIGradient")
		gradient.Color = RAINBOW
		gradient.Parent = label
	end
	label.Parent = parent
end

local function buildBrainrot(definition: Definition, mutation: Mutation?, price: number?): Visual
	local rarity = BrainrotConfig.RarityByName[definition.Rarity]

	local model = Instance.new("Model")
	model.Name = definition.Id

	local root = Instance.new("Part")
	root.Name = "Root"
	root.Size = Vector3.one
	root.Transparency = 1
	root.Anchored = true
	root.CanCollide = false
	root.CanQuery = false
	root.CanTouch = false
	root.Massless = true
	root.CFrame = CFrame.identity
	root.Parent = model
	model.PrimaryPart = root

	local customModels = ReplicatedStorage:FindFirstChild("BrainrotModels")
	local template = if customModels then customModels:FindFirstChild(definition.Id) else nil
	local hasCustomModel = template ~= nil and template:IsA("Model")
	local height = if template and template:IsA("Model")
		then buildCustomModel(model, root, template, FIGURE_HEIGHT * definition.Scale)
		else buildFigure(model, root, definition, if rarity and rarity.Glow then rarity.Color else nil)

	-- Tells BrainrotVisuals on each client which 3D model to show, how tall,
	-- which effects to add and how to animate it (State).
	model:SetAttribute("BrainrotId", definition.Id)
	model:SetAttribute("FigureHeight", height)
	model:SetAttribute("CustomModel", hasCustomModel)
	model:SetAttribute("Rarity", definition.Rarity)
	model:SetAttribute("Mutation", if mutation then mutation.Name else nil)
	model:SetAttribute("Price", price)
	model:SetAttribute("State", "Idle")

	local promptAttachment = Instance.new("Attachment")
	promptAttachment.Name = "PromptAttachment"
	promptAttachment.Position = Vector3.new(0, height * 0.5, 0)
	promptAttachment.Parent = root

	local billboard = Instance.new("BillboardGui")
	billboard.Name = "Info"
	billboard.Adornee = root
	billboard.Size = UDim2.fromOffset(260, 84 + (if price then 26 else 0) + (if mutation then 24 else 0))
	billboard.StudsOffsetWorldSpace = Vector3.new(0, height + 2.4, 0)
	billboard.MaxDistance = 90
	billboard.LightInfluence = 0

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
	layout.VerticalAlignment = Enum.VerticalAlignment.Bottom
	layout.Parent = billboard

	if mutation then
		addInfoLabel(billboard, mutation.Name, mutation.Color, 20, 0, mutation.Name == "Rainbow")
	end
	addInfoLabel(billboard, definition.DisplayName, Color3.new(1, 1, 1), 22, 1)
	addInfoLabel(billboard, definition.Rarity, if rarity then rarity.Color else Color3.new(1, 1, 1), 20, 2, definition.Rarity == "Mythic")
	addInfoLabel(billboard, NumberFormat.cash(incomeOf(definition, mutation)) .. "/s", Color3.fromRGB(255, 230, 70), 20, 3)
	if price then
		addInfoLabel(billboard, NumberFormat.cash(price), Color3.fromRGB(90, 255, 120), 22, 4)
	end
	billboard.Parent = root

	return { Model = model, Root = root, PromptAttachment = promptAttachment }
end

local function createPrompt(
	attachment: Attachment,
	kind: string,
	actionText: string,
	objectText: string,
	holdDuration: number,
	keyCode: Enum.KeyCode,
	ownerUserId: number?
): ProximityPrompt
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = actionText
	prompt.ObjectText = objectText
	prompt.HoldDuration = holdDuration
	prompt.KeyboardKeyCode = keyCode
	prompt.MaxActivationDistance = GameConfig.PromptDistance
	prompt.RequiresLineOfSight = false
	prompt:SetAttribute("PromptKind", kind)
	prompt:SetAttribute("Carried", false)
	if ownerUserId then
		prompt:SetAttribute("OwnerUserId", ownerUserId)
	end
	prompt.Parent = attachment
	return prompt
end

--------------------------------------------------------------------------------
-- Occupants (brainrots standing in a base)
--------------------------------------------------------------------------------

local onStealTriggered: (occupant: Occupant, thief: Player) -> ()
local onSellTriggered: (occupant: Occupant, player: Player) -> ()

local function setOccupantCarried(occupant: Occupant, carried: boolean)
	occupant.StealPrompt:SetAttribute("Carried", carried)
	occupant.SellPrompt:SetAttribute("Carried", carried)
end

local function stopWalking(occupant: Occupant)
	local walkTween = occupant.WalkTween
	if walkTween then
		walkTween:Cancel()
		occupant.WalkTween = nil
	end
end

local function placeOccupant(
	plot: Plot,
	slotIndex: number,
	definition: Definition,
	mutation: Mutation?,
	fromCFrame: CFrame?
): Occupant?
	local owner = plot.Owner
	if owner == nil or plot.Occupants[slotIndex] ~= nil then
		return nil
	end

	local visual = buildBrainrot(definition, mutation, nil)
	visual.Model.Parent = brainrotsFolder
	local targetCFrame = getSlotCFrame(plot, slotIndex)
	local refund = math.floor(priceOf(definition, mutation) * GameConfig.SellRefundFraction)
	local name = fullName(definition, mutation)

	local occupant: Occupant = {
		Definition = definition,
		Mutation = mutation,
		Plot = plot,
		SlotIndex = slotIndex,
		Model = visual.Model,
		Root = visual.Root,
		PromptAttachment = visual.PromptAttachment,
		StealPrompt = createPrompt(visual.PromptAttachment, "Steal", "Steal", name, GameConfig.StealHoldSeconds, Enum.KeyCode.E, owner.UserId),
		SellPrompt = createPrompt(visual.PromptAttachment, "Sell", "Sell for " .. NumberFormat.cash(refund), name, 0.5, Enum.KeyCode.F, owner.UserId),
		WalkTween = nil,
		Carrier = nil,
	}

	if fromCFrame then
		visual.Root.CFrame = fromCFrame
		local walkTween = TweenService:Create(
			visual.Root,
			TweenInfo.new(GameConfig.WalkToBaseSeconds, Enum.EasingStyle.Quad, Enum.EasingDirection.Out),
			{ CFrame = targetCFrame }
		)
		occupant.WalkTween = walkTween
		visual.Model:SetAttribute("State", "Walking")
		walkTween.Completed:Connect(function()
			if occupant.WalkTween == walkTween then
				occupant.WalkTween = nil
				if occupant.Carrier == nil then
					visual.Model:SetAttribute("State", "Idle")
				end
			end
		end)
		walkTween:Play()
	else
		visual.Root.CFrame = targetCFrame
	end

	occupant.StealPrompt.Triggered:Connect(function(player: Player)
		onStealTriggered(occupant, player)
	end)
	occupant.SellPrompt.Triggered:Connect(function(player: Player)
		onSellTriggered(occupant, player)
	end)

	plot.Occupants[slotIndex] = occupant
	return occupant
end

local function destroyOccupant(occupant: Occupant)
	stopWalking(occupant)
	occupant.Model:Destroy()
end

--------------------------------------------------------------------------------
-- Stealing
--------------------------------------------------------------------------------

local function endCarry(carry: Carry, message: string?)
	local thief = carry.Thief
	if carries[thief] == carry then
		carries[thief] = nil
	end
	carry.TargetPlot.Reserved[carry.TargetSlot] = nil
	restoreWalkSpeed(thief)

	local occupant = carry.Occupant
	occupant.Carrier = nil
	occupant.Root.Anchored = true
	carry.Weld:Destroy()

	local victimPlot = carry.VictimPlot
	if victimPlot.Occupants[occupant.SlotIndex] == occupant then
		occupant.Root.CFrame = getSlotCFrame(victimPlot, occupant.SlotIndex)
		occupant.Model:SetAttribute("State", "Idle")
		setOccupantCarried(occupant, false)
	else
		destroyOccupant(occupant)
	end

	if message then
		notify(thief, message, "Warning")
		local victim = victimPlot.Owner
		if victim then
			notify(victim, string.format("Your %s is back home.", fullName(occupant.Definition, occupant.Mutation)), "Success")
		end
	end
end

local function completeSteal(carry: Carry)
	local thief = carry.Thief
	local occupant = carry.Occupant
	local victimPlot = carry.VictimPlot
	local targetPlot = carry.TargetPlot
	local victim = victimPlot.Owner

	if victim == nil or targetPlot.Owner ~= thief or victimPlot.Occupants[occupant.SlotIndex] ~= occupant then
		endCarry(carry, nil)
		return
	end

	carries[thief] = nil
	targetPlot.Reserved[carry.TargetSlot] = nil
	restoreWalkSpeed(thief)

	-- Remove from the victim first: if the victim's data can no longer be
	-- written, the thief gets nothing rather than a duplicate.
	victimPlot.Occupants[occupant.SlotIndex] = nil
	destroyOccupant(occupant)
	if not saveBrainrots(victimPlot) then
		warn(string.format("%s Could not update %s's brainrots; steal cancelled.", LOG_PREFIX, victim.Name))
		return
	end

	placeOccupant(targetPlot, carry.TargetSlot, occupant.Definition, occupant.Mutation, nil)
	saveBrainrots(targetPlot)

	local name = fullName(occupant.Definition, occupant.Mutation)
	notify(thief, string.format("You stole %s!", name), "Success")
	notify(victim, string.format("%s stole your %s!", thief.DisplayName, name), "Error")
end

onStealTriggered = function(occupant: Occupant, thief: Player)
	local victimPlot = occupant.Plot
	local victim = victimPlot.Owner
	if victim == nil or victim == thief or occupant.Carrier ~= nil or victimPlot.Occupants[occupant.SlotIndex] ~= occupant then
		return
	end
	if carries[thief] then
		notify(thief, "You're already carrying a brainrot!", "Warning")
		return
	end
	local thiefPlot = plotByPlayer[thief]
	if thiefPlot == nil then
		notify(thief, "You need a base to steal.", "Error")
		return
	end
	local rootPart, humanoid = getLiveCharacter(thief)
	if rootPart == nil or humanoid == nil or not isPlayerNear(thief, occupant.PromptAttachment.WorldPosition) then
		return
	end
	local targetSlot = findFreeSlot(thiefPlot)
	if targetSlot == nil then
		notify(thief, "Your base is full! Sell a brainrot first.", "Error")
		return
	end

	thiefPlot.Reserved[targetSlot] = true
	stopWalking(occupant)
	occupant.Carrier = thief
	occupant.Model:SetAttribute("State", "Carried")
	setOccupantCarried(occupant, true)

	local root = occupant.Root
	root.CFrame = rootPart.CFrame * CFrame.new(0, CARRY_HEIGHT, 0)
	root.Anchored = false
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = rootPart
	weld.Part1 = root
	weld.Parent = root

	humanoid.WalkSpeed = GameConfig.CarryWalkSpeed
	carries[thief] = {
		Thief = thief,
		Occupant = occupant,
		VictimPlot = victimPlot,
		TargetPlot = thiefPlot,
		TargetSlot = targetSlot,
		StartedAt = os.clock(),
		LastPosition = rootPart.Position,
		LastCheckedAt = os.clock(),
		Weld = weld,
	}

	notify(thief, "Run it back to your base!", "Info")
	notify(victim, string.format("%s is stealing your %s! Catch them!", thief.DisplayName, fullName(occupant.Definition, occupant.Mutation)), "Warning")
end

onSellTriggered = function(occupant: Occupant, player: Player)
	local plot = occupant.Plot
	if plot.Owner ~= player or occupant.Carrier ~= nil or plot.Occupants[occupant.SlotIndex] ~= occupant then
		return
	end
	if not isPlayerNear(player, occupant.PromptAttachment.WorldPosition) then
		return
	end

	plot.Occupants[occupant.SlotIndex] = nil
	if not saveBrainrots(plot) then
		plot.Occupants[occupant.SlotIndex] = occupant
		return
	end
	destroyOccupant(occupant)

	local refund = math.floor(priceOf(occupant.Definition, occupant.Mutation) * GameConfig.SellRefundFraction)
	if refund > 0 then
		addCash(player, refund)
	end
	notify(player, string.format("Sold %s for %s", fullName(occupant.Definition, occupant.Mutation), NumberFormat.cash(refund)), "Success")
end

--------------------------------------------------------------------------------
-- Conveyor
--------------------------------------------------------------------------------

local function pickFromRarity(rarityName: string): Definition?
	local choices = BrainrotConfig.ByRarity[rarityName]
	if choices == nil or #choices == 0 then
		return nil
	end
	return choices[rng:NextInteger(1, #choices)]
end

local function resetGuaranteeTimer(rarityName: string)
	for _, rule in GameConfig.GuaranteedRarities do
		if rule.Rarity == rarityName then
			nextGuaranteedAt[rarityName] = Workspace:GetServerTimeNow() + rule.IntervalSeconds
		end
	end
end

local function rollDefinition(): Definition?
	-- A guaranteed spawn whose timer ran out wins over the random roll.
	local now = Workspace:GetServerTimeNow()
	for _, rule in GameConfig.GuaranteedRarities do
		if now >= (nextGuaranteedAt[rule.Rarity] or math.huge) then
			resetGuaranteeTimer(rule.Rarity)
			local guaranteed = pickFromRarity(rule.Rarity)
			if guaranteed then
				return guaranteed
			end
		end
	end

	local multiplier = tonumber(getServerRarityMultiplierFunction:Invoke()) or 1
	local commonRarity = BrainrotConfig.Rarities[1]

	local totalWeight = 0
	local weights: { number } = {}
	for index, rarity in BrainrotConfig.Rarities do
		local weight = 0
		if #BrainrotConfig.ByRarity[rarity.Name] > 0 then
			weight = if rarity == commonRarity then rarity.Weight else rarity.Weight * multiplier
		end
		weights[index] = weight
		totalWeight += weight
	end
	if totalWeight <= 0 then
		return nil
	end

	local roll = rng:NextNumber(0, totalWeight)
	for index, rarity in BrainrotConfig.Rarities do
		roll -= weights[index]
		if roll <= 0 and weights[index] > 0 then
			resetGuaranteeTimer(rarity.Name)
			return pickFromRarity(rarity.Name)
		end
	end
	return pickFromRarity(commonRarity.Name)
end

local function rollMutation(): Mutation?
	local roll = rng:NextNumber()
	for _, mutation in BrainrotConfig.Mutations do
		if roll < mutation.Chance then
			return mutation
		end
		roll -= mutation.Chance
	end
	return nil
end

local function removeConveyorItem(item: ConveyorItem)
	if conveyorItems[item] then
		conveyorItems[item] = nil
		conveyorItemCount -= 1
	end
	item.Tween:Cancel()
	item.Model:Destroy()
end

local function onBuyTriggered(item: ConveyorItem, player: Player)
	if item.Sold or not conveyorItems[item] then
		return
	end
	local plot = plotByPlayer[player]
	if plot == nil then
		notify(player, "You don't have a base yet.", "Error")
		return
	end
	if not isPlayerNear(player, item.PromptAttachment.WorldPosition) then
		return
	end
	local slotIndex = findFreeSlot(plot)
	if slotIndex == nil then
		notify(player, "Your base is full! Sell a brainrot first.", "Error")
		return
	end

	local definition = item.Definition
	local name = fullName(definition, item.Mutation)
	item.Sold = true
	plot.Reserved[slotIndex] = true
	local paid = spendCash(player, item.Price)
	plot.Reserved[slotIndex] = nil

	if not paid then
		item.Sold = false
		notify(player, string.format("You need %s to buy %s.", NumberFormat.cash(item.Price), name), "Error")
		return
	end
	if plot.Owner ~= player then
		addCash(player, item.Price)
		item.Sold = false
		return
	end

	local fromCFrame = item.Root.CFrame
	removeConveyorItem(item)
	placeOccupant(plot, slotIndex, definition, item.Mutation, fromCFrame)
	saveBrainrots(plot)
	notify(player, string.format("You bought %s!", name), "Success")
end

local function spawnConveyorBrainrot()
	local definition = rollDefinition()
	if definition == nil then
		return
	end
	local mutation = rollMutation()
	local price = priceOf(definition, mutation)

	local startPosition = conveyorStart.Position
	local endPosition = Vector3.new(conveyorEnd.Position.X, startPosition.Y, conveyorEnd.Position.Z)
	local direction = endPosition - startPosition
	if direction.Magnitude < 1 then
		return
	end
	local startCFrame = CFrame.lookAt(startPosition, endPosition)
	local endCFrame = startCFrame + direction

	local visual = buildBrainrot(definition, mutation, price)
	visual.Model:SetAttribute("State", "Conveyor")
	visual.Root.CFrame = startCFrame
	visual.Model.Parent = brainrotsFolder

	local tween = TweenService:Create(
		visual.Root,
		TweenInfo.new(direction.Magnitude / GameConfig.ConveyorSpeedStudsPerSecond, Enum.EasingStyle.Linear),
		{ CFrame = endCFrame }
	)

	local item: ConveyorItem = {
		Definition = definition,
		Mutation = mutation,
		Price = price,
		Model = visual.Model,
		Root = visual.Root,
		PromptAttachment = visual.PromptAttachment,
		Tween = tween,
		Sold = false,
	}
	conveyorItems[item] = true
	conveyorItemCount += 1

	local prompt = createPrompt(
		visual.PromptAttachment,
		"Buy",
		"Buy " .. NumberFormat.cash(price),
		fullName(definition, mutation),
		0,
		Enum.KeyCode.E,
		nil
	)
	prompt.Triggered:Connect(function(player: Player)
		onBuyTriggered(item, player)
	end)
	tween.Completed:Connect(function(playbackState: Enum.PlaybackState)
		if playbackState == Enum.PlaybackState.Completed and conveyorItems[item] then
			removeConveyorItem(item)
		end
	end)
	tween:Play()
end

--------------------------------------------------------------------------------
-- Plots
--------------------------------------------------------------------------------

local function setLasersActive(plot: Plot, active: boolean)
	for _, laser in plot.Lasers do
		laser.Transparency = if active then 0.1 else 1
	end
end

local function updatePlotLabels(plot: Plot)
	local owner = plot.Owner
	if owner == nil then
		plot.SignTitle.Text = "Empty Base"
		plot.SignSubtitle.Text = ""
		plot.LockLabel.Text = ""
		return
	end
	plot.SignTitle.Text = owner.DisplayName .. "'s Base"
	plot.SignSubtitle.Text = NumberFormat.cash(tonumber(owner:GetAttribute("IncomePerSecond")) or 0) .. "/s"
	if isLocked(plot) then
		plot.LockLabel.Text = "LOCKED " .. NumberFormat.duration(plot.LockEndsAt - Workspace:GetServerTimeNow())
	else
		plot.LockLabel.Text = "STEP HERE TO LOCK"
	end
end

local function onLockButtonTouched(plot: Plot, hit: BasePart)
	local owner = plot.Owner
	local character = if owner then owner.Character else nil
	if owner == nil or character == nil or not hit:IsDescendantOf(character) or isLocked(plot) then
		return
	end
	plot.LockEndsAt = Workspace:GetServerTimeNow() + GameConfig.LockDurationSeconds
	plot.Model:SetAttribute("LockEndsAt", plot.LockEndsAt)
	setLasersActive(plot, true)
	updatePlotLabels(plot)
	notify(owner, string.format("Base locked for %d seconds!", GameConfig.LockDurationSeconds), "Success")
end

local function createSign(plot: Plot, sign: BasePart): (TextLabel, TextLabel)
	local surfaceGui = Instance.new("SurfaceGui")
	surfaceGui.Name = "SignGui"
	surfaceGui.Face = Enum.NormalId.Front
	surfaceGui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	surfaceGui.PixelsPerStud = 40
	surfaceGui.LightInfluence = 0

	local title = Instance.new("TextLabel")
	title.Name = "Title"
	title.BackgroundTransparency = 1
	title.Size = UDim2.fromScale(1, 0.62)
	title.Font = Enum.Font.FredokaOne
	title.TextScaled = true
	title.TextColor3 = Color3.new(1, 1, 1)
	title.TextStrokeTransparency = 0.3
	title.Parent = surfaceGui

	local subtitle = Instance.new("TextLabel")
	subtitle.Name = "Subtitle"
	subtitle.BackgroundTransparency = 1
	subtitle.Position = UDim2.fromScale(0, 0.6)
	subtitle.Size = UDim2.fromScale(1, 0.36)
	subtitle.Font = Enum.Font.FredokaOne
	subtitle.TextScaled = true
	subtitle.TextColor3 = Color3.fromRGB(90, 255, 120)
	subtitle.TextStrokeTransparency = 0.3
	subtitle.Parent = surfaceGui

	surfaceGui.Parent = sign
	return title, subtitle
end

local function createLockLabel(lockButton: BasePart): TextLabel
	local billboard = Instance.new("BillboardGui")
	billboard.Name = "LockGui"
	billboard.Adornee = lockButton
	billboard.Size = UDim2.fromOffset(200, 40)
	billboard.StudsOffsetWorldSpace = Vector3.new(0, 3, 0)
	billboard.MaxDistance = 60
	billboard.LightInfluence = 0

	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = Color3.fromRGB(255, 90, 90)
	label.TextStrokeTransparency = 0.2
	label.Parent = billboard

	billboard.Parent = lockButton
	return label
end

local function findPart(parent: Instance, name: string): BasePart?
	local child = parent:FindFirstChild(name)
	if child and child:IsA("BasePart") then
		return child
	end
	return nil
end

local function collectNumberedParts(folder: Instance?, prefix: string): { BasePart }
	local parts: { BasePart } = {}
	if folder == nil then
		return parts
	end
	local numbered: { { number: number, part: BasePart } } = {}
	for _, child in folder:GetChildren() do
		local suffix = string.match(child.Name, "^" .. prefix .. "(%d+)$")
		if suffix and child:IsA("BasePart") then
			table.insert(numbered, { number = tonumber(suffix) :: number, part = child })
		end
	end
	table.sort(numbered, function(a, b)
		return a.number < b.number
	end)
	for _, entry in numbered do
		table.insert(parts, entry.part)
	end
	return parts
end

local function loadPlot(model: Instance, index: number): Plot?
	if not model:IsA("Model") then
		return nil
	end
	local floor = findPart(model, "Floor")
	local interior = findPart(model, "Interior")
	local laserZone = findPart(model, "LaserZone")
	local lockButton = findPart(model, "LockButton")
	local spawnPoint = findPart(model, "SpawnPoint")
	local sign = findPart(model, "Sign")
	local slots = collectNumberedParts(model:FindFirstChild("Slots"), "Slot")
	local lasers = collectNumberedParts(model:FindFirstChild("Lasers"), "Laser")
	if floor == nil or interior == nil or laserZone == nil or lockButton == nil or spawnPoint == nil or sign == nil or #slots == 0 then
		warn(string.format("%s %s is missing parts and was skipped.", LOG_PREFIX, model:GetFullName()))
		return nil
	end

	local plot: Plot = {
		Index = index,
		Model = model,
		Floor = floor,
		Interior = interior,
		LaserZone = laserZone,
		Lasers = lasers,
		SpawnPoint = spawnPoint,
		Slots = slots,
		Occupants = {},
		Reserved = {},
		Owner = nil,
		LockEndsAt = 0,
		IncomeRemainder = 0,
		SignTitle = nil :: any,
		SignSubtitle = nil :: any,
		LockLabel = createLockLabel(lockButton),
	}
	plot.SignTitle, plot.SignSubtitle = createSign(plot, sign)

	model:SetAttribute("OwnerUserId", 0)
	model:SetAttribute("LockEndsAt", 0)
	setLasersActive(plot, false)
	updatePlotLabels(plot)

	lockButton.Touched:Connect(function(hit: BasePart)
		onLockButtonTouched(plot, hit)
	end)
	return plot
end

local function teleportToPlot(player: Player)
	local plot = plotByPlayer[player]
	local character = player.Character
	if plot and character then
		character:PivotTo(plot.SpawnPoint.CFrame * CFrame.new(0, 4, 0))
	end
end

local function assignPlot(player: Player)
	if plotByPlayer[player] or player.Parent ~= Players then
		return
	end
	local plot: Plot? = nil
	for _, candidate in plots do
		if candidate.Owner == nil then
			plot = candidate
			break
		end
	end
	if plot == nil then
		notify(player, "Every base on this server is taken. Try another server!", "Error")
		return
	end

	plot.Owner = player
	plotByPlayer[player] = plot
	plot.IncomeRemainder = 0
	plot.Model:SetAttribute("OwnerUserId", player.UserId)

	local savedIds = getBrainrotsFunction:Invoke(player)
	local changed = false
	local nextSlot = 1
	if typeof(savedIds) == "table" then
		for _, entry in savedIds do
			local definition, mutation = nil, nil
			if typeof(entry) == "string" then
				definition, mutation = BrainrotConfig.decode(entry)
			end
			if definition and nextSlot <= #plot.Slots then
				placeOccupant(plot, nextSlot, definition, mutation, nil)
				nextSlot += 1
			else
				changed = true
			end
		end
	end

	-- A brand-new player gets one free brainrot so income starts right away.
	if nextSlot == 1 then
		local data = getPlayerData(player)
		local starter = BrainrotConfig.ById[GameConfig.StarterBrainrotId]
		if data and data.Cash == 0 and data.Rebirths == 0 and starter then
			placeOccupant(plot, 1, starter, nil, nil)
			changed = true
			notify(player, string.format("Welcome! Here's a free %s to get you started.", starter.DisplayName), "Success")
		end
	end
	if changed then
		saveBrainrots(plot)
	end

	updatePlotLabels(plot)
	teleportToPlot(player)
end

local function releasePlot(player: Player)
	local ownCarry = carries[player]
	if ownCarry then
		endCarry(ownCarry, nil)
	end

	local plot = plotByPlayer[player]
	if plot == nil then
		return
	end
	for _, carry in carries do
		if carry.VictimPlot == plot or carry.TargetPlot == plot then
			endCarry(carry, "The owner left, so the brainrot went back.")
		end
	end
	for _, occupant in plot.Occupants do
		destroyOccupant(occupant)
	end
	table.clear(plot.Occupants)
	table.clear(plot.Reserved)

	plotByPlayer[player] = nil
	plot.Owner = nil
	plot.LockEndsAt = 0
	plot.IncomeRemainder = 0
	plot.Model:SetAttribute("OwnerUserId", 0)
	plot.Model:SetAttribute("LockEndsAt", 0)
	setLasersActive(plot, false)
	updatePlotLabels(plot)
end

--------------------------------------------------------------------------------
-- Ticks
--------------------------------------------------------------------------------

local function getIncomeMultiplier(player: Player): number
	local data = getPlayerData(player)
	if data == nil then
		return 1
	end
	local rebirths = tonumber(data.Rebirths) or 0
	local passes = data.OwnedGamePasses
	local doubleCashId = MonetizationConfig.GamePasses.DoubleCash
	local hasDoubleCash = doubleCashId ~= nil and typeof(passes) == "table" and passes[tostring(doubleCashId)] == true
	return GameConfig.getRebirthIncomeMultiplier(rebirths)
		* (if hasDoubleCash then MonetizationConfig.DoubleCashIncomeMultiplier else 1)
end

-- Horizontal speed check for thieves, so a teleport can't carry a stolen
-- brainrot home. Vertical movement (jumps, falls) is ignored.
local function movedTooFast(carry: Carry, position: Vector3, clock: number): boolean
	local elapsed = clock - carry.LastCheckedAt
	local offset = position - carry.LastPosition
	local horizontalDistance = Vector3.new(offset.X, 0, offset.Z).Magnitude
	carry.LastPosition = position
	carry.LastCheckedAt = clock
	return horizontalDistance > GameConfig.CarryWalkSpeed * elapsed * 2 + GameConfig.CarrySpeedToleranceStuds
end

-- Runs every FAST_TICK_SECONDS: laser doors and brainrots being carried.
local function fastTick()
	for _, plot in plots do
		local owner = plot.Owner
		if owner and isLocked(plot) then
			for _, player in Players:GetPlayers() do
				if player ~= owner then
					local rootPart, humanoid = getLiveCharacter(player)
					if
						rootPart
						and humanoid
						and isInsidePart(plot.LaserZone, rootPart.Position)
						and isLaserBypassActiveFunction:Invoke(player) ~= true
					then
						humanoid.Health = 0
						notify(player, "Zapped by the laser door!", "Error")
					end
				end
			end
		end
	end

	for thief, carry in carries do
		local rootPart = getLiveCharacter(thief)
		local clock = os.clock()
		if rootPart == nil then
			endCarry(carry, "You dropped the brainrot!")
		elseif movedTooFast(carry, rootPart.Position, clock) then
			endCarry(carry, "You moved too fast and dropped the brainrot!")
		elseif isInsidePart(carry.TargetPlot.Interior, rootPart.Position) then
			completeSteal(carry)
		elseif clock - carry.StartedAt > GameConfig.CarryTimeoutSeconds then
			endCarry(carry, "You took too long and dropped the brainrot!")
		else
			local victim = carry.VictimPlot.Owner
			local victimRoot = if victim then getLiveCharacter(victim) else nil
			if victimRoot and (victimRoot.Position - rootPart.Position).Magnitude <= GameConfig.CatchDistance then
				endCarry(carry, "You got caught! The brainrot went back.")
			end
		end
	end
end

-- Runs every SLOW_TICK_SECONDS: income, lock timers and signs.
local spawnSignLabel: TextLabel? = nil
do
	local spawnSign = conveyorFolder:FindFirstChild("SpawnSign", true)
	if spawnSign and spawnSign:IsA("BasePart") then
		local surfaceGui = Instance.new("SurfaceGui")
		surfaceGui.Name = "SignGui"
		surfaceGui.Face = Enum.NormalId.Front
		surfaceGui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
		surfaceGui.PixelsPerStud = 40
		surfaceGui.LightInfluence = 0

		local label = Instance.new("TextLabel")
		label.BackgroundColor3 = Color3.fromRGB(20, 24, 40)
		label.Size = UDim2.fromScale(1, 1)
		label.Font = Enum.Font.FredokaOne
		label.RichText = true
		label.TextScaled = true
		label.TextColor3 = Color3.new(1, 1, 1)
		label.Parent = surfaceGui
		surfaceGui.Parent = spawnSign
		spawnSignLabel = label
	end
end

local function updateSpawnSign()
	local label = spawnSignLabel
	if label == nil then
		return
	end
	local now = Workspace:GetServerTimeNow()
	local lines: { string } = {}
	for index = #GameConfig.GuaranteedRarities, 1, -1 do
		local rule = GameConfig.GuaranteedRarities[index]
		local rarity = BrainrotConfig.RarityByName[rule.Rarity]
		local colour = if rarity then rarity.Color:ToHex() else "ffffff"
		table.insert(
			lines,
			string.format(
				'Guaranteed <font color="#%s">%s</font> in %s',
				colour,
				rule.Rarity,
				NumberFormat.duration((nextGuaranteedAt[rule.Rarity] or now) - now)
			)
		)
	end
	label.Text = table.concat(lines, "\n")
end

local function slowTick()
	local now = Workspace:GetServerTimeNow()
	for _, plot in plots do
		if plot.LockEndsAt > 0 and now >= plot.LockEndsAt then
			plot.LockEndsAt = 0
			plot.Model:SetAttribute("LockEndsAt", 0)
			setLasersActive(plot, false)
		end

		local owner = plot.Owner
		if owner then
			local baseIncome = 0
			for _, occupant in plot.Occupants do
				if occupant.Carrier == nil then
					baseIncome += incomeOf(occupant.Definition, occupant.Mutation)
				end
			end
			local incomePerSecond = baseIncome * getIncomeMultiplier(owner)
			owner:SetAttribute("IncomePerSecond", incomePerSecond)

			local amount = incomePerSecond * SLOW_TICK_SECONDS + plot.IncomeRemainder
			local whole = math.floor(amount)
			plot.IncomeRemainder = amount - whole
			if whole > 0 then
				addCash(owner, whole)
			end
		end
		updatePlotLabels(plot)
	end
	updateSpawnSign()
end

local function runLoop(intervalSeconds: number, name: string, callback: () -> ())
	task.spawn(function()
		while true do
			task.wait(intervalSeconds)
			xpcall(callback, function(err: any)
				warn(string.format("%s %s failed: %s", LOG_PREFIX, name, tostring(err)))
			end)
		end
	end)
end

--------------------------------------------------------------------------------
-- Rebirth
--------------------------------------------------------------------------------

requestRebirthFunction.OnServerInvoke = function(player: Player): (boolean, string)
	local now = os.clock()
	local last = lastRebirthRequest[player]
	if last and now - last < REBIRTH_REQUEST_COOLDOWN_SECONDS then
		return false, "Slow down!"
	end
	lastRebirthRequest[player] = now

	local data = getPlayerData(player)
	if data == nil then
		return false, "Your data is still loading."
	end
	local rebirths = tonumber(data.Rebirths) or 0
	local cash = tonumber(data.Cash) or 0
	local cost = GameConfig.getRebirthCost(rebirths)
	if cash < cost then
		return false, string.format("You need %s to rebirth.", NumberFormat.cash(cost))
	end

	-- Rebirthing resets Cash to 0 and keeps your brainrots.
	if not spendCash(player, cash) then
		return false, "Rebirth failed, try again."
	end
	addRebirthsFunction:Invoke(player, 1)

	local message = string.format(
		"Rebirth %d! Your income is now x%s.",
		rebirths + 1,
		tostring(GameConfig.getRebirthIncomeMultiplier(rebirths + 1))
	)
	for _, other in Players:GetPlayers() do
		if other ~= player then
			notify(other, string.format("%s just reached Rebirth %d!", player.DisplayName, rebirths + 1), "Info")
		end
	end
	return true, message
end

--------------------------------------------------------------------------------
-- Purchase announcements
--------------------------------------------------------------------------------

empLaserPurchasedEvent.Event:Connect(function(player: any, durationSeconds: any)
	if typeof(player) == "Instance" and player:IsA("Player") then
		notify(player, string.format("EMP active! Walk through laser doors for %d seconds.", tonumber(durationSeconds) or 0), "Success")
	end
end)

serverRarityBoostChangedEvent.Event:Connect(function(multiplier: any, _endsAt: any, purchaser: any)
	local boost = tonumber(multiplier) or 1
	if boost <= 1 or typeof(purchaser) ~= "Instance" or not purchaser:IsA("Player") then
		return
	end
	local message = string.format(
		"%s activated a x%s Rarity Boost for the whole server!",
		purchaser.DisplayName,
		tostring(boost)
	)
	for _, player in Players:GetPlayers() do
		notify(player, message, "Success")
	end
end)

--------------------------------------------------------------------------------
-- Player lifecycle
--------------------------------------------------------------------------------

local function onCharacterAdded(player: Player, character: Model)
	local rootPart = character:WaitForChild("HumanoidRootPart", 10)
	if rootPart and player.Character == character then
		task.defer(teleportToPlot, player)
	end
end

local function onPlayerAdded(player: Player)
	player.CharacterAdded:Connect(function(character: Model)
		onCharacterAdded(player, character)
	end)

	if player:GetAttribute("DataLoaded") == true then
		assignPlot(player)
		return
	end
	local connection: RBXScriptConnection? = nil
	connection = player:GetAttributeChangedSignal("DataLoaded"):Connect(function()
		if player:GetAttribute("DataLoaded") == true then
			if connection then
				connection:Disconnect()
			end
			assignPlot(player)
		end
	end)
end

local function onPlayerRemoving(player: Player)
	releasePlot(player)
	lastRebirthRequest[player] = nil
end

--------------------------------------------------------------------------------
-- Startup
--------------------------------------------------------------------------------

do
	local plotModels = plotsFolder:GetChildren()
	table.sort(plotModels, function(a, b)
		local aNumber = tonumber(string.match(a.Name, "%d+")) or math.huge
		local bNumber = tonumber(string.match(b.Name, "%d+")) or math.huge
		return aNumber < bNumber
	end)
	for _, model in plotModels do
		local plot = loadPlot(model, #plots + 1)
		if plot then
			table.insert(plots, plot)
		end
	end
	if #plots == 0 then
		warn(string.format("%s No usable plots found in %s.", LOG_PREFIX, plotsFolder:GetFullName()))
	end
end

Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(onPlayerRemoving)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

runLoop(FAST_TICK_SECONDS, "Fast tick", fastTick)
runLoop(SLOW_TICK_SECONDS, "Slow tick", slowTick)

task.spawn(function()
	while true do
		task.wait(GameConfig.ConveyorSpawnIntervalSeconds)
		if conveyorItemCount < GameConfig.MaxConveyorBrainrots then
			xpcall(spawnConveyorBrainrot, function(err: any)
				warn(string.format("%s Conveyor spawn failed: %s", LOG_PREFIX, tostring(err)))
			end)
		end
	end
end)

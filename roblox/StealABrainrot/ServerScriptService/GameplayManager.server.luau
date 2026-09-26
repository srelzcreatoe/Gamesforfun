--!strict
--[[
	GameplayManager
	Location: ServerScriptService (Script)

	Runs the Steal a Brainrot loop on the server:
	  * gives each player one of the bases in Workspace.Map.Plots
	  * spawns brainrots on the conveyor (rarer ones more often during a Server
	    Rarity Boost, one mutation far more often during a mutation event) that
	    players buy with Cash
	  * a bought brainrot walks from the conveyor to its buyer's base; until it
	    reaches the door, anyone else can buy it off them (the first buyer gets
	    their Cash back) and it turns around to walk to the new owner's base
	  * brainrots on their pedestals fill the collect pad in front of them with
	    Cash; the owner steps on the pad to collect it. Uncollected Cash is saved,
	    and brainrots keep earning while their owner is offline
	  * brainrots can be sold or stolen; a slapped thief drops what they carry
	  * each base has a laser door its owner can lock; the EMP Laser Overrider
	    lets its buyer walk through any locked door
	  * rebirths reset Cash (and the pads) for a permanent income bonus and open
	    the next floor of the base (4 floors of 8 pedestals)
	  * events every few minutes: mutation events (Gold Rush, Blood Moon, ...),
	    Taco Tuesday, Lucky Hour and Cash Rain (coins to collect)

	Every decision is made here. Clients only press ProximityPrompts and call the
	RequestRebirth remote, and each request is re-checked on the server
	(ownership, distance, Cash, free slots). Cash and saved data go through the
	DataAndMonetizationManager API in ServerStorage.

	Client-facing state:
	  ReplicatedStorage.Remotes.Notify (RemoteEvent, server -> client: message, kind, sound?)
	  ReplicatedStorage.Remotes.PlaySound (RemoteEvent, server -> client: sound)
	  ReplicatedStorage.Remotes.RequestRebirth (RemoteFunction)
	  Player attributes IncomePerSecond (number), Carrying (boolean)
	  Plot model attributes OwnerUserId (number, 0 = empty), LockEndsAt (server time)
	  ReplicatedStorage attributes EventName, EventMutation, EventEndsAt, EventSky,
	    EventParticles (the running event)
	  Workspace.Map.Coins (Cash Rain coins, attribute Spin for the client)
	  Brainrot model attributes BrainrotId, State, OwnerUserId, ...
	  ProximityPrompt attributes PromptKind ("Buy" | "Steal" | "Sell" | "Snipe"),
	    OwnerUserId, Carried, Walking, Snipeable (used by the client to hide
	    prompts that do not apply)

	Server API for other scripts (ServerStorage.Gameplay):
	  BindableEvent ForceDrop(player, message?)  makes a thief drop their brainrot
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
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
-- Walking brainrots walk beside the conveyor this far from the carpet's end.
local LANE_INSET = 3
-- The pad in front of a pedestal, and the walkway between pads and door.
local PAD_OFFSET = 5.5
local PAD_REACH = 1
-- How far from the stairs a walking brainrot steps off onto the floor above.
local STAIR_EXIT_OFFSET = 4.75

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
	PriceLabel: TextLabel?,
	OwnerLabel: TextLabel?,
}

type Pad = {
	Part: BasePart,
	Billboard: BillboardGui,
	Amount: TextLabel,
	Tag: TextLabel,
}

type Plot = {
	Index: number,
	Model: Model,
	Floor: BasePart,
	Interior: BasePart,
	LaserZone: BasePart,
	Carpet: BasePart?,
	Lasers: { BasePart },
	SpawnPoint: BasePart,
	Slots: { BasePart },
	Pads: { [number]: Pad },
	-- Uncollected Cash on each slot's pad (fractions carry over).
	PadCash: { number },
	OfflinePads: { [number]: boolean },
	Occupants: { [number]: Occupant },
	Reserved: { [number]: boolean },
	-- Stairs from floor N up to floor N + 1, and signs on locked floors.
	Stairs: { [number]: Stair },
	FloorSigns: { [number]: TextLabel },
	UnlockedFloors: number,
	Owner: Player?,
	LockEndsAt: number,
	SignTitle: TextLabel,
	SignSubtitle: TextLabel,
	LockLabel: TextLabel,
}

type Walk = {
	-- Where to walk; heights come from the ground under the brainrot.
	Points: { Vector3 },
	Index: number,
	-- Reaching this point means it walked through its owner's door.
	DoorIndex: number,
	Entered: boolean,
	Speed: number,
	Height: number,
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
	SnipePrompt: ProximityPrompt?,
	-- What its owner paid; the price for anyone buying it off them.
	Price: number,
	Walk: Walk?,
	Sniping: boolean,
	Carrier: Player?,
	PriceLabel: TextLabel?,
	OwnerLabel: TextLabel?,
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

type GameEvent = GameConfig.GameEvent

type Stair = { Bottom: Vector3, Top: Vector3 }

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
local addStealsFunction = getBindableFunction("AddSteals")
local getPlayerDataFunction = getBindableFunction("GetPlayerData")
local getBrainrotsFunction = getBindableFunction("GetBrainrots")
local setBrainrotsFunction = getBindableFunction("SetBrainrots")
local getPadCashFunction = getBindableFunction("GetPadCash")
local setPadCashFunction = getBindableFunction("SetPadCash")
local collectPadCashFunction = getBindableFunction("CollectPadCash")
local takeOfflineSecondsFunction = getBindableFunction("TakeOfflineSeconds")
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
-- Remotes and server API
--------------------------------------------------------------------------------

local remotesFolder = Instance.new("Folder")
remotesFolder.Name = "Remotes"

local notifyEvent = Instance.new("RemoteEvent")
notifyEvent.Name = "Notify"
notifyEvent.Parent = remotesFolder

local playSoundEvent = Instance.new("RemoteEvent")
playSoundEvent.Name = "PlaySound"
playSoundEvent.Parent = remotesFolder

local requestRebirthFunction = Instance.new("RemoteFunction")
requestRebirthFunction.Name = "RequestRebirth"
requestRebirthFunction.Parent = remotesFolder

remotesFolder.Parent = ReplicatedStorage

local gameplayApi = Instance.new("Folder")
gameplayApi.Name = "Gameplay"
local forceDropEvent = Instance.new("BindableEvent")
forceDropEvent.Name = "ForceDrop"
forceDropEvent.Parent = gameplayApi
gameplayApi.Parent = ServerStorage

-- `sound` names an entry in AudioConfig.Sounds for the client to play.
local function notify(player: Player, message: string, kind: NotifyKind, sound: string?)
	notifyEvent:FireClient(player, message, kind, sound)
end

local function playSound(player: Player, sound: string)
	playSoundEvent:FireClient(player, sound)
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
local walkers: { [Occupant]: boolean } = {}
local lastRebirthRequest: { [Player]: number } = {}
local rng = Random.new()
local nextGuaranteedAt: { [string]: number } = {}
for _, rule in GameConfig.GuaranteedRarities do
	nextGuaranteedAt[rule.Rarity] = Workspace:GetServerTimeNow() + rule.IntervalSeconds
end
local activeEvent: GameEvent? = nil
local coinsFolder = Instance.new("Folder")
coinsFolder.Name = "Coins"
coinsFolder.Parent = map

-- Walking brainrots follow the ground: the baseplate, the conveyor and the bases.
local groundParams = RaycastParams.new()
groundParams.FilterType = Enum.RaycastFilterType.Include
do
	local ground: { Instance } = { plotsFolder }
	local belt = conveyorFolder:FindFirstChild("Belt")
	if belt then
		table.insert(ground, belt)
	end
	local baseplate = Workspace:FindFirstChild("Baseplate")
	if baseplate then
		table.insert(ground, baseplate)
	end
	groundParams.FilterDescendantsInstances = ground
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

local function floorOf(slotIndex: number): number
	return (slotIndex - 1) // GameConfig.SlotsPerFloor + 1
end

-- Free pedestals are only handed out on floors the owner has opened.
local function findFreeSlot(plot: Plot): number?
	local limit = math.min(#plot.Slots, plot.UnlockedFloors * GameConfig.SlotsPerFloor)
	for index = 1, limit do
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

local function setCarrying(player: Player, carrying: boolean)
	local _, humanoid = getLiveCharacter(player)
	if humanoid then
		humanoid.WalkSpeed = if carrying then GameConfig.CarryWalkSpeed else GameConfig.DefaultWalkSpeed
	end
	-- GearManager listens to this to re-apply coils once the carry ends.
	player:SetAttribute("Carrying", carrying)
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

local function addInfoLabel(parent: Instance, text: string, color: Color3, textSize: number, order: number, rainbow: boolean?): TextLabel
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
	return label
end

-- `price` adds a price line (conveyor and walking brainrots); `ownerText` adds
-- a line saying whose base a walking brainrot is heading to.
local function buildBrainrot(definition: Definition, mutation: Mutation?, price: number?, ownerText: string?): Visual
	local rarity = BrainrotConfig.RarityByName[definition.Rarity]

	local model = Instance.new("Model")
	model.Name = definition.Id
	-- Streams in and out as a whole, so clients never see half a brainrot.
	model.ModelStreamingMode = Enum.ModelStreamingMode.Atomic

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
	model:SetAttribute("Motion", definition.Motion)
	model:SetAttribute("State", "Idle")

	local promptAttachment = Instance.new("Attachment")
	promptAttachment.Name = "PromptAttachment"
	promptAttachment.Position = Vector3.new(0, height * 0.5, 0)
	promptAttachment.Parent = root

	local billboard = Instance.new("BillboardGui")
	billboard.Name = "Info"
	billboard.Adornee = root
	billboard.Size = UDim2.fromOffset(
		260,
		84 + (if price then 26 else 0) + (if mutation then 24 else 0) + (if ownerText then 22 else 0)
	)
	billboard.StudsOffsetWorldSpace = Vector3.new(0, height + 2.4, 0)
	billboard.MaxDistance = 90
	billboard.LightInfluence = 0

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
	layout.VerticalAlignment = Enum.VerticalAlignment.Bottom
	layout.Parent = billboard

	local ownerLabel: TextLabel? = nil
	if ownerText then
		ownerLabel = addInfoLabel(billboard, ownerText, Color3.fromRGB(200, 230, 255), 16, -1)
	end
	if mutation then
		addInfoLabel(billboard, mutation.Name, mutation.Color, 20, 0, mutation.Name == "Rainbow")
	end
	addInfoLabel(billboard, definition.DisplayName, Color3.new(1, 1, 1), 22, 1)
	local rarityLabel = addInfoLabel(
		billboard,
		definition.Rarity,
		if rarity then rarity.Color else Color3.new(1, 1, 1),
		20,
		2,
		rarity ~= nil and rarity.Style == "Rainbow"
	)
	if rarity and rarity.Style == "Secret" then
		-- Black text with a white outline, like the original's Secrets.
		local outline = rarityLabel:FindFirstChildOfClass("UIStroke")
		if outline then
			outline.Color = Color3.new(1, 1, 1)
		end
	end
	addInfoLabel(billboard, NumberFormat.cash(incomeOf(definition, mutation)) .. "/s", Color3.fromRGB(255, 230, 70), 20, 3)
	local priceLabel: TextLabel? = nil
	if price then
		priceLabel = addInfoLabel(billboard, NumberFormat.cash(price), Color3.fromRGB(90, 255, 120), 22, 4)
	end
	billboard.Parent = root

	return {
		Model = model,
		Root = root,
		PromptAttachment = promptAttachment,
		PriceLabel = priceLabel,
		OwnerLabel = ownerLabel,
	}
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
	prompt:SetAttribute("Walking", false)
	if ownerUserId then
		prompt:SetAttribute("OwnerUserId", ownerUserId)
	end
	prompt.Parent = attachment
	return prompt
end

--------------------------------------------------------------------------------
-- Occupants (brainrots that belong to a base)
--------------------------------------------------------------------------------

local onStealTriggered: (occupant: Occupant, thief: Player) -> ()
local onSellTriggered: (occupant: Occupant, player: Player) -> ()
local onSnipeTriggered: (occupant: Occupant, player: Player) -> ()

local function ownerText(player: Player): string
	return "Walking to " .. player.DisplayName .. "'s base"
end

local function setOccupantCarried(occupant: Occupant, carried: boolean)
	occupant.StealPrompt:SetAttribute("Carried", carried)
	occupant.SellPrompt:SetAttribute("Carried", carried)
end

local function setOccupantOwner(occupant: Occupant, owner: Player)
	occupant.Model:SetAttribute("OwnerUserId", owner.UserId)
	occupant.StealPrompt:SetAttribute("OwnerUserId", owner.UserId)
	occupant.SellPrompt:SetAttribute("OwnerUserId", owner.UserId)
	local snipePrompt = occupant.SnipePrompt
	if snipePrompt then
		snipePrompt:SetAttribute("OwnerUserId", owner.UserId)
	end
	local ownerLabel = occupant.OwnerLabel
	if ownerLabel then
		ownerLabel.Text = ownerText(owner)
	end
end

-- Ends a walk right where the brainrot is (it stays in its base's list).
local function stopWalking(occupant: Occupant)
	occupant.Walk = nil
	walkers[occupant] = nil
end

-- Called when a walking brainrot reaches its pedestal.
local function finishWalk(occupant: Occupant)
	stopWalking(occupant)
	occupant.Root.CFrame = getSlotCFrame(occupant.Plot, occupant.SlotIndex)
	occupant.Model:SetAttribute("State", "Idle")
	occupant.StealPrompt:SetAttribute("Walking", false)
	occupant.SellPrompt:SetAttribute("Walking", false)
	local snipePrompt = occupant.SnipePrompt
	if snipePrompt then
		snipePrompt:Destroy()
		occupant.SnipePrompt = nil
	end
	local priceLabel = occupant.PriceLabel
	if priceLabel then
		priceLabel:Destroy()
	end
	local ownerLabel = occupant.OwnerLabel
	if ownerLabel then
		ownerLabel:Destroy()
	end
	occupant.PriceLabel = nil
	occupant.OwnerLabel = nil
end

-- The path from `from` to a pedestal: onto the walkway beside the conveyor,
-- along it to the base's carpet, up the carpet, through the door and past the
-- pads to the pedestal. Returns the points and the index of the door.
local function buildPath(plot: Plot, slotIndex: number, from: Vector3): ({ Vector3 }, number)
	local floorFrame = plot.Floor.CFrame
	local halfDepth = plot.Floor.Size.Z / 2
	local carpet = plot.Carpet
	local carpetLength = if carpet then carpet.Size.Z else 0
	local laneZ = -halfDepth - carpetLength + LANE_INSET
	local slotLocal = floorFrame:PointToObjectSpace(plot.Slots[slotIndex].Position)
	local fromLocal = floorFrame:PointToObjectSpace(from)
	local padZ = slotLocal.Z - PAD_OFFSET

	local points: { Vector3 } = {}
	local function add(x: number, z: number)
		table.insert(points, floorFrame:PointToWorldSpace(Vector3.new(x, 0, z)))
	end

	if fromLocal.Z < -halfDepth and math.abs(fromLocal.X) > 2 then
		-- Not on this base's carpet yet: walk beside the conveyor first.
		add(fromLocal.X, laneZ)
		add(0, laneZ)
	end
	add(0, -halfDepth - 1)
	local doorIndex = #points
	add(0, -halfDepth + 2)
	-- Upper floors: up each flight of stairs along the front wall, stepping
	-- off onto the floor above at the top.
	local aisleX = 0
	for floor = 1, floorOf(slotIndex) - 1 do
		local stair = plot.Stairs[floor]
		if stair then
			local bottom = floorFrame:PointToObjectSpace(stair.Bottom)
			local top = floorFrame:PointToObjectSpace(stair.Top)
			local exitZ = bottom.Z + STAIR_EXIT_OFFSET
			add(bottom.X, exitZ)
			add(bottom.X, bottom.Z)
			add(top.X, top.Z)
			add(top.X, exitZ)
			aisleX = top.X
		end
	end
	if aisleX ~= 0 then
		add(0, floorFrame:PointToObjectSpace(points[#points]).Z)
	end
	add(0, padZ)
	add(slotLocal.X, padZ)
	add(slotLocal.X, slotLocal.Z)
	return points, doorIndex
end

local function pathLength(from: Vector3, points: { Vector3 }): number
	local length = 0
	local last = from
	for _, point in points do
		local offset = point - last
		length += Vector3.new(offset.X, 0, offset.Z).Magnitude
		last = point
	end
	return length
end

local function startWalk(occupant: Occupant, from: Vector3)
	local points, doorIndex = buildPath(occupant.Plot, occupant.SlotIndex, from)
	local length = pathLength(from, points)
	occupant.Walk = {
		Points = points,
		Index = 1,
		DoorIndex = doorIndex,
		Entered = false,
		Speed = math.max(GameConfig.BrainrotWalkSpeed, length / GameConfig.MaxWalkSeconds),
		Height = from.Y,
	}
	walkers[occupant] = true
	occupant.Model:SetAttribute("State", "Walking")
	occupant.StealPrompt:SetAttribute("Walking", true)
	occupant.SellPrompt:SetAttribute("Walking", true)
	local snipePrompt = occupant.SnipePrompt
	if snipePrompt then
		snipePrompt:SetAttribute("Snipeable", true)
	end
end

local function groundHeightAt(position: Vector3, height: number): number?
	local result = Workspace:Raycast(Vector3.new(position.X, height + 4, position.Z), Vector3.new(0, -14, 0), groundParams)
	return if result then result.Position.Y else nil
end

-- Moves every walking brainrot a frame further along its path.
local function stepWalkers(dt: number)
	for occupant in walkers do
		local walk = occupant.Walk
		if walk == nil or occupant.Model.Parent == nil then
			walkers[occupant] = nil
			continue
		end
		local root = occupant.Root
		local position = root.Position
		local remaining = walk.Speed * dt
		while remaining > 0 do
			local target: Vector3? = walk.Points[walk.Index]
			if not target then
				break
			end
			local flat = Vector3.new(target.X - position.X, 0, target.Z - position.Z)
			local distance = flat.Magnitude
			if distance <= remaining then
				position = Vector3.new(target.X, position.Y, target.Z)
				remaining -= distance
				if walk.Index == walk.DoorIndex and not walk.Entered then
					-- Through the door: it's safe in its owner's base now.
					walk.Entered = true
					local snipePrompt = occupant.SnipePrompt
					if snipePrompt then
						snipePrompt:SetAttribute("Snipeable", false)
					end
				end
				walk.Index += 1
			else
				position += flat.Unit * remaining
				remaining = 0
			end
		end

		if walk.Index > #walk.Points then
			finishWalk(occupant)
			continue
		end

		local ground = groundHeightAt(position, walk.Height)
		if ground then
			walk.Height += (ground - walk.Height) * math.min(1, dt * 12)
		end
		local standing = Vector3.new(position.X, walk.Height, position.Z)
		local target = walk.Points[walk.Index]
		local facing = Vector3.new(target.X - standing.X, 0, target.Z - standing.Z)
		local rotation = root.CFrame.Rotation
		if facing.Magnitude > 0.05 then
			rotation = rotation:Lerp(CFrame.lookAt(Vector3.zero, facing), math.min(1, dt * 10))
		end
		root.CFrame = CFrame.new(standing) * rotation
	end
end

-- Puts a brainrot in a base. With `walkFrom` it walks there from that
-- position (and can be bought off its owner until it reaches the door).
local function placeOccupant(
	plot: Plot,
	slotIndex: number,
	definition: Definition,
	mutation: Mutation?,
	walkFrom: CFrame?,
	price: number?
): Occupant?
	local owner = plot.Owner
	if owner == nil or plot.Occupants[slotIndex] ~= nil then
		return nil
	end

	local paid = price or priceOf(definition, mutation)
	local visual = buildBrainrot(
		definition,
		mutation,
		if walkFrom then paid else nil,
		if walkFrom then ownerText(owner) else nil
	)
	visual.Model:SetAttribute("OwnerUserId", owner.UserId)
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
		SnipePrompt = nil,
		Price = paid,
		Walk = nil,
		Sniping = false,
		Carrier = nil,
		PriceLabel = visual.PriceLabel,
		OwnerLabel = visual.OwnerLabel,
	}

	occupant.StealPrompt.Triggered:Connect(function(player: Player)
		onStealTriggered(occupant, player)
	end)
	occupant.SellPrompt.Triggered:Connect(function(player: Player)
		onSellTriggered(occupant, player)
	end)

	if walkFrom then
		local snipePrompt = createPrompt(visual.PromptAttachment, "Snipe", "Buy " .. NumberFormat.cash(paid), name, 0, Enum.KeyCode.E, owner.UserId)
		snipePrompt:SetAttribute("Snipeable", false)
		snipePrompt.Triggered:Connect(function(player: Player)
			onSnipeTriggered(occupant, player)
		end)
		occupant.SnipePrompt = snipePrompt
		visual.Root.CFrame = walkFrom
		startWalk(occupant, walkFrom.Position)
	else
		visual.Root.CFrame = getSlotCFrame(plot, slotIndex)
	end

	plot.Occupants[slotIndex] = occupant
	visual.Model.Parent = brainrotsFolder
	return occupant
end

local function destroyOccupant(occupant: Occupant)
	stopWalking(occupant)
	occupant.Model:Destroy()
end

--------------------------------------------------------------------------------
-- Buying a walking brainrot off its buyer
--------------------------------------------------------------------------------

onSnipeTriggered = function(occupant: Occupant, sniper: Player)
	local walk = occupant.Walk
	local ownerPlot = occupant.Plot
	local owner = ownerPlot.Owner
	if walk == nil or walk.Entered or occupant.Sniping or owner == nil or owner == sniper then
		return
	end
	if ownerPlot.Occupants[occupant.SlotIndex] ~= occupant then
		return
	end
	local sniperPlot = plotByPlayer[sniper]
	if sniperPlot == nil then
		notify(sniper, "You don't have a base yet.", "Error")
		return
	end
	if not isPlayerNear(sniper, occupant.PromptAttachment.WorldPosition) then
		return
	end
	local slotIndex = findFreeSlot(sniperPlot)
	if slotIndex == nil then
		notify(sniper, "Your base is full! Sell a brainrot first.", "Error")
		return
	end

	local price = occupant.Price
	local name = fullName(occupant.Definition, occupant.Mutation)
	occupant.Sniping = true
	sniperPlot.Reserved[slotIndex] = true
	local paid = spendCash(sniper, price)
	sniperPlot.Reserved[slotIndex] = nil
	occupant.Sniping = false
	if not paid then
		notify(sniper, string.format("You need %s to buy %s.", NumberFormat.cash(price), name), "Error")
		return
	end

	-- Anything could have changed while paying: if so, give the Cash back.
	local currentWalk = occupant.Walk
	if
		currentWalk == nil
		or currentWalk.Entered
		or occupant.Plot ~= ownerPlot
		or ownerPlot.Owner ~= owner
		or ownerPlot.Occupants[occupant.SlotIndex] ~= occupant
		or sniperPlot.Owner ~= sniper
		or sniperPlot.Occupants[slotIndex] ~= nil
	then
		addCash(sniper, price)
		return
	end

	ownerPlot.Occupants[occupant.SlotIndex] = nil
	if not saveBrainrots(ownerPlot) then
		ownerPlot.Occupants[occupant.SlotIndex] = occupant
		addCash(sniper, price)
		return
	end
	addCash(owner, price)

	occupant.Plot = sniperPlot
	occupant.SlotIndex = slotIndex
	sniperPlot.Occupants[slotIndex] = occupant
	saveBrainrots(sniperPlot)
	setOccupantOwner(occupant, sniper)
	startWalk(occupant, occupant.Root.Position)

	notify(sniper, string.format("You bought %s off %s!", name, owner.DisplayName), "Success", "Purchase")
	notify(
		owner,
		string.format("%s bought your %s before it got home! You got %s back.", sniper.DisplayName, name, NumberFormat.cash(price)),
		"Error",
		"Sniped"
	)
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
	setCarrying(thief, false)

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
			notify(victim, string.format("Your %s is back home.", fullName(occupant.Definition, occupant.Mutation)), "Success", "Returned")
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
	setCarrying(thief, false)

	-- Remove from the victim first: if the victim's data can no longer be
	-- written, the thief gets nothing rather than a duplicate.
	victimPlot.Occupants[occupant.SlotIndex] = nil
	destroyOccupant(occupant)
	if not saveBrainrots(victimPlot) then
		warn(string.format("%s Could not update %s's brainrots; steal cancelled.", LOG_PREFIX, victim.Name))
		return
	end

	placeOccupant(targetPlot, carry.TargetSlot, occupant.Definition, occupant.Mutation, nil, occupant.Price)
	saveBrainrots(targetPlot)
	addStealsFunction:Invoke(thief, 1)

	local name = fullName(occupant.Definition, occupant.Mutation)
	notify(thief, string.format("You stole %s!", name), "Success", "StealSuccess")
	notify(victim, string.format("%s stole your %s!", thief.DisplayName, name), "Error", "Stolen")
end

onStealTriggered = function(occupant: Occupant, thief: Player)
	local victimPlot = occupant.Plot
	local victim = victimPlot.Owner
	if victim == nil or victim == thief or occupant.Carrier ~= nil or occupant.Walk ~= nil then
		return
	end
	if victimPlot.Occupants[occupant.SlotIndex] ~= occupant then
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
	setCarrying(thief, true)

	notify(thief, "Run it back to your base!", "Info", "Grab")
	notify(victim, string.format("%s is stealing your %s! Catch them!", thief.DisplayName, fullName(occupant.Definition, occupant.Mutation)), "Warning", "Alarm")
end

onSellTriggered = function(occupant: Occupant, player: Player)
	local plot = occupant.Plot
	if plot.Owner ~= player or occupant.Carrier ~= nil or occupant.Walk ~= nil or plot.Occupants[occupant.SlotIndex] ~= occupant then
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
	notify(player, string.format("Sold %s for %s", fullName(occupant.Definition, occupant.Mutation), NumberFormat.cash(refund)), "Success", "Sell")
end

forceDropEvent.Event:Connect(function(playerArg: any, message: any)
	if typeof(playerArg) ~= "Instance" or not playerArg:IsA("Player") then
		return
	end
	local carry = carries[playerArg]
	if carry then
		endCarry(carry, if typeof(message) == "string" then message else "You dropped the brainrot!")
	end
end)

--------------------------------------------------------------------------------
-- Conveyor
--------------------------------------------------------------------------------

local function pickFromRarity(rarityName: string): Definition?
	local choices = BrainrotConfig.ByRarity[rarityName]
	if choices == nil or #choices == 0 then
		return nil
	end
	-- Events like Taco Tuesday make brainrots with a tag more likely.
	local event = activeEvent
	local boost = if event then event.TagBoost else nil
	if boost == nil then
		return choices[rng:NextInteger(1, #choices)]
	end
	local total = 0
	for _, definition in choices do
		total += if BrainrotConfig.hasTag(definition, boost.Tag) then boost.Multiplier else 1
	end
	local roll = rng:NextNumber(0, total)
	for _, definition in choices do
		roll -= if BrainrotConfig.hasTag(definition, boost.Tag) then boost.Multiplier else 1
		if roll <= 0 then
			return definition
		end
	end
	return choices[#choices]
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

	local event = activeEvent
	local multiplier = (tonumber(getServerRarityMultiplierFunction:Invoke()) or 1) * (if event and event.Luck then event.Luck else 1)
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

local function mutationChance(mutation: Mutation): number
	local event = activeEvent
	if event and event.Mutation == mutation.Name then
		-- Event-only mutations get the event's own chance.
		if event.MutationChance then
			return event.MutationChance
		end
		return mutation.Chance * (event.ChanceMultiplier or 1)
	end
	return mutation.Chance
end

local function rollMutation(): Mutation?
	local roll = rng:NextNumber()
	for _, mutation in BrainrotConfig.Mutations do
		local chance = mutationChance(mutation)
		if roll < chance then
			return mutation
		end
		roll -= chance
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
	placeOccupant(plot, slotIndex, definition, item.Mutation, fromCFrame, item.Price)
	saveBrainrots(plot)
	notify(player, string.format("You bought %s! It's walking to your base.", name), "Success", "Purchase")
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

	local visual = buildBrainrot(definition, mutation, price, nil)
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
-- Collect pads
--------------------------------------------------------------------------------

local function padCashList(plot: Plot): { number }
	local list: { number } = table.create(#plot.Slots)
	for index = 1, #plot.Slots do
		list[index] = math.floor(plot.PadCash[index] or 0)
	end
	return list
end

local function updatePadLabel(plot: Plot, index: number)
	local pad = plot.Pads[index]
	if pad == nil then
		return
	end
	local amount = math.floor(plot.PadCash[index] or 0)
	pad.Billboard.Enabled = plot.Owner ~= nil and (amount > 0 or plot.Occupants[index] ~= nil)
	pad.Amount.Text = NumberFormat.cash(amount)
	pad.Tag.Visible = plot.OfflinePads[index] == true and amount > 0
end

local function updatePadLabels(plot: Plot)
	for index in plot.Pads do
		updatePadLabel(plot, index)
	end
end

local function clearPads(plot: Plot)
	for index = 1, #plot.Slots do
		plot.PadCash[index] = 0
	end
	table.clear(plot.OfflinePads)
	updatePadLabels(plot)
end

local function isOnPad(pad: BasePart, position: Vector3): boolean
	local offset = pad.CFrame:PointToObjectSpace(position)
	return math.abs(offset.X) <= pad.Size.X / 2 + PAD_REACH
		and math.abs(offset.Z) <= pad.Size.Z / 2 + PAD_REACH
		and offset.Y >= -1
		and offset.Y <= 6
end

-- The owner standing on a pad collects its Cash.
local function collectPads(plot: Plot)
	local owner = plot.Owner
	local rootPart = if owner then getLiveCharacter(owner) else nil
	if owner == nil or rootPart == nil or not isInsidePart(plot.Interior, rootPart.Position) then
		return
	end
	for index, pad in plot.Pads do
		local amount = plot.PadCash[index] or 0
		local whole = math.floor(amount)
		if whole >= 1 and isOnPad(pad.Part, rootPart.Position) then
			local wasOffline = plot.OfflinePads[index]
			plot.PadCash[index] = amount - whole
			plot.OfflinePads[index] = nil
			if collectPadCashFunction:Invoke(owner, whole, padCashList(plot)) == true then
				playSound(owner, "Collect")
			else
				plot.PadCash[index] = amount
				plot.OfflinePads[index] = wasOffline
			end
			updatePadLabel(plot, index)
		end
	end
end

local function createPadGui(part: BasePart): Pad
	local surface = Instance.new("SurfaceGui")
	surface.Name = "CollectGui"
	surface.Face = Enum.NormalId.Top
	surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	surface.PixelsPerStud = 40
	surface.LightInfluence = 0

	local collectText = Instance.new("TextLabel")
	collectText.BackgroundTransparency = 1
	collectText.Size = UDim2.fromScale(1, 1)
	collectText.Font = Enum.Font.FredokaOne
	collectText.Text = "COLLECT"
	collectText.TextScaled = true
	collectText.TextColor3 = Color3.fromRGB(235, 255, 235)
	collectText.TextStrokeTransparency = 0.4
	collectText.Parent = surface
	surface.Parent = part

	local billboard = Instance.new("BillboardGui")
	billboard.Name = "PadGui"
	billboard.Adornee = part
	billboard.Size = UDim2.fromOffset(160, 56)
	billboard.StudsOffsetWorldSpace = Vector3.new(0, 2.2, 0)
	billboard.MaxDistance = 50
	billboard.LightInfluence = 0
	billboard.Enabled = false

	local tag = Instance.new("TextLabel")
	tag.Name = "Tag"
	tag.BackgroundTransparency = 1
	tag.Size = UDim2.fromScale(1, 0.4)
	tag.Font = Enum.Font.FredokaOne
	tag.Text = "OFFLINE CASH"
	tag.TextScaled = true
	tag.TextColor3 = Color3.fromRGB(255, 225, 70)
	tag.TextStrokeTransparency = 0.2
	tag.Visible = false
	tag.Parent = billboard

	local amount = Instance.new("TextLabel")
	amount.Name = "Amount"
	amount.BackgroundTransparency = 1
	amount.Position = UDim2.fromScale(0, 0.38)
	amount.Size = UDim2.fromScale(1, 0.62)
	amount.Font = Enum.Font.FredokaOne
	amount.Text = "$0"
	amount.TextScaled = true
	amount.TextColor3 = Color3.fromRGB(90, 255, 110)
	amount.TextStrokeTransparency = 0.1
	amount.Parent = billboard

	billboard.Parent = part
	return { Part = part, Billboard = billboard, Amount = amount, Tag = tag }
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
	notify(owner, string.format("Base locked for %d seconds!", GameConfig.LockDurationSeconds), "Success", "Lock")
end

local function createSign(sign: BasePart): (TextLabel, TextLabel)
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

local function collectNumberedParts(folder: Instance?, prefix: string): { [number]: BasePart }
	local parts: { [number]: BasePart } = {}
	if folder == nil then
		return parts
	end
	for _, child in folder:GetChildren() do
		local suffix = string.match(child.Name, "^" .. prefix .. "(%d+)$")
		if suffix and child:IsA("BasePart") then
			parts[tonumber(suffix) :: number] = child
		end
	end
	return parts
end

-- Numbered parts in order, skipping gaps.
local function sortedParts(parts: { [number]: BasePart }): { BasePart }
	local numbers: { number } = {}
	for number in parts do
		table.insert(numbers, number)
	end
	table.sort(numbers)
	local list: { BasePart } = {}
	for _, number in numbers do
		table.insert(list, parts[number])
	end
	return list
end

local function createFloorSign(part: BasePart): TextLabel
	local billboard = Instance.new("BillboardGui")
	billboard.Name = "FloorGui"
	billboard.Adornee = part
	billboard.Size = UDim2.fromOffset(360, 90)
	billboard.MaxDistance = 90
	billboard.LightInfluence = 0

	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = Color3.fromRGB(255, 220, 90)
	label.TextStrokeTransparency = 0.1
	label.Parent = billboard

	billboard.Parent = part
	return label
end

-- Shows which floors are still locked and what unlocks them.
local function updateFloorSigns(plot: Plot)
	for floor, label in plot.FloorSigns do
		local rebirths = GameConfig.FloorUnlockRebirths[floor] or 0
		if plot.Owner == nil or floor <= plot.UnlockedFloors then
			label.Text = ""
		else
			label.Text = string.format("🔒 Floor %d\nUnlocks at Rebirth %d", floor, rebirths)
		end
	end
end

local function refreshUnlockedFloors(plot: Plot)
	local owner = plot.Owner
	local data = if owner then getPlayerData(owner) else nil
	local rebirths = if data then tonumber(data.Rebirths) or 0 else 0
	local floors = math.max(1, GameConfig.getUnlockedFloors(rebirths))
	local maxFloors = math.ceil(#plot.Slots / GameConfig.SlotsPerFloor)
	floors = math.min(floors, maxFloors)
	if floors ~= plot.UnlockedFloors then
		local gained = floors > plot.UnlockedFloors and plot.UnlockedFloors > 0 and owner ~= nil
		plot.UnlockedFloors = floors
		plot.Model:SetAttribute("UnlockedFloors", floors)
		if gained and owner then
			notify(owner, string.format("Floor %d of your base is unlocked! More room for brainrots.", floors), "Success", "Purchase")
		end
	end
	updateFloorSigns(plot)
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
	local slotParts = collectNumberedParts(model:FindFirstChild("Slots"), "Slot")
	local slots = sortedParts(slotParts)
	local lasers = sortedParts(collectNumberedParts(model:FindFirstChild("Lasers"), "Laser"))
	if floor == nil or interior == nil or laserZone == nil or lockButton == nil or spawnPoint == nil or sign == nil or #slots == 0 then
		warn(string.format("%s %s is missing parts and was skipped.", LOG_PREFIX, model:GetFullName()))
		return nil
	end

	-- Pad N belongs to Slot N.
	local pads: { [number]: Pad } = {}
	local padParts = collectNumberedParts(model:FindFirstChild("Pads"), "Pad")
	local padCash: { number } = {}
	for slotIndex, slot in slots do
		padCash[slotIndex] = 0
		for number, slotPart in slotParts do
			local padPart = padParts[number]
			if slotPart == slot and padPart then
				pads[slotIndex] = createPadGui(padPart)
			end
		end
	end

	-- Stairs and locked-floor signs on the upper floors.
	local stairs: { [number]: Stair } = {}
	local floorSigns: { [number]: TextLabel } = {}
	local floorsFolder = model:FindFirstChild("Floors")
	if floorsFolder then
		local bottoms = collectNumberedParts(floorsFolder, "StairBottom")
		local tops = collectNumberedParts(floorsFolder, "StairTop")
		for floorNumber, bottom in bottoms do
			local top = tops[floorNumber]
			if top then
				stairs[floorNumber] = { Bottom = bottom.Position, Top = top.Position }
			end
		end
		for floorNumber, signPart in collectNumberedParts(floorsFolder, "FloorSign") do
			floorSigns[floorNumber] = createFloorSign(signPart)
		end
	end

	local title, subtitle = createSign(sign)
	local plot: Plot = {
		Index = index,
		Model = model,
		Floor = floor,
		Interior = interior,
		LaserZone = laserZone,
		Carpet = findPart(model, "Carpet"),
		Lasers = lasers,
		SpawnPoint = spawnPoint,
		Slots = slots,
		Pads = pads,
		PadCash = padCash,
		OfflinePads = {},
		Occupants = {},
		Reserved = {},
		Owner = nil,
		LockEndsAt = 0,
		SignTitle = title,
		SignSubtitle = subtitle,
		LockLabel = createLockLabel(lockButton),
		Stairs = stairs,
		FloorSigns = floorSigns,
		UnlockedFloors = 1,
	}

	model:SetAttribute("OwnerUserId", 0)
	model:SetAttribute("LockEndsAt", 0)
	model:SetAttribute("UnlockedFloors", 1)
	updateFloorSigns(plot)
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

-- Uncollected Cash from last time goes back on the pads, and brainrots earn
-- offline cash for the time the player was away.
local function restorePads(player: Player, plot: Plot)
	local saved = getPadCashFunction:Invoke(player)
	if typeof(saved) == "table" then
		for index, amount in saved do
			if typeof(index) == "number" and typeof(amount) == "number" and amount > 0 then
				-- A pad that no longer exists hands its Cash to the first one.
				local target = if index <= #plot.Slots then index else 1
				plot.PadCash[target] = (plot.PadCash[target] or 0) + amount
			end
		end
	end

	local seconds = tonumber(takeOfflineSecondsFunction:Invoke(player)) or 0
	local total = 0
	if seconds >= GameConfig.OfflineMinSeconds then
		local earningSeconds = math.min(seconds, GameConfig.OfflineMaxHours * 3600)
		local multiplier = getIncomeMultiplier(player) * GameConfig.OfflineIncomeFraction
		for index, occupant in plot.Occupants do
			local earned = math.floor(incomeOf(occupant.Definition, occupant.Mutation) * multiplier * earningSeconds)
			if earned > 0 then
				plot.PadCash[index] = (plot.PadCash[index] or 0) + earned
				plot.OfflinePads[index] = true
				total += earned
			end
		end
	end
	setPadCashFunction:Invoke(player, padCashList(plot))
	updatePadLabels(plot)

	if total > 0 then
		notify(
			player,
			string.format(
				"Welcome back! Your brainrots made %s while you were away (%s). Step on the green pads to collect it!",
				NumberFormat.cash(total),
				NumberFormat.duration(math.min(seconds, GameConfig.OfflineMaxHours * 3600))
			),
			"Success",
			"OfflineCash"
		)
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
	plot.Model:SetAttribute("OwnerUserId", player.UserId)
	plot.UnlockedFloors = 0
	refreshUnlockedFloors(plot)

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
				placeOccupant(plot, nextSlot, definition, mutation, nil, nil)
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
			placeOccupant(plot, 1, starter, nil, nil, nil)
			changed = true
			notify(player, string.format("Welcome! Here's a free %s to get you started.", starter.DisplayName), "Success")
		end
	end
	if changed then
		saveBrainrots(plot)
	end

	restorePads(player, plot)
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
	plot.Model:SetAttribute("OwnerUserId", 0)
	plot.Model:SetAttribute("LockEndsAt", 0)
	plot.UnlockedFloors = 1
	plot.Model:SetAttribute("UnlockedFloors", 1)
	updateFloorSigns(plot)
	setLasersActive(plot, false)
	clearPads(plot)
	updatePlotLabels(plot)
end

--------------------------------------------------------------------------------
-- Ticks
--------------------------------------------------------------------------------

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

-- Runs every FAST_TICK_SECONDS: laser doors, collect pads and brainrots being carried.
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
						notify(player, "Zapped by the laser door!", "Error", "Zap")
					end
				end
			end
		end
		if owner then
			collectPads(plot)
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

-- Runs every SLOW_TICK_SECONDS: income onto the pads, lock timers and signs.
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
			refreshUnlockedFloors(plot)
			local multiplier = getIncomeMultiplier(owner)
			local incomePerSecond = 0
			for index, occupant in plot.Occupants do
				if occupant.Carrier == nil and occupant.Walk == nil then
					local income = incomeOf(occupant.Definition, occupant.Mutation) * multiplier
					incomePerSecond += income
					plot.PadCash[index] = (plot.PadCash[index] or 0) + income * SLOW_TICK_SECONDS
				end
			end
			owner:SetAttribute("IncomePerSecond", incomePerSecond)
			setPadCashFunction:Invoke(owner, padCashList(plot))
			updatePadLabels(plot)
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
-- Mutation events
--------------------------------------------------------------------------------

local function notifyAll(message: string, kind: NotifyKind, sound: string?)
	for _, player in Players:GetPlayers() do
		notify(player, message, kind, sound)
	end
end

local function eventMessage(event: GameEvent): string
	local duration = NumberFormat.duration(GameConfig.EventDurationSeconds)
	local boost = event.TagBoost
	if boost then
		return string.format("%s! %s brainrots are %sx more common for %s!", event.Name, boost.Tag, tostring(boost.Multiplier), duration)
	elseif event.CashRain then
		return string.format("%s! Grab the Cash falling from the sky for %s!", event.Name, duration)
	elseif event.Luck then
		return string.format("%s! Rare brainrots are %sx more likely for %s!", event.Name, tostring(event.Luck), duration)
	elseif event.Mutation and event.MutationChance then
		return string.format("%s! %s brainrots can spawn on the conveyor for %s!", event.Name, event.Mutation, duration)
	elseif event.Mutation then
		return string.format(
			"%s! %s brainrots are %sx more common for %s!",
			event.Name,
			event.Mutation,
			tostring(event.ChanceMultiplier or 1),
			duration
		)
	end
	return string.format("%s for %s!", event.Name, duration)
end

-- Cash Rain: coins land around the map; the first player to touch one gets
-- Cash worth a few seconds of their income.
local coinExpiresAt: { [BasePart]: number } = {}
local coinArea: { Min: Vector3, Max: Vector3 }? = nil
do
	local baseplate = Workspace:FindFirstChild("Baseplate")
	if baseplate and baseplate:IsA("BasePart") then
		local half = baseplate.Size / 2 - Vector3.new(24, 0, 24)
		local top = baseplate.Position.Y + baseplate.Size.Y / 2
		coinArea = {
			Min = Vector3.new(baseplate.Position.X - half.X, top, baseplate.Position.Z - half.Z),
			Max = Vector3.new(baseplate.Position.X + half.X, top, baseplate.Position.Z + half.Z),
		}
	end
end

local function coinSpot(): Vector3?
	local area = coinArea
	if area == nil then
		return nil
	end
	for _ = 1, 8 do
		local x = rng:NextNumber(area.Min.X, area.Max.X)
		local z = rng:NextNumber(area.Min.Z, area.Max.Z)
		-- Only on open ground: not on a roof or inside a base.
		local hit = Workspace:Raycast(Vector3.new(x, area.Min.Y + 80, z), Vector3.new(0, -100, 0))
		if hit and hit.Position.Y <= area.Min.Y + 1.5 and not hit.Instance:IsDescendantOf(plotsFolder) then
			return Vector3.new(x, hit.Position.Y, z)
		end
	end
	return nil
end

local function spawnCoinWave()
	local expiresAt = os.clock() + GameConfig.CashRainWaveSeconds * 2.5
	for _ = 1, GameConfig.CashRainCoinsPerWave do
		local spot = coinSpot()
		if spot then
			local coin = Instance.new("Part")
			coin.Name = "Coin"
			coin.Shape = Enum.PartType.Cylinder
			coin.Size = Vector3.new(0.5, 3, 3)
			coin.Material = Enum.Material.Neon
			coin.Color = Color3.fromRGB(255, 205, 50)
			coin.Anchored = true
			coin.CanCollide = false
			coin.CanQuery = false
			coin.CanTouch = false
			coin.CFrame = CFrame.new(spot + Vector3.new(0, 2.2, 0))
			coin:SetAttribute("Spin", true)
			coin.Parent = coinsFolder
			coinExpiresAt[coin] = expiresAt
		end
	end
end

local function clearCoins()
	for coin in coinExpiresAt do
		coin:Destroy()
	end
	table.clear(coinExpiresAt)
end

-- Called from the fast tick.
local function collectCoins()
	if next(coinExpiresAt) == nil then
		return
	end
	local clock = os.clock()
	local roots: { [Player]: BasePart } = {}
	for _, player in Players:GetPlayers() do
		local rootPart = getLiveCharacter(player)
		if rootPart then
			roots[player] = rootPart
		end
	end
	for coin, expiresAt in coinExpiresAt do
		if clock >= expiresAt or coin.Parent == nil then
			coinExpiresAt[coin] = nil
			coin:Destroy()
			continue
		end
		for player, rootPart in roots do
			if (rootPart.Position - coin.Position).Magnitude <= 5 then
				local income = tonumber(player:GetAttribute("IncomePerSecond")) or 0
				local amount = math.max(GameConfig.CashRainMinCoin, math.floor(income * GameConfig.CashRainCoinIncomeSeconds))
				coinExpiresAt[coin] = nil
				coin:Destroy()
				if addCash(player, amount) then
					playSound(player, "Collect")
					notify(player, "+" .. NumberFormat.cash(amount) .. " from the Cash Rain!", "Success")
				end
				break
			end
		end
	end
end

local function runEvent(event: GameEvent)
	local endsAt = Workspace:GetServerTimeNow() + GameConfig.EventDurationSeconds
	activeEvent = event
	ReplicatedStorage:SetAttribute("EventName", event.Name)
	ReplicatedStorage:SetAttribute("EventMutation", event.Mutation)
	ReplicatedStorage:SetAttribute("EventSky", event.Sky)
	ReplicatedStorage:SetAttribute("EventParticles", event.Particles)
	ReplicatedStorage:SetAttribute("EventEndsAt", endsAt)
	notifyAll(eventMessage(event), "Info", "Event")
	if event.CashRain then
		while Workspace:GetServerTimeNow() < endsAt do
			spawnCoinWave()
			task.wait(math.min(GameConfig.CashRainWaveSeconds, math.max(0.1, endsAt - Workspace:GetServerTimeNow())))
		end
	else
		task.wait(GameConfig.EventDurationSeconds)
	end
	activeEvent = nil
	clearCoins()
	ReplicatedStorage:SetAttribute("EventName", nil)
	ReplicatedStorage:SetAttribute("EventMutation", nil)
	ReplicatedStorage:SetAttribute("EventSky", nil)
	ReplicatedStorage:SetAttribute("EventParticles", nil)
	ReplicatedStorage:SetAttribute("EventEndsAt", 0)
	notifyAll(event.Name .. " is over.", "Info")
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

	-- Rebirthing resets Cash and the pads to 0 and keeps your brainrots.
	if not spendCash(player, cash) then
		return false, "Rebirth failed, try again."
	end
	addRebirthsFunction:Invoke(player, 1)
	local plot = plotByPlayer[player]
	if plot then
		clearPads(plot)
		refreshUnlockedFloors(plot)
	end
	setPadCashFunction:Invoke(player, if plot then padCashList(plot) else {})

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
		notify(player, string.format("EMP active! Walk through laser doors for %d seconds.", tonumber(durationSeconds) or 0), "Success", "Purchase")
	end
end)

serverRarityBoostChangedEvent.Event:Connect(function(multiplier: any, _endsAt: any, purchaser: any)
	local boost = tonumber(multiplier) or 1
	if boost <= 1 or typeof(purchaser) ~= "Instance" or not purchaser:IsA("Player") then
		return
	end
	notifyAll(
		string.format("%s activated a x%s Rarity Boost for the whole server!", purchaser.DisplayName, tostring(boost)),
		"Success",
		"Event"
	)
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
	player:SetAttribute("Carrying", false)
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

ReplicatedStorage:SetAttribute("EventEndsAt", 0)

Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(onPlayerRemoving)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

runLoop(FAST_TICK_SECONDS, "Fast tick", fastTick)
runLoop(FAST_TICK_SECONDS, "Cash Rain", collectCoins)
runLoop(SLOW_TICK_SECONDS, "Slow tick", slowTick)

RunService.Heartbeat:Connect(function(dt: number)
	xpcall(stepWalkers, function(err: any)
		warn(string.format("%s Walking failed: %s", LOG_PREFIX, tostring(err)))
	end, dt)
end)

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

task.spawn(function()
	while true do
		task.wait(rng:NextNumber(GameConfig.EventMinGapSeconds, GameConfig.EventMaxGapSeconds))
		local events = GameConfig.Events
		if #events > 0 then
			xpcall(runEvent, function(err: any)
				activeEvent = nil
				clearCoins()
				warn(string.format("%s Event failed: %s", LOG_PREFIX, tostring(err)))
			end, events[rng:NextInteger(1, #events)])
		end
	end
end)

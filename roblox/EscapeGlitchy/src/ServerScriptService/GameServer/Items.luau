-- Items and locks.
--
-- Every round, each item id found in the map's ItemSpawns folder appears at one
-- of its spawn points at random. A survivor can hold one item at a time: picking
-- up another swaps them, and they can drop what they hold. Holding the right
-- item lets them open a lock. When every lock marked ExitLock is open, anything
-- named "ExitGate" is removed and the exit opens.

local Players = game:GetService("Players")
local ServerStorage = game:GetService("ServerStorage")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))

local Items = {}

local notifyAll: (string) -> ()
local notify: (Player, string) -> ()

local currentMap: Model? = nil
local onExitOpened: (() -> ())? = nil
local held: { [Player]: string } = {}
local spawnPoints: { [string]: { BasePart } } = {}
local lastDrop: { [Player]: number } = {}
local exitLocksTotal = 0
local exitLocksOpen = 0
local exitOpen = false

local function itemInfo(itemId)
	return Config.Items[itemId] or { DisplayName = itemId, Color = Color3.new(1, 1, 1), Shape = "Key" }
end

local function canInteract(player)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	return currentMap ~= nil and player:GetAttribute("Role") == "Survivor" and humanoid ~= nil and humanoid.Health > 0
end

local function weld(part0, part1)
	local constraint = Instance.new("WeldConstraint")
	constraint.Part0 = part0
	constraint.Part1 = part1
	constraint.Parent = part1
end

-- Builds the model for an item, either from ServerStorage > ItemModels or out
-- of simple parts. Every part comes back anchored and non-collidable.
local function makeItemModel(itemId): Model
	local info = itemInfo(itemId)
	local templates = ServerStorage:FindFirstChild("ItemModels")
	local template = templates and templates:FindFirstChild(itemId)

	local model
	if template and (template:IsA("Model") or template:IsA("BasePart")) then
		local copy = template:Clone()
		if copy:IsA("BasePart") then
			model = Instance.new("Model")
			copy.Parent = model
			model.PrimaryPart = copy
		else
			model = copy
		end
	else
		model = Instance.new("Model")
		local handle = Instance.new("Part")
		handle.Name = "Handle"
		handle.Color = info.Color
		handle.Material = Enum.Material.Metal
		local head = Instance.new("Part")
		head.Name = "Head"
		head.Color = info.Color
		head.Material = Enum.Material.Metal
		if info.Shape == "Tool" then
			handle.Size = Vector3.new(0.3, 0.3, 1.8)
			head.Size = Vector3.new(0.8, 0.3, 0.5)
			head.CFrame = handle.CFrame * CFrame.new(0, 0, -1.05)
		else
			handle.Size = Vector3.new(0.25, 0.25, 1.2)
			head.Shape = Enum.PartType.Cylinder
			head.Size = Vector3.new(0.25, 0.8, 0.8)
			head.CFrame = handle.CFrame * CFrame.new(0, 0, -0.9) * CFrame.Angles(0, 0, math.rad(90))
		end
		handle.Parent = model
		head.Parent = model
		model.PrimaryPart = handle

		local glow = Instance.new("PointLight")
		glow.Color = info.Color
		glow.Range = 7
		glow.Brightness = 0.8
		glow.Parent = handle
	end

	model.Name = itemId
	if not model.PrimaryPart then
		model.PrimaryPart = model:FindFirstChildWhichIsA("BasePart", true)
	end
	for _, part in model:GetDescendants() do
		if part:IsA("BasePart") then
			part.Anchored = true
			part.CanCollide = false
			part.CanQuery = false
			part.CanTouch = false
		end
	end
	return model
end

-- Shows the held item in the character's right hand.
local function updateHandVisual(player)
	local character = player.Character
	if not character then
		return
	end
	local old = character:FindFirstChild("HeldItemVisual")
	if old then
		old:Destroy()
	end

	local itemId = held[player]
	local hand = character:FindFirstChild("RightHand") or character:FindFirstChild("Right Arm")
	if not itemId or not hand or not hand:IsA("BasePart") then
		return
	end

	local visual = makeItemModel(itemId)
	visual.Name = "HeldItemVisual"
	for _, prompt in visual:GetDescendants() do
		if prompt:IsA("ProximityPrompt") then
			prompt:Destroy() -- custom item models may come with their own prompts
		end
	end
	local primary = visual.PrimaryPart
	if not primary then
		visual:Destroy()
		return
	end
	visual:PivotTo(hand.CFrame * CFrame.new(0, -hand.Size.Y / 2 - 0.2, -0.4))
	for _, part in visual:GetDescendants() do
		if part:IsA("BasePart") then
			if part ~= primary then
				weld(primary, part)
			end
			part.Massless = true
			part.Anchored = false
		end
	end
	weld(hand, primary)
	visual.Parent = character
end

local function setHeld(player, itemId)
	held[player] = itemId
	player:SetAttribute("HeldItem", itemId)
	updateHandVisual(player)
end

local spawnWorldItem

local function pickUp(player, model)
	if not canInteract(player) or not model.Parent then
		return
	end
	local itemId = model:GetAttribute("ItemId")
	local where = model:GetPivot()
	model:Destroy()

	local previous = held[player]
	if previous then
		spawnWorldItem(previous, where) -- swap: leave the old item where the new one was
	end
	setHeld(player, itemId)
end

-- Places an item in the map with a "Pick up" prompt.
function spawnWorldItem(itemId, cframe)
	if not currentMap then
		return
	end
	local info = itemInfo(itemId)
	local model = makeItemModel(itemId)
	model:SetAttribute("ItemId", itemId)
	model:PivotTo(cframe)

	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Pick up"
	prompt.ObjectText = info.DisplayName
	prompt.HoldDuration = 0
	prompt.MaxActivationDistance = 8
	prompt.RequiresLineOfSight = false
	prompt.Parent = model.PrimaryPart
	prompt.Triggered:Connect(function(player)
		pickUp(player, model)
	end)

	model.Parent = currentMap
end

local function spawnAtRandomPoint(itemId)
	local points = spawnPoints[itemId]
	if points and #points > 0 then
		local point = points[math.random(#points)]
		spawnWorldItem(itemId, CFrame.new(point.Position))
	end
end

-- Finds the floor under a position so dropped items do not float.
local function groundBelow(position)
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Include
	params.FilterDescendantsInstances = { currentMap }
	local result = workspace:Raycast(position + Vector3.new(0, 1, 0), Vector3.new(0, -20, 0), params)
	return result and result.Position + Vector3.new(0, 0.4, 0) or position
end

local function openExit()
	if exitOpen or not currentMap then
		return
	end
	exitOpen = true
	for _, child in currentMap:GetChildren() do
		if child.Name == "ExitGate" then
			child:Destroy()
		end
	end
	local exit = currentMap:FindFirstChild("Exit")
	if exit and exit:IsA("BasePart") then
		exit.Color = Color3.fromRGB(60, 255, 120)
		exit.Material = Enum.Material.Neon
		exit.Transparency = 0.7
	end
	if onExitOpened then
		onExitOpened()
	end
end

local function setupLock(lock)
	local required = lock:GetAttribute("RequiredItem")
	if typeof(required) ~= "string" then
		return
	end
	local part = if lock:IsA("BasePart")
		then lock
		elseif lock:IsA("Model") then lock.PrimaryPart or lock:FindFirstChildWhichIsA("BasePart", true)
		else nil
	if not part then
		return
	end

	local isExitLock = lock:GetAttribute("ExitLock") == true
	if isExitLock then
		exitLocksTotal += 1
	end

	local info = itemInfo(required)
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Use " .. info.DisplayName
	prompt.ObjectText = lock.Name
	prompt.HoldDuration = 0.5
	prompt.MaxActivationDistance = 9
	prompt.RequiresLineOfSight = false
	prompt.Parent = part
	prompt.Triggered:Connect(function(player)
		if not canInteract(player) or not lock.Parent then
			return
		end
		if held[player] ~= required then
			notify(player, `You need the {info.DisplayName}!`)
			return
		end

		setHeld(player, nil)
		lock:Destroy()
		notifyAll(`{player.DisplayName} used the {info.DisplayName}!`)

		if isExitLock then
			exitLocksOpen += 1
			if exitLocksOpen >= exitLocksTotal then
				openExit()
			else
				notifyAll(`Exit locks open: {exitLocksOpen}/{exitLocksTotal}`)
			end
		end
	end)
end

---------------------------------------------------------------------------
-- Public
---------------------------------------------------------------------------

function Items.Init(callbacks: { notifyAll: (string) -> (), notify: (Player, string) -> (), dropRemote: RemoteEvent })
	notifyAll = callbacks.notifyAll
	notify = callbacks.notify

	callbacks.dropRemote.OnServerEvent:Connect(function(player)
		if not canInteract(player) or not held[player] then
			return
		end
		local now = os.clock()
		if (lastDrop[player] or 0) + 0.5 > now then
			return
		end
		lastDrop[player] = now
		local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
		if root and root:IsA("BasePart") then
			Items.DropHeld(player, root.Position)
		end
	end)

	-- A player leaving must not take an item with them, or the round could
	-- become impossible to finish.
	Players.PlayerRemoving:Connect(function(player)
		Items.DropHeld(player)
		held[player] = nil
		lastDrop[player] = nil
	end)
end

-- Spawns this round's items and sets up the map's locks.
function Items.Setup(map: Model, exitOpenedCallback: () -> ())
	Items.Reset()
	currentMap = map
	onExitOpened = exitOpenedCallback

	local spawnFolder = map:FindFirstChild("ItemSpawns")
	if spawnFolder then
		for _, point in spawnFolder:GetChildren() do
			local itemId = point:GetAttribute("Item")
			if point:IsA("BasePart") and typeof(itemId) == "string" then
				if not Config.Items[itemId] then
					warn(`[{Config.GameName}] Item "{itemId}" is used in the map but missing from Config.Items.`)
				end
				spawnPoints[itemId] = spawnPoints[itemId] or {}
				table.insert(spawnPoints[itemId], point)
			end
		end
	end
	for itemId in spawnPoints do
		spawnAtRandomPoint(itemId)
	end

	local locks = map:FindFirstChild("Locks")
	if locks then
		for _, lock in locks:GetChildren() do
			setupLock(lock)
		end
	end
	if exitLocksTotal == 0 then
		task.defer(openExit)
	end
end

-- Takes the item away from a player. With a position the item is dropped
-- there; without one it goes back to a random spawn point (used when a player
-- leaves the game, so the round can still be finished).
function Items.DropHeld(player: Player, position: Vector3?)
	local itemId = held[player]
	if not itemId then
		return
	end
	setHeld(player, nil)
	if not currentMap or not currentMap.Parent then
		return
	end
	if position then
		spawnWorldItem(itemId, CFrame.new(groundBelow(position)))
	else
		spawnAtRandomPoint(itemId)
	end
end

function Items.IsExitOpen()
	return exitOpen
end

-- Clears everything at the end of a round.
function Items.Reset()
	for player in held do
		if player.Parent then
			player:SetAttribute("HeldItem", nil)
			local visual = player.Character and player.Character:FindFirstChild("HeldItemVisual")
			if visual then
				visual:Destroy()
			end
		end
	end
	table.clear(held)
	table.clear(spawnPoints)
	currentMap = nil
	onExitOpened = nil
	exitLocksTotal = 0
	exitLocksOpen = 0
	exitOpen = false
end

return Items

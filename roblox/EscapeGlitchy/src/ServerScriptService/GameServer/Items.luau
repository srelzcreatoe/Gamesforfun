-- Items and locks.
--
-- Every round, each item id found in the map's ItemSpawns folder appears at one
-- of its spawn points at random. A survivor can hold one item at a time: picking
-- up another swaps them, and they can drop what they hold. Holding the right
-- item lets them open a lock. Locks with the attribute Code = true are keypads
-- instead: the code is written on one of the map's CodeNotes, picked at
-- random. When every lock marked ExitLock is open, anything named "ExitGate"
-- is removed and the exit opens.

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
local roundCode = "" -- the keypad code for this round
local opened: { [Instance]: boolean } = {}
local lastCodeTry: { [Player]: number } = {}
local keypadRemote: RemoteEvent

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
		elseif info.Shape == "Card" then
			handle.Size = Vector3.new(0.9, 0.06, 1.4)
			handle.Material = Enum.Material.SmoothPlastic
			head.Size = Vector3.new(0.92, 0.07, 0.3) -- a white stripe
			head.Color = Color3.new(1, 1, 1)
			head.Material = Enum.Material.SmoothPlastic
			head.CFrame = handle.CFrame * CFrame.new(0, 0, -0.35)
		elseif info.Shape == "Fuse" then
			handle.Shape = Enum.PartType.Cylinder
			handle.Size = Vector3.new(1.2, 0.5, 0.5)
			handle.Material = Enum.Material.Glass
			head.Shape = Enum.PartType.Cylinder
			head.Size = Vector3.new(1.5, 0.3, 0.3) -- metal pins through the middle
			head.Color = Color3.fromRGB(190, 190, 200)
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
	prompt.MaxActivationDistance = 7
	prompt.RequiresLineOfSight = true -- no grabbing items through walls
	prompt:SetAttribute("ItemPrompt", true)
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

-- Finds the floor under a position so dropped items do not float. Returns nil
-- if there is no floor there (e.g. someone fell off the map).
local function groundBelow(position: Vector3): Vector3?
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Include
	params.FilterDescendantsInstances = { currentMap }
	local result = workspace:Raycast(position + Vector3.new(0, 1, 0), Vector3.new(0, -20, 0), params)
	return if result then result.Position + Vector3.new(0, 0.4, 0) else nil
end

local function openExit()
	if exitOpen or not currentMap then
		return
	end
	exitOpen = true
	for _, descendant in currentMap:GetDescendants() do
		if descendant.Name == "ExitGate" then
			descendant:Destroy()
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

local function lockPart(lock: Instance): BasePart?
	if lock:IsA("BasePart") then
		return lock
	elseif lock:IsA("Model") then
		return lock.PrimaryPart or lock:FindFirstChildWhichIsA("BasePart", true)
	end
	return nil
end

-- Writes this round's code on a note (or a keypad, if the map has no notes).
local function showCode(part: BasePart)
	for _, face in { Enum.NormalId.Front, Enum.NormalId.Back } do
		local surface = Instance.new("SurfaceGui")
		surface.Name = "Code"
		surface.Face = face
		surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
		surface.PixelsPerStud = 60
		surface.Parent = part
		local label = Instance.new("TextLabel")
		label.Size = UDim2.fromScale(1, 1)
		label.BackgroundTransparency = 1
		label.Font = Enum.Font.SpecialElite
		label.TextScaled = true
		label.TextColor3 = Color3.fromRGB(45, 30, 20)
		label.Text = "CODE\n" .. roundCode
		label.Parent = surface
	end
end

-- Opens a lock. Doors disappear; lock pillars (KeepOnUnlock) light up green.
local function unlock(lock: Instance, message: string, isExitLock: boolean)
	if opened[lock] then
		return
	end
	opened[lock] = true
	if lock:GetAttribute("KeepOnUnlock") then
		for _, descendant in lock:GetDescendants() do
			if descendant:IsA("ProximityPrompt") then
				descendant:Destroy()
			elseif descendant:IsA("BasePart") and descendant.Name == "Light" then
				descendant.Color = Color3.fromRGB(60, 255, 120)
			end
		end
	else
		lock:Destroy()
	end
	notifyAll(message)

	if isExitLock then
		exitLocksOpen += 1
		if exitLocksOpen >= exitLocksTotal then
			openExit()
		else
			notifyAll(`Exit locks open: {exitLocksOpen}/{exitLocksTotal}`)
		end
	end
end

local function setupLock(lock: Instance)
	local required = lock:GetAttribute("RequiredItem")
	local isCode = lock:GetAttribute("Code") == true
	if typeof(required) ~= "string" and not isCode then
		return
	end
	local part = lockPart(lock)
	if not part then
		return
	end
	if not isCode and not spawnPoints[required] then
		warn(`[{Config.GameName}] Lock "{lock:GetFullName()}" needs "{required}", but the map has no ItemSpawns for it.`)
	end

	local isExitLock = lock:GetAttribute("ExitLock") == true
	if isExitLock then
		exitLocksTotal += 1
	end

	local prompt = Instance.new("ProximityPrompt")
	prompt:SetAttribute("LockPrompt", true) -- the monster's client hides these
	prompt.ObjectText = lock.Name
	prompt.MaxActivationDistance = 9
	prompt.RequiresLineOfSight = false
	prompt.Parent = part

	if isCode then
		prompt.ActionText = "Enter code"
		prompt.HoldDuration = 0
		prompt.Triggered:Connect(function(player)
			if canInteract(player) and not opened[lock] then
				keypadRemote:FireClient(player, lock)
			end
		end)
		return
	end

	local info = itemInfo(required)
	prompt.ActionText = "Use " .. info.DisplayName
	prompt.HoldDuration = 0.5
	prompt.Triggered:Connect(function(player)
		if not canInteract(player) or opened[lock] then
			return
		end
		if held[player] ~= required then
			notify(player, `You need the {info.DisplayName}!`)
			return
		end
		setHeld(player, nil)
		unlock(lock, `{player.DisplayName} used the {info.DisplayName}!`, isExitLock)
	end)
end

---------------------------------------------------------------------------
-- Public
---------------------------------------------------------------------------

function Items.Init(callbacks: {
	notifyAll: (string) -> (),
	notify: (Player, string) -> (),
	dropRemote: RemoteEvent,
	keypadRemote: RemoteEvent,
	codeRemote: RemoteEvent,
})
	notifyAll = callbacks.notifyAll
	notify = callbacks.notify
	keypadRemote = callbacks.keypadRemote

	-- A player typed a code into a keypad.
	callbacks.codeRemote.OnServerEvent:Connect(function(player, lock, code)
		local map = currentMap
		if typeof(lock) ~= "Instance" or typeof(code) ~= "string" or #code > 8 then
			return
		end
		if not map or not canInteract(player) or opened[lock] or not lock:IsDescendantOf(map) or lock:GetAttribute("Code") ~= true then
			return
		end
		local now = os.clock()
		if (lastCodeTry[player] or 0) + 1 > now then
			notify(player, "Slow down!")
			return
		end
		lastCodeTry[player] = now
		local part = lockPart(lock)
		local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
		if not part or not root or not root:IsA("BasePart") or (root.Position - part.Position).Magnitude > 16 then
			return
		end
		if code == roundCode then
			unlock(lock, `{player.DisplayName} entered the right code!`, lock:GetAttribute("ExitLock") == true)
		else
			notify(player, "Wrong code!")
		end
	end)

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
		lastCodeTry[player] = nil
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
	local codeLocks = {}
	if locks then
		for _, lock in locks:GetChildren() do
			setupLock(lock)
			if lock:GetAttribute("Code") == true then
				table.insert(codeLocks, lock)
			end
		end
	end

	-- A new code every round, written on one note picked at random.
	roundCode = string.format("%04d", math.random(0, 9999))
	if #codeLocks > 0 then
		local notes = {}
		local notesFolder = map:FindFirstChild("CodeNotes")
		for _, note in if notesFolder then notesFolder:GetChildren() else {} do
			local part = lockPart(note)
			if part then
				table.insert(notes, part)
			end
		end
		if #notes > 0 then
			showCode(notes[math.random(#notes)])
		else
			warn(`[{Config.GameName}] Map "{map.Name}" has keypads but no CodeNotes, so the code is shown on the keypads.`)
			for _, lock in codeLocks do
				local part = lockPart(lock)
				if part then
					showCode(part)
				end
			end
		end
	end

	if exitLocksTotal == 0 then
		task.defer(openExit)
	end
end

-- Takes the item away from a player. With a position the item is dropped on
-- the floor there; otherwise (or if there is no floor) it goes back to a
-- random spawn point, so the round can always still be finished.
function Items.DropHeld(player: Player, position: Vector3?)
	local itemId = held[player]
	if not itemId then
		return
	end
	setHeld(player, nil)
	if not currentMap or not currentMap.Parent then
		return
	end
	local ground = if position then groundBelow(position) else nil
	if ground then
		spawnWorldItem(itemId, CFrame.new(ground))
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
	roundCode = ""
	table.clear(opened)
end

return Items

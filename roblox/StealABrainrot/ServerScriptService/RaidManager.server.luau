--!strict
--[[
	RaidManager
	Location: ServerScriptService (Script)

	The two events that happen on the map itself (GameplayManager starts and
	ends them like any other event and tells this script through
	ServerStorage.Gameplay.EventChanged):

	  * Boss Raid: a giant brainrot walks up and down the walkway between the
	    bases (Workspace.Map.BossArena), stomping every few seconds. Everyone
	    clicks it (or slaps it) to hurt it; when it falls, the top three
	    raiders win lucky blocks and everyone who helped gets Cash and maybe
	    a hat. Beating it ends the event.
	  * Bank Heist: the vault door (Workspace.Map.Vault) rolls open. Grab a
	    loot bag from a gold pile and carry it into your own base for Cash
	    (ExtrasConfig.HeistLootIncomeSeconds of your income). You're slower
	    with a bag; a slap or a fall makes you drop it for anyone to grab.

	Client-facing state:
	  Boss model (Workspace.Map.Brainrots, State "Boss") with attributes
	    BossHealth, BossMaxHealth and Stomp (server time of the last stomp)
	  ReplicatedStorage attributes BossName, BossHealth, BossMaxHealth (0 = no
	    boss) and HeistOpen
	  Player attributes CarryingLoot, LootValue, LootSpeed
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))
local ExtrasConfig = require(Shared:WaitForChild("ExtrasConfig"))
local GameConfig = require(Shared:WaitForChild("GameConfig"))
local GearConfig = require(Shared:WaitForChild("GearConfig"))
local NumberFormat = require(Shared:WaitForChild("NumberFormat"))

local LOG_PREFIX = "[RaidManager]"
local TICK_SECONDS = 0.1
local DOOR_SECONDS = 2
local DROPPED_LOOT_SECONDS = 20

local dataApi = ServerStorage:WaitForChild("DataAndMonetization")
local gameplayApi = ServerStorage:WaitForChild("Gameplay")
local gearApi = ServerStorage:WaitForChild("Gear")
local addCashFunction = dataApi:WaitForChild("AddCash") :: BindableFunction
local addHatFunction = dataApi:WaitForChild("AddHat") :: BindableFunction
local eventChangedEvent = gameplayApi:WaitForChild("EventChanged") :: BindableEvent
local giveBrainrotFunction = gameplayApi:WaitForChild("GiveBrainrot") :: BindableFunction
local getIncomeFunction = gameplayApi:WaitForChild("GetIncome") :: BindableFunction
local activityEvent = gameplayApi:WaitForChild("Activity") :: BindableEvent
local knockbackFunction = gearApi:WaitForChild("Knockback") :: BindableFunction
local slapSwingEvent = gearApi:WaitForChild("SlapSwing") :: BindableEvent
local slappedEvent = gearApi:WaitForChild("Slapped") :: BindableEvent

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local notifyEvent = remotes:WaitForChild("Notify") :: RemoteEvent
local playSoundEvent = remotes:WaitForChild("PlaySound") :: RemoteEvent

local map = Workspace:WaitForChild("Map")
local brainrotsFolder = map:WaitForChild("Brainrots")
local plotsFolder = map:WaitForChild("Plots")

local rng = Random.new()

local function notify(player: Player, message: string, kind: string, sound: string?)
	notifyEvent:FireClient(player, message, kind, sound)
end

local function notifyAll(message: string, kind: string, sound: string?)
	notifyEvent:FireAllClients(message, kind, sound)
end

local function getRoot(player: Player): BasePart?
	local character = player.Character
	local root = if character then character:FindFirstChild("HumanoidRootPart") else nil
	local humanoid = if character then character:FindFirstChildOfClass("Humanoid") else nil
	if root and root:IsA("BasePart") and humanoid and humanoid.Health > 0 then
		return root
	end
	return nil
end

local function income(player: Player): number
	return tonumber(getIncomeFunction:Invoke(player)) or 0
end

local function isInside(part: BasePart, position: Vector3): boolean
	local localPosition = part.CFrame:PointToObjectSpace(position)
	local half = part.Size / 2
	return math.abs(localPosition.X) <= half.X and math.abs(localPosition.Y) <= half.Y + 4 and math.abs(localPosition.Z) <= half.Z
end

--------------------------------------------------------------------------------
-- Boss Raid
--------------------------------------------------------------------------------

type Boss = {
	Model: Model,
	Root: BasePart,
	Hitbox: BasePart,
	Name: string,
	Health: number,
	MaxHealth: number,
	Damage: { [Player]: number },
	LastHit: { [Player]: number },
	Target: Vector3,
	NextStomp: number,
	Defeated: boolean,
}

local boss: Boss? = nil
local damageBoss: (current: Boss, player: Player, amount: number) -> ()

local function arena(): BasePart?
	local part = map:FindFirstChild("BossArena")
	return if part and part:IsA("BasePart") then part else nil
end

local function randomSpot(area: BasePart): Vector3
	local half = area.Size / 2 - Vector3.new(20, 0, 12)
	local x = rng:NextNumber(-math.max(half.X, 1), math.max(half.X, 1))
	local z = rng:NextNumber(-math.max(half.Z, 1), math.max(half.Z, 1))
	local ground = area.Position.Y - area.Size.Y / 2
	return Vector3.new(area.Position.X + x, ground, area.Position.Z + z)
end

local function publishHealth(current: Boss)
	current.Model:SetAttribute("BossHealth", current.Health)
	ReplicatedStorage:SetAttribute("BossHealth", current.Health)
end

local function removeBoss(escaped: boolean)
	local current = boss
	boss = nil
	ReplicatedStorage:SetAttribute("BossName", nil)
	ReplicatedStorage:SetAttribute("BossHealth", 0)
	ReplicatedStorage:SetAttribute("BossMaxHealth", 0)
	if current == nil then
		return
	end
	if escaped and not current.Defeated then
		notifyAll(string.format("%s got away! Maybe next time.", current.Name), "Warning")
	end
	current.Model:Destroy()
end

local function spawnBoss()
	removeBoss(false)
	local area = arena()
	if area == nil then
		warn(LOG_PREFIX .. " No BossArena in the map; the Boss Raid has no boss.")
		return
	end
	local choices: { BrainrotConfig.Brainrot } = {}
	for _, id in ExtrasConfig.BossIds do
		local definition = BrainrotConfig.ById[id]
		if definition then
			table.insert(choices, definition)
		end
	end
	if #choices == 0 then
		return
	end
	local definition = choices[rng:NextInteger(1, #choices)]
	local maxHealth = math.max(ExtrasConfig.BossMinHealth, #Players:GetPlayers() * ExtrasConfig.BossHealthPerPlayer)
	local height = ExtrasConfig.BossHeight

	local model = Instance.new("Model")
	model.Name = "Boss"
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
	local hitbox = Instance.new("Part")
	hitbox.Name = "Hitbox"
	hitbox.Size = Vector3.new(height * 0.6, height, height * 0.6)
	hitbox.Transparency = 1
	hitbox.Anchored = true
	hitbox.CanCollide = false
	hitbox.CanTouch = false
	hitbox.CanQuery = true
	hitbox.Parent = model
	local clicker = Instance.new("ClickDetector")
	clicker.MaxActivationDistance = ExtrasConfig.BossClickRange
	clicker.CursorIcon = "rbxasset://SystemCursors/Cross"
	clicker.Parent = hitbox

	model:SetAttribute("BrainrotId", definition.Id)
	model:SetAttribute("FigureHeight", height)
	model:SetAttribute("CustomModel", false)
	model:SetAttribute("Rarity", "Brainrot God")
	model:SetAttribute("Mutation", "Boss")
	model:SetAttribute("Motion", "Walk")
	model:SetAttribute("State", "Boss")
	model:SetAttribute("BossMaxHealth", maxHealth)
	model:SetAttribute("BossHealth", maxHealth)
	model:SetAttribute("Stomp", 0)

	local start = randomSpot(area)
	root.CFrame = CFrame.new(start)
	hitbox.CFrame = CFrame.new(start + Vector3.new(0, height / 2, 0))
	local name = "BOSS " .. definition.DisplayName
	local current: Boss = {
		Model = model,
		Root = root,
		Hitbox = hitbox,
		Name = name,
		Health = maxHealth,
		MaxHealth = maxHealth,
		Damage = {},
		LastHit = {},
		Target = randomSpot(area),
		NextStomp = os.clock() + ExtrasConfig.BossStompSeconds,
		Defeated = false,
	}
	boss = current
	ReplicatedStorage:SetAttribute("BossName", name)
	ReplicatedStorage:SetAttribute("BossMaxHealth", maxHealth)
	publishHealth(current)
	model.Parent = brainrotsFolder

	clicker.MouseClick:Connect(function(player: Player)
		local root2 = getRoot(player)
		if root2 == nil or boss ~= current then
			return
		end
		local now = os.clock()
		if now - (current.LastHit[player] or 0) < ExtrasConfig.BossClickCooldown then
			return
		end
		if (root2.Position - current.Root.Position).Magnitude > ExtrasConfig.BossClickRange + height then
			return
		end
		current.LastHit[player] = now
		damageBoss(current, player, ExtrasConfig.BossClickDamage)
	end)
end

local function defeat(current: Boss)
	current.Defeated = true
	current.Model:SetAttribute("State", "Defeated")
	local ranking: { { Player: Player, Damage: number } } = {}
	local total = 0
	for player, amount in current.Damage do
		if player.Parent == Players then
			table.insert(ranking, { Player = player, Damage = amount })
			total += amount
		end
	end
	table.sort(ranking, function(a, b)
		return a.Damage > b.Damage
	end)
	local names: { string } = {}
	for place, entry in ranking do
		local player = entry.Player
		if place <= #ExtrasConfig.BossPrizes then
			table.insert(names, string.format("%d. %s", place, player.DisplayName))
			local prize = ExtrasConfig.BossPrizes[place]
			giveBrainrotFunction:Invoke(player, prize)
			local definition = BrainrotConfig.ById[prize]
			notify(player, string.format("You were #%d in the raid! You won a %s!", place, if definition then definition.DisplayName else prize), "Success", "Purchase")
		end
		if total > 0 and entry.Damage / total >= ExtrasConfig.BossMinShare then
			local cash = math.max(ExtrasConfig.BossMinCash, math.floor(income(player) * 60 * ExtrasConfig.BossCashMinutes))
			addCashFunction:Invoke(player, cash)
			local message = string.format("Boss beaten! +%s for helping.", NumberFormat.cash(cash))
			if rng:NextNumber() < ExtrasConfig.BossHatChance then
				local hatName = addHatFunction:Invoke(player, "Random", 1)
				local hat = if typeof(hatName) == "string" then ExtrasConfig.HatByName[hatName] else nil
				if hat then
					message ..= string.format(" And a %s %s!", hat.Icon, hat.DisplayName)
				end
			end
			notify(player, message, "Success", "Collect")
			activityEvent:Fire(player, "BossWin", 1)
			activityEvent:Fire(player, "BossHit", math.floor(entry.Damage / 50))
		end
	end
	notifyAll(
		string.format("%s is defeated! Top raiders: %s", current.Name, if #names > 0 then table.concat(names, ", ") else "nobody"),
		"Success",
		"Event"
	)
	-- Beating the boss ends the Boss Raid (GameplayManager's event loop
	-- watches EventEndsAt).
	ReplicatedStorage:SetAttribute("EventEndsAt", Workspace:GetServerTimeNow() + 3)
	task.delay(3, function()
		if boss == current then
			removeBoss(false)
		end
	end)
end

damageBoss = function(current: Boss, player: Player, amount: number)
	if current.Defeated or boss ~= current then
		return
	end
	current.Health = math.max(0, current.Health - amount)
	current.Damage[player] = (current.Damage[player] or 0) + amount
	publishHealth(current)
	if current.Health <= 0 then
		defeat(current)
	end
end

local function stomp(current: Boss)
	current.Model:SetAttribute("Stomp", Workspace:GetServerTimeNow())
	local centre = current.Root.Position
	for _, player in Players:GetPlayers() do
		local root = getRoot(player)
		if root then
			local offset = root.Position - centre
			local flat = Vector3.new(offset.X, 0, offset.Z)
			if flat.Magnitude <= ExtrasConfig.BossStompRadius and math.abs(offset.Y) < 12 then
				knockbackFunction:Invoke(player, flat, ExtrasConfig.BossStompKnockback, 0.6)
				playSoundEvent:FireClient(player, "Slap")
			end
		end
	end
end

local function stepBoss(dt: number)
	local current = boss
	if current == nil or current.Defeated then
		return
	end
	local area = arena()
	local position = current.Root.Position
	local offset = Vector3.new(current.Target.X - position.X, 0, current.Target.Z - position.Z)
	if offset.Magnitude < 3 then
		if area then
			current.Target = randomSpot(area)
		end
	else
		local step = math.min(offset.Magnitude, ExtrasConfig.BossSpeed * dt)
		local nextPosition = position + offset.Unit * step
		current.Root.CFrame = CFrame.lookAt(nextPosition, nextPosition + offset.Unit)
		current.Hitbox.CFrame = CFrame.new(nextPosition + Vector3.new(0, ExtrasConfig.BossHeight / 2, 0))
	end
	if os.clock() >= current.NextStomp then
		current.NextStomp = os.clock() + ExtrasConfig.BossStompSeconds
		stomp(current)
	end
end

-- A slap glove swung at the boss hurts it more than a click.
slapSwingEvent.Event:Connect(function(playerArg: any)
	local current = boss
	if current == nil or typeof(playerArg) ~= "Instance" or not playerArg:IsA("Player") then
		return
	end
	local root = getRoot(playerArg)
	if root == nil then
		return
	end
	local offset = current.Root.Position - root.Position
	local flat = Vector3.new(offset.X, 0, offset.Z)
	if flat.Magnitude <= GearConfig.SlapRange + ExtrasConfig.BossHeight * 0.35 and (flat.Magnitude < 1 or root.CFrame.LookVector:Dot(flat.Unit) > 0.2) then
		damageBoss(current, playerArg, ExtrasConfig.BossSlapDamage)
	end
end)

--------------------------------------------------------------------------------
-- Bank Heist
--------------------------------------------------------------------------------

type LootSpot = { Model: Model, Prompt: ProximityPrompt?, Taken: boolean }

local heistOpen = false
local lootSpots: { LootSpot } = {}
local doorClosedPivot: CFrame? = nil
local doorMoving = 0

local function vault(): Model?
	local found = map:FindFirstChild("Vault")
	return if found and found:IsA("Model") then found else nil
end

local function moveDoor(open: boolean)
	local building = vault()
	local door = if building then building:FindFirstChild("VaultDoor") else nil
	local closed = if building then building:FindFirstChild("DoorClosed") else nil
	local opened = if building then building:FindFirstChild("DoorOpen") else nil
	if not (door and door:IsA("Model") and closed and closed:IsA("BasePart") and opened and opened:IsA("BasePart")) then
		return
	end
	-- The door moves around its disc.
	if door.PrimaryPart == nil then
		local disc = door:FindFirstChild("Disc")
		door.PrimaryPart = if disc and disc:IsA("BasePart") then disc else door:FindFirstChildWhichIsA("BasePart")
	end
	local closedPivot = doorClosedPivot or door:GetPivot()
	doorClosedPivot = closedPivot
	local shift = opened.Position - closed.Position
	local from = door:GetPivot()
	local to = if open then closedPivot + shift else closedPivot
	doorMoving += 1
	local token = doorMoving
	task.spawn(function()
		local started = os.clock()
		while token == doorMoving do
			local alpha = math.clamp((os.clock() - started) / DOOR_SECONDS, 0, 1)
			local eased = alpha * alpha * (3 - 2 * alpha)
			door:PivotTo(from:Lerp(to, eased))
			if alpha >= 1 then
				break
			end
			task.wait(1 / 20)
		end
	end)
end

local function setPileVisible(spot: LootSpot, visible: boolean)
	for _, part in spot.Model:GetDescendants() do
		if part:IsA("BasePart") and part.Name ~= "Pile" then
			part.Transparency = if visible then 0 else 1
		end
	end
end

local function clearLoot(player: Player)
	player:SetAttribute("CarryingLoot", nil)
	player:SetAttribute("LootValue", nil)
	player:SetAttribute("LootSpeed", 0)
	local character = player.Character
	local bag = if character then character:FindFirstChild("LootBag") else nil
	if bag then
		bag:Destroy()
	end
end

local function attachBag(player: Player)
	local character = player.Character
	local torso = if character
		then (character:FindFirstChild("UpperTorso") or character:FindFirstChild("Torso") or character:FindFirstChild("HumanoidRootPart"))
		else nil
	if character == nil or torso == nil or not torso:IsA("BasePart") then
		return
	end
	local bag = Instance.new("Part")
	bag.Name = "LootBag"
	bag.Shape = Enum.PartType.Ball
	bag.Size = Vector3.new(2.6, 2.6, 2.6)
	bag.Color = Color3.fromRGB(150, 110, 60)
	bag.Material = Enum.Material.Fabric
	bag.CanCollide = false
	bag.CanQuery = false
	bag.CanTouch = false
	bag.Massless = true
	bag.CFrame = torso.CFrame * CFrame.new(0, 0.4, 1.6)
	local label = Instance.new("BillboardGui")
	label.Size = UDim2.fromScale(2, 2)
	label.StudsOffset = Vector3.new(0, 0.2, 0)
	label.LightInfluence = 0
	label.MaxDistance = 80
	local sign = Instance.new("TextLabel")
	sign.BackgroundTransparency = 1
	sign.Size = UDim2.fromScale(1, 1)
	sign.Text = "💰"
	sign.TextScaled = true
	sign.Parent = label
	label.Parent = bag
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = torso
	weld.Part1 = bag
	weld.Parent = bag
	bag.Parent = character
end

local function giveLoot(player: Player, value: number)
	player:SetAttribute("CarryingLoot", true)
	player:SetAttribute("LootValue", value)
	player:SetAttribute("LootSpeed", ExtrasConfig.HeistLootSpeed)
	attachBag(player)
end

-- A dropped bag anyone can pick up for a while.
local function dropLoot(player: Player, message: string)
	local value = tonumber(player:GetAttribute("LootValue")) or 0
	local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	clearLoot(player)
	notify(player, message, "Warning")
	if value <= 0 or root == nil or not root:IsA("BasePart") then
		return
	end
	local bag = Instance.new("Part")
	bag.Name = "DroppedLoot"
	bag.Shape = Enum.PartType.Ball
	bag.Size = Vector3.new(2.6, 2.6, 2.6)
	bag.Color = Color3.fromRGB(150, 110, 60)
	bag.Material = Enum.Material.Fabric
	bag.Anchored = true
	bag.CanCollide = false
	bag.Position = root.Position - Vector3.new(0, 1.6, 0)
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Grab Loot"
	prompt.ObjectText = NumberFormat.cash(value)
	prompt.HoldDuration = 0.4
	prompt.MaxActivationDistance = 8
	prompt.RequiresLineOfSight = false
	prompt:SetAttribute("PromptKind", "Loot")
	prompt.Parent = bag
	prompt.Triggered:Connect(function(taker: Player)
		if bag.Parent == nil or taker:GetAttribute("CarryingLoot") == true or taker:GetAttribute("Carrying") == true then
			return
		end
		bag:Destroy()
		giveLoot(taker, value)
		notify(taker, string.format("You grabbed a dropped bag worth %s! Get it to your base!", NumberFormat.cash(value)), "Success", "Collect")
	end)
	bag.Parent = map
	task.delay(DROPPED_LOOT_SECONDS, function()
		if bag.Parent then
			bag:Destroy()
		end
	end)
end

local function onGrab(spot: LootSpot, player: Player)
	if not heistOpen or spot.Taken then
		return
	end
	if player:GetAttribute("CarryingLoot") == true then
		notify(player, "You're already carrying loot! Get it home first.", "Warning")
		return
	end
	if player:GetAttribute("Carrying") == true then
		notify(player, "Your hands are full!", "Warning")
		return
	end
	local value = math.max(ExtrasConfig.HeistLootMin, math.floor(income(player) * ExtrasConfig.HeistLootIncomeSeconds))
	spot.Taken = true
	setPileVisible(spot, false)
	if spot.Prompt then
		spot.Prompt.Enabled = false
	end
	giveLoot(player, value)
	notify(player, string.format("You grabbed %s of loot! Run it back to your base!", NumberFormat.cash(value)), "Success", "Collect")
	task.delay(ExtrasConfig.HeistRespawnSeconds, function()
		if heistOpen and spot.Taken then
			spot.Taken = false
			setPileVisible(spot, true)
			if spot.Prompt then
				spot.Prompt.Enabled = true
			end
		end
	end)
end

local function openHeist()
	local building = vault()
	if building == nil then
		warn(LOG_PREFIX .. " No Vault in the map; the Bank Heist has nothing to rob.")
		return
	end
	heistOpen = true
	ReplicatedStorage:SetAttribute("HeistOpen", true)
	moveDoor(true)
	lootSpots = {}
	local lootFolder = building:FindFirstChild("Loot")
	if lootFolder then
		for _, child in lootFolder:GetChildren() do
			local pile = child:FindFirstChild("Pile")
			if child:IsA("Model") and pile and pile:IsA("BasePart") then
				local spot: LootSpot = { Model = child, Prompt = nil, Taken = false }
				local prompt = Instance.new("ProximityPrompt")
				prompt.ActionText = "Grab Loot"
				prompt.ObjectText = "Gold"
				prompt.HoldDuration = ExtrasConfig.HeistGrabSeconds
				prompt.MaxActivationDistance = 9
				prompt.RequiresLineOfSight = false
				prompt:SetAttribute("PromptKind", "Loot")
				prompt.Parent = pile
				prompt.Triggered:Connect(function(player: Player)
					onGrab(spot, player)
				end)
				spot.Prompt = prompt
				setPileVisible(spot, true)
				table.insert(lootSpots, spot)
			end
		end
	end
end

local function closeHeist()
	if not heistOpen then
		return
	end
	heistOpen = false
	ReplicatedStorage:SetAttribute("HeistOpen", false)
	moveDoor(false)
	for _, spot in lootSpots do
		if spot.Prompt then
			spot.Prompt:Destroy()
		end
		setPileVisible(spot, true)
	end
	lootSpots = {}
end

local function plotInterior(player: Player): BasePart?
	for _, plot in plotsFolder:GetChildren() do
		if plot:GetAttribute("OwnerUserId") == player.UserId then
			local interior = plot:FindFirstChild("Interior")
			return if interior and interior:IsA("BasePart") then interior else nil
		end
	end
	return nil
end

-- Bags carried into their owner's base are cashed in.
local function stepLoot()
	for _, player in Players:GetPlayers() do
		if player:GetAttribute("CarryingLoot") ~= true then
			continue
		end
		local root = getRoot(player)
		if root == nil then
			dropLoot(player, "You dropped your loot!")
			continue
		end
		local interior = plotInterior(player)
		if interior and isInside(interior, root.Position) then
			local value = tonumber(player:GetAttribute("LootValue")) or 0
			clearLoot(player)
			if value > 0 then
				addCashFunction:Invoke(player, value)
				notify(player, string.format("Heist complete! +%s", NumberFormat.cash(value)), "Success", "Collect")
				activityEvent:Fire(player, "Heist", 1)
			end
		end
	end
end

slappedEvent.Event:Connect(function(slapper: any, target: any)
	if typeof(target) == "Instance" and target:IsA("Player") and target:GetAttribute("CarryingLoot") == true then
		dropLoot(target, "You got slapped and dropped your loot!")
		if typeof(slapper) == "Instance" and slapper:IsA("Player") then
			notify(slapper, string.format("%s dropped their loot! Grab it!", target.DisplayName), "Success")
		end
	end
end)

--------------------------------------------------------------------------------
-- Events and the loop
--------------------------------------------------------------------------------

local function eventByName(name: string?): GameConfig.GameEvent?
	if name == nil then
		return nil
	end
	for _, event in GameConfig.Events do
		if event.Name == name then
			return event
		end
	end
	return nil
end

eventChangedEvent.Event:Connect(function(name: any)
	local event = eventByName(if typeof(name) == "string" then name else nil)
	if event and event.Boss then
		spawnBoss()
	elseif event and event.Heist then
		openHeist()
	else
		removeBoss(true)
		closeHeist()
	end
end)

Players.PlayerRemoving:Connect(function(player: Player)
	local current = boss
	if current then
		current.Damage[player] = nil
		current.LastHit[player] = nil
	end
end)
Players.PlayerAdded:Connect(function(player: Player)
	player:SetAttribute("LootSpeed", 0)
	player.CharacterRemoving:Connect(function()
		if player:GetAttribute("CarryingLoot") == true then
			clearLoot(player)
		end
	end)
end)
ReplicatedStorage:SetAttribute("BossHealth", 0)
ReplicatedStorage:SetAttribute("BossMaxHealth", 0)
ReplicatedStorage:SetAttribute("HeistOpen", false)

task.spawn(function()
	local last = os.clock()
	while true do
		task.wait(TICK_SECONDS)
		local now = os.clock()
		local dt = math.min(now - last, 0.5)
		last = now
		local ok, err = pcall(function()
			stepBoss(dt)
		end)
		if not ok then
			warn(string.format("%s Boss failed: %s", LOG_PREFIX, tostring(err)))
		end
		ok, err = pcall(stepLoot)
		if not ok then
			warn(string.format("%s Loot failed: %s", LOG_PREFIX, tostring(err)))
		end
	end
end)

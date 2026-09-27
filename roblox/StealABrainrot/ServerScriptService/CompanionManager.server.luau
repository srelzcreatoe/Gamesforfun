--!strict
--[[
	CompanionManager
	Location: ServerScriptService (Script)

	Guards and pets, picked from the brainrots in a player's base:
	  * Guard: stands guard in front of the base's door, pacing across it.
	    When someone who isn't the owner (or in their crew) comes close, it
	    shouts ("!"), then charges and knocks them back; a thief it catches
	    drops what they carry. Then it rests (ExtrasConfig.GuardCooldowns,
	    halved by the Super Guard pass). It's slower than a walking player,
	    never chases far from its post, ignores cloaked players, and a slap
	    dazes it, so stealing still works.
	  * Pets: brainrots that follow their owner around (each client draws
	    them), making them faster (ExtrasConfig.petSpeed). Everyone has one
	    pet slot; more are bought with Cash (ExtrasConfig.PetSlotPrices).
	The brainrots stay on their pedestals and keep earning either way. All of
	it is saved (progress "Companions") and ends when the brainrot leaves the
	base.

	Remote: ReplicatedStorage.Remotes.Companion (RemoteFunction)
	  (action, slot) with action "Guard", "Unguard", "Pet", "Unpet" -> (ok, message)
	  ("BuySlot") -> (ok, message): the next pet slot
	  ("State") -> (true, nil, { Guard = slot?, Pets = { slot, ... }, PetSlots = n })
	Player attributes: GuardSlot (0 = none), PetCapacity (pet slots owned),
	  PetBaseSlots, PetEntries and PetHats (comma lists, one per pet),
	  PetSpeed
	Guard models live in Workspace.Map.Brainrots (State "Guard") with the
	  attributes OwnerUserId, GuardReadyAt (server time), GuardAlert and
	  GuardDazedUntil.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))
local ExtrasConfig = require(Shared:WaitForChild("ExtrasConfig"))
local GearConfig = require(Shared:WaitForChild("GearConfig"))
local NumberFormat = require(Shared:WaitForChild("NumberFormat"))
local TemplateModels = require(Shared:WaitForChild("TemplateModels"))

local LOG_PREFIX = "[CompanionManager]"
local TICK_SECONDS = 0.1
-- Height in studs of a brainrot with Scale 1 (as in GameplayManager).
local FIGURE_HEIGHT = 5.2
local REQUEST_COOLDOWN_SECONDS = 0.4
-- Guards only watch the ground floor of their base.
local GUARD_FLOOR_TOLERANCE = 7

type Companions = { Guard: string?, Pets: { string }, PetSlots: number }

type Guard = {
	Owner: Player,
	Slot: number,
	Entry: string,
	Model: Model,
	Root: BasePart,
	Status: TextLabel,
	-- Its post in front of the door, facing out, and which way is "across".
	Post: CFrame,
	Across: Vector3,
	Interior: BasePart,
	LaserZone: BasePart,
	ReadyAt: number,
	Cooldown: number,
	DazedUntil: number,
	-- Who it's about to charge, and when it charges.
	Target: Player?,
	ChargeAt: number,
	Patrol: number,
}

local dataApi = ServerStorage:WaitForChild("DataAndMonetization")
local gameplayApi = ServerStorage:WaitForChild("Gameplay")
local gearApi = ServerStorage:WaitForChild("Gear")
local getProgressFunction = dataApi:WaitForChild("GetProgress") :: BindableFunction
local setProgressFunction = dataApi:WaitForChild("SetProgress") :: BindableFunction
local ownsGamePassFunction = dataApi:WaitForChild("OwnsGamePass") :: BindableFunction
local spendCashFunction = dataApi:WaitForChild("SpendCash") :: BindableFunction
local describeOccupantsFunction = gameplayApi:WaitForChild("DescribeOccupants") :: BindableFunction
local slotsChangedEvent = gameplayApi:WaitForChild("SlotsChanged") :: BindableEvent
local forceDropEvent = gameplayApi:WaitForChild("ForceDrop") :: BindableEvent
local activityEvent = gameplayApi:WaitForChild("Activity") :: BindableEvent
local knockbackFunction = gearApi:WaitForChild("Knockback") :: BindableFunction
local slapSwingEvent = gearApi:WaitForChild("SlapSwing") :: BindableEvent

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local notifyEvent = remotes:WaitForChild("Notify") :: RemoteEvent
local playSoundEvent = remotes:WaitForChild("PlaySound") :: RemoteEvent

local companionFunction = Instance.new("RemoteFunction")
companionFunction.Name = "Companion"
companionFunction.Parent = remotes

local map = Workspace:WaitForChild("Map")
local plotsFolder = map:WaitForChild("Plots")
local brainrotsFolder = map:WaitForChild("Brainrots")

local guards: { [Player]: Guard } = {}
-- Each player's pets: the base slot and entry of each, in order.
local petSlots: { [Player]: { number } } = {}
local saved: { [Player]: Companions } = {}
local lastRequest: { [Player]: number } = {}

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------

local function notify(player: Player, message: string, kind: string, sound: string?)
	notifyEvent:FireClient(player, message, kind, sound)
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

local function flat(vector: Vector3): Vector3
	return Vector3.new(vector.X, 0, vector.Z)
end

local function sameCrew(a: Player, b: Player): boolean
	local crew = a:GetAttribute("CrewId")
	return crew ~= nil and b:GetAttribute("CrewId") == crew
end

local function plotOf(player: Player): Model?
	for _, plot in plotsFolder:GetChildren() do
		if plot:IsA("Model") and plot:GetAttribute("OwnerUserId") == player.UserId then
			return plot
		end
	end
	return nil
end

-- The brainrots in the player's base by slot.
local function describe(player: Player): { [number]: { [string]: any } }?
	local result = describeOccupantsFunction:Invoke(player)
	if typeof(result) ~= "table" then
		return nil
	end
	local bySlot: { [number]: { [string]: any } } = {}
	for _, info in result do
		if typeof(info) == "table" and typeof(info.Slot) == "number" then
			bySlot[info.Slot] = info
		end
	end
	return bySlot
end

local function saveCompanions(player: Player)
	local companions = saved[player]
	if companions == nil then
		return
	end
	setProgressFunction:Invoke(player, "Companions", {
		Guard = companions.Guard,
		Pets = table.clone(companions.Pets),
		PetSlots = companions.PetSlots,
	})
end

local function brainrotName(entry: string?): string
	local definition = if entry then BrainrotConfig.decode(entry) else nil
	return if definition then definition.DisplayName else "It"
end

--------------------------------------------------------------------------------
-- Guards
--------------------------------------------------------------------------------

local function removeGuard(player: Player)
	local guard = guards[player]
	guards[player] = nil
	if guard then
		guard.Model:Destroy()
	end
	player:SetAttribute("GuardSlot", 0)
end

-- In front of the door, facing out (towards anyone coming).
local function guardPost(plot: Model): (CFrame?, Vector3?, BasePart?, BasePart?)
	local laserZone = plot:FindFirstChild("LaserZone")
	local interior = plot:FindFirstChild("Interior")
	local floor = plot:FindFirstChild("Floor")
	if not (laserZone and laserZone:IsA("BasePart") and interior and interior:IsA("BasePart") and floor and floor:IsA("BasePart")) then
		return nil, nil, nil, nil
	end
	local inward = flat(interior.Position - laserZone.Position)
	inward = if inward.Magnitude > 0.01 then inward.Unit else Vector3.zAxis
	local groundY = floor.Position.Y + floor.Size.Y / 2
	local position = Vector3.new(laserZone.Position.X, groundY, laserZone.Position.Z) - inward * ExtrasConfig.GuardPostDistance
	return CFrame.lookAt(position, position - inward), inward:Cross(Vector3.yAxis), interior, laserZone
end

local function buildGuardModel(player: Player, info: { [string]: any }): (Model?, BasePart?, TextLabel?)
	local definition, mutation, trait = BrainrotConfig.decode(info.Entry)
	if definition == nil then
		return nil, nil, nil
	end
	local height = FIGURE_HEIGHT * definition.Scale * (if trait then trait.Scale else 1)
	local model = Instance.new("Model")
	model.Name = "Guard_" .. player.UserId
	model.ModelStreamingMode = Enum.ModelStreamingMode.Atomic
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
	-- The imported model if there is one (else each client builds it).
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
	model:SetAttribute("State", "Guard")
	model:SetAttribute("Hat", info.Hat)
	model:SetAttribute("OwnerUserId", player.UserId)
	model:SetAttribute("GuardReadyAt", 0)

	local billboard = Instance.new("BillboardGui")
	billboard.Name = "GuardInfo"
	billboard.Adornee = root
	billboard.Size = UDim2.fromScale(6, 1.5)
	billboard.StudsOffsetWorldSpace = Vector3.new(0, height + 1.4, 0)
	billboard.MaxDistance = 90
	billboard.LightInfluence = 0
	local status = Instance.new("TextLabel")
	status.Name = "Status"
	status.BackgroundTransparency = 1
	status.Size = UDim2.fromScale(1, 1)
	status.Font = Enum.Font.FredokaOne
	status.TextScaled = true
	status.TextColor3 = Color3.fromRGB(120, 220, 255)
	status.Text = "🛡️ GUARD"
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 2
	stroke.Parent = status
	status.Parent = billboard
	billboard.Parent = root
	return model, root, status
end

local function setGuard(player: Player, slot: number, info: { [string]: any }): boolean
	removeGuard(player)
	local plot = plotOf(player)
	if plot == nil then
		return false
	end
	local post, across, interior, laserZone = guardPost(plot)
	if post == nil or across == nil or interior == nil or laserZone == nil then
		return false
	end
	local model, root, status = buildGuardModel(player, info)
	if model == nil or root == nil or status == nil then
		return false
	end
	root.CFrame = post
	local superGuard = ownsGamePassFunction:Invoke(player, "SuperGuard") == true
	local cooldown = (ExtrasConfig.GuardCooldowns[info.Rarity] or 20) * (if superGuard then ExtrasConfig.SuperGuardCooldownMultiplier else 1)
	guards[player] = {
		Owner = player,
		Slot = slot,
		Entry = info.Entry,
		Model = model,
		Root = root,
		Status = status,
		Post = post,
		Across = across,
		Interior = interior,
		LaserZone = laserZone,
		ReadyAt = 0,
		Cooldown = cooldown,
		DazedUntil = 0,
		Target = nil,
		ChargeAt = 0,
		Patrol = math.random() * math.pi * 2,
	}
	player:SetAttribute("GuardSlot", slot)
	model.Parent = brainrotsFolder
	return true
end

local function hit(guard: Guard, target: Player, targetRoot: BasePart)
	local owner = guard.Owner
	local now = Workspace:GetServerTimeNow()
	guard.ReadyAt = now + guard.Cooldown
	guard.Target = nil
	guard.Model:SetAttribute("GuardReadyAt", guard.ReadyAt)
	guard.Model:SetAttribute("GuardHit", now)
	-- Away from the guard, and away from the door.
	local direction = flat(targetRoot.Position - guard.Root.Position)
	local outward = guard.Post.LookVector
	direction = (if direction.Magnitude > 0.1 then direction.Unit else outward) + outward * 0.6
	knockbackFunction:Invoke(target, direction, ExtrasConfig.GuardKnockback, ExtrasConfig.GuardStunSeconds)
	playSoundEvent:FireClient(target, "Slap")
	playSoundEvent:FireClient(owner, "Slap")
	local guardName = brainrotName(guard.Entry)
	if target:GetAttribute("Carrying") == true then
		forceDropEvent:Fire(target, string.format("%s's guard %s caught you! You dropped the brainrot.", owner.DisplayName, guardName), owner)
		notify(owner, string.format("Your guard %s caught %s stealing!", guardName, target.DisplayName), "Success", "Notify")
		activityEvent:Fire(owner, "Catch", 1)
	else
		notify(target, string.format("%s's guard %s knocked you away from the base! Slap it to daze it.", owner.DisplayName, guardName), "Warning")
		notify(owner, string.format("Your guard %s knocked %s away from your base!", guardName, target.DisplayName), "Info")
	end
end

-- Someone the guard should go after: not the owner or their crew, not
-- cloaked, on the ground floor and close to its post (or a thief anywhere
-- near, carrying a brainrot).
local function intruderNear(guard: Guard): (Player?, BasePart?)
	local owner = guard.Owner
	local post = guard.Post.Position
	local best, found, foundRoot = math.huge, nil, nil
	for _, other in Players:GetPlayers() do
		if other == owner or sameCrew(other, owner) or other:GetAttribute("Cloaked") == true then
			continue
		end
		local root = getRoot(other)
		if root == nil or math.abs(root.Position.Y - post.Y) > GUARD_FLOOR_TOLERANCE then
			continue
		end
		local fromPost = flat(root.Position - post).Magnitude
		local reach = if other:GetAttribute("Carrying") == true then ExtrasConfig.GuardLeash else ExtrasConfig.GuardRadius
		if fromPost <= reach and fromPost < best then
			best, found, foundRoot = fromPost, other, root
		end
	end
	return found, foundRoot
end

local function stepGuard(guard: Guard, dt: number)
	local now = Workspace:GetServerTimeNow()
	local post = guard.Post.Position
	local position = guard.Root.Position
	local dazed = now < guard.DazedUntil
	local ready = now >= guard.ReadyAt and not dazed

	-- Spot someone, shout, then charge after the wind-up.
	local target: Player? = nil
	local targetRoot: BasePart? = nil
	if ready then
		local spotted, spottedRoot = intruderNear(guard)
		if spotted and spottedRoot then
			if guard.Target ~= spotted then
				guard.Target = spotted
				guard.ChargeAt = now + ExtrasConfig.GuardWindupSeconds
				guard.Model:SetAttribute("GuardAlert", now)
				playSoundEvent:FireClient(spotted, "Alarm")
			end
			target, targetRoot = spotted, spottedRoot
		else
			guard.Target = nil
		end
	else
		guard.Target = nil
	end
	local charging = target ~= nil and now >= guard.ChargeAt

	-- Where to go: after the intruder (on a leash), or pacing across the door.
	local goal: Vector3
	local speed: number
	if dazed then
		goal, speed = position, 0
	elseif charging and targetRoot then
		goal = Vector3.new(targetRoot.Position.X, post.Y, targetRoot.Position.Z)
		local leash = goal - post
		if leash.Magnitude > ExtrasConfig.GuardLeash then
			goal = post + leash.Unit * ExtrasConfig.GuardLeash
		end
		speed = ExtrasConfig.GuardChaseSpeed
	elseif target then
		-- Winding up: stands still, facing them.
		goal, speed = position, 0
	else
		guard.Patrol += dt * ExtrasConfig.GuardPatrolSpeed / math.max(ExtrasConfig.GuardPatrolWidth, 0.1)
		goal = post + guard.Across * math.sin(guard.Patrol) * ExtrasConfig.GuardPatrolWidth
		speed = ExtrasConfig.GuardChaseSpeed * 0.6
	end
	local offset = flat(goal - position)
	local distance = offset.Magnitude
	local facing = if target and targetRoot then flat(targetRoot.Position - position) else offset
	if distance > 0.2 and speed > 0 then
		local nextPosition = Vector3.new(position.X, post.Y, position.Z) + offset.Unit * math.min(distance, speed * dt)
		local look = if facing.Magnitude > 0.05 then facing.Unit else guard.Post.LookVector
		guard.Root.CFrame = CFrame.lookAt(nextPosition, nextPosition + look)
	elseif facing.Magnitude > 0.05 and not dazed then
		guard.Root.CFrame = CFrame.lookAt(position, position + facing.Unit)
	end

	if charging and target and targetRoot then
		local gap = flat(targetRoot.Position - guard.Root.Position).Magnitude
		if gap <= ExtrasConfig.GuardHitDistance then
			hit(guard, target, targetRoot)
		end
	end

	local text, colour
	if dazed then
		text, colour = string.format("😵 %ds", math.ceil(guard.DazedUntil - now)), Color3.fromRGB(255, 220, 90)
	elseif now < guard.ReadyAt then
		text, colour = string.format("💤 %ds", math.ceil(guard.ReadyAt - now)), Color3.fromRGB(200, 200, 210)
	elseif target then
		text, colour = "❗", Color3.fromRGB(255, 80, 80)
	else
		text, colour = "🛡️ GUARD", Color3.fromRGB(120, 220, 255)
	end
	if guard.Status.Text ~= text then
		guard.Status.Text = text
		guard.Status.TextColor3 = colour
	end
end

-- A slap glove swung at someone else's guard dazes it.
slapSwingEvent.Event:Connect(function(playerArg: any)
	if typeof(playerArg) ~= "Instance" or not playerArg:IsA("Player") then
		return
	end
	local slapper = playerArg :: Player
	local root = getRoot(slapper)
	if root == nil then
		return
	end
	for owner, guard in guards do
		if owner == slapper or sameCrew(owner, slapper) then
			continue
		end
		local offset = flat(guard.Root.Position - root.Position)
		if offset.Magnitude <= GearConfig.SlapRange + 2 and (offset.Magnitude < 1 or root.CFrame.LookVector:Dot(offset.Unit) > 0.2) then
			local now = Workspace:GetServerTimeNow()
			guard.DazedUntil = now + ExtrasConfig.GuardDazeSeconds
			guard.Target = nil
			guard.Model:SetAttribute("GuardDazedUntil", guard.DazedUntil)
			notify(slapper, string.format("You dazed %s's guard for %ds. Go go go!", owner.DisplayName, ExtrasConfig.GuardDazeSeconds), "Success")
			notify(owner, string.format("%s dazed your guard!", slapper.DisplayName), "Warning")
		end
	end
end)

--------------------------------------------------------------------------------
-- Pets
--------------------------------------------------------------------------------

-- Tells every client what to draw and sets the speed bonus.
local function publishPets(player: Player, occupants: { [number]: { [string]: any } }?)
	local slots: { number } = petSlots[player] or {}
	local entries, hats, rarities = {}, {}, {}
	for _, slot in slots do
		local info = if occupants then occupants[slot] else nil
		if info then
			table.insert(entries, info.Entry)
			table.insert(hats, if typeof(info.Hat) == "string" then info.Hat else "")
			table.insert(rarities, info.Rarity)
		end
	end
	local companions = saved[player]
	player:SetAttribute("PetCapacity", if companions then companions.PetSlots else 1)
	player:SetAttribute("PetBaseSlots", if #slots > 0 then table.concat(slots, ",") else nil)
	player:SetAttribute("PetEntries", if #entries > 0 then table.concat(entries, ",") else nil)
	player:SetAttribute("PetHats", if #hats > 0 then table.concat(hats, ",") else nil)
	player:SetAttribute("PetSpeed", if #rarities > 0 then ExtrasConfig.petSpeed(rarities) else 0)
end

local function clearPets(player: Player)
	petSlots[player] = {}
	publishPets(player, nil)
end

--------------------------------------------------------------------------------
-- Keeping up with the base
--------------------------------------------------------------------------------

-- Finds where a saved companion is now: the same slot if it still holds the
-- same brainrot, else any free slot with one like it.
local function findSlot(occupants: { [number]: { [string]: any } }, entry: string?, preferred: number?, taken: { [number]: boolean }): number?
	if entry == nil then
		return nil
	end
	if preferred and not taken[preferred] then
		local info = occupants[preferred]
		if info and info.Entry == entry then
			return preferred
		end
	end
	for slot, info in occupants do
		if info.Entry == entry and not taken[slot] then
			return slot
		end
	end
	return nil
end

local function refresh(player: Player)
	local occupants = describe(player)
	local companions = saved[player]
	if occupants == nil or companions == nil then
		return
	end
	local changed = false
	local taken: { [number]: boolean } = {}

	local guard = guards[player]
	local guardSlot = findSlot(occupants, companions.Guard, if guard then guard.Slot else nil, taken)
	if guardSlot then
		taken[guardSlot] = true
		local info = occupants[guardSlot]
		if guard == nil or guard.Slot ~= guardSlot then
			setGuard(player, guardSlot, info)
		else
			guard.Model:SetAttribute("Hat", info.Hat)
		end
	elseif companions.Guard then
		removeGuard(player)
		companions.Guard = nil
		changed = true
		notify(player, "Your guard left the base with its brainrot.", "Warning")
	end

	local oldSlots: { number } = petSlots[player] or {}
	local newSlots: { number } = {}
	local keptEntries: { string } = {}
	for index, entry in companions.Pets do
		local slot = findSlot(occupants, entry, oldSlots[index], taken)
		if slot then
			taken[slot] = true
			table.insert(newSlots, slot)
			table.insert(keptEntries, entry)
		else
			changed = true
			notify(player, string.format("Your pet %s went with its brainrot.", brainrotName(entry)), "Warning")
		end
	end
	companions.Pets = keptEntries
	petSlots[player] = newSlots
	publishPets(player, occupants)
	if changed then
		saveCompanions(player)
	end
end

local function onDataLoaded(player: Player)
	local stored = getProgressFunction:Invoke(player, "Companions")
	local pets: { string } = {}
	if typeof(stored) == "table" then
		if typeof(stored.Pets) == "table" then
			for _, entry in stored.Pets do
				if typeof(entry) == "string" and #pets < ExtrasConfig.MaxPetSlots then
					table.insert(pets, entry)
				end
			end
		elseif typeof(stored.Pet) == "string" then
			-- Saved before there could be several.
			table.insert(pets, stored.Pet)
		end
	end
	local owned = if typeof(stored) == "table" then math.floor(tonumber(stored.PetSlots) or 1) else 1
	owned = math.clamp(owned, 1, ExtrasConfig.MaxPetSlots)
	while #pets > owned do
		table.remove(pets)
	end
	saved[player] = {
		Guard = if typeof(stored) == "table" and typeof(stored.Guard) == "string" then stored.Guard else nil,
		Pets = pets,
		PetSlots = owned,
	}
	player:SetAttribute("GuardSlot", 0)
	clearPets(player)
	-- The base is filled right after the data loads.
	for _ = 1, 60 do
		if player.Parent ~= Players then
			return
		end
		if describe(player) ~= nil then
			refresh(player)
			return
		end
		task.wait(1)
	end
end

slotsChangedEvent.Event:Connect(function(player: any)
	if typeof(player) == "Instance" and player:IsA("Player") and saved[player] then
		refresh(player)
	end
end)

--------------------------------------------------------------------------------
-- Requests
--------------------------------------------------------------------------------

local function buySlot(player: Player, companions: Companions): (boolean, string?)
	local next = companions.PetSlots + 1
	local price = ExtrasConfig.PetSlotPrices[next]
	if price == nil then
		return false, "You have every pet slot!"
	end
	if spendCashFunction:Invoke(player, price) ~= true then
		return false, string.format("Pet slot %d costs %s.", next, NumberFormat.cash(price))
	end
	companions.PetSlots = next
	saveCompanions(player)
	publishPets(player, describe(player))
	return true, string.format("Pet slot %d unlocked! Pick another brainrot to follow you.", next)
end

companionFunction.OnServerInvoke = function(player: Player, action: any, slot: any): (boolean, string?, any)
	local companions = saved[player]
	if companions == nil then
		return false, "Still loading, try again in a moment."
	end
	if action == "State" then
		local guard = guards[player]
		return true, nil, { Guard = if guard then guard.Slot else nil, Pets = table.clone(petSlots[player] or {}), PetSlots = companions.PetSlots }
	end
	local now = os.clock()
	if now - (lastRequest[player] or 0) < REQUEST_COOLDOWN_SECONDS then
		return false, "Slow down!"
	end
	lastRequest[player] = now

	if action == "BuySlot" then
		return buySlot(player, companions)
	elseif action == "Unguard" then
		removeGuard(player)
		companions.Guard = nil
		saveCompanions(player)
		return true, "Your guard is off duty."
	elseif action == "Unpet" then
		local slots: { number } = petSlots[player] or {}
		local index = if typeof(slot) == "number" then table.find(slots, slot) else nil
		if index == nil then
			return false, "That brainrot isn't one of your pets."
		end
		local name = brainrotName(companions.Pets[index])
		table.remove(slots, index)
		table.remove(companions.Pets, index)
		saveCompanions(player)
		publishPets(player, describe(player))
		return true, string.format("%s went back to its pedestal.", name)
	end

	local occupants = describe(player)
	local info = if occupants and typeof(slot) == "number" then occupants[slot] else nil
	if info == nil then
		return false, "That brainrot isn't in your base."
	end
	if not info.Home then
		return false, "Wait until it's back on its pedestal."
	end
	local name = brainrotName(info.Entry)
	local slots: { number } = petSlots[player] or {}
	if action == "Guard" then
		if table.find(slots, slot) then
			return false, "That's one of your pets! Pick another brainrot to guard."
		end
		if not setGuard(player, slot, info) then
			return false, "Your base has no door to guard."
		end
		companions.Guard = info.Entry
		saveCompanions(player)
		return true, string.format("%s is guarding your base! It stands at the door and knocks away anyone who comes close.", name)
	elseif action == "Pet" then
		local guard = guards[player]
		if guard and guard.Slot == slot then
			return false, "That's your guard! Pick another brainrot as a pet."
		end
		if table.find(slots, slot) then
			return false, "It's already following you."
		end
		if #slots >= companions.PetSlots then
			local price = ExtrasConfig.PetSlotPrices[companions.PetSlots + 1]
			return false,
				if price
					then string.format("All %d pet slots are full. Put a pet back, or buy another slot for %s (Pets button).", companions.PetSlots, NumberFormat.cash(price))
					else "All your pet slots are full. Put a pet back first."
		end
		table.insert(slots, slot)
		table.insert(companions.Pets, info.Entry)
		petSlots[player] = slots
		saveCompanions(player)
		publishPets(player, occupants)
		return true, string.format("%s is following you! Walk speed +%s.", name, tostring(player:GetAttribute("PetSpeed")))
	end
	return false, nil
end

--------------------------------------------------------------------------------
-- Players and the loop
--------------------------------------------------------------------------------

local function onPlayerAdded(player: Player)
	if player:GetAttribute("DataLoaded") == true then
		task.spawn(onDataLoaded, player)
		return
	end
	local connection: RBXScriptConnection? = nil
	connection = player:GetAttributeChangedSignal("DataLoaded"):Connect(function()
		if player:GetAttribute("DataLoaded") == true then
			if connection then
				connection:Disconnect()
			end
			onDataLoaded(player)
		end
	end)
end

Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(function(player: Player)
	removeGuard(player)
	saved[player] = nil
	petSlots[player] = nil
	lastRequest[player] = nil
end)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

task.spawn(function()
	local last = os.clock()
	while true do
		task.wait(TICK_SECONDS)
		local now = os.clock()
		local dt = math.min(now - last, 0.5)
		last = now
		for _, guard in guards do
			local ok, err = pcall(function()
				stepGuard(guard, dt)
			end)
			if not ok then
				warn(string.format("%s Guard failed: %s", LOG_PREFIX, tostring(err)))
			end
		end
	end
end)

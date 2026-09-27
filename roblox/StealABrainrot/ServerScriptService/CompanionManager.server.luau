--!strict
--[[
	CompanionManager
	Location: ServerScriptService (Script)

	Guards and pets, picked from the brainrots in a player's base:
	  * Guard: stands just inside the base's door. When someone who isn't the
	    owner (or in their crew) walks into the base, or runs by carrying a
	    brainrot, it chases them and knocks them back; a thief it catches drops
	    what they carry. Then it rests a while (ExtrasConfig.GuardCooldowns,
	    halved by the Super Guard pass).
	  * Pet: follows its owner around (each client draws it) and makes them a
	    little faster (ExtrasConfig.PetSpeedBonus).
	The brainrot stays on its pedestal and keeps earning either way. Both are
	saved (progress "Companions") and end when the brainrot leaves the base.

	Remote: ReplicatedStorage.Remotes.Companion (RemoteFunction)
	  (action, slot) with action "Guard", "Unguard", "Pet", "Unpet" -> (ok, message)
	  ("State") -> (true, nil, { Guard = slot?, Pet = slot? })
	Player attributes: GuardSlot and PetSlot (0 = none), PetEntry, PetHat,
	  PetLevel, PetSpeed
	Guard models live in Workspace.Map.Brainrots (State "Guard") with the
	  attributes OwnerUserId and GuardReadyAt (server time).
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))
local ExtrasConfig = require(Shared:WaitForChild("ExtrasConfig"))

local LOG_PREFIX = "[CompanionManager]"
local TICK_SECONDS = 0.1
-- Height in studs of a brainrot with Scale 1 (as in GameplayManager).
local FIGURE_HEIGHT = 5.2
local REQUEST_COOLDOWN_SECONDS = 0.4
-- Guards only watch the ground floor of their base.
local GUARD_FLOOR_TOLERANCE = 7

type Companions = { Guard: string?, Pet: string? }

type Guard = {
	Owner: Player,
	Slot: number,
	Entry: string,
	Model: Model,
	Root: BasePart,
	Status: TextLabel,
	Home: CFrame,
	Interior: BasePart,
	LaserZone: BasePart,
	ReadyAt: number,
	Cooldown: number,
}

local dataApi = ServerStorage:WaitForChild("DataAndMonetization")
local gameplayApi = ServerStorage:WaitForChild("Gameplay")
local gearApi = ServerStorage:WaitForChild("Gear")
local getProgressFunction = dataApi:WaitForChild("GetProgress") :: BindableFunction
local setProgressFunction = dataApi:WaitForChild("SetProgress") :: BindableFunction
local ownsGamePassFunction = dataApi:WaitForChild("OwnsGamePass") :: BindableFunction
local describeOccupantsFunction = gameplayApi:WaitForChild("DescribeOccupants") :: BindableFunction
local slotsChangedEvent = gameplayApi:WaitForChild("SlotsChanged") :: BindableEvent
local forceDropEvent = gameplayApi:WaitForChild("ForceDrop") :: BindableEvent
local activityEvent = gameplayApi:WaitForChild("Activity") :: BindableEvent
local knockbackFunction = gearApi:WaitForChild("Knockback") :: BindableFunction

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
local petSlots: { [Player]: number } = {}
local petEntries: { [Player]: string } = {}
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

local function isInside(part: BasePart, position: Vector3, margin: number): boolean
	local localPosition = part.CFrame:PointToObjectSpace(position)
	local half = part.Size / 2 + Vector3.one * margin
	return math.abs(localPosition.X) <= half.X and math.abs(localPosition.Y) <= half.Y + 6 and math.abs(localPosition.Z) <= half.Z
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
	local companions: Companions = saved[player] or {}
	setProgressFunction:Invoke(player, "Companions", { Guard = companions.Guard, Pet = companions.Pet })
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

-- Just inside the door, facing out.
local function guardHome(plot: Model): (CFrame?, BasePart?, BasePart?)
	local laserZone = plot:FindFirstChild("LaserZone")
	local interior = plot:FindFirstChild("Interior")
	local floor = plot:FindFirstChild("Floor")
	if not (laserZone and laserZone:IsA("BasePart") and interior and interior:IsA("BasePart") and floor and floor:IsA("BasePart")) then
		return nil, nil, nil
	end
	local inward = interior.Position - laserZone.Position
	inward = Vector3.new(inward.X, 0, inward.Z)
	inward = if inward.Magnitude > 0.01 then inward.Unit else Vector3.zAxis
	local groundY = floor.Position.Y + floor.Size.Y / 2
	local position = Vector3.new(laserZone.Position.X, groundY, laserZone.Position.Z) + inward * 6
	return CFrame.lookAt(position, position - inward), interior, laserZone
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
	model:SetAttribute("BrainrotId", definition.Id)
	model:SetAttribute("FigureHeight", height)
	model:SetAttribute("CustomModel", false)
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
	local home, interior, laserZone = guardHome(plot)
	if home == nil or interior == nil or laserZone == nil then
		return false
	end
	local model, root, status = buildGuardModel(player, info)
	if model == nil or root == nil or status == nil then
		return false
	end
	root.CFrame = home
	local superGuard = ownsGamePassFunction:Invoke(player, "SuperGuard") == true
	local cooldown = (ExtrasConfig.GuardCooldowns[info.Rarity] or 20) * (if superGuard then ExtrasConfig.SuperGuardCooldownMultiplier else 1)
	guards[player] = {
		Owner = player,
		Slot = slot,
		Entry = info.Entry,
		Model = model,
		Root = root,
		Status = status,
		Home = home,
		Interior = interior,
		LaserZone = laserZone,
		ReadyAt = 0,
		Cooldown = cooldown,
	}
	player:SetAttribute("GuardSlot", slot)
	model.Parent = brainrotsFolder
	return true
end

local function hit(guard: Guard, target: Player, targetRoot: BasePart)
	local owner = guard.Owner
	local now = Workspace:GetServerTimeNow()
	guard.ReadyAt = now + guard.Cooldown
	guard.Model:SetAttribute("GuardReadyAt", guard.ReadyAt)
	guard.Model:SetAttribute("GuardHit", now)
	local direction = targetRoot.Position - guard.Root.Position
	knockbackFunction:Invoke(target, direction, ExtrasConfig.GuardKnockback, ExtrasConfig.GuardStunSeconds)
	playSoundEvent:FireClient(target, "Slap")
	playSoundEvent:FireClient(owner, "Slap")
	local name = BrainrotConfig.ById[guard.Model:GetAttribute("BrainrotId") :: string]
	local guardName = if name then name.DisplayName else "guard"
	if target:GetAttribute("Carrying") == true then
		forceDropEvent:Fire(target, string.format("%s's guard %s caught you! You dropped the brainrot.", owner.DisplayName, guardName), owner)
		notify(owner, string.format("Your guard %s caught %s stealing!", guardName, target.DisplayName), "Success", "Notify")
		activityEvent:Fire(owner, "Catch", 1)
	else
		notify(target, string.format("%s's guard %s knocked you out of the base!", owner.DisplayName, guardName), "Warning")
		notify(owner, string.format("Your guard %s knocked %s out of your base!", guardName, target.DisplayName), "Info")
	end
end

local function stepGuard(guard: Guard, dt: number)
	local owner = guard.Owner
	local now = Workspace:GetServerTimeNow()
	local home = guard.Home.Position
	local position = guard.Root.Position
	local ready = now >= guard.ReadyAt

	local target: Player? = nil
	local targetRoot: BasePart? = nil
	if ready then
		local best = math.huge
		for _, other in Players:GetPlayers() do
			if other == owner or sameCrew(other, owner) then
				continue
			end
			local root = getRoot(other)
			if root == nil or math.abs(root.Position.Y - home.Y) > GUARD_FLOOR_TOLERANCE then
				continue
			end
			local fromHome = Vector3.new(root.Position.X - home.X, 0, root.Position.Z - home.Z).Magnitude
			local inBase = isInside(guard.Interior, root.Position, 0) or isInside(guard.LaserZone, root.Position, 1)
			local thief = other:GetAttribute("Carrying") == true
			if fromHome <= ExtrasConfig.GuardRadius and (inBase or thief) and fromHome < best then
				best, target, targetRoot = fromHome, other, root
			end
		end
	end

	local goal = home
	if target and targetRoot then
		goal = Vector3.new(targetRoot.Position.X, home.Y, targetRoot.Position.Z)
		-- A leash: it never runs far from its door.
		local leash = goal - home
		if leash.Magnitude > ExtrasConfig.GuardRadius + 4 then
			goal = home + leash.Unit * (ExtrasConfig.GuardRadius + 4)
		end
	end
	local offset = Vector3.new(goal.X - position.X, 0, goal.Z - position.Z)
	local distance = offset.Magnitude
	local speed = if target then ExtrasConfig.GuardChaseSpeed else ExtrasConfig.GuardChaseSpeed * 0.5
	if distance > 0.2 then
		local step = math.min(distance, speed * dt)
		local nextPosition = Vector3.new(position.X, home.Y, position.Z) + offset.Unit * step
		guard.Root.CFrame = CFrame.lookAt(nextPosition, nextPosition + offset.Unit)
	elseif target == nil and (guard.Root.CFrame.LookVector - guard.Home.LookVector).Magnitude > 0.05 then
		guard.Root.CFrame = guard.Home
	end

	if target and targetRoot then
		local gap = Vector3.new(targetRoot.Position.X - guard.Root.Position.X, 0, targetRoot.Position.Z - guard.Root.Position.Z).Magnitude
		if gap <= ExtrasConfig.GuardHitDistance then
			hit(guard, target, targetRoot)
		end
	end

	local text = if now >= guard.ReadyAt then "🛡️ GUARD" else string.format("💤 %ds", math.ceil(guard.ReadyAt - now))
	if guard.Status.Text ~= text then
		guard.Status.Text = text
		guard.Status.TextColor3 = if now >= guard.ReadyAt then Color3.fromRGB(120, 220, 255) else Color3.fromRGB(200, 200, 210)
	end
end

--------------------------------------------------------------------------------
-- Pets
--------------------------------------------------------------------------------

local function clearPet(player: Player)
	petSlots[player] = nil
	petEntries[player] = nil
	player:SetAttribute("PetSlot", 0)
	player:SetAttribute("PetEntry", nil)
	player:SetAttribute("PetHat", nil)
	player:SetAttribute("PetLevel", nil)
	player:SetAttribute("PetSpeed", 0)
end

local function setPet(player: Player, slot: number, info: { [string]: any })
	petSlots[player] = slot
	petEntries[player] = info.Entry
	player:SetAttribute("PetSlot", slot)
	player:SetAttribute("PetEntry", info.Entry)
	player:SetAttribute("PetHat", info.Hat)
	player:SetAttribute("PetLevel", info.Level)
	player:SetAttribute("PetSpeed", ExtrasConfig.PetSpeedBonus[info.Rarity] or 1)
end

--------------------------------------------------------------------------------
-- Keeping up with the base
--------------------------------------------------------------------------------

-- Finds where a saved companion is now: the same slot if it still holds the
-- same brainrot, else any slot with one like it.
local function findSlot(occupants: { [number]: { [string]: any } }, entry: string?, preferred: number?, avoid: number?): number?
	if entry == nil then
		return nil
	end
	if preferred and preferred ~= avoid then
		local info = occupants[preferred]
		if info and info.Entry == entry then
			return preferred
		end
	end
	for slot, info in occupants do
		if info.Entry == entry and slot ~= avoid then
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

	local guard = guards[player]
	local guardSlot = findSlot(occupants, companions.Guard, if guard then guard.Slot else nil, nil)
	if guardSlot then
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

	local petSlot = findSlot(occupants, companions.Pet, petSlots[player], guardSlot)
	if petSlot then
		setPet(player, petSlot, occupants[petSlot])
	elseif companions.Pet then
		clearPet(player)
		companions.Pet = nil
		changed = true
		notify(player, "Your pet went with its brainrot.", "Warning")
	end
	if changed then
		saveCompanions(player)
	end
end

local function onDataLoaded(player: Player)
	local stored = getProgressFunction:Invoke(player, "Companions")
	saved[player] = {
		Guard = if typeof(stored) == "table" and typeof(stored.Guard) == "string" then stored.Guard else nil,
		Pet = if typeof(stored) == "table" and typeof(stored.Pet) == "string" then stored.Pet else nil,
	}
	player:SetAttribute("GuardSlot", 0)
	clearPet(player)
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

companionFunction.OnServerInvoke = function(player: Player, action: any, slot: any): (boolean, string?, any)
	local companions = saved[player]
	if companions == nil then
		return false, "Still loading, try again in a moment."
	end
	if action == "State" then
		local guard = guards[player]
		return true, nil, { Guard = if guard then guard.Slot else nil, Pet = petSlots[player] }
	end
	local now = os.clock()
	if now - (lastRequest[player] or 0) < REQUEST_COOLDOWN_SECONDS then
		return false, "Slow down!"
	end
	lastRequest[player] = now

	if action == "Unguard" then
		removeGuard(player)
		companions.Guard = nil
		saveCompanions(player)
		return true, "Your guard is off duty."
	elseif action == "Unpet" then
		clearPet(player)
		companions.Pet = nil
		saveCompanions(player)
		return true, "Your pet went back to its pedestal."
	end

	local occupants = describe(player)
	local info = if occupants and typeof(slot) == "number" then occupants[slot] else nil
	if info == nil then
		return false, "That brainrot isn't in your base."
	end
	if not info.Home then
		return false, "Wait until it's back on its pedestal."
	end
	local definition = BrainrotConfig.decode(info.Entry)
	local name = if definition then definition.DisplayName else "It"
	if action == "Guard" then
		if petSlots[player] == slot then
			return false, "That's your pet! Pick another brainrot to guard."
		end
		if not setGuard(player, slot, info) then
			return false, "Your base has no door to guard."
		end
		companions.Guard = info.Entry
		saveCompanions(player)
		return true, string.format("%s is guarding your base! It knocks out anyone who walks in.", name)
	elseif action == "Pet" then
		local guard = guards[player]
		if guard and guard.Slot == slot then
			return false, "That's your guard! Pick another brainrot as a pet."
		end
		setPet(player, slot, info)
		companions.Pet = info.Entry
		saveCompanions(player)
		return true, string.format("%s is following you! +%s walk speed.", name, tostring(ExtrasConfig.PetSpeedBonus[info.Rarity] or 1))
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
	petEntries[player] = nil
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

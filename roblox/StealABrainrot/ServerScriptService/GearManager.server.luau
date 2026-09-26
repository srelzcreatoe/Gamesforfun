--!strict
--[[
	GearManager
	Location: ServerScriptService (Script)

	The Gear Shop: sells the gear in GearConfig for Cash, saves what each player
	owns, hands the tools out on every spawn and makes them work:
	  Slap                a big glove on a stick that knocks other players
	                      back; a slapped thief drops the brainrot they carry
	  Speed Coil          runs faster while held
	  Gravity Coil        jumps much higher while held
	  Invisibility Cloak  click to turn invisible for a few seconds; grabbing a
	                      brainrot reveals you
	Coils do nothing while carrying a stolen brainrot, so thieves stay catchable.

	Troll items bought with Robux come as charges (saved by the data manager)
	and show up as tools while you have charges left:
	  Freeze Ray   freezes the player you face in a block of ice
	  Spike Trap   placed at your feet; whoever steps on it gets stuck
	  Land Mine    placed at your feet; launches whoever steps on it
	  Boogie Bomb  everyone around you dances and can't move
	Each makes a thief drop the brainrot they are carrying.

	Everything is decided here: the client only equips and clicks tools (which
	Roblox reports to the server) and calls BuyGear, which is re-checked
	(known gear, not owned yet, near the Gear Shop, enough Cash).

	Client-facing state:
	  ReplicatedStorage.Remotes.BuyGear (RemoteFunction: gearId -> (ok, message))
	  Player attribute OwnedGear (comma-separated gear IDs)
	  Player attribute Stunned (string: "Frozen" | "Spiked" | "Launched" |
	    "Dancing") while a troll item holds them
	  Workspace.Map.Traps (placed spike traps and land mines)
]]

local Debris = game:GetService("Debris")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local GameConfig = require(Shared:WaitForChild("GameConfig"))
local GearConfig = require(Shared:WaitForChild("GearConfig"))
local NumberFormat = require(Shared:WaitForChild("NumberFormat"))

type Gear = GearConfig.Gear
type TrollItem = GearConfig.TrollItem

-- A placed spike trap or land mine.
type Trap = {
	Kind: string,
	Owner: Player,
	Model: Model,
	Position: Vector3,
	ExpiresAt: number,
	Light: BasePart?,
}

local BUY_COOLDOWN_SECONDS = 0.5
local KNOCKBACK_SECONDS = 0.18
local TRAP_CHECK_SECONDS = 0.1
-- Roblox's R15 "dance" emote animation.
local DANCE_ANIMATION_ID = "rbxassetid://507771019"

local dataApi = ServerStorage:WaitForChild("DataAndMonetization")
local getGearFunction = dataApi:WaitForChild("GetGear") :: BindableFunction
local addGearFunction = dataApi:WaitForChild("AddGear") :: BindableFunction
local spendCashFunction = dataApi:WaitForChild("SpendCash") :: BindableFunction
local addCashFunction = dataApi:WaitForChild("AddCash") :: BindableFunction
local getItemsFunction = dataApi:WaitForChild("GetItems") :: BindableFunction
local useItemChargeFunction = dataApi:WaitForChild("UseItemCharge") :: BindableFunction
local itemsChangedEvent = dataApi:WaitForChild("ItemsChanged") :: BindableEvent
local forceDropEvent = ServerStorage:WaitForChild("Gameplay"):WaitForChild("ForceDrop") :: BindableEvent

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local notifyEvent = remotes:WaitForChild("Notify") :: RemoteEvent
local playSoundEvent = remotes:WaitForChild("PlaySound") :: RemoteEvent

local buyGearFunction = Instance.new("RemoteFunction")
buyGearFunction.Name = "BuyGear"
buyGearFunction.Parent = remotes

local lastBuyRequest: { [Player]: number } = {}
local lastSlap: { [Player]: number } = {}
local lastCloak: { [Player]: number } = {}
-- Parts hidden by the cloak and the transparency to give back.
local cloaked: { [Player]: { [Instance]: number } } = {}
local lastItemUse: { [Player]: number } = {}
-- Players held in place by a troll item, until this os.clock() time.
local stunnedUntil: { [Player]: number } = {}
local traps: { Trap } = {}

local trapsFolder = Instance.new("Folder")
trapsFolder.Name = "Traps"
trapsFolder.Parent = Workspace:WaitForChild("Map")

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------

local function notify(player: Player, message: string, kind: string, sound: string?)
	notifyEvent:FireClient(player, message, kind, sound)
end

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

local function getOwnedGear(player: Player): { string }
	local owned: { string } = {}
	for _, gear in GearConfig.Gear do
		if gear.Price <= 0 then
			table.insert(owned, gear.Id)
		end
	end
	local saved = getGearFunction:Invoke(player)
	if typeof(saved) == "table" then
		for _, gearId in saved do
			if typeof(gearId) == "string" and GearConfig.ById[gearId] and table.find(owned, gearId) == nil then
				table.insert(owned, gearId)
			end
		end
	end
	return owned
end

local function equippedGearId(player: Player): string?
	local character = player.Character
	local tool = if character then character:FindFirstChildOfClass("Tool") else nil
	local gearId = if tool then tool:GetAttribute("GearId") else nil
	return if typeof(gearId) == "string" then gearId else nil
end

-- Walk speed and jump height from the held gear. GameplayManager sets
-- Carrying while a stolen brainrot is carried; coils don't work then.
local function applyMovement(player: Player)
	local _, humanoid = getLiveCharacter(player)
	if humanoid == nil then
		return
	end
	local carrying = player:GetAttribute("Carrying") == true
	local gearId = if carrying then nil else equippedGearId(player)
	local stunned = (stunnedUntil[player] or 0) > os.clock()
	if stunned then
		humanoid.WalkSpeed = 0
		humanoid.UseJumpPower = false
		humanoid.JumpHeight = 0
		return
	end
	humanoid.WalkSpeed = if carrying
		then GameConfig.CarryWalkSpeed
		elseif gearId == "SpeedCoil" then GameConfig.DefaultWalkSpeed + GearConfig.SpeedCoilBonus
		else GameConfig.DefaultWalkSpeed
	humanoid.UseJumpPower = false
	humanoid.JumpHeight = if gearId == "GravityCoil" then GearConfig.GravityCoilJumpHeight else GearConfig.DefaultJumpHeight
end

--------------------------------------------------------------------------------
-- Invisibility Cloak
--------------------------------------------------------------------------------

local function uncloak(player: Player, message: string?)
	local hidden = cloaked[player]
	if hidden == nil then
		return
	end
	cloaked[player] = nil
	for instance, transparency in hidden do
		if instance:IsA("BasePart") then
			instance.Transparency = transparency
		elseif instance:IsA("Decal") then
			instance.Transparency = transparency
		end
	end
	local _, humanoid = getLiveCharacter(player)
	if humanoid then
		humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.Viewer
	end
	if message then
		notify(player, message, "Warning")
	end
end

local function cloak(player: Player)
	local rootPart, humanoid = getLiveCharacter(player)
	local character = player.Character
	if rootPart == nil or humanoid == nil or character == nil or cloaked[player] then
		return
	end
	if player:GetAttribute("Carrying") == true then
		notify(player, "You can't hide while carrying a brainrot!", "Error")
		return
	end
	local now = os.clock()
	local last = lastCloak[player]
	if last and now - last < GearConfig.CloakCooldownSeconds then
		notify(player, string.format("The cloak recharges in %ds.", math.ceil(GearConfig.CloakCooldownSeconds - (now - last))), "Warning")
		return
	end
	lastCloak[player] = now

	local hidden: { [Instance]: number } = {}
	for _, descendant in character:GetDescendants() do
		if descendant:IsA("BasePart") and descendant ~= rootPart then
			hidden[descendant] = descendant.Transparency
			descendant.Transparency = 1
		elseif descendant:IsA("Decal") then
			hidden[descendant] = descendant.Transparency
			descendant.Transparency = 1
		end
	end
	cloaked[player] = hidden
	humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
	notify(player, string.format("You're invisible for %d seconds!", GearConfig.CloakSeconds), "Success", "Cloak")

	task.delay(GearConfig.CloakSeconds, function()
		if cloaked[player] == hidden then
			uncloak(player, "You're visible again.")
		end
	end)
end

--------------------------------------------------------------------------------
-- Slap
--------------------------------------------------------------------------------

local function knockback(rootPart: BasePart, direction: Vector3)
	local attachment = rootPart:FindFirstChild("RootAttachment")
	if attachment == nil or not attachment:IsA("Attachment") then
		local created = Instance.new("Attachment")
		created.Name = "SlapAttachment"
		created.Parent = rootPart
		attachment = created
	end
	-- The constraint replicates to the player's own client, which simulates
	-- their character, so the push works on player-owned physics.
	local velocity = Instance.new("LinearVelocity")
	velocity.Name = "SlapKnockback"
	velocity.Attachment0 = attachment :: Attachment
	velocity.RelativeTo = Enum.ActuatorRelativeTo.World
	velocity.VelocityConstraintMode = Enum.VelocityConstraintMode.Vector
	velocity.MaxForce = 1e6
	velocity.VectorVelocity = direction * GearConfig.SlapKnockback + Vector3.new(0, 30, 0)
	velocity.Parent = rootPart
	Debris:AddItem(velocity, KNOCKBACK_SECONDS)
end

local function slap(player: Player, tool: Tool)
	local now = os.clock()
	local last = lastSlap[player]
	if last and now - last < GearConfig.SlapCooldownSeconds then
		return
	end
	lastSlap[player] = now
	local rootPart = getLiveCharacter(player)
	if rootPart == nil or tool.Parent ~= player.Character then
		return
	end

	-- Plays the character's tool swing animation.
	local swing = Instance.new("StringValue")
	swing.Name = "toolanim"
	swing.Value = "Slash"
	swing.Parent = tool
	Debris:AddItem(swing, 1)

	local target: Player? = nil
	local targetRoot: BasePart? = nil
	local bestDistance = math.huge
	local facing = rootPart.CFrame.LookVector
	for _, other in Players:GetPlayers() do
		if other ~= player then
			local otherRoot = getLiveCharacter(other)
			if otherRoot then
				local offset = otherRoot.Position - rootPart.Position
				local distance = offset.Magnitude
				if distance > 0 and distance <= GearConfig.SlapRange and facing:Dot(offset.Unit) > 0.2 and distance < bestDistance then
					target, targetRoot, bestDistance = other, otherRoot, distance
				end
			end
		end
	end
	if target == nil or targetRoot == nil then
		playSoundEvent:FireClient(player, "Swing")
		return
	end

	local offset = targetRoot.Position - rootPart.Position
	knockback(targetRoot, Vector3.new(offset.X, 0, offset.Z).Unit)
	playSoundEvent:FireClient(player, "Slap")
	playSoundEvent:FireClient(target, "Slap")
	if target:GetAttribute("Carrying") == true then
		forceDropEvent:Fire(target, string.format("%s slapped you and you dropped the brainrot!", player.DisplayName))
		notify(player, string.format("You slapped %s and they dropped the brainrot!", target.DisplayName), "Success")
	end
end

--------------------------------------------------------------------------------
-- Troll items
--------------------------------------------------------------------------------

local function newPart(name: string, size: Vector3, color: Color3, material: Enum.Material): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Size = size
	part.Color = color
	part.Material = material
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	return part
end

-- Holds a player in place for a while (the longest hold wins).
local function stun(target: Player, seconds: number, kind: string)
	local untilClock = math.max(stunnedUntil[target] or 0, os.clock() + seconds)
	stunnedUntil[target] = untilClock
	target:SetAttribute("Stunned", kind)
	applyMovement(target)
	task.delay(seconds, function()
		if stunnedUntil[target] == untilClock then
			stunnedUntil[target] = nil
			target:SetAttribute("Stunned", nil)
			applyMovement(target)
		end
	end)
end

local function dropBrainrot(target: Player, attacker: Player, message: string)
	if target:GetAttribute("Carrying") == true then
		forceDropEvent:Fire(target, message)
		notify(attacker, string.format("%s dropped the brainrot they were stealing!", target.DisplayName), "Success")
	end
end

-- The other player most in front of `rootPart`, within `range`.
local function findTargetInFront(player: Player, rootPart: BasePart, range: number): (Player?, BasePart?)
	local best: Player? = nil
	local bestRoot: BasePart? = nil
	local bestScore = -math.huge
	local facing = rootPart.CFrame.LookVector
	for _, other in Players:GetPlayers() do
		local otherRoot = if other ~= player then getLiveCharacter(other) else nil
		if otherRoot then
			local offset = otherRoot.Position - rootPart.Position
			local distance = offset.Magnitude
			local alignment = if distance > 0 then facing:Dot(offset.Unit) else 0
			if distance <= range and alignment > 0.8 then
				local score = alignment * 2 - distance / range
				if score > bestScore then
					best, bestRoot, bestScore = other, otherRoot, score
				end
			end
		end
	end
	return best, bestRoot
end

local function freezeRay(player: Player, rootPart: BasePart): boolean
	local target, targetRoot = findTargetInFront(player, rootPart, GearConfig.FreezeRange)
	if target == nil or targetRoot == nil then
		notify(player, "Aim at another player to freeze them!", "Warning")
		return false
	end

	-- A quick icy beam, then an ice block around the target.
	local from = rootPart.Position + Vector3.new(0, 1, 0)
	local to = targetRoot.Position
	local beam = newPart("FreezeBeam", Vector3.new(0.4, 0.4, (to - from).Magnitude), Color3.fromRGB(150, 235, 255), Enum.Material.Neon)
	beam.CFrame = CFrame.lookAt((from + to) / 2, to)
	beam.Transparency = 0.2
	beam.Parent = trapsFolder
	Debris:AddItem(beam, 0.3)

	local ice = newPart("IceBlock", Vector3.new(5, 7, 5), Color3.fromRGB(160, 225, 255), Enum.Material.Ice)
	ice.Transparency = 0.35
	ice.CFrame = targetRoot.CFrame * CFrame.new(0, -0.4, 0)
	ice.Parent = trapsFolder
	targetRoot.Anchored = true
	stun(target, GearConfig.FreezeSeconds, "Frozen")
	task.delay(GearConfig.FreezeSeconds, function()
		ice:Destroy()
		if targetRoot.Parent then
			targetRoot.Anchored = false
		end
	end)

	playSoundEvent:FireClient(player, "Freeze")
	playSoundEvent:FireClient(target, "Freeze")
	notify(target, string.format("%s froze you solid!", player.DisplayName), "Error")
	dropBrainrot(target, player, string.format("%s froze you and you dropped the brainrot!", player.DisplayName))
	return true
end

-- Ground in front of the player's feet.
local function placeSpot(rootPart: BasePart, character: Model): Vector3?
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { character, trapsFolder }
	local origin = rootPart.Position + rootPart.CFrame.LookVector * 4
	local hit = Workspace:Raycast(origin, Vector3.new(0, -12, 0), params)
	return if hit then hit.Position else nil
end

local function buildSpikeTrap(position: Vector3): Model
	local model = Instance.new("Model")
	model.Name = "SpikeTrap"
	local base = newPart("Base", Vector3.new(4.5, 0.3, 4.5), Color3.fromRGB(70, 70, 78), Enum.Material.DiamondPlate)
	base.CFrame = CFrame.new(position + Vector3.new(0, 0.15, 0))
	base.Parent = model
	for x = -1, 1 do
		for z = -1, 1 do
			local spike = newPart("Spike", Vector3.new(0.45, 1.4, 0.45), Color3.fromRGB(200, 205, 215), Enum.Material.Metal)
			spike.CFrame = CFrame.new(position + Vector3.new(x * 1.4, 0.8, z * 1.4)) * CFrame.Angles(0, math.rad(45), 0)
			spike.Parent = model
			local tip = newPart("Tip", Vector3.new(0.25, 0.5, 0.25), Color3.fromRGB(230, 60, 60), Enum.Material.Metal)
			tip.CFrame = CFrame.new(position + Vector3.new(x * 1.4, 1.7, z * 1.4)) * CFrame.Angles(0, math.rad(45), 0)
			tip.Parent = model
		end
	end
	model.PrimaryPart = base
	return model
end

local function buildLandMine(position: Vector3): (Model, BasePart)
	local model = Instance.new("Model")
	model.Name = "LandMine"
	local body = newPart("Body", Vector3.new(0.5, 2.6, 2.6), Color3.fromRGB(60, 75, 50), Enum.Material.Metal)
	body.Shape = Enum.PartType.Cylinder
	body.CFrame = CFrame.new(position + Vector3.new(0, 0.25, 0)) * CFrame.Angles(0, 0, math.rad(90))
	body.Parent = model
	local button = newPart("Button", Vector3.new(0.3, 1, 1), Color3.fromRGB(40, 40, 40), Enum.Material.Metal)
	button.Shape = Enum.PartType.Cylinder
	button.CFrame = CFrame.new(position + Vector3.new(0, 0.6, 0)) * CFrame.Angles(0, 0, math.rad(90))
	button.Parent = model
	local light = newPart("Light", Vector3.new(0.4, 0.4, 0.4), Color3.fromRGB(255, 40, 40), Enum.Material.Neon)
	light.Shape = Enum.PartType.Ball
	light.CFrame = CFrame.new(position + Vector3.new(0, 0.85, 0))
	light.Parent = model
	model.PrimaryPart = body
	return model, light
end

local function placeTrap(player: Player, rootPart: BasePart, kind: string): boolean
	local character = player.Character
	local spot = if character then placeSpot(rootPart, character) else nil
	if spot == nil then
		notify(player, "There's no ground here to put that on.", "Warning")
		return false
	end
	-- Only a few out at once: the oldest goes.
	local mine: { Trap } = {}
	for _, trap in traps do
		if trap.Owner == player then
			table.insert(mine, trap)
		end
	end
	if #mine >= GearConfig.MaxTrapsPerPlayer then
		local oldest = mine[1]
		oldest.Model:Destroy()
		table.remove(traps, table.find(traps, oldest) :: number)
	end

	local model: Model
	local light: BasePart? = nil
	if kind == "LandMine" then
		model, light = buildLandMine(spot)
	else
		model = buildSpikeTrap(spot)
	end
	model:SetAttribute("OwnerUserId", player.UserId)
	model.Parent = trapsFolder
	table.insert(traps, {
		Kind = kind,
		Owner = player,
		Model = model,
		Position = spot,
		ExpiresAt = os.clock() + GearConfig.TrapLifetimeSeconds,
		Light = light,
	})
	playSoundEvent:FireClient(player, "Place")
	return true
end

local function launch(rootPart: BasePart)
	local attachment = rootPart:FindFirstChild("RootAttachment")
	if attachment == nil or not attachment:IsA("Attachment") then
		local created = Instance.new("Attachment")
		created.Name = "LaunchAttachment"
		created.Parent = rootPart
		attachment = created
	end
	local angle = math.random() * math.pi * 2
	local velocity = Instance.new("LinearVelocity")
	velocity.Name = "MineLaunch"
	velocity.Attachment0 = attachment :: Attachment
	velocity.RelativeTo = Enum.ActuatorRelativeTo.World
	velocity.VelocityConstraintMode = Enum.VelocityConstraintMode.Vector
	velocity.MaxForce = 1e7
	velocity.VectorVelocity = Vector3.new(math.cos(angle) * 25, GearConfig.MineLaunchSpeed, math.sin(angle) * 25)
	velocity.Parent = rootPart
	Debris:AddItem(velocity, 0.3)
end

local function triggerTrap(trap: Trap, victim: Player, victimRoot: BasePart)
	local owner = trap.Owner
	local ownerName = owner.DisplayName
	if trap.Kind == "LandMine" then
		local explosion = Instance.new("Explosion")
		explosion.Position = trap.Position
		explosion.BlastRadius = 6
		-- Just the boom: nobody gets hurt or flung by the blast itself.
		explosion.BlastPressure = 0
		explosion.DestroyJointRadiusPercent = 0
		explosion.Parent = Workspace
		launch(victimRoot)
		stun(victim, GearConfig.MineStunSeconds, "Launched")
		playSoundEvent:FireClient(victim, "Launch")
		notify(victim, string.format("You stepped on %s's land mine!", ownerName), "Error")
		dropBrainrot(victim, owner, string.format("%s's land mine made you drop the brainrot!", ownerName))
	else
		stun(victim, GearConfig.SpikeStunSeconds, "Spiked")
		victimRoot.AssemblyLinearVelocity = Vector3.zero
		playSoundEvent:FireClient(victim, "Ouch")
		notify(victim, string.format("You stepped on %s's spike trap!", ownerName), "Error")
		dropBrainrot(victim, owner, string.format("%s's spike trap made you drop the brainrot!", ownerName))
	end
	if owner.Parent == Players then
		notify(owner, string.format("%s stepped on your %s!", victim.DisplayName, if trap.Kind == "LandMine" then "land mine" else "spike trap"), "Success")
	end
end

local trapClock = 0
local function checkTraps()
	local now = os.clock()
	trapClock += 1
	local roots: { [Player]: BasePart } = {}
	for _, player in Players:GetPlayers() do
		local rootPart = getLiveCharacter(player)
		if rootPart then
			roots[player] = rootPart
		end
	end
	for index = #traps, 1, -1 do
		local trap = traps[index]
		if now >= trap.ExpiresAt or trap.Model.Parent == nil or trap.Owner.Parent ~= Players then
			trap.Model:Destroy()
			table.remove(traps, index)
			continue
		end
		local light = trap.Light
		if light then
			light.Transparency = if trapClock % 10 < 5 then 0 else 0.8
		end
		for player, rootPart in roots do
			local offset = rootPart.Position - trap.Position
			if
				player ~= trap.Owner
				and Vector3.new(offset.X, 0, offset.Z).Magnitude <= GearConfig.TrapTriggerRadius
				and offset.Y < 5
			then
				trap.Model:Destroy()
				table.remove(traps, index)
				triggerTrap(trap, player, rootPart)
				break
			end
		end
	end
end

local function boogieBomb(player: Player, rootPart: BasePart): boolean
	local ball = newPart("DiscoBall", Vector3.new(3, 3, 3), Color3.fromRGB(255, 90, 200), Enum.Material.Neon)
	ball.Shape = Enum.PartType.Ball
	ball.CFrame = CFrame.new(rootPart.Position + Vector3.new(0, 8, 0))
	local sparkles = Instance.new("Sparkles")
	sparkles.SparkleColor = Color3.fromRGB(255, 255, 120)
	sparkles.Parent = ball
	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(255, 120, 230)
	light.Range = GearConfig.BoogieRadius
	light.Brightness = 4
	light.Parent = ball
	ball.Parent = trapsFolder
	Debris:AddItem(ball, GearConfig.BoogieSeconds)

	local count = 0
	for _, other in Players:GetPlayers() do
		local otherRoot, otherHumanoid = getLiveCharacter(other)
		if other ~= player and otherRoot and otherHumanoid and (otherRoot.Position - rootPart.Position).Magnitude <= GearConfig.BoogieRadius then
			count += 1
			stun(other, GearConfig.BoogieSeconds, "Dancing")
			playSoundEvent:FireClient(other, "Boogie")
			notify(other, string.format("%s hit you with a Boogie Bomb! Dance!", player.DisplayName), "Error")
			dropBrainrot(other, player, string.format("%s's Boogie Bomb made you drop the brainrot!", player.DisplayName))
			local animator = otherHumanoid:FindFirstChildOfClass("Animator")
			if animator then
				local animation = Instance.new("Animation")
				animation.AnimationId = DANCE_ANIMATION_ID
				local ok, track = pcall(function()
					return animator:LoadAnimation(animation)
				end)
				if ok and track then
					track.Looped = true
					track:Play()
					task.delay(GearConfig.BoogieSeconds, function()
						track:Stop()
					end)
				end
			end
		end
	end
	playSoundEvent:FireClient(player, "Boogie")
	if count == 0 then
		notify(player, "Nobody was close enough to dance. Get closer next time!", "Warning")
	else
		notify(player, string.format("%d player%s can't stop dancing!", count, if count == 1 then "" else "s"), "Success")
	end
	return true
end

local ITEM_ACTIONS: { [string]: (Player, BasePart) -> boolean } = {
	FreezeRay = freezeRay,
	SpikeTrap = function(player: Player, rootPart: BasePart): boolean
		return placeTrap(player, rootPart, "SpikeTrap")
	end,
	LandMine = function(player: Player, rootPart: BasePart): boolean
		return placeTrap(player, rootPart, "LandMine")
	end,
	BoogieBomb = boogieBomb,
}

local refreshItemTools: (Player) -> ()

local function useItem(player: Player, tool: Tool, itemId: string)
	local rootPart = getLiveCharacter(player)
	if rootPart == nil or tool.Parent ~= player.Character then
		return
	end
	if (stunnedUntil[player] or 0) > os.clock() then
		return
	end
	local now = os.clock()
	local last = lastItemUse[player]
	if last and now - last < GearConfig.ItemCooldownSeconds then
		return
	end
	lastItemUse[player] = now
	local action = ITEM_ACTIONS[itemId]
	local items = getItemsFunction:Invoke(player)
	local charges = if typeof(items) == "table" then tonumber(items[itemId]) or 0 else 0
	if action == nil or charges <= 0 then
		refreshItemTools(player)
		return
	end
	if action(player, rootPart) then
		useItemChargeFunction:Invoke(player, itemId)
		refreshItemTools(player)
	end
end

--------------------------------------------------------------------------------
-- Tools
--------------------------------------------------------------------------------

local function toolPart(name: string, size: Vector3, color: Color3, material: Enum.Material): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Size = size
	part.Color = color
	part.Material = material
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Massless = true
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	return part
end

-- Welds `part` to `handle` at `offset` from the handle.
local function attach(handle: BasePart, part: BasePart, offset: CFrame)
	part.CFrame = handle.CFrame * offset
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = handle
	weld.Part1 = part
	weld.Parent = part
	part.Parent = handle
end

-- A big slap glove on a wooden stick. The stick runs along the handle's Z
-- axis and the tool grip holds its bottom end, so the glove sticks up.
local function buildSlapGlove(tool: Tool, color: Color3): Part
	local stick = toolPart("Handle", Vector3.new(0.35, 0.35, 3), Color3.fromRGB(120, 80, 45), Enum.Material.Wood)
	stick.Parent = tool
	tool.GripPos = Vector3.new(0, 0, -1.1)
	tool.GripForward = Vector3.new(-1, 0, 0)
	tool.GripUp = Vector3.new(0, 0, 1)
	tool.GripRight = Vector3.new(0, 1, 0)

	local dark = color:Lerp(Color3.new(0, 0, 0), 0.35)
	attach(stick, toolPart("Cuff", Vector3.new(0.9, 2.2, 0.6), Color3.new(1, 1, 1), Enum.Material.SmoothPlastic), CFrame.new(0, 0, 1.7))
	attach(stick, toolPart("CuffStripe", Vector3.new(0.95, 2.25, 0.2), color, Enum.Material.Neon), CFrame.new(0, 0, 1.7))
	attach(stick, toolPart("Palm", Vector3.new(0.7, 2, 2), color, Enum.Material.SmoothPlastic), CFrame.new(0, 0, 3))
	for index, y in { -0.72, -0.24, 0.24, 0.72 } do
		local length = if index == 1 or index == 4 then 1 else 1.3
		attach(stick, toolPart("Finger" .. index, Vector3.new(0.55, 0.42, length), color, Enum.Material.SmoothPlastic), CFrame.new(0, y, 4 + length / 2 - 0.05))
		attach(stick, toolPart("Knuckle" .. index, Vector3.new(0.6, 0.44, 0.15), dark, Enum.Material.SmoothPlastic), CFrame.new(0, y, 4.05))
	end
	attach(
		stick,
		toolPart("Thumb", Vector3.new(0.55, 0.45, 1.1), color, Enum.Material.SmoothPlastic),
		CFrame.new(0, 1.2, 3.1) * CFrame.Angles(math.rad(-40), 0, 0)
	)
	local sparkles = Instance.new("Sparkles")
	sparkles.SparkleColor = color:Lerp(Color3.new(1, 1, 1), 0.4)
	sparkles.Parent = stick:FindFirstChild("Palm")
	return stick
end

local function createHandle(gear: Gear): Part
	local handle = toolPart("Handle", Vector3.new(1, 1, 1), gear.Color, Enum.Material.SmoothPlastic)
	if gear.Id == "InvisibilityCloak" then
		handle.Size = Vector3.new(0.3, 2, 1.6)
		handle.Material = Enum.Material.Fabric
		handle.Transparency = 0.3
	else
		handle.Shape = Enum.PartType.Cylinder
		handle.Size = Vector3.new(1.2, 1.4, 1.4)
		handle.Material = Enum.Material.Neon
	end
	return handle
end

local function createTool(player: Player, gear: Gear): Tool
	local tool = Instance.new("Tool")
	tool.Name = gear.DisplayName
	tool.ToolTip = gear.Description
	tool.CanBeDropped = false
	tool.RequiresHandle = true
	tool:SetAttribute("GearId", gear.Id)
	if gear.Id == "Slap" then
		buildSlapGlove(tool, gear.Color)
	else
		createHandle(gear).Parent = tool
	end

	if gear.Id == "Slap" then
		tool.Activated:Connect(function()
			slap(player, tool)
		end)
	elseif gear.Id == "InvisibilityCloak" then
		tool.Activated:Connect(function()
			cloak(player)
		end)
	end
	tool.Equipped:Connect(function()
		applyMovement(player)
	end)
	tool.Unequipped:Connect(function()
		applyMovement(player)
	end)
	return tool
end

-- What each troll item looks like in your hand.
local function buildItemHandle(tool: Tool, item: TrollItem)
	if item.Id == "FreezeRay" then
		-- A blaster pointing forward (the handle's -Z).
		local body = toolPart("Handle", Vector3.new(0.6, 0.8, 2.2), Color3.fromRGB(235, 240, 250), Enum.Material.SmoothPlastic)
		body.Parent = tool
		attach(body, toolPart("Barrel", Vector3.new(0.45, 0.45, 1), item.Color, Enum.Material.Neon), CFrame.new(0, 0.1, -1.5))
		attach(body, toolPart("Tank", Vector3.new(0.5, 0.6, 0.9), item.Color, Enum.Material.Glass), CFrame.new(0, 0.6, 0.2))
		attach(body, toolPart("Grip", Vector3.new(0.45, 1, 0.5), Color3.fromRGB(60, 70, 90), Enum.Material.SmoothPlastic), CFrame.new(0, -0.7, 0.6))
	elseif item.Id == "SpikeTrap" then
		local base = toolPart("Handle", Vector3.new(1.6, 0.3, 1.6), Color3.fromRGB(70, 70, 78), Enum.Material.DiamondPlate)
		base.Parent = tool
		for index, offset in { Vector3.new(-0.45, 0, -0.45), Vector3.new(0.45, 0, -0.45), Vector3.new(-0.45, 0, 0.45), Vector3.new(0.45, 0, 0.45) } do
			attach(
				base,
				toolPart("Spike" .. index, Vector3.new(0.25, 0.7, 0.25), item.Color, Enum.Material.Metal),
				CFrame.new(offset + Vector3.new(0, 0.5, 0)) * CFrame.Angles(0, math.rad(45), 0)
			)
		end
	elseif item.Id == "LandMine" then
		local body = toolPart("Handle", Vector3.new(0.4, 1.6, 1.6), Color3.fromRGB(60, 75, 50), Enum.Material.Metal)
		body.Shape = Enum.PartType.Cylinder
		body.Parent = tool
		local light = toolPart("Light", Vector3.new(0.35, 0.35, 0.35), item.Color, Enum.Material.Neon)
		light.Shape = Enum.PartType.Ball
		attach(body, light, CFrame.new(0.3, 0, 0))
	else
		local ball = toolPart("Handle", Vector3.new(1.4, 1.4, 1.4), item.Color, Enum.Material.Neon)
		ball.Shape = Enum.PartType.Ball
		ball.Parent = tool
		local sparkles = Instance.new("Sparkles")
		sparkles.SparkleColor = Color3.fromRGB(255, 255, 120)
		sparkles.Parent = ball
	end
end

local function findItemTool(player: Player, itemId: string): Tool?
	local containers: { Instance? } = { player:FindFirstChildOfClass("Backpack"), player.Character }
	for _, container in containers do
		if container then
			for _, child in container:GetChildren() do
				if child:IsA("Tool") and child:GetAttribute("ItemId") == itemId then
					return child
				end
			end
		end
	end
	return nil
end

-- One tool per troll item you have charges of, named with the charges left.
refreshItemTools = function(player: Player)
	local backpack = player:FindFirstChildOfClass("Backpack")
	if backpack == nil or player:GetAttribute("DataLoaded") ~= true then
		return
	end
	local items = getItemsFunction:Invoke(player)
	for _, item in GearConfig.TrollItems do
		local charges = if typeof(items) == "table" then tonumber(items[item.Id]) or 0 else 0
		local tool = findItemTool(player, item.Id)
		if charges <= 0 then
			if tool then
				tool:Destroy()
			end
		else
			if tool == nil then
				local created = Instance.new("Tool")
				created.ToolTip = item.Description
				created.CanBeDropped = false
				created.RequiresHandle = true
				created:SetAttribute("ItemId", item.Id)
				buildItemHandle(created, item)
				created.Activated:Connect(function()
					useItem(player, created, item.Id)
				end)
				created.Parent = backpack
				tool = created
			end
			(tool :: Tool).Name = string.format("%s x%d", item.DisplayName, charges)
		end
	end
end

local function hasTool(player: Player, gearId: string): boolean
	local containers: { Instance } = {}
	local backpack = player:FindFirstChildOfClass("Backpack")
	if backpack then
		table.insert(containers, backpack)
	end
	if player.Character then
		table.insert(containers, player.Character)
	end
	for _, container in containers do
		for _, child in container:GetChildren() do
			if child:IsA("Tool") and child:GetAttribute("GearId") == gearId then
				return true
			end
		end
	end
	return false
end

local function giveTools(player: Player)
	local backpack = player:FindFirstChildOfClass("Backpack")
	if backpack == nil or player:GetAttribute("DataLoaded") ~= true then
		return
	end
	local owned = getOwnedGear(player)
	player:SetAttribute("OwnedGear", table.concat(owned, ","))
	for _, gear in GearConfig.Gear do
		if table.find(owned, gear.Id) and not hasTool(player, gear.Id) then
			createTool(player, gear).Parent = backpack
		end
	end
end

--------------------------------------------------------------------------------
-- Gear Shop
--------------------------------------------------------------------------------

local function isNearGearShop(player: Player): boolean
	local rootPart = getLiveCharacter(player)
	local map = Workspace:FindFirstChild("Map")
	local stall = if map then map:FindFirstChild("GearShop") else nil
	local counter = if stall then stall:FindFirstChild("Counter") else nil
	return rootPart ~= nil
		and counter ~= nil
		and counter:IsA("BasePart")
		and (rootPart.Position - counter.Position).Magnitude <= GearConfig.ShopDistance
end

buyGearFunction.OnServerInvoke = function(player: Player, gearId: any): (boolean, string)
	local now = os.clock()
	local last = lastBuyRequest[player]
	if last and now - last < BUY_COOLDOWN_SECONDS then
		return false, "Slow down!"
	end
	lastBuyRequest[player] = now

	local gear = if typeof(gearId) == "string" then GearConfig.ById[gearId] else nil
	if gear == nil then
		return false, "That gear doesn't exist."
	end
	if player:GetAttribute("DataLoaded") ~= true then
		return false, "Your data is still loading."
	end
	if table.find(getOwnedGear(player), gear.Id) then
		return false, string.format("You already own the %s.", gear.DisplayName)
	end
	if not isNearGearShop(player) then
		return false, "Walk up to the Gear Shop to buy gear."
	end
	if spendCashFunction:Invoke(player, gear.Price) ~= true then
		return false, string.format("You need %s for the %s.", NumberFormat.cash(gear.Price), gear.DisplayName)
	end
	if addGearFunction:Invoke(player, gear.Id) ~= true then
		addCashFunction:Invoke(player, gear.Price)
		return false, "Couldn't buy that, try again."
	end
	giveTools(player)
	return true, string.format("You bought the %s! It's in your backpack.", gear.DisplayName)
end

--------------------------------------------------------------------------------
-- Player lifecycle
--------------------------------------------------------------------------------

local function onCharacterAdded(player: Player, character: Model)
	uncloak(player, nil)
	local humanoid = character:WaitForChild("Humanoid", 10)
	-- A frame later, so the tools go into the new character's fresh Backpack.
	task.wait()
	if humanoid == nil or player.Character ~= character then
		return
	end
	giveTools(player)
	refreshItemTools(player)
	applyMovement(player)
end

local function onPlayerAdded(player: Player)
	player.CharacterAdded:Connect(function(character: Model)
		onCharacterAdded(player, character)
	end)
	player:GetAttributeChangedSignal("DataLoaded"):Connect(function()
		giveTools(player)
		refreshItemTools(player)
	end)
	player:GetAttributeChangedSignal("Carrying"):Connect(function()
		if player:GetAttribute("Carrying") == true then
			uncloak(player, "Grabbing a brainrot made you visible!")
		end
		applyMovement(player)
	end)
	if player.Character then
		task.spawn(onCharacterAdded, player, player.Character)
	end
end

Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(function(player: Player)
	lastBuyRequest[player] = nil
	lastSlap[player] = nil
	lastCloak[player] = nil
	cloaked[player] = nil
	lastItemUse[player] = nil
	stunnedUntil[player] = nil
end)

itemsChangedEvent.Event:Connect(function(player: any)
	if typeof(player) == "Instance" and player:IsA("Player") then
		refreshItemTools(player)
	end
end)

task.spawn(function()
	while true do
		task.wait(TRAP_CHECK_SECONDS)
		xpcall(checkTraps, function(err: any)
			warn("[GearManager] Traps failed: " .. tostring(err))
		end)
	end
end)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

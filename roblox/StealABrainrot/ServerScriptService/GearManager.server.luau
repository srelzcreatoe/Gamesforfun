--!strict
--[[
	GearManager
	Location: ServerScriptService (Script)

	The Gear Shop: sells the gear in GearConfig for Cash, saves what each player
	owns, hands the tools out on every spawn and makes them work:
	  Slap                knocks other players back; a slapped thief drops the
	                      brainrot they are carrying
	  Speed Coil          runs faster while held
	  Gravity Coil        jumps much higher while held
	  Invisibility Cloak  click to turn invisible for a few seconds; grabbing a
	                      brainrot reveals you
	Coils do nothing while carrying a stolen brainrot, so thieves stay catchable.

	Everything is decided here: the client only equips and clicks tools (which
	Roblox reports to the server) and calls BuyGear, which is re-checked
	(known gear, not owned yet, near the Gear Shop, enough Cash).

	Client-facing state:
	  ReplicatedStorage.Remotes.BuyGear (RemoteFunction: gearId -> (ok, message))
	  Player attribute OwnedGear (comma-separated gear IDs)
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

local BUY_COOLDOWN_SECONDS = 0.5
local KNOCKBACK_SECONDS = 0.18

local dataApi = ServerStorage:WaitForChild("DataAndMonetization")
local getGearFunction = dataApi:WaitForChild("GetGear") :: BindableFunction
local addGearFunction = dataApi:WaitForChild("AddGear") :: BindableFunction
local spendCashFunction = dataApi:WaitForChild("SpendCash") :: BindableFunction
local addCashFunction = dataApi:WaitForChild("AddCash") :: BindableFunction
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
-- Tools
--------------------------------------------------------------------------------

local function createHandle(gear: Gear): Part
	local handle = Instance.new("Part")
	handle.Name = "Handle"
	handle.Color = gear.Color
	handle.CanCollide = false
	handle.CanQuery = false
	handle.Massless = true
	handle.TopSurface = Enum.SurfaceType.Smooth
	handle.BottomSurface = Enum.SurfaceType.Smooth
	if gear.Id == "Slap" then
		-- A big open hand.
		handle.Size = Vector3.new(0.5, 1.8, 1.6)
		handle.Material = Enum.Material.SmoothPlastic
	elseif gear.Id == "InvisibilityCloak" then
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
	createHandle(gear).Parent = tool

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
	applyMovement(player)
end

local function onPlayerAdded(player: Player)
	player.CharacterAdded:Connect(function(character: Model)
		onCharacterAdded(player, character)
	end)
	player:GetAttributeChangedSignal("DataLoaded"):Connect(function()
		giveTools(player)
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
end)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

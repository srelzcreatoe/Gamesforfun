--!strict
--[[
	FuseManager
	Location: ServerScriptService (Script)

	The Fuse Machine (Workspace.Map.FuseMachine): stand at it and put in
	FeatureConfig.FuseCount brainrots of the same rarity from your base; out
	comes a random brainrot of the next rarity up. If all of them share a
	mutation, the new one keeps it. Lucky blocks and Secrets can't be fused.

	Remote (ReplicatedStorage.Remotes):
	  Fuse  RemoteFunction ({ slot, slot, slot }) -> (ok, message, resultEntry?)
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))
local FeatureConfig = require(Shared:WaitForChild("FeatureConfig"))

local FUSE_COOLDOWN_SECONDS = 1.5
-- How close to the machine you have to be.
local MACHINE_REACH = 24

local gameplayApi = ServerStorage:WaitForChild("Gameplay")
local describeSlotsFunction = gameplayApi:WaitForChild("DescribeSlots") :: BindableFunction
local takeBrainrotsFunction = gameplayApi:WaitForChild("TakeBrainrots") :: BindableFunction
local giveBrainrotFunction = gameplayApi:WaitForChild("GiveBrainrot") :: BindableFunction
local activityEvent = gameplayApi:WaitForChild("Activity") :: BindableEvent

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local fuseFunction = Instance.new("RemoteFunction")
fuseFunction.Name = "Fuse"

local rng = Random.new()
local lastFuse: { [Player]: number } = {}

local function machinePosition(): Vector3?
	local map = Workspace:FindFirstChild("Map")
	local machine = if map then map:FindFirstChild("FuseMachine") else nil
	local counter = if machine then machine:FindFirstChild("Counter") else nil
	return if counter and counter:IsA("BasePart") then counter.Position else nil
end

local function isNearMachine(player: Player): boolean
	local position = machinePosition()
	local character = player.Character
	local root = if character then character:FindFirstChild("HumanoidRootPart") else nil
	return position ~= nil and root ~= nil and root:IsA("BasePart") and (root.Position - position).Magnitude <= MACHINE_REACH
end

local function nextRarity(rarityName: string): string?
	for index, rarity in BrainrotConfig.Rarities do
		if rarity.Name == rarityName then
			local following = BrainrotConfig.Rarities[index + 1]
			return if following then following.Name else nil
		end
	end
	return nil
end

-- What these entries fuse into, or why they can't be fused.
local function fuseResult(entries: { string }): (string?, string?)
	local rarity: string? = nil
	local mutationName: string? = nil
	local sameMutation = true
	for index, entry in entries do
		local definition, mutation = BrainrotConfig.decode(entry)
		if definition == nil or BrainrotConfig.isLuckyBlock(definition) then
			return nil, "Lucky blocks can't be fused. Open them first!"
		end
		if rarity == nil then
			rarity = definition.Rarity
		elseif rarity ~= definition.Rarity then
			return nil, "They all need to be the same rarity."
		end
		local name = if mutation then mutation.Name else nil
		if index == 1 then
			mutationName = name
		elseif name ~= mutationName then
			sameMutation = false
		end
	end
	local target = if rarity then nextRarity(rarity) else nil
	local choices = if target then BrainrotConfig.ByRarity[target] else nil
	if choices == nil or #choices == 0 then
		return nil, "Secrets are already the best. They can't be fused!"
	end
	local definition = choices[rng:NextInteger(1, #choices)]
	return BrainrotConfig.encode(definition.Id, if sameMutation then mutationName else nil), nil
end

fuseFunction.OnServerInvoke = function(player: Player, slots: any): (boolean, string?, string?)
	if player:GetAttribute("DataLoaded") ~= true or typeof(slots) ~= "table" then
		return false, nil, nil
	end
	local now = os.clock()
	if now - (lastFuse[player] or 0) < FUSE_COOLDOWN_SECONDS then
		return false, "The machine is still cooling down!", nil
	end
	if #slots ~= FeatureConfig.FuseCount then
		return false, string.format("Pick %d brainrots to fuse.", FeatureConfig.FuseCount), nil
	end
	if not isNearMachine(player) then
		return false, "Stand at the Fuse Machine to fuse.", nil
	end
	local entries = describeSlotsFunction:Invoke(player, slots)
	if typeof(entries) ~= "table" or #entries ~= #slots then
		return false, "Only brainrots sitting in your base can be fused.", nil
	end
	local result, problem = fuseResult(entries)
	if result == nil then
		return false, problem, nil
	end
	lastFuse[player] = now

	-- Take all three, then hand over the result (it lands on a freed pedestal).
	local taken = takeBrainrotsFunction:Invoke(player, slots)
	if typeof(taken) ~= "table" then
		return false, "Something changed, try again.", nil
	end
	if giveBrainrotFunction:Invoke(player, result) == nil then
		-- Couldn't place it: give the originals back.
		for _, entry in taken do
			giveBrainrotFunction:Invoke(player, entry)
		end
		return false, "Something went wrong, your brainrots are back.", nil
	end
	activityEvent:Fire(player, "Fuse", 1)
	local definition, mutation = BrainrotConfig.decode(result)
	local name = if definition then BrainrotConfig.fullName(definition, mutation, nil) else "???"
	return true, string.format("FUSED! You got %s!", name), result
end

Players.PlayerRemoving:Connect(function(player: Player)
	lastFuse[player] = nil
end)

fuseFunction.Parent = remotes

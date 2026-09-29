-- Hiding spots: closets and lockers a survivor can climb into. The bot can't
-- find someone hiding unless it saw them get in (or was right next to them).
-- A player monster can search a hiding spot to pull the survivor out and catch
-- them. Nobody can stay hidden forever: after Config.MaxHideTime they come out.
--
-- A map's hiding spots are Models in a "HidingSpots" folder. Each needs a part
-- named "Inside" (set as its PrimaryPart) where the hider stands, facing out.

local Players = game:GetService("Players")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))

local Hiding = {}

local occupant: { [Model]: Player } = {}
local spotOf: { [Player]: Model } = {}
local spotted: { [Player]: boolean } = {}
local hiddenSince: { [Player]: number } = {}
local lastUse: { [Player]: number } = {}
local previousCameraMode: { [Player]: Enum.CameraMode } = {}
local cooldownUntil: { [Player]: number } = {} -- after being pushed out
local generation = 0 -- bumped every round so an old round's timer stops

local notify: (Player, string) -> ()
local canMonsterSee: (Vector3) -> boolean
local onSearched: (Player) -> ()

local function insidePart(spot: Model): BasePart?
	local inside = spot.PrimaryPart or spot:FindFirstChild("Inside")
	return if inside and inside:IsA("BasePart") then inside else nil
end

-- Lets a player out of their hiding spot (does nothing if they aren't hiding).
function Hiding.Unhide(player: Player)
	local spot = spotOf[player]
	if not spot then
		return
	end
	spotOf[player] = nil
	occupant[spot] = nil
	spotted[player] = nil
	hiddenSince[player] = nil
	if not player.Parent then
		return
	end
	player:SetAttribute("Hiding", nil)
	-- Put the camera back. Leaving first person keeps the camera zoomed all
	-- the way in, so push the minimum zoom out for a moment.
	player.CameraMode = previousCameraMode[player] or Enum.CameraMode.Classic
	previousCameraMode[player] = nil
	local minZoom = player.CameraMinZoomDistance
	player.CameraMinZoomDistance = math.max(minZoom, 10)
	task.delay(0.3, function()
		if player.Parent and not spotOf[player] then
			player.CameraMinZoomDistance = minZoom
		end
	end)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if root and root:IsA("BasePart") then
		local inside = insidePart(spot)
		if inside and spot.Parent then
			character:PivotTo(inside.CFrame * CFrame.new(0, 0, -4)) -- step out of the front
		end
		root.Anchored = false
	end
end

local function hide(player: Player, spot: Model)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	local inside = insidePart(spot)
	if not root or not root:IsA("BasePart") or not inside then
		return
	end
	if player:GetAttribute("Trapped") then
		notify(player, "You're stuck in a trap!")
		return
	end
	if (cooldownUntil[player] or 0) > os.clock() then
		notify(player, "Catch your breath before hiding again!")
		return
	end
	spotted[player] = canMonsterSee(root.Position)
	occupant[spot] = player
	spotOf[player] = spot
	hiddenSince[player] = os.clock()
	player:SetAttribute("Hiding", true)
	root.Anchored = true
	character:PivotTo(inside.CFrame)
	previousCameraMode[player] = player.CameraMode
	player.CameraMode = Enum.CameraMode.LockFirstPerson
end

-- Whether a player is hiding, and whether the monster saw them get in.
function Hiding.IsHidden(player: Player): (boolean, boolean)
	return spotOf[player] ~= nil, spotted[player] == true
end

-- A spot on the floor just in front of a hider's closet (for the bot).
function Hiding.FrontOf(player: Player): Vector3?
	local spot = spotOf[player]
	local inside = spot and insidePart(spot)
	return if inside then (inside.CFrame * CFrame.new(0, -1.5, -3)).Position else nil
end

function Hiding.Init(options: {
	notify: (Player, string) -> (),
	canMonsterSee: (Vector3) -> boolean,
	onSearched: (Player) -> (),
	leaveRemote: RemoteEvent,
})
	notify = options.notify
	canMonsterSee = options.canMonsterSee
	onSearched = options.onSearched
	-- The LEAVE button on screen (easier than finding the prompt on a phone).
	options.leaveRemote.OnServerEvent:Connect(function(player)
		Hiding.Unhide(player)
	end)
	Players.PlayerRemoving:Connect(function(player)
		Hiding.Unhide(player)
		lastUse[player] = nil
		cooldownUntil[player] = nil
	end)
end

function Hiding.Setup(map: Model)
	Hiding.Reset()
	local myGeneration = generation
	local spots = map:FindFirstChild("HidingSpots")
	for _, spot in if spots then spots:GetChildren() else {} do
		local inside = spot:IsA("Model") and insidePart(spot)
		if not inside then
			continue
		end
		local prompt = Instance.new("ProximityPrompt")
		prompt.ActionText = "Hide"
		prompt.ObjectText = spot.Name
		prompt.HoldDuration = 0
		prompt.MaxActivationDistance = 6
		prompt.RequiresLineOfSight = false
		prompt:SetAttribute("HidePrompt", true) -- the client changes the text to Leave / Search
		-- At eye level by the doors, so it's easy to see from inside and out.
		local handle = Instance.new("Attachment")
		handle.Name = "PromptSpot"
		handle.Position = Vector3.new(0, 1.5, -1.3)
		handle.Parent = inside
		prompt.Parent = handle
		prompt.Triggered:Connect(function(player)
			local now = os.clock()
			if (lastUse[player] or 0) + 0.6 > now then
				return
			end
			lastUse[player] = now
			local role = player:GetAttribute("Role")
			local current = occupant[spot :: Model]
			if role == "Monster" then
				if current then
					Hiding.Unhide(current)
					onSearched(current)
				else
					notify(player, "Nobody is hiding in there.")
				end
			elseif role == "Survivor" then
				if current == player then
					Hiding.Unhide(player)
				elseif current then
					notify(player, "Someone is already hiding in there!")
				elseif not spotOf[player] then
					hide(player, spot :: Model)
				end
			end
		end)
	end

	-- Push people out when their time is up.
	task.spawn(function()
		while generation == myGeneration do
			task.wait(1)
			for player, since in hiddenSince do
				if os.clock() - since >= Config.MaxHideTime then
					Hiding.Unhide(player)
					cooldownUntil[player] = os.clock() + 8
					notify(player, "You couldn't stay hidden any longer!")
				end
			end
		end
	end)
end

function Hiding.Reset()
	generation += 1
	for player in spotOf do
		Hiding.Unhide(player)
	end
	table.clear(occupant)
	table.clear(spotOf)
	table.clear(spotted)
	table.clear(hiddenSince)
end

return Hiding

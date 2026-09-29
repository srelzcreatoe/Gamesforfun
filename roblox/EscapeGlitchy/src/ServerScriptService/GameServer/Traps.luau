-- Traps. A player monster can place a few each round, and the bot drops one
-- now and then. A survivor who steps in one is stuck for a few seconds, and
-- the monster is told where they are.

local Players = game:GetService("Players")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))
local Build = require(script.Parent.Build)

local Traps = {}

local currentMap: Model? = nil
local folder: Folder? = nil
local notifyAll: (string) -> ()
local notify: (Player, string) -> ()
local onTriggered: ((Player, Vector3) -> ())? = nil
local lastPlace: { [Player]: number } = {}

-- Holds a survivor in place, then lets them go and removes the trap.
local function spring(player: Player, character: Model, trap: Model)
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if not humanoid or humanoid.Health <= 0 then
		return
	end
	player:SetAttribute("Trapped", true)
	local walkSpeed, jumpHeight, jumpPower = humanoid.WalkSpeed, humanoid.JumpHeight, humanoid.JumpPower
	humanoid.WalkSpeed = 0
	humanoid.JumpHeight = 0
	humanoid.JumpPower = 0
	for _, part in trap:GetChildren() do
		if part:IsA("BasePart") and part.Name == "Tooth" then
			part.Color = Color3.fromRGB(190, 30, 30)
		end
	end
	notifyAll(`{player.DisplayName} stepped in a trap!`)
	if onTriggered then
		onTriggered(player, trap:GetPivot().Position)
	end

	task.delay(Config.TrapTime, function()
		if trap.Parent then
			trap:Destroy()
		end
		if player.Parent then
			player:SetAttribute("Trapped", nil)
		end
		if humanoid.Parent and player.Character == character then
			humanoid.WalkSpeed = walkSpeed
			humanoid.JumpHeight = jumpHeight
			humanoid.JumpPower = jumpPower
		end
	end)
end

-- Places a trap on the floor at `position`. `owner` is "Bot" or "Player".
function Traps.Place(position: Vector3, owner: string): Model?
	local trapFolder = folder
	if not trapFolder then
		return nil
	end
	local model = Build.Model(nil, "Trap")
	model:SetAttribute("Owner", owner)
	local base = Build.Part(
		model,
		"Base",
		Vector3.new(0.3, 3.2, 3.2),
		CFrame.new(position + Vector3.new(0, 0.15, 0)) * CFrame.Angles(0, 0, math.rad(90)),
		Color3.fromRGB(55, 55, 60),
		Enum.Material.DiamondPlate
	)
	base.Shape = Enum.PartType.Cylinder -- lying flat
	base.CanCollide = false
	for i = 0, 7 do
		local angle = i / 8 * math.pi * 2
		local tooth = Build.Part(
			model,
			"Tooth",
			Vector3.new(0.3, 0.7, 0.3),
			position + Vector3.new(math.cos(angle) * 1.3, 0.5, math.sin(angle) * 1.3),
			Color3.fromRGB(150, 150, 160),
			Enum.Material.Metal
		)
		tooth.CanCollide = false
		tooth.CanQuery = false
	end
	model.PrimaryPart = base

	local armed = true
	base.Touched:Connect(function(hit)
		if not armed then
			return
		end
		local character = hit.Parent
		local player = Players:GetPlayerFromCharacter(character)
		if
			player
			and player:GetAttribute("Role") == "Survivor"
			and not player:GetAttribute("Trapped")
			and not player:GetAttribute("Hiding")
		then
			armed = false
			spring(player, character :: Model, model)
		end
	end)

	model.Parent = trapFolder
	return model
end

-- How many traps of this owner are in the map right now.
function Traps.Count(owner: string): number
	local count = 0
	if folder then
		for _, trap in folder:GetChildren() do
			if trap:GetAttribute("Owner") == owner then
				count += 1
			end
		end
	end
	return count
end

-- The floor under a position, or nil if there is none.
function Traps.FloorBelow(position: Vector3): Vector3?
	if not currentMap then
		return nil
	end
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Include
	params.FilterDescendantsInstances = { currentMap }
	local result = workspace:Raycast(position, Vector3.new(0, -12, 0), params)
	return if result then result.Position else nil
end

function Traps.Init(options: {
	notifyAll: (string) -> (),
	notify: (Player, string) -> (),
	placeRemote: RemoteEvent,
	onTriggered: (Player, Vector3) -> (),
})
	notifyAll = options.notifyAll
	notify = options.notify
	onTriggered = options.onTriggered

	options.placeRemote.OnServerEvent:Connect(function(player)
		local left = player:GetAttribute("TrapsLeft")
		if player:GetAttribute("Role") ~= "Monster" or typeof(left) ~= "number" or left <= 0 then
			return
		end
		local now = os.clock()
		if (lastPlace[player] or 0) + 1.5 > now then
			return
		end
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart")
		local floor = root and root:IsA("BasePart") and Traps.FloorBelow(root.Position)
		if not floor then
			return
		end
		lastPlace[player] = now
		player:SetAttribute("TrapsLeft", left - 1)
		Traps.Place(floor, "Player")
		notify(player, `Trap set! {left - 1} left.`)
	end)

	Players.PlayerRemoving:Connect(function(player)
		lastPlace[player] = nil
	end)
end

function Traps.Setup(map: Model)
	Traps.Reset()
	currentMap = map
	folder = Build.Folder(map, "Traps")
end

function Traps.Reset()
	currentMap = nil
	folder = nil
	for _, player in Players:GetPlayers() do
		player:SetAttribute("Trapped", nil)
		player:SetAttribute("TrapsLeft", nil)
	end
end

return Traps

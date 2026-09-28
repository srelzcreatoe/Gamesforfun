-- The monster, either an AI bot or a player.
--
-- The bot wanders between the map's Waypoints. When it sees a survivor (or
-- hears one close by) it chases them with pathfinding, and it keeps searching
-- where it last saw them for a few seconds after losing them.
--
-- To use your own monster model for the bot, put a Model named "MonsterModel"
-- (with a Humanoid and a HumanoidRootPart) in ServerStorage.

local CollectionService = game:GetService("CollectionService")
local PathfindingService = game:GetService("PathfindingService")
local Players = game:GetService("Players")
local ServerStorage = game:GetService("ServerStorage")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))
local Skins = require(script.Parent.Skins)

local Monster = {}

export type Target = { player: Player, character: Model, root: BasePart }

type State = {
	active: boolean,
	released: boolean,
	map: Model,
	getTargets: () -> { Target },
	onCatch: (Player) -> (),
	player: Player?,
	model: Model?,
	look: Skins.MonsterLook,
	connections: { RBXScriptConnection },
}

local state: State? = nil

-- Default R15 animations made by Roblox (anyone can use them).
local IDLE_ANIMATION = "rbxassetid://507766388"
local RUN_ANIMATION = "rbxassetid://507767714"

local function weld(part0, part1)
	local constraint = Instance.new("WeldConstraint")
	constraint.Part0 = part0
	constraint.Part1 = part1
	constraint.Parent = part1
end

-- Glowing eyes, a matching outline and no face: the "glitched avatar" look.
local function addMonsterDetails(character: Model, look: Skins.MonsterLook)
	local head = character:FindFirstChild("Head")
	if head and head:IsA("BasePart") then
		local face = head:FindFirstChildWhichIsA("Decal")
		if face then
			face:Destroy()
		end
		for _, side in { -1, 1 } do
			local eye = Instance.new("Part")
			eye.Name = "Eye"
			eye.Shape = Enum.PartType.Ball
			eye.Size = Vector3.new(0.28, 0.28, 0.28)
			eye.Color = look.EyeColor
			eye.Material = Enum.Material.Neon
			eye.CanCollide = false
			eye.CanQuery = false
			eye.CanTouch = false
			eye.Massless = true
			eye.CFrame = head.CFrame * CFrame.new(side * head.Size.X * 0.2, head.Size.Y * 0.1, -head.Size.Z / 2)
			weld(head, eye)
			eye.Parent = character
		end
		local glow = Instance.new("PointLight")
		glow.Color = look.EyeColor
		glow.Range = 10
		glow.Brightness = 2
		glow.Parent = head
	end

	local outline = Instance.new("Highlight")
	outline.FillTransparency = 1
	outline.OutlineColor = look.EyeColor
	outline.DepthMode = Enum.HighlightDepthMode.Occluded
	outline.Parent = character

	CollectionService:AddTag(character, "Monster")
end

-- Turns a player's character into the monster, in their monster skin.
local function applyMonsterLook(character: Model, look: Skins.MonsterLook)
	if character:FindFirstChild("Eye") then
		return -- already done
	end
	Skins.ApplyMonsterColors(character, look)
	addMonsterDetails(character, look)
end

-- A plain block figure, only used if Roblox fails to build an R15 rig.
local function buildBlockMonster(look: Skins.MonsterLook): Model
	local model = Instance.new("Model")
	local root = Instance.new("Part")
	root.Name = "HumanoidRootPart"
	root.Size = Vector3.new(2, 2, 1)
	root.Transparency = 1
	root.Parent = model
	local function limb(name, size, offset, color)
		local part = Instance.new("Part")
		part.Name = name
		part.Size = size
		part.Color = color
		part.CFrame = root.CFrame * CFrame.new(offset)
		part.CanCollide = name == "Torso"
		weld(root, part)
		part.Parent = model
		return part
	end
	limb("Torso", Vector3.new(2, 2, 1), Vector3.zero, look.BodyColor)
	limb("Head", Vector3.new(1.2, 1.2, 1.2), Vector3.new(0, 1.6, 0), look.HeadColor)
	limb("LeftArm", Vector3.new(1, 2, 1), Vector3.new(-1.5, 0, 0), look.BodyColor)
	limb("RightArm", Vector3.new(1, 2, 1), Vector3.new(1.5, 0, 0), look.BodyColor)
	limb("LeftLeg", Vector3.new(1, 2, 1), Vector3.new(-0.5, -2, 0), look.BodyColor)
	limb("RightLeg", Vector3.new(1, 2, 1), Vector3.new(0.5, -2, 0), look.BodyColor)
	local humanoid = Instance.new("Humanoid")
	humanoid.RigType = Enum.HumanoidRigType.R15 -- so HipHeight is used
	humanoid.HipHeight = 2
	humanoid.RequiresNeck = false
	humanoid.Parent = model
	model.PrimaryPart = root
	return model
end

-- Returns the bot's model, and whether it came from ServerStorage.MonsterModel
-- (a custom model keeps its own look and animations).
local function buildBotModel(look: Skins.MonsterLook): (Model, boolean)
	local template = ServerStorage:FindFirstChild("MonsterModel")
	if template then
		local model = template:Clone()
		if model:IsA("Model") and model:FindFirstChildOfClass("Humanoid") and model:FindFirstChild("HumanoidRootPart") then
			return model, true
		end
		warn(`[{Config.GameName}] ServerStorage.MonsterModel needs a Humanoid and a HumanoidRootPart; using the default monster.`)
		model:Destroy()
	end

	local description = Instance.new("HumanoidDescription")
	description.HeadColor = look.HeadColor
	description.TorsoColor = look.BodyColor
	description.LeftArmColor = look.BodyColor
	description.RightArmColor = look.BodyColor
	description.LeftLegColor = look.BodyColor
	description.RightLegColor = look.BodyColor
	local ok, result = pcall(function()
		return Players:CreateHumanoidModelFromDescription(description, Enum.HumanoidRigType.R15)
	end)
	if ok and result then
		return result, false
	end
	warn(`[{Config.GameName}] Could not build the R15 monster ({result}); using a block monster.`)
	return buildBlockMonster(look), false
end

local function setupBotAnimations(humanoid: Humanoid)
	local animator = humanoid:FindFirstChildOfClass("Animator")
	if not animator then
		animator = Instance.new("Animator")
		animator.Parent = humanoid
	end
	local function load(id)
		local animation = Instance.new("Animation")
		animation.AnimationId = id
		local ok, track = pcall(function()
			return animator:LoadAnimation(animation)
		end)
		if ok and track then
			track.Looped = true
			return track
		end
		return nil
	end
	local idle, run = load(IDLE_ANIMATION), load(RUN_ANIMATION)
	if idle then
		idle:Play()
	end
	humanoid.Running:Connect(function(speed)
		if speed > 0.5 then
			if idle and idle.IsPlaying then
				idle:Stop(0.2)
			end
			if run then
				if not run.IsPlaying then
					run:Play(0.2)
				end
				run:AdjustSpeed(math.max(speed / 16, 0.5))
			end
		else
			if run and run.IsPlaying then
				run:Stop(0.2)
			end
			if idle and not idle.IsPlaying then
				idle:Play(0.2)
			end
		end
	end)
end

local function hasLineOfSight(from: Vector3, to: Vector3, params: RaycastParams)
	return workspace:Raycast(from, to - from, params) == nil
end

-- Places the bot wanders to.
local function getWanderPoints(map: Model): { Vector3 }
	local points = {}
	for _, folderName in { "Waypoints", "ItemSpawns", "PlayerSpawns" } do
		local folder = map:FindFirstChild(folderName)
		if folder then
			for _, part in folder:GetChildren() do
				if part:IsA("BasePart") then
					table.insert(points, part.Position)
				end
			end
		end
		if #points >= 3 then
			break
		end
	end
	return points
end

local function runBot(s: State, model: Model, humanoid: Humanoid, root: BasePart)
	local path = PathfindingService:CreatePath({
		AgentRadius = 2,
		AgentHeight = 5,
		AgentCanJump = true,
		WaypointSpacing = 4,
	})
	local rayParams = RaycastParams.new()
	rayParams.FilterType = Enum.RaycastFilterType.Exclude

	local wanderPoints = getWanderPoints(s.map)
	local waypoints: { PathWaypoint }? = nil
	local waypointIndex = 1
	local goal: Vector3? = nil
	local lastPathTime = 0
	local wandering = false
	local lastSeenPosition: Vector3? = nil
	local lastSeenTime = -math.huge
	local pausedUntil = 0
	local stuckPosition, stuckTime = root.Position, os.clock()

	local function computePath(target: Vector3): boolean
		lastPathTime = os.clock()
		local ok = pcall(function()
			path:ComputeAsync(root.Position, target)
		end)
		if ok and path.Status == Enum.PathStatus.Success then
			waypoints = path:GetWaypoints()
			waypointIndex = 2
			goal = target
			return true
		end
		waypoints, goal = nil, nil
		return false
	end

	-- Moves one step along the current path. Returns false when there is no
	-- path or it has been walked to the end.
	local function followPath(): boolean
		local list = waypoints
		if not list then
			return false
		end
		local waypoint = list[waypointIndex]
		if not waypoint then
			waypoints, goal = nil, nil
			return false
		end
		if waypoint.Action == Enum.PathWaypointAction.Jump then
			humanoid.Jump = true
		end
		humanoid:MoveTo(waypoint.Position)
		local offset = (waypoint.Position - root.Position) * Vector3.new(1, 0, 1)
		if offset.Magnitude < 3 then
			waypointIndex += 1
		end
		return true
	end

	while s.active and model.Parent do
		task.wait(0.1)
		if not s.released or os.clock() < pausedUntil then
			continue
		end

		local targets = s.getTargets()
		local exclude: { Instance } = { model }
		for _, target in targets do
			table.insert(exclude, target.character)
		end
		rayParams.FilterDescendantsInstances = exclude

		-- Catch anyone in reach, otherwise pick the closest survivor we can sense.
		local eyes = root.Position + Vector3.new(0, 1.5, 0)
		local best: Target? = nil
		local bestDistance = math.huge
		local bestVisible = false
		local caught = false
		for _, target in targets do
			local distance = (target.root.Position - root.Position).Magnitude
			local visible = distance <= Config.SightRange and hasLineOfSight(eyes, target.root.Position, rayParams)
			if distance <= Config.CatchDistance and visible then
				s.onCatch(target.player)
				caught = true
				break
			end
			if (visible or distance <= Config.HearingRange) and distance < bestDistance then
				best, bestDistance, bestVisible = target, distance, visible
			end
		end
		if caught then
			pausedUntil = os.clock() + Config.CatchPause
			humanoid:MoveTo(root.Position)
			waypoints, goal = nil, nil
			stuckPosition, stuckTime = root.Position, pausedUntil
			continue
		end

		if best then
			-- Chase
			wandering = false
			humanoid.WalkSpeed = Config.BotChaseSpeed
			local targetPosition = best.root.Position
			lastSeenPosition, lastSeenTime = targetPosition, os.clock()
			if bestVisible and bestDistance < 15 and math.abs(targetPosition.Y - root.Position.Y) < 3 then
				waypoints, goal = nil, nil
				humanoid:MoveTo(targetPosition)
			else
				local currentGoal = goal
				if not currentGoal or (currentGoal - targetPosition).Magnitude > 5 or os.clock() - lastPathTime > 1 then
					computePath(targetPosition)
				end
				if not followPath() then
					humanoid:MoveTo(targetPosition)
				end
			end
		elseif lastSeenPosition and os.clock() - lastSeenTime < Config.ChaseMemory then
			-- Search where we last saw someone
			wandering = false
			local searchPosition = lastSeenPosition
			if goal ~= searchPosition and os.clock() - lastPathTime > 0.5 then
				computePath(searchPosition)
			end
			if not followPath() then
				lastSeenPosition = nil
			end
		else
			-- Wander
			humanoid.WalkSpeed = Config.BotWanderSpeed
			if not wandering or not followPath() then
				wandering = #wanderPoints > 0 and computePath(wanderPoints[math.random(#wanderPoints)])
			end
		end

		-- If we have barely moved for a while, jump and pick a new route.
		if (root.Position - stuckPosition).Magnitude > 2 then
			stuckPosition, stuckTime = root.Position, os.clock()
		elseif os.clock() - stuckTime > 2 then
			humanoid.Jump = true
			waypoints, goal, wandering = nil, nil, false
			stuckPosition, stuckTime = root.Position, os.clock()
		end
	end
end

-- Catches survivors who get close to a player-controlled monster.
local function runPlayerCatcher(s: State, player: Player)
	local rayParams = RaycastParams.new()
	rayParams.FilterType = Enum.RaycastFilterType.Exclude
	local nextCatch = 0
	while s.active do
		task.wait(0.1)
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart")
		if not s.released or not root or not root:IsA("BasePart") or os.clock() < nextCatch then
			continue
		end
		local targets = s.getTargets()
		local exclude: { Instance } = { character :: Model }
		for _, target in targets do
			table.insert(exclude, target.character)
		end
		rayParams.FilterDescendantsInstances = exclude
		for _, target in targets do
			local distance = (target.root.Position - root.Position).Magnitude
			if distance <= Config.CatchDistance and hasLineOfSight(root.Position, target.root.Position, rayParams) then
				s.onCatch(target.player)
				nextCatch = os.clock() + 1
				break
			end
		end
	end
end

local function monsterSpawnCFrame(map: Model): CFrame
	local spawnPart = map:FindFirstChild("MonsterSpawn")
	if spawnPart and spawnPart:IsA("BasePart") then
		return spawnPart.CFrame + Vector3.new(0, 3, 0)
	end
	return map:GetPivot()
end

---------------------------------------------------------------------------
-- Public
---------------------------------------------------------------------------

-- Gets the monster ready for a round. It is not released into the map until
-- Monster.Release() is called.
--   options.map         the map clone in Workspace
--   options.player      the player who is the monster, or nil for a bot
--   options.getTargets  returns the survivors that can be caught
--   options.onCatch     called with a player when they are caught
--   options.skin        the monster skin id to wear
function Monster.Start(options: {
	map: Model,
	player: Player?,
	getTargets: () -> { Target },
	onCatch: (Player) -> (),
	skin: string?,
})
	Monster.Stop()
	local s: State = {
		active = true,
		released = false,
		map = options.map,
		getTargets = options.getTargets,
		onCatch = options.onCatch,
		player = options.player,
		model = nil,
		look = Skins.GetMonsterLook(options.skin),
		connections = {},
	}
	state = s

	local player = options.player
	if player then
		player:SetAttribute("Role", "Monster")
		local function setUpCharacter(character: Model)
			local humanoid = character:WaitForChild("Humanoid", 5)
			if not humanoid or not humanoid:IsA("Humanoid") or state ~= s then
				return
			end
			humanoid.WalkSpeed = Config.MonsterPlayerSpeed
			if s.released then
				task.wait() -- let the character finish spawning before moving it
				character:PivotTo(monsterSpawnCFrame(s.map))
			end
			-- Wait for their avatar's clothes to load so they can be replaced.
			if Skins.WaitForAppearance(player, character) and state == s then
				applyMonsterLook(character, s.look)
			end
		end
		if player.Character then
			task.spawn(setUpCharacter, player.Character)
		end
		table.insert(s.connections, player.CharacterAdded:Connect(setUpCharacter))
		task.spawn(runPlayerCatcher, s, player)
	else
		local model, isCustomModel = buildBotModel(s.look)
		model.Name = Config.MonsterName
		local humanoid = model:FindFirstChildOfClass("Humanoid") :: Humanoid
		humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
		humanoid.MaxHealth = math.huge
		humanoid.Health = math.huge
		humanoid:SetStateEnabled(Enum.HumanoidStateType.Seated, false)
		if isCustomModel then
			CollectionService:AddTag(model, "Monster")
		else
			addMonsterDetails(model, s.look)
		end
		model:SetAttribute("CustomModel", isCustomModel)
		s.model = model
	end
end

-- Lets the monster into the map.
function Monster.Release()
	local s = state
	if not s or s.released then
		return
	end
	s.released = true

	local player = s.player
	if player then
		local character = player.Character
		if character then
			character:PivotTo(monsterSpawnCFrame(s.map))
		end
		return
	end

	local model = s.model
	if not model then
		return
	end
	local humanoid = model:FindFirstChildOfClass("Humanoid") :: Humanoid
	local root = model:FindFirstChild("HumanoidRootPart") :: BasePart
	model:PivotTo(monsterSpawnCFrame(s.map))
	model.Parent = workspace
	pcall(function()
		root:SetNetworkOwner(nil) -- the server moves the bot, so it should own it
	end)
	if not model:GetAttribute("CustomModel") then
		setupBotAnimations(humanoid)
	end
	task.spawn(runBot, s, model, humanoid, root)
end

function Monster.Stop()
	local s = state
	if not s then
		return
	end
	state = nil
	s.active = false
	for _, connection in s.connections do
		connection:Disconnect()
	end
	if s.model then
		s.model:Destroy()
	end
	if s.player and s.player.Parent then
		s.player:SetAttribute("Role", nil)
	end
end

return Monster

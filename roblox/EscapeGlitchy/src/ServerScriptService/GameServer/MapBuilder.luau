-- Builds a lobby and a small test chapter out of plain parts, so the game is
-- playable the moment you press Play. Once you make your own lobby
-- (a Model named "Lobby" in Workspace) or maps (Models in ServerStorage > Maps)
-- this file leaves them alone.

local ServerStorage = game:GetService("ServerStorage")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))

local MapBuilder = {}

local LOBBY_ORIGIN = Vector3.new(0, 200, 0)
local MAP_ORIGIN = Vector3.new(300, 0, 0)

local WALL_HEIGHT = 12
local DOOR_HEIGHT = 8
local DOOR_WIDTH = 6
local FLOOR_TOP = 1

local function box(parent, name, size, position, color, material)
	local part = Instance.new("Part")
	part.Name = name
	part.Anchored = true
	part.Size = size
	part.CFrame = CFrame.new(position)
	part.Color = color or Color3.fromRGB(200, 200, 200)
	part.Material = material or Enum.Material.SmoothPlastic
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Parent = parent
	return part
end

-- Invisible parts that only mark a position (spawns, waypoints, ...).
local function marker(parent, name, position)
	local part = box(parent, name, Vector3.new(1, 1, 1), position)
	part.Transparency = 1
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	return part
end

---------------------------------------------------------------------------
-- Lobby
---------------------------------------------------------------------------

function MapBuilder.EnsureLobby()
	local existing = workspace:FindFirstChild("Lobby")
	if existing then
		return existing
	end

	local lobby = Instance.new("Model")
	lobby.Name = "Lobby"

	local o = LOBBY_ORIGIN
	local stone = Color3.fromRGB(70, 70, 80)
	box(lobby, "Floor", Vector3.new(80, 2, 80), o + Vector3.new(0, -1, 0), Color3.fromRGB(45, 45, 55), Enum.Material.Slate)
	box(lobby, "Wall", Vector3.new(80, 8, 2), o + Vector3.new(0, 4, 41), stone, Enum.Material.Brick)
	box(lobby, "Wall", Vector3.new(80, 8, 2), o + Vector3.new(0, 4, -41), stone, Enum.Material.Brick)
	box(lobby, "Wall", Vector3.new(2, 8, 84), o + Vector3.new(41, 4, 0), stone, Enum.Material.Brick)
	box(lobby, "Wall", Vector3.new(2, 8, 84), o + Vector3.new(-41, 4, 0), stone, Enum.Material.Brick)

	local sign = box(lobby, "Sign", Vector3.new(34, 12, 1), o + Vector3.new(0, 14, -38), Color3.fromRGB(15, 15, 20))
	local surface = Instance.new("SurfaceGui")
	surface.Face = Enum.NormalId.Back -- the side facing the spawn
	surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	surface.PixelsPerStud = 30
	surface.Parent = sign
	local title = Instance.new("TextLabel")
	title.BackgroundTransparency = 1
	title.Size = UDim2.fromScale(1, 1)
	title.Font = Enum.Font.Creepster
	title.TextScaled = true
	title.TextColor3 = Config.MonsterEyeColor
	title.Text = string.upper(Config.GameName)
	title.Parent = surface

	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "LobbySpawn"
	spawn.Anchored = true
	spawn.Size = Vector3.new(10, 1, 10)
	spawn.CFrame = CFrame.new(o + Vector3.new(0, 0.5, 0))
	spawn.Duration = 0 -- no force field
	spawn.Neutral = true
	spawn.Color = Color3.fromRGB(90, 90, 110)
	spawn.Material = Enum.Material.SmoothPlastic
	spawn.Parent = lobby

	local lamp = box(lobby, "Lamp", Vector3.new(2, 1, 2), o + Vector3.new(0, 20, 0), Color3.fromRGB(255, 230, 190), Enum.Material.Neon)
	local light = Instance.new("PointLight")
	light.Range = 60
	light.Brightness = 1.5
	light.Parent = lamp

	lobby.Parent = workspace

	-- Places made from the Baseplate template come with their own spawn at the
	-- centre of the world. Turn it off so everyone starts in the lobby.
	for _, other in workspace:GetDescendants() do
		if other:IsA("SpawnLocation") and other ~= spawn and other.Enabled then
			other.Enabled = false
			warn(`[{Config.GameName}] Disabled SpawnLocation "{other:GetFullName()}" so players spawn in the lobby.`)
		end
	end

	return lobby
end

---------------------------------------------------------------------------
-- Test chapter: a small house
--
--          x = -40        -13          13          40
--   z = 30  +------------+------------+-----------+
--           |  Living    |  Bedroom   |  Garage   |
--           |  (start)   |            |      EXIT >  (gate with 2 locks)
--   z = 0   +----    ----+----    ----+-----------+
--           |  Kitchen   |  Hallway   |  Storage  |
--           |            |  (monster) X red door  |
--   z = -30 +------------+------------+-----------+
---------------------------------------------------------------------------

-- A wall that runs along the Z axis at a fixed X, optionally with a doorway.
local function wallAlongZ(parent, x, z1, z2, doorZ, color)
	local y = FLOOR_TOP + WALL_HEIGHT / 2
	if not doorZ then
		box(parent, "Wall", Vector3.new(1, WALL_HEIGHT, z2 - z1), MAP_ORIGIN + Vector3.new(x, y, (z1 + z2) / 2), color)
		return
	end
	local d1, d2 = doorZ - DOOR_WIDTH / 2, doorZ + DOOR_WIDTH / 2
	box(parent, "Wall", Vector3.new(1, WALL_HEIGHT, d1 - z1), MAP_ORIGIN + Vector3.new(x, y, (z1 + d1) / 2), color)
	box(parent, "Wall", Vector3.new(1, WALL_HEIGHT, z2 - d2), MAP_ORIGIN + Vector3.new(x, y, (d2 + z2) / 2), color)
	local topHeight = WALL_HEIGHT - DOOR_HEIGHT
	box(
		parent,
		"Wall",
		Vector3.new(1, topHeight, DOOR_WIDTH),
		MAP_ORIGIN + Vector3.new(x, FLOOR_TOP + DOOR_HEIGHT + topHeight / 2, doorZ),
		color
	)
end

-- A wall that runs along the X axis at a fixed Z, optionally with a doorway.
local function wallAlongX(parent, z, x1, x2, doorX, color)
	local y = FLOOR_TOP + WALL_HEIGHT / 2
	if not doorX then
		box(parent, "Wall", Vector3.new(x2 - x1, WALL_HEIGHT, 1), MAP_ORIGIN + Vector3.new((x1 + x2) / 2, y, z), color)
		return
	end
	local d1, d2 = doorX - DOOR_WIDTH / 2, doorX + DOOR_WIDTH / 2
	box(parent, "Wall", Vector3.new(d1 - x1, WALL_HEIGHT, 1), MAP_ORIGIN + Vector3.new((x1 + d1) / 2, y, z), color)
	box(parent, "Wall", Vector3.new(x2 - d2, WALL_HEIGHT, 1), MAP_ORIGIN + Vector3.new((d2 + x2) / 2, y, z), color)
	local topHeight = WALL_HEIGHT - DOOR_HEIGHT
	box(
		parent,
		"Wall",
		Vector3.new(DOOR_WIDTH, topHeight, 1),
		MAP_ORIGIN + Vector3.new(doorX, FLOOR_TOP + DOOR_HEIGHT + topHeight / 2, z),
		color
	)
end

local function folder(parent, name)
	local f = Instance.new("Folder")
	f.Name = name
	f.Parent = parent
	return f
end

local function buildTestHouse()
	local map = Instance.new("Model")
	map.Name = "TestHouse"
	map:SetAttribute("DisplayName", "Chapter 1: The House")

	local walls = Color3.fromRGB(150, 140, 125)
	local o = MAP_ORIGIN

	-- Shell
	box(map, "Floor", Vector3.new(81, 1, 61), o + Vector3.new(0, 0.5, 0), Color3.fromRGB(105, 75, 50), Enum.Material.WoodPlanks)
	box(map, "Ceiling", Vector3.new(81, 1, 61), o + Vector3.new(0, FLOOR_TOP + WALL_HEIGHT + 0.5, 0), Color3.fromRGB(90, 85, 80))

	wallAlongZ(map, -40, -30, 30, nil, walls)
	wallAlongZ(map, 40, -30, 30, 15, walls) -- the exit doorway, closed by the gate below
	wallAlongX(map, -30, -40, 40, nil, walls)
	wallAlongX(map, 30, -40, 40, nil, walls)

	-- Inside walls
	wallAlongZ(map, -13, 0, 30, 15, walls) -- living | bedroom
	wallAlongZ(map, 13, 0, 30, 15, walls) -- bedroom | garage
	wallAlongZ(map, -13, -30, 0, -15, walls) -- kitchen | hallway
	wallAlongZ(map, 13, -30, 0, -15, walls) -- hallway | storage (red door)
	wallAlongX(map, 0, -40, -13, -26, walls) -- living | kitchen
	wallAlongX(map, 0, -13, 13, 0, walls) -- bedroom | hallway
	wallAlongX(map, 0, 13, 40, nil, walls) -- garage | storage (solid)

	-- Furniture (also gives players something to hide behind)
	local wood = Color3.fromRGB(95, 65, 40)
	box(map, "Couch", Vector3.new(10, 3, 3), o + Vector3.new(-30, 2.5, 26), Color3.fromRGB(120, 40, 45), Enum.Material.Fabric)
	box(map, "Bed", Vector3.new(6, 2, 9), o + Vector3.new(5, 2, 24), Color3.fromRGB(70, 90, 140), Enum.Material.Fabric)
	box(map, "Wardrobe", Vector3.new(6, 9, 3), o + Vector3.new(-6, 5.5, 27), wood, Enum.Material.Wood)
	box(map, "Table", Vector3.new(8, 3, 4), o + Vector3.new(-26, 2.5, -15), wood, Enum.Material.Wood)
	box(map, "Counter", Vector3.new(3, 4, 14), o + Vector3.new(-38, 3, -20), Color3.fromRGB(210, 210, 205), Enum.Material.Marble)
	box(map, "Shelves", Vector3.new(12, 7, 2), o + Vector3.new(27, 4.5, -28), wood, Enum.Material.Wood)
	box(map, "Crate", Vector3.new(4, 4, 4), o + Vector3.new(30, 3, 7), Color3.fromRGB(140, 105, 60), Enum.Material.WoodPlanks)
	box(map, "Crate", Vector3.new(4, 4, 4), o + Vector3.new(22, 3, 25), Color3.fromRGB(140, 105, 60), Enum.Material.WoodPlanks)

	-- One dim lamp per room
	for _, center in { Vector3.new(-26, 0, 15), Vector3.new(0, 0, 15), Vector3.new(26, 0, 15), Vector3.new(-26, 0, -15), Vector3.new(0, 0, -15), Vector3.new(26, 0, -15) } do
		local lamp = box(map, "Lamp", Vector3.new(2, 0.4, 2), o + center + Vector3.new(0, FLOOR_TOP + WALL_HEIGHT - 0.2, 0), Color3.fromRGB(255, 220, 170), Enum.Material.Neon)
		local light = Instance.new("PointLight")
		light.Range = 26
		light.Brightness = 0.9
		light.Color = Color3.fromRGB(255, 214, 170)
		light.Parent = lamp
	end

	-- The exit: a gate in the garage wall, and a pad outside it
	box(map, "Porch", Vector3.new(8, 1, 8), o + Vector3.new(44.5, 0.5, 15), Color3.fromRGB(80, 80, 80), Enum.Material.Concrete)
	box(map, "ExitGate", Vector3.new(1, DOOR_HEIGHT, DOOR_WIDTH), o + Vector3.new(40, FLOOR_TOP + DOOR_HEIGHT / 2, 15), Color3.fromRGB(60, 45, 35), Enum.Material.Wood)
	local exit = box(map, "Exit", Vector3.new(4, 8, 6), o + Vector3.new(45, FLOOR_TOP + 4, 15), Color3.fromRGB(40, 40, 40))
	exit.Transparency = 1
	exit.CanCollide = false
	exit.CanQuery = false

	-- Locks
	local locks = folder(map, "Locks")
	local redDoor = box(locks, "Red Door", Vector3.new(1, DOOR_HEIGHT, DOOR_WIDTH), o + Vector3.new(13, FLOOR_TOP + DOOR_HEIGHT / 2, -15), Color3.fromRGB(170, 30, 30), Enum.Material.Wood)
	redDoor:SetAttribute("RequiredItem", "RedKey")

	local padlock = box(locks, "Blue Padlock", Vector3.new(0.6, 1.2, 1), o + Vector3.new(39.2, 4.5, 13.5), Config.Items.BlueKey.Color, Enum.Material.Metal)
	padlock:SetAttribute("RequiredItem", "BlueKey")
	padlock:SetAttribute("ExitLock", true)

	local bolts = box(locks, "Rusty Bolts", Vector3.new(0.6, 1.4, 1.4), o + Vector3.new(39.2, 5, 16.5), Color3.fromRGB(120, 70, 40), Enum.Material.CorrodedMetal)
	bolts:SetAttribute("RequiredItem", "Wrench")
	bolts:SetAttribute("ExitLock", true)

	-- Where each item can appear (one spot is picked at random every round)
	local itemSpawns = folder(map, "ItemSpawns")
	local spots = {
		RedKey = { Vector3.new(-36, 1.5, 27), Vector3.new(10.5, 1.5, 27), Vector3.new(-26, 4.5, -15) },
		BlueKey = { Vector3.new(10, 1.5, -27), Vector3.new(-36, 1.5, -5), Vector3.new(35, 1.5, 3), Vector3.new(-9, 1.5, 4) },
		Wrench = { Vector3.new(36, 1.5, -24), Vector3.new(19, 1.5, -4) },
	}
	for itemId, positions in spots do
		for _, position in positions do
			local spot = marker(itemSpawns, itemId .. "Spawn", o + position)
			spot:SetAttribute("Item", itemId)
		end
	end

	-- Spawns
	local playerSpawns = folder(map, "PlayerSpawns")
	for _, position in { Vector3.new(-32, 1.5, 8), Vector3.new(-26, 1.5, 8), Vector3.new(-20, 1.5, 8), Vector3.new(-32, 1.5, 14), Vector3.new(-26, 1.5, 14), Vector3.new(-20, 1.5, 14) } do
		marker(playerSpawns, "PlayerSpawn", o + position)
	end
	marker(map, "MonsterSpawn", o + Vector3.new(0, 1.5, -25))

	-- Places the bot wanders between when it is not chasing anyone
	local waypoints = folder(map, "Waypoints")
	for _, position in { Vector3.new(-26, 1.5, 15), Vector3.new(0, 1.5, 15), Vector3.new(26, 1.5, 15), Vector3.new(-32, 1.5, -6), Vector3.new(0, 1.5, -15), Vector3.new(26, 1.5, -15) } do
		marker(waypoints, "Waypoint", o + position)
	end

	return map
end

-- Returns every map in ServerStorage > Maps, building the test house first if
-- there are none yet.
function MapBuilder.GetMaps()
	local maps = ServerStorage:FindFirstChild("Maps")
	if not maps then
		maps = folder(ServerStorage, "Maps")
	end
	local list = {}
	for _, child in maps:GetChildren() do
		if child:IsA("Model") then
			table.insert(list, child)
		end
	end
	if #list == 0 then
		local house = buildTestHouse()
		house.Parent = maps
		table.insert(list, house)
	end
	return list
end

-- Warns about anything a map needs but is missing. Returns false if the map
-- cannot be played at all.
function MapBuilder.Validate(map)
	local playerSpawns = map:FindFirstChild("PlayerSpawns")
	if not playerSpawns or #playerSpawns:GetChildren() == 0 then
		warn(`[{Config.GameName}] Map "{map.Name}" has no PlayerSpawns folder with parts in it, skipping it.`)
		return false
	end
	if not map:FindFirstChild("MonsterSpawn") then
		warn(`[{Config.GameName}] Map "{map.Name}" has no MonsterSpawn part, skipping it.`)
		return false
	end
	if not map:FindFirstChild("Exit") then
		warn(`[{Config.GameName}] Map "{map.Name}" has no Exit part, so nobody can escape.`)
	end
	return true
end

return MapBuilder

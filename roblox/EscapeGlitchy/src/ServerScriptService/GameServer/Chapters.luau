-- The chapters that come with the game. Each one is drawn as a text grid where
-- every character is one 4x4 stud tile, so you can change a map by editing
-- the text. All rows of a grid must be the same length.
--
--   #  wall                 =  wall with a window      (space)  outside
--   .  floor                :  doorway (floor with a beam above it)
--   P  player spawn         M  monster spawn           w  bot waypoint
--   n  spot for the code note (one is picked each round)
--   h  hiding closet / locker (opens towards the open side)
--   G  exit gate            E  exit (touch it after the gate opens)
--   furniture:  t table  d desk  b bed  o couch  k counter  s shelf
--               c crate  v car  u rug
--   digits      item spawn spots, see Items below
--   capitals    locks, see Locks below. Post = a small lock pillar;
--               otherwise the lock is a door that fills its tiles.

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))
local Build = require(script.Parent.Build)

local Chapters = {}

local TILE = 4
local FLOOR_TOP = 1
local WALL_HEIGHT = 14
local DOOR_HEIGHT = 9
local ORIGIN = Vector3.new(300, 0, 0)

Chapters.List = {
	{
		Id = "House",
		DisplayName = "Chapter 1: The House",
		Style = {
			Floor = Color3.fromRGB(110, 78, 52),
			FloorMaterial = Enum.Material.WoodPlanks,
			Wall = Color3.fromRGB(165, 150, 130),
			WallMaterial = Enum.Material.Plaster,
			Ceiling = Color3.fromRGB(95, 88, 80),
			Light = Color3.fromRGB(255, 205, 150),
			Closet = Color3.fromRGB(90, 60, 38),
			ClosetMaterial = Enum.Material.Wood,
			ClosetName = "Wardrobe",
			Gate = Color3.fromRGB(60, 42, 30),
		},
		Items = { ["1"] = "RedKey", ["2"] = "BlueKey", ["3"] = "Wrench" },
		Locks = {
			R = { Name = "Red Door", Item = "RedKey" },
			A = { Name = "Blue Padlock", Item = "BlueKey", Exit = true, Post = true },
			B = { Name = "Rusty Bolts", Item = "Wrench", Exit = true, Post = true },
			C = { Name = "Keypad", Code = true, Exit = true, Post = true },
		},
		Grid = {
			"###====#####====#####====###########    ",
			"#kkkkkk.h#.n......#.bb....h#.sssss.#    ",
			"#........#........#.bb.....#.......#    ",
			"#......2.#........#.bb.....#.......#    ",
			"=...w....#........#......2.#.......#    ",
			"=........:..tttt..#...w....R...3...#    ",
			"=........:..tttt..#........R.......#    ",
			"=...tt...#........#..uuuu..#.3.w...#    ",
			"#...tt...#........:..uuuu..#.......#    ",
			"#.1......#...w....:..uuuu..#.....c.#    ",
			"#........#......1.#.....M..#.c...c.#    ",
			"#.......n#........#........#.......#    ",
			"####::#######::#######::############    ",
			"#h.......#n.......#h.......#.......#    ",
			"#......1.#........#..dddd..#.vvv...#    ",
			"#........#.....2..#..dddd..#.vvv...#    ",
			"#..P.P.P.#........:........#.vvv...#    ",
			"=........#........:........#.vvvC.A#    ",
			"=..P.P.P.#........#........#.......#    ",
			"=....w...:........#...w....#.......GEE  ",
			"=........:...w....#.2......#.......GEE  ",
			"=..uuuu..#........#........:.......#    ",
			"=..uuuu..#........#........:...w..B#    ",
			"#..uuuu..#........#........#.......#    ",
			"#........#.1......#n.......#.......#    ",
			"#.oooo...#.......h#.ssssss.#.kkkkk.#    ",
			"###====#####====#####====###########    ",
		},
	},
	{
		Id = "School",
		DisplayName = "Chapter 2: The School",
		Style = {
			Floor = Color3.fromRGB(200, 198, 188),
			FloorMaterial = Enum.Material.Marble,
			Wall = Color3.fromRGB(150, 175, 160),
			WallMaterial = Enum.Material.SmoothPlastic,
			Ceiling = Color3.fromRGB(205, 205, 200),
			Light = Color3.fromRGB(215, 235, 255),
			Closet = Color3.fromRGB(70, 95, 130),
			ClosetMaterial = Enum.Material.Metal,
			ClosetName = "Locker",
			Gate = Color3.fromRGB(70, 75, 85),
		},
		Items = { ["1"] = "JanitorKey", ["2"] = "Fuse", ["3"] = "Keycard" },
		Locks = {
			J = { Name = "Janitor's Closet", Item = "JanitorKey" },
			F = { Name = "Fuse Box", Item = "Fuse", Exit = true, Post = true },
			K = { Name = "Card Reader", Item = "Keycard", Exit = true, Post = true },
			C = { Name = "Keypad", Code = true, Exit = true, Post = true },
		},
		Grid = {
			"###======#####======#####=======#####======###",
			"#.........n#..........#...........#.ssssssss.#",
			"#.1........#.3........#..sssssss..#.........1#",
			"=..........#..........#.....M.....#..........=",
			"=.dd.dd.dd.#.dd.dd.dd.#...........#....ddd...=",
			"=..........#..........:..sssssss..#....ddd...=",
			"=..........#..........:...........#..........=",
			"=.dd.dd.dd.#.dd.dd.dd.#...........#..........=",
			"=..........#..........#..sssssss..#...w......=",
			"=....w.....#.....w....#...........#..........=",
			"#...dddd...#...dddd.1.#.w........3#.........3#",
			"#..........#..........#n..........#..........#",
			"#####::#########::#########::##########::#####",
			"#..h.....h....h.....h....h.....h.....h.....h.#",
			"#.........w.............................w....#",
			"#.............................w..............#",
			"#..h........h.................h.............h#",
			"#######::###########::####::######JJ#####::###",
			"#..............#...............#.....#.......#",
			"#..............#........uuuuu.1#....c#......n#",
			"=..tttt..tttt..#........uuuuu..#..w..#.ddd...=",
			"=..tttt..tttt..#...............#.....#.ddd...=",
			"=..............#....PPPPPP...n.#..2..#.......=",
			"=......w.......:...............#.....#..w....=",
			"=..............:...............#.....#..uuu..=",
			"=..tttt..tttt..#.......w.......#.....#C.uuu..=",
			"=..tttt..tttt..#...............#...2.#..uuu..=",
			"=.1..........3.#...............#.....#.......=",
			"#..............#...............#.....#F....K.#",
			"#.kkkkkkkkkkkk.#.kkkkkkkkkkkkk.#.ssss#.......#",
			"##################===========###########GG####",
			"                                        EE    ",
			"                                        EE    ",
		},
	},
}

local FURNITURE = {
	t = { Name = "Table", Height = 3, Color = Color3.fromRGB(105, 70, 42), Material = Enum.Material.Wood, Legs = true },
	d = { Name = "Desk", Height = 2.8, Color = Color3.fromRGB(150, 115, 75), Material = Enum.Material.Wood, Legs = true },
	b = { Name = "Bed", Height = 2, Color = Color3.fromRGB(70, 90, 140), Material = Enum.Material.Fabric },
	o = { Name = "Couch", Height = 3, Color = Color3.fromRGB(120, 40, 45), Material = Enum.Material.Fabric },
	k = { Name = "Counter", Height = 3.5, Color = Color3.fromRGB(200, 200, 195), Material = Enum.Material.Marble },
	s = { Name = "Shelf", Height = 7, Color = Color3.fromRGB(95, 65, 40), Material = Enum.Material.Wood },
	c = { Name = "Crate", Height = 3.6, Color = Color3.fromRGB(140, 105, 60), Material = Enum.Material.WoodPlanks },
	v = { Name = "Car", Height = 5, Color = Color3.fromRGB(140, 30, 30), Material = Enum.Material.Metal },
	u = { Name = "Rug", Height = 0.1, Color = Color3.fromRGB(120, 50, 60), Material = Enum.Material.Fabric },
}

-- Tiles people (and the bot) can walk on.
local WALKABLE = {}
for i = 1, #".:PMwnEu123456789" do
	WALKABLE[string.sub(".:PMwnEu123456789", i, i)] = true
end

-- Splits the tiles that pass `test` into as few rectangles as possible, so a
-- map needs fewer parts. Each rectangle is { x1, y1, x2, y2 } in tiles.
local function rectangles(cells: { { string } }, width: number, height: number, test: (string) -> boolean)
	local used = {}
	local result = {}
	local function free(x, y)
		return not used[y * 1000 + x] and test(cells[y][x])
	end
	for y = 1, height do
		for x = 1, width do
			if free(x, y) then
				local x2 = x
				while x2 < width and free(x2 + 1, y) do
					x2 += 1
				end
				local y2 = y
				while y2 < height do
					local rowFree = true
					for xx = x, x2 do
						if not free(xx, y2 + 1) then
							rowFree = false
							break
						end
					end
					if not rowFree then
						break
					end
					y2 += 1
				end
				for yy = y, y2 do
					for xx = x, x2 do
						used[yy * 1000 + xx] = true
					end
				end
				table.insert(result, { x, y, x2, y2 })
			end
		end
	end
	return result
end

local function rectCenter(r: { number }, y: number): Vector3
	return ORIGIN + Vector3.new((r[1] - 1 + r[3]) / 2 * TILE, y, (r[2] - 1 + r[4]) / 2 * TILE)
end

local function rectSize(r: { number }, height: number): Vector3
	return Vector3.new((r[3] - r[1] + 1) * TILE, height, (r[4] - r[2] + 1) * TILE)
end

local function tileCenter(x: number, y: number, height: number): Vector3
	return ORIGIN + Vector3.new((x - 0.5) * TILE, height, (y - 0.5) * TILE)
end

-- A door-shaped slab filling a doorway rectangle: thin across the wall line.
local function doorSlab(parent: Instance, name: string, r: { number }, thickness: number, color: Color3, material: Enum.Material): Part
	local size = rectSize(r, DOOR_HEIGHT)
	local alongX = size.X >= size.Z
	local slab = Build.Part(
		parent,
		name,
		if alongX then Vector3.new(size.X, DOOR_HEIGHT, thickness) else Vector3.new(thickness, DOOR_HEIGHT, size.Z),
		rectCenter(r, FLOOR_TOP + DOOR_HEIGHT / 2),
		color,
		material
	)
	local faces = if alongX then { Enum.NormalId.Front, Enum.NormalId.Back } else { Enum.NormalId.Left, Enum.NormalId.Right }
	for _, face in faces do
		local label = Build.Label(slab, face, string.upper(name), { Color = Color3.new(1, 1, 1), PixelsPerStud = 12 })
		label.TextStrokeTransparency = 0.3
		label.Size = UDim2.fromScale(0.8, 0.12)
		label.Position = UDim2.fromScale(0.1, 0.2)
	end
	return slab
end

local function buildFurniture(parent: Instance, spec, r: { number })
	local size = rectSize(r, spec.Height)
	local w, d = size.X - 0.6, size.Z - 0.6
	local base = rectCenter(r, FLOOR_TOP)
	local model = Build.Model(parent, spec.Name)
	if spec.Legs then
		Build.Part(model, "Top", Vector3.new(w, 0.4, d), base + Vector3.new(0, spec.Height - 0.2, 0), spec.Color, spec.Material)
		for _, sx in { -1, 1 } do
			for _, sz in { -1, 1 } do
				Build.Part(
					model,
					"Leg",
					Vector3.new(0.4, spec.Height - 0.4, 0.4),
					base + Vector3.new(sx * (w / 2 - 0.3), (spec.Height - 0.4) / 2, sz * (d / 2 - 0.3)),
					spec.Color,
					spec.Material
				)
			end
		end
	elseif spec.Name == "Car" then
		local alongX = w >= d
		Build.Part(model, "Body", Vector3.new(w, 2.2, d), base + Vector3.new(0, 1.6, 0), spec.Color, spec.Material)
		Build.Part(
			model,
			"Cabin",
			if alongX then Vector3.new(w * 0.5, 1.8, d - 0.6) else Vector3.new(w - 0.6, 1.8, d * 0.5),
			base + Vector3.new(0, 3.6, 0),
			Color3.fromRGB(40, 50, 65),
			Enum.Material.Glass
		)
		for _, along in { -1, 1 } do
			for _, side in { -1, 1 } do
				local offset = if alongX
					then Vector3.new(along * (w / 2 - 1.6), 0.8, side * d / 2)
					else Vector3.new(side * w / 2, 0.8, along * (d / 2 - 1.6))
				local wheel = Build.Part(
					model,
					"Wheel",
					Vector3.new(0.6, 1.6, 1.6),
					CFrame.new(base + offset) * (if alongX then CFrame.Angles(0, math.rad(90), 0) else CFrame.identity),
					Color3.fromRGB(25, 25, 25),
					Enum.Material.Rubber
				)
				wheel.Shape = Enum.PartType.Cylinder
			end
		end
	elseif spec.Name == "Rug" then
		local rug = Build.Part(model, "Rug", Vector3.new(w, 0.1, d), base + Vector3.new(0, 0.05, 0), spec.Color, spec.Material)
		rug.CanCollide = false
	else
		Build.Part(model, spec.Name, Vector3.new(w, spec.Height, d), base + Vector3.new(0, spec.Height / 2, 0), spec.Color, spec.Material)
		if spec.Name == "Bed" then
			local alongX = w >= d
			Build.Part(
				model,
				"Pillow",
				if alongX then Vector3.new(1.2, 0.5, d * 0.7) else Vector3.new(w * 0.7, 0.5, 1.2),
				base + (if alongX then Vector3.new(-w / 2 + 0.9, 2.25, 0) else Vector3.new(0, 2.25, -d / 2 + 0.9)),
				Color3.fromRGB(235, 235, 235),
				Enum.Material.Fabric
			)
		end
	end
end

-- A closet (or locker) the size of one tile, open side facing `facing`.
local function buildCloset(parent: Instance, style, x: number, y: number, facing: Vector3)
	local model = Build.Model(parent, style.ClosetName)
	local floorCenter = tileCenter(x, y, FLOOR_TOP)
	local frame = CFrame.lookAt(floorCenter, floorCenter + facing) -- -Z (look) is the front
	local width, height, depth = TILE - 0.4, 8, TILE - 0.4
	local function panel(name, size, offset)
		return Build.Part(model, name, size, frame * CFrame.new(offset), style.Closet, style.ClosetMaterial)
	end
	panel("Back", Vector3.new(width, height, 0.3), Vector3.new(0, height / 2, depth / 2 - 0.15))
	panel("Side", Vector3.new(0.3, height, depth), Vector3.new(-width / 2 + 0.15, height / 2, 0))
	panel("Side", Vector3.new(0.3, height, depth), Vector3.new(width / 2 - 0.15, height / 2, 0))
	panel("Top", Vector3.new(width, 0.3, depth), Vector3.new(0, height - 0.15, 0))
	-- Two doors with a thin gap to peek through.
	local doorWidth = (width - 0.3) / 2
	for _, side in { -1, 1 } do
		panel("Door", Vector3.new(doorWidth, height - 0.6, 0.2), Vector3.new(side * (doorWidth / 2 + 0.15), height / 2, -depth / 2 + 0.1))
	end
	local inside = Build.Marker(model, "Inside", Vector3.zero)
	inside.CFrame = frame * CFrame.new(0, 3, 0)
	model.PrimaryPart = inside
end

-- A small stand with a board. One board per round shows the keypad code.
local function buildNote(parent: Instance, x: number, y: number)
	local model = Build.Model(parent, "Note")
	local base = tileCenter(x, y, FLOOR_TOP)
	Build.Part(model, "Stand", Vector3.new(0.3, 3.6, 0.3), base + Vector3.new(0, 1.8, 0), Color3.fromRGB(90, 65, 40), Enum.Material.Wood)
	local board = Build.Part(model, "Board", Vector3.new(2.8, 1.9, 0.2), base + Vector3.new(0, 4.3, 0), Color3.fromRGB(235, 228, 205), Enum.Material.SmoothPlastic)
	model.PrimaryPart = board
end

-- A lock pillar with a colored panel and a light that turns green when opened.
local function buildPost(parent: Instance, lock, x: number, y: number): Model
	local model = Build.Model(parent, lock.Name)
	local base = tileCenter(x, y, FLOOR_TOP)
	local info = lock.Item and Config.Items[lock.Item]
	local color = if info then info.Color else Color3.fromRGB(55, 60, 70)
	Build.Part(model, "Pillar", Vector3.new(1.2, 3.6, 1.2), base + Vector3.new(0, 1.8, 0), Color3.fromRGB(45, 45, 50), Enum.Material.Metal)
	local panelPart = Build.Part(model, "Panel", Vector3.new(1.8, 1.2, 1.8), base + Vector3.new(0, 4.2, 0), color, Enum.Material.Metal)
	for _, face in { Enum.NormalId.Front, Enum.NormalId.Back, Enum.NormalId.Left, Enum.NormalId.Right } do
		Build.Label(panelPart, face, lock.Name, { Color = Color3.new(1, 1, 1), PixelsPerStud = 30 }).TextStrokeTransparency = 0.2
	end
	local light = Build.Part(model, "Light", Vector3.new(0.6, 0.3, 0.6), base + Vector3.new(0, 4.95, 0), Color3.fromRGB(255, 40, 40), Enum.Material.Neon)
	light.CanCollide = false
	model.PrimaryPart = panelPart
	return model
end

-- Builds a chapter from its definition. Returns a Model laid out the way the
-- round code expects (see "Make your own chapter" in the README).
function Chapters.Build(def): Model
	local rows: { string } = def.Grid
	local style = def.Style
	local height = #rows
	local width = #rows[1]
	local cells: { { string } } = {}
	for y, row in rows do
		if #row ~= width then
			warn(`[{Config.GameName}] Row {y} of chapter {def.Id} is {#row} long, expected {width}.`)
		end
		cells[y] = {}
		for x = 1, width do
			cells[y][x] = if x <= #row then string.sub(row, x, x) else " "
		end
	end
	local function at(x, y)
		local row = cells[y]
		return if row and row[x] then row[x] else " "
	end

	local map = Build.Model(nil, def.Id)
	map:SetAttribute("DisplayName", def.DisplayName)
	local structure = Build.Folder(map, "Structure")
	local furniture = Build.Folder(map, "Furniture")
	local locks = Build.Folder(map, "Locks")
	local itemSpawns = Build.Folder(map, "ItemSpawns")
	local playerSpawns = Build.Folder(map, "PlayerSpawns")
	local waypoints = Build.Folder(map, "Waypoints")
	local codeNotes = Build.Folder(map, "CodeNotes")
	local hidingSpots = Build.Folder(map, "HidingSpots")

	-- Floor, ceiling, walls, windows and the beams over doorways
	for _, r in rectangles(cells, width, height, function(c)
		return c ~= " "
	end) do
		Build.Part(structure, "Floor", rectSize(r, 1), rectCenter(r, FLOOR_TOP - 0.5), style.Floor, style.FloorMaterial)
	end
	for _, r in rectangles(cells, width, height, function(c)
		return c ~= " " and c ~= "E"
	end) do
		Build.Part(structure, "Ceiling", rectSize(r, 1), rectCenter(r, FLOOR_TOP + WALL_HEIGHT + 0.5), style.Ceiling)
	end
	for _, r in rectangles(cells, width, height, function(c)
		return c == "#"
	end) do
		Build.Part(structure, "Wall", rectSize(r, WALL_HEIGHT), rectCenter(r, FLOOR_TOP + WALL_HEIGHT / 2), style.Wall, style.WallMaterial)
	end
	for _, r in rectangles(cells, width, height, function(c)
		return c == "="
	end) do
		Build.Part(structure, "Wall", rectSize(r, 4), rectCenter(r, FLOOR_TOP + 2), style.Wall, style.WallMaterial)
		local glass = Build.Part(structure, "Window", rectSize(r, 5), rectCenter(r, FLOOR_TOP + 6.5), Color3.fromRGB(60, 80, 110), Enum.Material.Glass)
		glass.Transparency = 0.45
		Build.Part(structure, "Wall", rectSize(r, WALL_HEIGHT - 9), rectCenter(r, FLOOR_TOP + 9 + (WALL_HEIGHT - 9) / 2), style.Wall, style.WallMaterial)
	end
	for _, r in rectangles(cells, width, height, function(c)
		local lock = def.Locks[c]
		return c == ":" or c == "G" or (lock ~= nil and not lock.Post)
	end) do
		local beamHeight = WALL_HEIGHT - DOOR_HEIGHT
		Build.Part(structure, "Beam", rectSize(r, beamHeight), rectCenter(r, FLOOR_TOP + DOOR_HEIGHT + beamHeight / 2), style.Wall, style.WallMaterial)
	end

	-- Furniture
	for char, spec in FURNITURE do
		for _, r in rectangles(cells, width, height, function(c)
			return c == char
		end) do
			buildFurniture(furniture, spec, r)
		end
	end

	-- Doors that are locks, and the exit gate
	for char, lock in def.Locks do
		if lock.Post then
			continue
		end
		local info = lock.Item and Config.Items[lock.Item]
		for _, r in rectangles(cells, width, height, function(c)
			return c == char
		end) do
			local door = doorSlab(locks, lock.Name, r, 1, if info then info.Color else Color3.fromRGB(90, 90, 100), Enum.Material.Wood)
			door:SetAttribute("RequiredItem", lock.Item)
			door:SetAttribute("Code", lock.Code)
			door:SetAttribute("ExitLock", lock.Exit)
		end
	end
	for _, r in rectangles(cells, width, height, function(c)
		return c == "G"
	end) do
		local gate = doorSlab(map, "ExitGate", r, 1.2, style.Gate, Enum.Material.Wood)
		for _, surface in gate:GetChildren() do
			local label = surface:FindFirstChildOfClass("TextLabel")
			if label then
				label.Text = "EXIT"
				label.TextColor3 = Color3.fromRGB(255, 60, 60)
			end
		end
	end

	-- Everything that sits on a single tile
	local exitMin, exitMax = nil, nil
	for y = 1, height do
		for x = 1, width do
			local c = at(x, y)
			local floorPosition = tileCenter(x, y, FLOOR_TOP + 0.5)
			local lock = def.Locks[c]
			if c == "P" then
				Build.Marker(playerSpawns, "PlayerSpawn", floorPosition)
			elseif c == "M" then
				Build.Marker(map, "MonsterSpawn", floorPosition)
			elseif c == "w" then
				Build.Marker(waypoints, "Waypoint", floorPosition)
			elseif c == "n" then
				buildNote(codeNotes, x, y)
			elseif def.Items[c] then
				local spot = Build.Marker(itemSpawns, def.Items[c] .. "Spawn", floorPosition)
				spot:SetAttribute("Item", def.Items[c])
			elseif c == "E" then
				local position = tileCenter(x, y, 0)
				exitMin = if exitMin then exitMin:Min(position) else position
				exitMax = if exitMax then exitMax:Max(position) else position
			elseif c == "h" then
				-- Open towards a walkable side, preferring one with a wall behind.
				local facing = nil
				for _, dir in { Vector3.new(1, 0, 0), Vector3.new(-1, 0, 0), Vector3.new(0, 0, 1), Vector3.new(0, 0, -1) } do
					local front = WALKABLE[at(x + dir.X, y + dir.Z)]
					local back = WALKABLE[at(x - dir.X, y - dir.Z)]
					if front and not back then
						facing = dir
						break
					elseif front and not facing then
						facing = dir
					end
				end
				buildCloset(hidingSpots, style, x, y, facing or Vector3.new(0, 0, -1))
			elseif lock and lock.Post then
				local post = buildPost(locks, lock, x, y)
				post:SetAttribute("RequiredItem", lock.Item)
				post:SetAttribute("Code", lock.Code)
				post:SetAttribute("ExitLock", lock.Exit)
				post:SetAttribute("KeepOnUnlock", true)
			end

			-- A dim lamp every few tiles (not over doorways, where the beam is)
			local doorway = c == ":" or c == "G" or (lock ~= nil and not lock.Post)
			if x % 5 == 3 and y % 5 == 3 and not doorway and c ~= " " and c ~= "#" and c ~= "=" and c ~= "E" then
				local lamp = Build.Part(
					structure,
					"Lamp",
					Vector3.new(2, 0.3, 2),
					tileCenter(x, y, FLOOR_TOP + WALL_HEIGHT - 0.15),
					style.Light,
					Enum.Material.Neon
				)
				lamp.CanCollide = false
				Build.Light(lamp, 24, 0.75, style.Light)
			end
		end
	end

	if exitMin and exitMax then
		local size = exitMax - exitMin + Vector3.new(TILE, 0, TILE)
		local exit = Build.Part(map, "Exit", Vector3.new(size.X, 8, size.Z), (exitMin + exitMax) / 2 + Vector3.new(0, FLOOR_TOP + 4, 0))
		exit.Transparency = 1
		exit.CanCollide = false
		exit.CanQuery = false
	end

	return map
end

return Chapters

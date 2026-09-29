-- Finds the maps to play (building the included chapters when you have not
-- made your own), checks that a map has what a round needs, and moves players
-- into maps safely.

local ServerStorage = game:GetService("ServerStorage")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))
local Chapters = require(script.Parent.Chapters)

local MapBuilder = {}

-- Moves a player's character, first asking Roblox to load the area around the
-- destination. Places with Workspace.StreamingEnabled on need this, or players
-- can arrive before the floor has loaded and fall through.
function MapBuilder.Teleport(player: Player, character: Model, cframe: CFrame)
	pcall(function()
		player:RequestStreamAroundAsync(cframe.Position, 5)
	end)
	if player.Character == character and character.Parent then
		character:PivotTo(cframe)
	end
end

-- Returns every map in ServerStorage > Maps. If there are none yet, the
-- included chapters are built and put there first.
function MapBuilder.GetMaps(): { Model }
	local maps = ServerStorage:FindFirstChild("Maps")
	if not maps then
		maps = Instance.new("Folder")
		maps.Name = "Maps"
		maps.Parent = ServerStorage
	end
	local list = {}
	for _, child in maps:GetChildren() do
		if child:IsA("Model") then
			table.insert(list, child)
		end
	end
	if #list == 0 then
		for _, def in Chapters.List do
			local ok, result = pcall(Chapters.Build, def)
			if ok then
				result.Parent = maps
				table.insert(list, result)
			else
				warn(`[{Config.GameName}] Could not build chapter {def.Id}: {result}`)
			end
		end
	end
	return list
end

-- Warns about anything a map needs but is missing. Returns false if the map
-- cannot be played at all.
function MapBuilder.Validate(map: Model): boolean
	local playerSpawns = map:FindFirstChild("PlayerSpawns")
	local spawnParts = 0
	for _, child in if playerSpawns then playerSpawns:GetChildren() else {} do
		if child:IsA("BasePart") then
			spawnParts += 1
		end
	end
	if spawnParts == 0 then
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

-- The name shown for a map in votes and messages.
function MapBuilder.DisplayName(map: Model): string
	local name = map:GetAttribute("DisplayName")
	return if typeof(name) == "string" then name else map.Name
end

return MapBuilder

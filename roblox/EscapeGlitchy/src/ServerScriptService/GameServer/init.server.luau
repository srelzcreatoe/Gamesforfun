-- Runs the game: intermission -> pick a map -> head start -> hunt -> results.
--
-- The other parts of the server live in the ModuleScripts inside this script:
--   MapBuilder  lobby + test map, and map checks
--   Items       items, locks and the exit
--   Monster     the AI bot / player monster
--   Skins       the skin shop
--   Data        coins, skins and saving

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Config"))
local MapBuilder = require(script.MapBuilder)
local Items = require(script.Items)
local Monster = require(script.Monster)
local Skins = require(script.Skins)
local Data = require(script.Data)

-- Respawns a player (in the lobby) without waiting for it to finish.
local function sendToLobby(player: Player)
	task.spawn(function()
		if not player.Parent then
			return
		end
		local ok, err = pcall(function()
			player:LoadCharacterAsync()
		end)
		if not ok then
			warn(`[{Config.GameName}] Could not respawn {player.Name}: {err}`)
		end
	end)
end

-- Build the lobby before anything else so the first characters spawn in it.
MapBuilder.EnsureLobby()
for _, player in Players:GetPlayers() do
	if player.Character then
		sendToLobby(player)
	end
end

---------------------------------------------------------------------------
-- Things the client needs: remote events and the shared game state
---------------------------------------------------------------------------

local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
local function newRemote(name: string): RemoteEvent
	local remote = Instance.new("RemoteEvent")
	remote.Name = name
	remote.Parent = remotes
	return remote
end
local notifyRemote = newRemote("Notify")
local jumpscareRemote = newRemote("Jumpscare")
local dropRemote = newRemote("DropItem")
local shopRemote = newRemote("Shop")
remotes.Parent = ReplicatedStorage

local gameState = Instance.new("Folder")
gameState.Name = "GameState"
gameState:SetAttribute("Status", "Loading...")
gameState:SetAttribute("TimeLeft", 0)
gameState.Parent = ReplicatedStorage

local function setStatus(text: string, timeLeft: number?)
	gameState:SetAttribute("Status", text)
	gameState:SetAttribute("TimeLeft", timeLeft or 0)
end

local function notifyAll(text: string)
	notifyRemote:FireAllClients(text)
end

local function notify(player: Player, text: string)
	notifyRemote:FireClient(player, text)
end

Skins.Init({ notify = notify, respawn = sendToLobby, shopRemote = shopRemote })
Data.Start(Skins.OnDataLoaded)
Items.Init({ notifyAll = notifyAll, notify = notify, dropRemote = dropRemote })

---------------------------------------------------------------------------
-- Round state
---------------------------------------------------------------------------

type SurvivorStatus = "Playing" | "Escaped" | "Caught" | "Left"

type Round = {
	map: Model,
	survivors: { [Player]: SurvivorStatus },
	monsterPlayer: Player?,
	connections: { RBXScriptConnection },
}

local round: Round? = nil

local function countPlaying(r: Round): number
	local count = 0
	for _, status in r.survivors do
		if status == "Playing" then
			count += 1
		end
	end
	return count
end

-- The survivors the monster can catch right now.
local function getTargets(): { Monster.Target }
	local list = {}
	local r = round
	if not r then
		return list
	end
	for player, status in r.survivors do
		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		local root = character and character:FindFirstChild("HumanoidRootPart")
		if status == "Playing" and humanoid and humanoid.Health > 0 and root and root:IsA("BasePart") then
			table.insert(list, { player = player, character = character :: Model, root = root })
		end
	end
	return list
end

local function onCaught(player: Player)
	local r = round
	if not r or r.survivors[player] ~= "Playing" then
		return
	end
	r.survivors[player] = "Caught"
	player:SetAttribute("Role", nil)

	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if root and root:IsA("BasePart") then
		Items.DropHeld(player, root.Position)
		root.Anchored = true -- freeze them during the jumpscare
	else
		Items.DropHeld(player)
	end

	jumpscareRemote:FireClient(player)
	notifyAll(`{player.DisplayName} was caught by {Config.MonsterName}!`)
	if r.monsterPlayer and r.monsterPlayer.Parent then
		Data.AddCoins(r.monsterPlayer, Config.CatchCoins)
	end

	task.delay(Config.JumpscareTime, function()
		if player.Character == character then
			sendToLobby(player)
		end
	end)
end

-- A survivor died some other way (reset, fell off the map, ...).
local function onDied(player: Player, character: Model)
	local r = round
	if not r or r.survivors[player] ~= "Playing" then
		return
	end
	r.survivors[player] = "Caught"
	player:SetAttribute("Role", nil)
	local root = character:FindFirstChild("HumanoidRootPart")
	Items.DropHeld(player, if root and root:IsA("BasePart") then root.Position else nil)
	notifyAll(`{player.DisplayName} is out!`)
end

local function onEscaped(player: Player)
	local r = round
	if not r or r.survivors[player] ~= "Playing" or not Items.IsExitOpen() then
		return
	end
	r.survivors[player] = "Escaped"
	player:SetAttribute("Role", nil)
	Items.DropHeld(player)
	Data.AddCoins(player, Config.EscapeCoins)
	Data.AddEscape(player)
	notifyAll(`{player.DisplayName} escaped!`)
	sendToLobby(player)
end

Players.PlayerRemoving:Connect(function(player)
	local r = round
	if r and r.survivors[player] == "Playing" then
		r.survivors[player] = "Left"
	end
end)

---------------------------------------------------------------------------
-- Round flow
---------------------------------------------------------------------------

-- Players who are spawned in and can be put into a round.
local function readyPlayers(): { Player }
	local list = {}
	for _, player in Players:GetPlayers() do
		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		if humanoid and humanoid.Health > 0 and character:FindFirstChild("HumanoidRootPart") then
			table.insert(list, player)
		end
	end
	return list
end

-- Counts down the intermission. Returns false if there are not enough players.
local function intermission(): boolean
	local count = #Players:GetPlayers()
	if count < Config.MinPlayers then
		setStatus(`Waiting for players ({count}/{Config.MinPlayers})`)
		task.wait(1)
		return false
	end
	for timeLeft = Config.IntermissionTime, 1, -1 do
		if #Players:GetPlayers() < Config.MinPlayers then
			return false
		end
		setStatus("Intermission", timeLeft)
		task.wait(1)
	end
	return true
end

-- Returns why the round should end, or nil to keep going.
local function checkEnd(r: Round): string?
	if countPlaying(r) == 0 then
		return "Round over!"
	end
	if r.monsterPlayer and not r.monsterPlayer.Parent then
		return `{Config.MonsterName} left the game!`
	end
	return nil
end

local function cleanUpRound(r: Round)
	Monster.Stop()
	Items.Reset()
	for _, connection in r.connections do
		connection:Disconnect()
	end
	round = nil

	-- Everyone still in the map goes back to the lobby.
	for player, status in r.survivors do
		if player.Parent then
			Data.AddCoins(player, Config.PlayCoins)
			if status == "Playing" then
				player:SetAttribute("Role", nil)
				sendToLobby(player)
			end
		end
	end
	local monsterPlayer = r.monsterPlayer
	if monsterPlayer and monsterPlayer.Parent then
		Data.AddCoins(monsterPlayer, Config.PlayCoins)
		sendToLobby(monsterPlayer)
	end

	r.map:Destroy()
end

local function playRound()
	local maps = {}
	for _, map in MapBuilder.GetMaps() do
		if MapBuilder.Validate(map) then
			table.insert(maps, map)
		end
	end
	if #maps == 0 then
		setStatus("No playable maps! Check the Output window.")
		task.wait(10)
		return
	end

	local participants = readyPlayers()
	if #participants < Config.MinPlayers then
		return
	end

	local template = maps[math.random(#maps)]
	local map = template:Clone()
	map.Name = "CurrentMap"
	map.Parent = workspace

	local monsterPlayer: Player? = nil
	if Config.MonsterMode == "Player" and #participants >= 2 then
		monsterPlayer = table.remove(participants, math.random(#participants))
	end

	local r: Round = { map = map, survivors = {}, monsterPlayer = monsterPlayer, connections = {} }
	round = r

	Items.Setup(map, function()
		notifyAll("The exit is open! RUN!")
	end)

	-- Put the survivors in the map
	local spawns = {}
	for _, spawnPart in (map:FindFirstChild("PlayerSpawns") :: Folder):GetChildren() do
		if spawnPart:IsA("BasePart") then
			table.insert(spawns, spawnPart)
		end
	end
	for index, player in participants do
		local character = player.Character :: Model
		local humanoid = character:FindFirstChildOfClass("Humanoid") :: Humanoid
		local spawnPart = spawns[(index - 1) % #spawns + 1]
		r.survivors[player] = "Playing"
		player:SetAttribute("Role", "Survivor")
		character:PivotTo(spawnPart.CFrame + Vector3.new(0, 3, 0))
		table.insert(
			r.connections,
			humanoid.Died:Connect(function()
				onDied(player, character)
			end)
		)
		-- Respawning for any other reason (e.g. equipping a skin just as the
		-- round started) puts them back in the lobby, so they are out.
		table.insert(
			r.connections,
			player.CharacterAdded:Connect(function()
				if r.survivors[player] == "Playing" then
					r.survivors[player] = "Caught"
					player:SetAttribute("Role", nil)
					Items.DropHeld(player)
				end
			end)
		)
	end

	local exit = map:FindFirstChild("Exit")
	if exit and exit:IsA("BasePart") then
		table.insert(
			r.connections,
			exit.Touched:Connect(function(hit)
				local player = Players:GetPlayerFromCharacter(hit.Parent)
				if player then
					onEscaped(player)
				end
			end)
		)
	end

	Monster.Start({
		map = map,
		player = monsterPlayer,
		getTargets = getTargets,
		onCatch = onCaught,
		skin = if monsterPlayer then Data.GetEquippedSkin(monsterPlayer, "Monster") else Config.BotSkin,
	})

	notifyAll(tostring(map:GetAttribute("DisplayName") or template.Name))
	if monsterPlayer then
		notifyAll(`{monsterPlayer.DisplayName} is {Config.MonsterName}!`)
	end

	-- Head start
	local endReason: string? = nil
	for timeLeft = Config.HeadStartTime, 1, -1 do
		setStatus(`{Config.MonsterName} arrives in`, timeLeft)
		task.wait(1)
		endReason = checkEnd(r)
		if endReason then
			break
		end
	end

	-- The hunt
	if not endReason then
		Monster.Release()
		notifyAll(`{Config.MonsterName} is coming...`)
		local deadline = os.clock() + Config.RoundTime
		while true do
			local timeLeft = math.max(0, math.ceil(deadline - os.clock()))
			setStatus(if Items.IsExitOpen() then "The exit is open! RUN!" else "Find the items and escape!", timeLeft)
			endReason = checkEnd(r)
			if endReason then
				break
			end
			if timeLeft <= 0 then
				endReason = "Time's up!"
				break
			end
			task.wait(0.5)
		end
	end

	-- Results
	local escaped, caught = 0, 0
	for _, status in r.survivors do
		if status == "Escaped" then
			escaped += 1
		elseif status == "Caught" then
			caught += 1
		end
	end
	notifyAll(`{endReason} {escaped} escaped, {caught} caught.`)
	cleanUpRound(r)

	for timeLeft = Config.RoundOverTime, 1, -1 do
		setStatus(`Round over: {escaped} escaped`, timeLeft)
		task.wait(1)
	end
end

while true do
	if intermission() then
		local ok, err = xpcall(playRound, debug.traceback)
		if not ok then
			warn(`[{Config.GameName}] The round crashed:\n{err}`)
			local r = round
			if r then
				cleanUpRound(r)
			end
			task.wait(3)
		end
	end
end

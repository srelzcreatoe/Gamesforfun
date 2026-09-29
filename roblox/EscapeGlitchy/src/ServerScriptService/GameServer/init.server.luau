-- Runs the game: intermission (with voting) -> chapter -> head start -> hunt
-- -> results.
--
-- The other parts of the server live in the ModuleScripts inside this script:
--   Lobby       the waiting lobby, obby, leaderboard and shop stall
--   MapBuilder  finds the maps (Chapters builds the included ones)
--   Voting      chapter and mode votes
--   Items       items, locks, keypads and the exit
--   Monster     the AI bot / player monster
--   Traps       traps the monster places
--   Hiding      closets and lockers
--   Skins       the skin shop
--   Data        coins, skins and saving
--   Build       helpers for building with parts

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Config"))
local Lobby = require(script.Lobby)
local MapBuilder = require(script.MapBuilder)
local Voting = require(script.Voting)
local Items = require(script.Items)
local Monster = require(script.Monster)
local Traps = require(script.Traps)
local Hiding = require(script.Hiding)
local Skins = require(script.Skins)
local Data = require(script.Data)

-- Players whose respawn is still loading. They sit out the next round start.
local respawning: { [Player]: boolean } = {}

-- Respawns a player (in the lobby) without waiting for it to finish.
local function sendToLobby(player: Player)
	task.spawn(function()
		if not player.Parent then
			return
		end
		respawning[player] = true
		local ok, err = pcall(function()
			player:LoadCharacterAsync()
		end)
		respawning[player] = nil
		if not ok then
			warn(`[{Config.GameName}] Could not respawn {player.Name}: {err}`)
		end
	end)
end

-- Build the lobby before anything else so the first characters spawn in it.
local lobby = Lobby.Build()
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
local openShopRemote = newRemote("OpenShop")
local voteRemote = newRemote("Vote")
local placeTrapRemote = newRemote("PlaceTrap")
local keypadRemote = newRemote("Keypad")
local codeRemote = newRemote("EnterCode")
local spectateRemote = newRemote("Spectate")
local leaveHidingRemote = newRemote("LeaveHiding")
remotes.Parent = ReplicatedStorage

-- Phase is "Waiting", "Intermission", "Playing" or "Results".
local gameState = Instance.new("Folder")
gameState.Name = "GameState"
gameState:SetAttribute("Status", "Loading...")
gameState:SetAttribute("TimeLeft", 0)
gameState:SetAttribute("Phase", "Waiting")
gameState.Parent = ReplicatedStorage

local function setStatus(text: string, timeLeft: number?)
	gameState:SetAttribute("Status", text)
	gameState:SetAttribute("TimeLeft", timeLeft or 0)
end

local function setPhase(phase: string)
	gameState:SetAttribute("Phase", phase)
end

local function notifyAll(text: string)
	notifyRemote:FireAllClients(text)
end

local function notify(player: Player, text: string)
	notifyRemote:FireClient(player, text)
end

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

-- The survivors the monster can catch right now. Hiders are left out unless
-- the monster saw them get in.
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
			local hidden, spotted = Hiding.IsHidden(player)
			if not hidden or spotted then
				table.insert(list, {
					player = player,
					character = character :: Model,
					root = root,
					hidden = hidden,
					approach = if hidden then Hiding.FrontOf(player) else nil,
				})
			end
		end
	end
	return list
end

-- Marks a survivor as no longer in the round and cleans up after them.
local function leaveRound(r: Round, player: Player, status: SurvivorStatus, dropAt: Vector3?)
	r.survivors[player] = status
	Hiding.Unhide(player)
	player:SetAttribute("Role", nil)
	player:SetAttribute("Trapped", nil)
	Items.DropHeld(player, dropAt)
end

local function onCaught(player: Player)
	local r = round
	if not r or r.survivors[player] ~= "Playing" then
		return
	end
	Hiding.Unhide(player) -- pull them out first so the item drops where they are
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	local position = if root and root:IsA("BasePart") then root.Position else nil
	leaveRound(r, player, "Caught", position)
	if root and root:IsA("BasePart") then
		root.Anchored = true -- freeze them during the jumpscare
	end

	jumpscareRemote:FireClient(player)
	notifyAll(`{player.DisplayName} was caught by {Config.MonsterName}!`)
	if r.monsterPlayer and r.monsterPlayer.Parent then
		Data.AddCoins(r.monsterPlayer, Config.CatchCoins)
	end

	task.delay(Config.JumpscareTime, function()
		if player.Character == character then
			sendToLobby(player) -- back to the lobby
		end
	end)
end

-- A survivor died some other way (reset, fell off the map, ...).
local function onDied(player: Player, character: Model)
	local r = round
	if not r or r.survivors[player] ~= "Playing" then
		return
	end
	Hiding.Unhide(player) -- out of the closet first, so any item drops outside it
	local root = character:FindFirstChild("HumanoidRootPart")
	leaveRound(r, player, "Caught", if root and root:IsA("BasePart") then root.Position else nil)
	notifyAll(`{player.DisplayName} is out!`)
end

local function onEscaped(player: Player)
	local r = round
	if not r or r.survivors[player] ~= "Playing" or not Items.IsExitOpen() then
		return
	end
	leaveRound(r, player, "Escaped")
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
	respawning[player] = nil
end)

---------------------------------------------------------------------------
-- Start the other systems
---------------------------------------------------------------------------

Skins.Init({ notify = notify, respawn = sendToLobby, shopRemote = shopRemote })
Data.Start(Skins.OnDataLoaded)
Lobby.Start(lobby, { notify = notify, openShopRemote = openShopRemote })
Voting.Init(gameState, voteRemote)
Items.Init({
	notifyAll = notifyAll,
	notify = notify,
	dropRemote = dropRemote,
	keypadRemote = keypadRemote,
	codeRemote = codeRemote,
})
Traps.Init({
	notifyAll = notifyAll,
	notify = notify,
	placeRemote = placeTrapRemote,
	onTriggered = function(player, position)
		Monster.Alert(position)
		local r = round
		local monsterPlayer = r and r.monsterPlayer
		if monsterPlayer then
			notify(monsterPlayer, `{player.DisplayName} is stuck in a trap!`)
		end
	end,
})
Hiding.Init({
	notify = notify,
	canMonsterSee = Monster.CanSee,
	onSearched = function(player)
		onCaught(player)
	end,
	leaveRemote = leaveHidingRemote,
})

-- Caught players can watch the others; this makes the server stream in the
-- area around whoever they are watching.
spectateRemote.OnServerEvent:Connect(function(player, target)
	local allowed = round ~= nil
		and player:GetAttribute("Role") == nil
		and typeof(target) == "Instance"
		and target:IsA("Player")
		and target:GetAttribute("Role") ~= nil
	local character = allowed and (target :: Player).Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	player.ReplicationFocus = if root and root:IsA("BasePart") then root else nil
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
		if not respawning[player] and humanoid and humanoid.Health > 0 and character:FindFirstChild("HumanoidRootPart") then
			table.insert(list, player)
		end
	end
	return list
end

local function playableMaps(): { Model }
	local maps = {}
	for _, map in MapBuilder.GetMaps() do
		if MapBuilder.Validate(map) then
			table.insert(maps, map)
		end
	end
	return maps
end

-- Counts down the intermission while everyone votes. Returns the chosen map
-- and mode, or nil if the round can't start.
local function intermission(): (Model?, string?)
	local count = #Players:GetPlayers()
	if count < Config.MinPlayers then
		setPhase("Waiting")
		setStatus(`Waiting for players ({count}/{Config.MinPlayers})`)
		task.wait(1)
		return nil, nil
	end
	local maps = playableMaps()
	if #maps == 0 then
		setPhase("Waiting")
		setStatus("No playable maps! Check the Output window.")
		task.wait(10)
		return nil, nil
	end

	setPhase("Intermission")
	if Config.Voting then
		Voting.Open(maps)
	end
	for timeLeft = Config.IntermissionTime, 1, -1 do
		if #Players:GetPlayers() < Config.MinPlayers then
			if Config.Voting then
				Voting.Close()
			end
			return nil, nil
		end
		setStatus(if Config.Voting then "Intermission - vote now!" else "Intermission", timeLeft)
		task.wait(1)
	end
	if Config.Voting then
		return Voting.Close()
	end
	return maps[math.random(#maps)], Config.MonsterMode
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
	Hiding.Reset()
	Items.Reset()
	Traps.Reset()
	for _, connection in r.connections do
		connection:Disconnect()
	end
	round = nil
	setPhase("Results")

	-- Everyone still in the map goes back to the lobby.
	for player, status in r.survivors do
		if player.Parent then
			Data.AddCoins(player, Config.PlayCoins)
			local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
			local frozen = root ~= nil and root:IsA("BasePart") and root.Anchored -- a respawn that failed
			if status == "Playing" or frozen then
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
	for _, player in Players:GetPlayers() do
		player.ReplicationFocus = nil
	end

	r.map:Destroy()
end

local function playRound(template: Model, mode: string)
	if not template.Parent then
		return -- the map was removed during the vote
	end
	local participants = readyPlayers()
	if #participants < Config.MinPlayers then
		return
	end

	local map = template:Clone()
	map.Name = "CurrentMap"
	map.Parent = workspace

	local monsterPlayer: Player? = nil
	if mode == "Player" and #participants >= 2 then
		monsterPlayer = table.remove(participants, math.random(#participants))
	end

	local r: Round = { map = map, survivors = {}, monsterPlayer = monsterPlayer, connections = {} }
	round = r
	setPhase("Playing")

	Traps.Setup(map)
	Hiding.Setup(map)
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
		task.spawn(MapBuilder.Teleport, player, character, spawnPart.CFrame + Vector3.new(0, 3, 0))
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
					leaveRound(r, player, "Caught")
					notify(player, "You respawned, so you're out of this round.")
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

	notifyAll(MapBuilder.DisplayName(template))
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
		if monsterPlayer then
			monsterPlayer:SetAttribute("TrapsLeft", Config.TrapsPerRound)
		end
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
	local map, mode = intermission()
	if map and mode then
		local ok, err = xpcall(playRound, debug.traceback, map, mode)
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

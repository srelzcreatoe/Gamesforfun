-- Voting during intermission: everyone picks the next chapter and whether the
-- monster is the bot or a player. The most votes wins (ties are random).
--
-- The current vote is shared with clients as JSON in the GameState attribute
-- "Vote": { open, maps = { { name, votes } }, modes = { { name, votes } } }.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))
local MapBuilder = require(script.Parent.MapBuilder)

local Voting = {}

local MODES = { "Bot", "Player" }

local gameState: Folder
local isOpen = false
local maps: { Model } = {}
local mapVotes: { [Player]: number } = {}
local modeVotes: { [Player]: string } = {}

local function tally()
	local mapCounts, modeCounts = {}, {}
	for i in maps do
		mapCounts[i] = 0
	end
	for _, mode in MODES do
		modeCounts[mode] = 0
	end
	for _, index in mapVotes do
		mapCounts[index] += 1
	end
	for _, mode in modeVotes do
		modeCounts[mode] += 1
	end
	return mapCounts, modeCounts
end

local function publish()
	local mapCounts, modeCounts = tally()
	local payload = { open = isOpen, maps = {}, modes = {} }
	for i, map in maps do
		payload.maps[i] = { name = MapBuilder.DisplayName(map), votes = mapCounts[i] }
	end
	for _, mode in MODES do
		table.insert(payload.modes, { name = mode, votes = modeCounts[mode] })
	end
	gameState:SetAttribute("Vote", HttpService:JSONEncode(payload))
end

-- The option(s) with the most votes; returns one, picked at random on a tie.
local function pickWinner<T>(options: { T }, votesFor: (T) -> number): T
	local best, bestVotes = {}, -1
	for _, option in options do
		local votes = votesFor(option)
		if votes > bestVotes then
			best, bestVotes = { option }, votes
		elseif votes == bestVotes then
			table.insert(best, option)
		end
	end
	return best[math.random(#best)]
end

function Voting.Init(state: Folder, voteRemote: RemoteEvent)
	gameState = state
	voteRemote.OnServerEvent:Connect(function(player, kind, choice)
		if not isOpen then
			return
		end
		if kind == "Map" and typeof(choice) == "number" and maps[choice] then
			mapVotes[player] = choice
		elseif kind == "Mode" and (choice == "Bot" or choice == "Player") then
			modeVotes[player] = choice
		else
			return
		end
		publish()
	end)
	Players.PlayerRemoving:Connect(function(player)
		mapVotes[player] = nil
		modeVotes[player] = nil
		if isOpen then
			publish()
		end
	end)
end

function Voting.Open(mapList: { Model })
	maps = mapList
	table.clear(mapVotes)
	table.clear(modeVotes)
	isOpen = true
	publish()
end

-- Ends the vote. Returns the chosen map and mode.
function Voting.Close(): (Model, string)
	isOpen = false
	local mapCounts, modeCounts = tally()
	local indexes = {}
	for i in maps do
		table.insert(indexes, i)
	end
	local mapIndex = pickWinner(indexes, function(i)
		return mapCounts[i]
	end)
	local mode = Config.MonsterMode
	if next(modeVotes) then
		mode = pickWinner(MODES, function(m)
			return modeCounts[m]
		end)
	end
	publish()
	return maps[mapIndex], mode
end

return Voting

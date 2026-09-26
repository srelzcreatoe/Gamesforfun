--!strict
--[[
	TradeManager
	Location: ServerScriptService (Script)

	Brainrot trading between two players:
	  1. A asks B to trade; B has a few seconds to accept.
	  2. Both put up to FeatureConfig.MaxTradeItems brainrots from their base
	     on the table. Every change un-readies both sides, so nobody can swap
	     an offer at the last second.
	  3. When both press Ready a short countdown runs; then the server swaps
	     the brainrots in one step (GameplayManager's TradeBrainrots checks
	     that every brainrot is still at home and that both bases have room).

	Remotes (ReplicatedStorage.Remotes):
	  Trade       RemoteFunction (action, argument) -> (ok, message?)
	    "Request" userId | "Respond" { From = userId, Accept = bool } |
	    "Offer" { slot, ... } | "Ready" bool | "Cancel"
	  TradeState  RemoteEvent, server -> client:
	    { Kind = "Request", From, Name, ExpiresIn }
	    { Kind = "Session", Partner, PartnerName, Mine, Theirs, MyReady,
	      TheirReady, CountdownEndsAt }   (offers are lists of { Slot, Entry })
	    { Kind = "Closed", Message }
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local FeatureConfig = require(Shared:WaitForChild("FeatureConfig"))

local REQUEST_COOLDOWN_SECONDS = 0.25
local ASK_COOLDOWN_SECONDS = 4

local gameplayApi = ServerStorage:WaitForChild("Gameplay")
local tradeBrainrotsFunction = gameplayApi:WaitForChild("TradeBrainrots") :: BindableFunction
local describeSlotsFunction = gameplayApi:WaitForChild("DescribeSlots") :: BindableFunction
local activityEvent = gameplayApi:WaitForChild("Activity") :: BindableEvent

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local notifyEvent = remotes:WaitForChild("Notify") :: RemoteEvent

local tradeFunction = Instance.new("RemoteFunction")
tradeFunction.Name = "Trade"
local stateEvent = Instance.new("RemoteEvent")
stateEvent.Name = "TradeState"
stateEvent.Parent = remotes

type Offer = { { Slot: number, Entry: string } }

type Session = {
	A: Player,
	B: Player,
	Offers: { [Player]: Offer },
	Ready: { [Player]: boolean },
	CountdownEndsAt: number,
	-- Bumped on every change, so an old countdown knows it's stale.
	Version: number,
	Closed: boolean,
}

type Request = { From: Player, ExpiresAt: number }

local sessions: { [Player]: Session } = {}
-- requests[target][from]
local requests: { [Player]: { [Player]: Request } } = {}
local lastRequest: { [Player]: number } = {}
local lastAsk: { [Player]: number } = {}

local function notify(player: Player, message: string, kind: string, sound: string?)
	notifyEvent:FireClient(player, message, kind, sound)
end

local function partnerOf(session: Session, player: Player): Player
	return if session.A == player then session.B else session.A
end

local function pushSession(session: Session)
	for _, player in { session.A, session.B } do
		local partner = partnerOf(session, player)
		stateEvent:FireClient(player, {
			Kind = "Session",
			Partner = partner.UserId,
			PartnerName = partner.DisplayName,
			Mine = session.Offers[player],
			Theirs = session.Offers[partner],
			MyReady = session.Ready[player] == true,
			TheirReady = session.Ready[partner] == true,
			CountdownEndsAt = session.CountdownEndsAt,
		})
	end
end

local function closeSession(session: Session, message: string?)
	if session.Closed then
		return
	end
	session.Closed = true
	for _, player in { session.A, session.B } do
		if sessions[player] == session then
			sessions[player] = nil
		end
		if player.Parent == Players then
			stateEvent:FireClient(player, { Kind = "Closed", Message = message })
		end
	end
end

-- Any change: nobody is ready any more and a running countdown stops.
local function changed(session: Session)
	session.Version += 1
	session.Ready[session.A] = false
	session.Ready[session.B] = false
	session.CountdownEndsAt = 0
	pushSession(session)
end

local function slotsOf(offer: Offer): { number }
	local slots: { number } = {}
	for _, item in offer do
		table.insert(slots, item.Slot)
	end
	return slots
end

-- True if every offered pedestal still holds what was offered.
local function offerStillValid(player: Player, offer: Offer): boolean
	if #offer == 0 then
		return true
	end
	local entries = describeSlotsFunction:Invoke(player, slotsOf(offer))
	if typeof(entries) ~= "table" or #entries ~= #offer then
		return false
	end
	for index, item in offer do
		if entries[index] ~= item.Entry then
			return false
		end
	end
	return true
end

local function finish(session: Session, version: number)
	if session.Closed or session.Version ~= version then
		return
	end
	local a, b = session.A, session.B
	local ok = offerStillValid(a, session.Offers[a])
		and offerStillValid(b, session.Offers[b])
		and tradeBrainrotsFunction:Invoke(a, slotsOf(session.Offers[a]), b, slotsOf(session.Offers[b])) == true
	if not ok then
		notify(a, "The trade didn't go through: something changed or a base is full.", "Error")
		notify(b, "The trade didn't go through: something changed or a base is full.", "Error")
		-- Offers may point at pedestals that changed; start the table over.
		session.Offers[a] = {}
		session.Offers[b] = {}
		changed(session)
		return
	end
	activityEvent:Fire(a, "Trade", 1)
	activityEvent:Fire(b, "Trade", 1)
	notify(a, string.format("Trade with %s complete!", b.DisplayName), "Success", "StealSuccess")
	notify(b, string.format("Trade with %s complete!", a.DisplayName), "Success", "StealSuccess")
	closeSession(session, "Trade complete!")
end

type Handler = (player: Player, argument: any) -> (boolean, string?)
local HANDLERS: { [string]: Handler } = {}

HANDLERS.Request = function(player: Player, argument: any): (boolean, string?)
	local target = if typeof(argument) == "number" then Players:GetPlayerByUserId(argument) else nil
	if target == nil or target == player then
		return false, "That player isn't here."
	end
	if sessions[player] then
		return false, "You're already trading."
	end
	if sessions[target] then
		return false, target.DisplayName .. " is busy trading."
	end
	local now = os.clock()
	if now - (lastAsk[player] or 0) < ASK_COOLDOWN_SECONDS then
		return false, "Wait a moment before asking again."
	end
	lastAsk[player] = now
	-- They asked us too: just start.
	local mine = requests[player]
	local theirs = if mine then mine[target] else nil
	if theirs and theirs.ExpiresAt > now then
		return HANDLERS.Respond(player, { From = target.UserId, Accept = true })
	end
	requests[target] = requests[target] or {}
	requests[target][player] = { From = player, ExpiresAt = now + FeatureConfig.TradeRequestSeconds }
	stateEvent:FireClient(target, {
		Kind = "Request",
		From = player.UserId,
		Name = player.DisplayName,
		ExpiresIn = FeatureConfig.TradeRequestSeconds,
	})
	return true, string.format("Trade request sent to %s.", target.DisplayName)
end

HANDLERS.Respond = function(player: Player, argument: any): (boolean, string?)
	if typeof(argument) ~= "table" or typeof(argument.From) ~= "number" then
		return false, nil
	end
	local from = Players:GetPlayerByUserId(argument.From)
	local pending = requests[player]
	local request = if pending and from then pending[from] else nil
	if pending and from then
		pending[from] = nil
	end
	if from == nil or request == nil or request.ExpiresAt < os.clock() then
		return false, "That trade request ran out."
	end
	if argument.Accept ~= true then
		notify(from, player.DisplayName .. " said no to trading.", "Warning")
		return true, nil
	end
	if sessions[player] or sessions[from] then
		return false, "One of you is already trading."
	end
	local session: Session = {
		A = from,
		B = player,
		Offers = { [from] = {}, [player] = {} },
		Ready = { [from] = false, [player] = false },
		CountdownEndsAt = 0,
		Version = 0,
		Closed = false,
	}
	sessions[from] = session
	sessions[player] = session
	pushSession(session)
	return true, nil
end

HANDLERS.Offer = function(player: Player, argument: any): (boolean, string?)
	local session = sessions[player]
	if session == nil or typeof(argument) ~= "table" then
		return false, nil
	end
	local slots: { number } = {}
	for _, slot in argument do
		if typeof(slot) ~= "number" or slot ~= math.floor(slot) or table.find(slots, slot) then
			return false, nil
		end
		table.insert(slots, slot)
	end
	if #slots > FeatureConfig.MaxTradeItems then
		return false, string.format("You can offer up to %d brainrots.", FeatureConfig.MaxTradeItems)
	end
	local entries = if #slots > 0 then describeSlotsFunction:Invoke(player, slots) else {}
	if typeof(entries) ~= "table" or #entries ~= #slots then
		return false, "Only brainrots sitting in your base can be traded."
	end
	local offer: Offer = {}
	for index, slot in slots do
		table.insert(offer, { Slot = slot, Entry = entries[index] })
	end
	session.Offers[player] = offer
	changed(session)
	return true, nil
end

HANDLERS.Ready = function(player: Player, argument: any): (boolean, string?)
	local session = sessions[player]
	if session == nil then
		return false, nil
	end
	local partner = partnerOf(session, player)
	if #session.Offers[player] + #session.Offers[partner] == 0 then
		return false, "Put something on the table first."
	end
	session.Ready[player] = argument == true
	if session.Ready[session.A] and session.Ready[session.B] then
		session.Version += 1
		local version = session.Version
		session.CountdownEndsAt = Workspace:GetServerTimeNow() + FeatureConfig.TradeCountdownSeconds
		task.delay(FeatureConfig.TradeCountdownSeconds, finish, session, version)
	else
		session.Version += 1
		session.CountdownEndsAt = 0
	end
	pushSession(session)
	return true, nil
end

HANDLERS.Cancel = function(player: Player): (boolean, string?)
	local session = sessions[player]
	if session then
		closeSession(session, player.DisplayName .. " cancelled the trade.")
	end
	return true, nil
end

tradeFunction.OnServerInvoke = function(player: Player, action: any, argument: any): (boolean, string?)
	local handler = if typeof(action) == "string" then HANDLERS[action] else nil
	if handler == nil or player:GetAttribute("DataLoaded") ~= true then
		return false, nil
	end
	local now = os.clock()
	if now - (lastRequest[player] or 0) < REQUEST_COOLDOWN_SECONDS then
		return false, "Slow down!"
	end
	lastRequest[player] = now
	return handler(player, argument)
end

Players.PlayerRemoving:Connect(function(player: Player)
	local session = sessions[player]
	if session then
		closeSession(session, player.DisplayName .. " left the game.")
	end
	requests[player] = nil
	for _, pending in requests do
		pending[player] = nil
	end
	lastRequest[player] = nil
	lastAsk[player] = nil
end)

tradeFunction.Parent = remotes

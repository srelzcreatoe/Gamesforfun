--!strict
--[[
	SocialManager
	Location: ServerScriptService (Script)

	Everything between players:
	  * name tags: sized in studs above each head (Roblox's own name is
	    hidden), with the player's crew and bounty
	  * crews: up to ExtrasConfig.CrewMaxSize players in a server team up. Each
	    crewmate in the server adds ExtrasConfig.CrewBoostPerMember income;
	    crewmates walk through each other's laser doors and can't steal from
	    each other. Crews last as long as the server session.
	  * bounties: the server's top thief (at least BountyMinSteals steals this
	    session) has a price on their head, paid by the game to whoever steals
	    from them next
	  * revenge: when someone steals from you, you're faster for
	    RevengeSeconds and stealing anything back from them pays a bonus

	Remotes:
	  Crew       RemoteFunction (action, argument) -> (ok, message?, state?)
	             actions State, Create {Name, Color}, Invite userId,
	             Accept crewId, Decline crewId, Leave, Kick userId
	  CrewEvent  RemoteEvent, server -> client: ("Invite", info) or ("State", state)
	Player attributes: CrewId, CrewName, CrewColor, CrewBoost, Bounty,
	  RevengeTarget (UserId), RevengeEndsAt (server time), RevengeSpeed
	ReplicatedStorage attribute: BountyHolder (UserId, 0 = none)
]]

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local ExtrasConfig = require(Shared:WaitForChild("ExtrasConfig"))
local NumberFormat = require(Shared:WaitForChild("NumberFormat"))

local REQUEST_COOLDOWN_SECONDS = 0.4
local BOUNTY_REFRESH_SECONDS = 2

type Crew = {
	Id: string,
	Name: string,
	ColorIndex: number,
	Leader: Player,
	Members: { Player },
}

local dataApi = ServerStorage:WaitForChild("DataAndMonetization")
local gameplayApi = ServerStorage:WaitForChild("Gameplay")
local addCashFunction = dataApi:WaitForChild("AddCash") :: BindableFunction
local getIncomeFunction = gameplayApi:WaitForChild("GetIncome") :: BindableFunction
local stolenEvent = gameplayApi:WaitForChild("Stolen") :: BindableEvent
local activityEvent = gameplayApi:WaitForChild("Activity") :: BindableEvent

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local notifyEvent = remotes:WaitForChild("Notify") :: RemoteEvent

local crewFunction = Instance.new("RemoteFunction")
crewFunction.Name = "Crew"
crewFunction.Parent = remotes
local crewEvent = Instance.new("RemoteEvent")
crewEvent.Name = "CrewEvent"
crewEvent.Parent = remotes

local crews: { [string]: Crew } = {}
local crewOf: { [Player]: Crew } = {}
-- Invites waiting for an answer: invites[target][crewId] = expiry (os.clock()).
local invites: { [Player]: { [string]: number } } = {}
local sessionSteals: { [Player]: number } = {}
local lastRequest: { [Player]: number } = {}
local bountyHolder: Player? = nil

local function notify(player: Player, message: string, kind: string, sound: string?)
	notifyEvent:FireClient(player, message, kind, sound)
end

local function notifyAll(message: string, kind: string, sound: string?)
	notifyEvent:FireAllClients(message, kind, sound)
end

local function income(player: Player): number
	return tonumber(getIncomeFunction:Invoke(player)) or 0
end

--------------------------------------------------------------------------------
-- Name tags
--------------------------------------------------------------------------------

local function tagLine(parent: Instance, name: string, height: number, order: number, color: Color3): TextLabel
	local label = Instance.new("TextLabel")
	label.Name = name
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, height)
	label.LayoutOrder = order
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = color
	label.Text = ""
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 2
	stroke.Color = Color3.fromRGB(20, 20, 30)
	stroke.Parent = label
	label.Parent = parent
	return label
end

local function updateTag(player: Player)
	local character = player.Character
	local head = if character then character:FindFirstChild("Head") else nil
	local tag = if head then head:FindFirstChild("NameTag") else nil
	if tag == nil or not tag:IsA("BillboardGui") then
		return
	end
	tag.Enabled = player:GetAttribute("Cloaked") ~= true
	local crewLabel = tag:FindFirstChild("Crew") :: TextLabel?
	local bountyLabel = tag:FindFirstChild("Bounty") :: TextLabel?
	local crewName = player:GetAttribute("CrewName")
	if crewLabel then
		crewLabel.Visible = typeof(crewName) == "string"
		crewLabel.Text = if typeof(crewName) == "string" then "[" .. crewName .. "]" else ""
		local color = player:GetAttribute("CrewColor")
		crewLabel.TextColor3 = if typeof(color) == "Color3" then color else Color3.new(1, 1, 1)
	end
	local bounty = tonumber(player:GetAttribute("Bounty")) or 0
	if bountyLabel then
		bountyLabel.Visible = bounty > 0
		bountyLabel.Text = "💰 BOUNTY " .. NumberFormat.cash(bounty)
	end
end

local function addTag(player: Player, character: Model)
	local head = character:WaitForChild("Head", 10)
	local humanoid = character:WaitForChild("Humanoid", 10)
	if head == nil or not head:IsA("BasePart") or player.Character ~= character then
		return
	end
	if humanoid and humanoid:IsA("Humanoid") then
		-- Our own tag replaces Roblox's name, which doesn't scale with distance.
		humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
	end
	local old = head:FindFirstChild("NameTag")
	if old then
		old:Destroy()
	end
	local tag = Instance.new("BillboardGui")
	tag.Name = "NameTag"
	tag.Adornee = head
	-- Studs, like everything in the world: small far away, normal up close.
	tag.Size = UDim2.fromScale(7, 2.4)
	tag.StudsOffsetWorldSpace = Vector3.new(0, 2.6, 0)
	tag.MaxDistance = 140
	tag.LightInfluence = 0
	tag.PlayerToHideFrom = player
	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.VerticalAlignment = Enum.VerticalAlignment.Bottom
	layout.HorizontalAlignment = Enum.HorizontalAlignment.Center
	layout.Parent = tag
	tagLine(tag, "Crew", 0.26, 1, Color3.new(1, 1, 1))
	local nameLabel = tagLine(tag, "PlayerName", 0.42, 2, Color3.new(1, 1, 1))
	nameLabel.Text = player.DisplayName
	local bounty = tagLine(tag, "Bounty", 0.3, 3, Color3.fromRGB(255, 215, 60))
	local bountyStroke = bounty:FindFirstChildOfClass("UIStroke")
	if bountyStroke then
		bountyStroke.Color = Color3.fromRGB(150, 20, 20)
	end
	tag.Parent = head
	updateTag(player)
end

--------------------------------------------------------------------------------
-- Crews
--------------------------------------------------------------------------------

local function crewState(player: Player): { [string]: any }
	local crew = crewOf[player]
	local state: { [string]: any } = { Invites = {} }
	if crew then
		local members = {}
		for _, member in crew.Members do
			table.insert(members, { UserId = member.UserId, Name = member.DisplayName })
		end
		state.Crew = {
			Id = crew.Id,
			Name = crew.Name,
			ColorIndex = crew.ColorIndex,
			Leader = crew.Leader.UserId,
			Members = members,
		}
	end
	local now = os.clock()
	local pending: { [string]: number } = invites[player] or {}
	for crewId, expiry in pending do
		local invited = crews[crewId]
		if invited and expiry > now then
			table.insert(state.Invites, { CrewId = crewId, CrewName = invited.Name, From = invited.Leader.DisplayName })
		end
	end
	return state
end

local function pushState(player: Player)
	if player.Parent == Players then
		crewEvent:FireClient(player, "State", crewState(player))
	end
end

local function refreshCrew(crew: Crew)
	local boost = ExtrasConfig.CrewBoostPerMember * math.max(0, #crew.Members - 1)
	local color = ExtrasConfig.CrewColors[crew.ColorIndex] or Color3.new(1, 1, 1)
	for _, member in crew.Members do
		member:SetAttribute("CrewId", crew.Id)
		member:SetAttribute("CrewName", crew.Name)
		member:SetAttribute("CrewColor", color)
		member:SetAttribute("CrewBoost", boost)
		updateTag(member)
		pushState(member)
	end
end

local function leaveCrew(player: Player, message: string?)
	local crew = crewOf[player]
	if crew == nil then
		return
	end
	crewOf[player] = nil
	local index = table.find(crew.Members, player)
	if index then
		table.remove(crew.Members, index)
	end
	player:SetAttribute("CrewId", nil)
	player:SetAttribute("CrewName", nil)
	player:SetAttribute("CrewColor", nil)
	player:SetAttribute("CrewBoost", 0)
	updateTag(player)
	pushState(player)
	if #crew.Members == 0 then
		crews[crew.Id] = nil
		return
	end
	if crew.Leader == player then
		crew.Leader = crew.Members[1]
		notify(crew.Leader, "You lead the crew now.", "Info")
	end
	for _, member in crew.Members do
		notify(member, message or string.format("%s left the crew.", player.DisplayName), "Info")
	end
	refreshCrew(crew)
end

local HANDLERS: { [string]: (player: Player, argument: any) -> (boolean, string?) } = {}

HANDLERS.Create = function(player: Player, argument: any): (boolean, string?)
	if crewOf[player] then
		return false, "You're already in a crew."
	end
	local nameIndex = if typeof(argument) == "table" then tonumber(argument.Name) else nil
	local colorIndex = if typeof(argument) == "table" then tonumber(argument.Color) else nil
	local name = if nameIndex then ExtrasConfig.CrewNames[nameIndex] else nil
	if name == nil then
		return false, "Pick a crew name."
	end
	local crew: Crew = {
		Id = HttpService:GenerateGUID(false),
		Name = name,
		ColorIndex = if colorIndex and ExtrasConfig.CrewColors[colorIndex] then colorIndex else 1,
		Leader = player,
		Members = { player },
	}
	crews[crew.Id] = crew
	crewOf[player] = crew
	refreshCrew(crew)
	return true, string.format("You started the %s! Invite players from the Crew menu.", name)
end

HANDLERS.Invite = function(player: Player, argument: any): (boolean, string?)
	local crew = crewOf[player]
	if crew == nil then
		return false, "Start a crew first."
	end
	local target = if typeof(argument) == "number" then Players:GetPlayerByUserId(argument) else nil
	if target == nil or target == player then
		return false, "That player isn't here."
	end
	if crewOf[target] == crew then
		return false, "They're already in your crew."
	end
	if #crew.Members >= ExtrasConfig.CrewMaxSize then
		return false, "Your crew is full."
	end
	invites[target] = invites[target] or {}
	invites[target][crew.Id] = os.clock() + ExtrasConfig.CrewInviteSeconds
	crewEvent:FireClient(target, "Invite", { CrewId = crew.Id, CrewName = crew.Name, From = player.DisplayName })
	pushState(target)
	return true, string.format("Invited %s to the %s.", target.DisplayName, crew.Name)
end

HANDLERS.Accept = function(player: Player, argument: any): (boolean, string?)
	local crewId = if typeof(argument) == "string" then argument else nil
	local crew = if crewId then crews[crewId] else nil
	local expiry = if crewId and invites[player] then invites[player][crewId] else nil
	if crew == nil or expiry == nil or expiry < os.clock() then
		return false, "That invite ran out."
	end
	if #crew.Members >= ExtrasConfig.CrewMaxSize then
		return false, "That crew is full now."
	end
	invites[player][crewId :: string] = nil
	leaveCrew(player)
	crewOf[player] = crew
	table.insert(crew.Members, player)
	for _, member in crew.Members do
		if member ~= player then
			notify(member, string.format("%s joined the crew!", player.DisplayName), "Success")
		end
	end
	refreshCrew(crew)
	return true, string.format("You joined the %s! +%d%% income for each crewmate here.", crew.Name, math.floor(ExtrasConfig.CrewBoostPerMember * 100))
end

HANDLERS.Decline = function(player: Player, argument: any): (boolean, string?)
	if typeof(argument) == "string" and invites[player] then
		invites[player][argument] = nil
	end
	pushState(player)
	return true, nil
end

HANDLERS.Leave = function(player: Player): (boolean, string?)
	if crewOf[player] == nil then
		return false, "You're not in a crew."
	end
	leaveCrew(player)
	return true, "You left the crew."
end

HANDLERS.Kick = function(player: Player, argument: any): (boolean, string?)
	local crew = crewOf[player]
	local target = if typeof(argument) == "number" then Players:GetPlayerByUserId(argument) else nil
	if crew == nil or crew.Leader ~= player then
		return false, "Only the crew leader can do that."
	end
	if target == nil or target == player or crewOf[target] ~= crew then
		return false, "They're not in your crew."
	end
	leaveCrew(target, string.format("%s was kicked from the crew.", target.DisplayName))
	notify(target, "You were kicked from the crew.", "Warning")
	return true, nil
end

crewFunction.OnServerInvoke = function(player: Player, action: any, argument: any): (boolean, string?, any)
	if action == "State" then
		return true, nil, crewState(player)
	end
	local handler = if typeof(action) == "string" then HANDLERS[action] else nil
	if handler == nil then
		return false, nil
	end
	local now = os.clock()
	if now - (lastRequest[player] or 0) < REQUEST_COOLDOWN_SECONDS then
		return false, "Slow down!"
	end
	lastRequest[player] = now
	local ok, message = handler(player, argument)
	return ok, message, crewState(player)
end

--------------------------------------------------------------------------------
-- Bounties
--------------------------------------------------------------------------------

local function bountyFor(player: Player): number
	local steals = sessionSteals[player] or 0
	local perSecond = income(player)
	local fromIncome = math.min(perSecond * ExtrasConfig.BountyIncomeSecondsPerSteal * steals, perSecond * ExtrasConfig.BountyMaxIncomeSeconds)
	return math.floor(ExtrasConfig.BountyBase + fromIncome)
end

local function refreshBounty()
	local best: Player? = nil
	local bestSteals = ExtrasConfig.BountyMinSteals - 1
	for player, steals in sessionSteals do
		if player.Parent == Players and steals > bestSteals then
			best, bestSteals = player, steals
		end
	end
	if best ~= bountyHolder then
		local old = bountyHolder
		bountyHolder = best
		if old then
			old:SetAttribute("Bounty", 0)
			updateTag(old)
		end
		if best then
			notifyAll(string.format("💰 %s is the server's top thief! Steal from them to claim the bounty!", best.DisplayName), "Warning", "Notify")
		end
	end
	ReplicatedStorage:SetAttribute("BountyHolder", if best then best.UserId else 0)
	if best then
		best:SetAttribute("Bounty", bountyFor(best))
		updateTag(best)
	end
end

--------------------------------------------------------------------------------
-- Revenge
--------------------------------------------------------------------------------

local function clearRevenge(player: Player)
	player:SetAttribute("RevengeTarget", nil)
	player:SetAttribute("RevengeEndsAt", nil)
	player:SetAttribute("RevengeSpeed", 0)
end

local function startRevenge(victim: Player, thief: Player)
	local endsAt = Workspace:GetServerTimeNow() + ExtrasConfig.RevengeSeconds
	victim:SetAttribute("RevengeTarget", thief.UserId)
	victim:SetAttribute("RevengeEndsAt", endsAt)
	victim:SetAttribute("RevengeSpeed", ExtrasConfig.RevengeSpeedBonus)
	notify(
		victim,
		string.format("REVENGE! Steal anything from %s in the next %d seconds for a bonus. You're faster!", thief.DisplayName, ExtrasConfig.RevengeSeconds),
		"Warning",
		"Notify"
	)
	task.delay(ExtrasConfig.RevengeSeconds, function()
		if victim:GetAttribute("RevengeEndsAt") == endsAt then
			clearRevenge(victim)
		end
	end)
end

stolenEvent.Event:Connect(function(thiefArg: any, victimArg: any)
	if typeof(thiefArg) ~= "Instance" or not thiefArg:IsA("Player") or typeof(victimArg) ~= "Instance" or not victimArg:IsA("Player") then
		return
	end
	local thief: Player = thiefArg
	local victim: Player = victimArg
	sessionSteals[thief] = (sessionSteals[thief] or 0) + 1

	-- Getting them back.
	local endsAt = tonumber(thief:GetAttribute("RevengeEndsAt")) or 0
	if thief:GetAttribute("RevengeTarget") == victim.UserId and Workspace:GetServerTimeNow() < endsAt then
		local bonus = math.max(ExtrasConfig.RevengeMinCash, math.floor(income(thief) * ExtrasConfig.RevengeIncomeSeconds))
		addCashFunction:Invoke(thief, bonus)
		clearRevenge(thief)
		notify(thief, string.format("REVENGE! You got %s back and earned %s!", victim.DisplayName, NumberFormat.cash(bonus)), "Success", "StealSuccess")
		notify(victim, string.format("%s got their revenge!", thief.DisplayName), "Warning")
		activityEvent:Fire(thief, "Revenge", 1)
	end

	-- The bounty on the victim.
	if victim == bountyHolder then
		local bounty = tonumber(victim:GetAttribute("Bounty")) or bountyFor(victim)
		addCashFunction:Invoke(thief, bounty)
		sessionSteals[victim] = 0
		notifyAll(string.format("💰 %s claimed the %s bounty on %s!", thief.DisplayName, NumberFormat.cash(bounty), victim.DisplayName), "Success", "Notify")
		activityEvent:Fire(thief, "Bounty", 1)
	end

	startRevenge(victim, thief)
	refreshBounty()
end)

--------------------------------------------------------------------------------
-- Players
--------------------------------------------------------------------------------

local function onPlayerAdded(player: Player)
	player:SetAttribute("CrewBoost", 0)
	player:SetAttribute("Bounty", 0)
	player:SetAttribute("RevengeSpeed", 0)
	player.CharacterAdded:Connect(function(character: Model)
		addTag(player, character)
	end)
	if player.Character then
		task.spawn(addTag, player, player.Character)
	end
	player:GetAttributeChangedSignal("Cloaked"):Connect(function()
		updateTag(player)
	end)
	-- Anyone in the server can be invited: show them to everyone's crew menu.
	for _, other in Players:GetPlayers() do
		if other ~= player then
			pushState(other)
		end
	end
end

Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(function(player: Player)
	leaveCrew(player)
	invites[player] = nil
	sessionSteals[player] = nil
	lastRequest[player] = nil
	for _, pending in invites do
		for crewId in pending do
			if crews[crewId] == nil then
				pending[crewId] = nil
			end
		end
	end
	if bountyHolder == player then
		bountyHolder = nil
	end
	refreshBounty()
	-- Anyone who wanted revenge on them can't get it now.
	for _, other in Players:GetPlayers() do
		if other:GetAttribute("RevengeTarget") == player.UserId then
			clearRevenge(other)
		end
	end
end)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end
ReplicatedStorage:SetAttribute("BountyHolder", 0)

task.spawn(function()
	while true do
		task.wait(BOUNTY_REFRESH_SECONDS)
		pcall(refreshBounty)
	end
end)

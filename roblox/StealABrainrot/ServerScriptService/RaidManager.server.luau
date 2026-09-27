--!strict
--[[
	RaidManager
	Location: ServerScriptService (Script)

	The two events that happen on the map itself (GameplayManager starts and
	ends them like any other event and tells this script through
	ServerStorage.Gameplay.EventChanged):

	  * Boss Raid: a giant brainrot rampages up and down the walkway between
	    the bases (Workspace.Map.BossArena). Each boss is a random tier
	    (ExtrasConfig.BossTiers, Easy to Mega): tougher ones are bigger, have
	    more health and more attacks, attack faster and drop better loot. The
	    attacks each warn first: stomp shockwaves, an aimed laser (a red line,
	    then the beam), a grab-and-throw (a red ring under someone), meteor
	    rain (red circles) and a jump slam (the ring where it'll land). Below
	    ExtrasConfig.BossRageFraction health it rages. Everyone clicks (or
	    slaps) it; when it falls, the top three raiders win lucky blocks, on
	    Hard and Mega everyone who helped gets one too, and every helper gets
	    Cash and maybe a hat. Beating it ends the event.
	  * Bank Heist: the vault door (Workspace.Map.Vault) rolls open. Each gold
	    pile holds cash, gold bars or diamonds (ExtrasConfig.HeistLoot), worth
	    more the rarer they are and heavier to carry. Grab some and carry it
	    into your own base for Cash; a slap or a fall makes you drop it for
	    anyone to grab. Security lasers sweep the vault (jump over them or get
	    zapped back and lose your bag). In the last minute the alarm goes
	    off: faster lasers, double loot. Whoever banks the most wins a lucky
	    block.

	Client-facing state:
	  Boss model (Workspace.Map.Brainrots, State "Boss") with attributes
	    BossHealth, BossMaxHealth, Stomp (server time of the last stomp),
	    StompRadius and Enraged
	  Attack warnings and effects: Parts in Workspace.BossEffects
	  ReplicatedStorage attributes BossName, BossTier, BossTierColour,
	    BossHealth, BossMaxHealth (0 = no boss), BossEnraged, HeistOpen and
	    HeistAlarm
	  Player attributes CarryingLoot, LootValue, LootKind, LootSpeed
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local BrainrotConfig = require(Shared:WaitForChild("BrainrotConfig"))
local ExtrasConfig = require(Shared:WaitForChild("ExtrasConfig"))
local GameConfig = require(Shared:WaitForChild("GameConfig"))
local GearConfig = require(Shared:WaitForChild("GearConfig"))
local NumberFormat = require(Shared:WaitForChild("NumberFormat"))
local TemplateModels = require(Shared:WaitForChild("TemplateModels"))

local LOG_PREFIX = "[RaidManager]"
local TICK_SECONDS = 0.1
local DOOR_SECONDS = 2
local DROPPED_LOOT_SECONDS = 20
-- A player can be zapped by a vault laser once per this long.
local LASER_HIT_COOLDOWN = 1.5

local dataApi = ServerStorage:WaitForChild("DataAndMonetization")
local gameplayApi = ServerStorage:WaitForChild("Gameplay")
local gearApi = ServerStorage:WaitForChild("Gear")
local addCashFunction = dataApi:WaitForChild("AddCash") :: BindableFunction
local addHatFunction = dataApi:WaitForChild("AddHat") :: BindableFunction
local eventChangedEvent = gameplayApi:WaitForChild("EventChanged") :: BindableEvent
local giveBrainrotFunction = gameplayApi:WaitForChild("GiveBrainrot") :: BindableFunction
local getIncomeFunction = gameplayApi:WaitForChild("GetIncome") :: BindableFunction
local activityEvent = gameplayApi:WaitForChild("Activity") :: BindableEvent
local knockbackFunction = gearApi:WaitForChild("Knockback") :: BindableFunction
local slapSwingEvent = gearApi:WaitForChild("SlapSwing") :: BindableEvent
local slappedEvent = gearApi:WaitForChild("Slapped") :: BindableEvent

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local notifyEvent = remotes:WaitForChild("Notify") :: RemoteEvent
local playSoundEvent = remotes:WaitForChild("PlaySound") :: RemoteEvent

local map = Workspace:WaitForChild("Map")
local brainrotsFolder = map:WaitForChild("Brainrots")
local plotsFolder = map:WaitForChild("Plots")

local effectsFolder = Instance.new("Folder")
effectsFolder.Name = "BossEffects"
effectsFolder.Parent = Workspace

local rng = Random.new()

local function notify(player: Player, message: string, kind: string, sound: string?)
	notifyEvent:FireClient(player, message, kind, sound)
end

local function notifyAll(message: string, kind: string, sound: string?)
	notifyEvent:FireAllClients(message, kind, sound)
end

local function getRoot(player: Player): BasePart?
	local character = player.Character
	local root = if character then character:FindFirstChild("HumanoidRootPart") else nil
	local humanoid = if character then character:FindFirstChildOfClass("Humanoid") else nil
	if root and root:IsA("BasePart") and humanoid and humanoid.Health > 0 then
		return root
	end
	return nil
end

local function flat(vector: Vector3): Vector3
	return Vector3.new(vector.X, 0, vector.Z)
end

local function income(player: Player): number
	return tonumber(getIncomeFunction:Invoke(player)) or 0
end

local function isInside(part: BasePart, position: Vector3): boolean
	local localPosition = part.CFrame:PointToObjectSpace(position)
	local half = part.Size / 2
	return math.abs(localPosition.X) <= half.X and math.abs(localPosition.Y) <= half.Y + 4 and math.abs(localPosition.Z) <= half.Z
end

-- Picks from a list of things with a Weight.
local function weighted<T>(choices: { T }, weightOf: (T) -> number): T
	local total = 0
	for _, choice in choices do
		total += weightOf(choice)
	end
	local roll = rng:NextNumber() * total
	for _, choice in choices do
		roll -= weightOf(choice)
		if roll <= 0 then
			return choice
		end
	end
	return choices[#choices]
end

-- A glowing warning or effect, cleaned up after `seconds`.
local function effect(name: string, size: Vector3, cframe: CFrame, colour: Color3, transparency: number, seconds: number, shape: Enum.PartType?): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Size = size
	part.CFrame = cframe
	part.Color = colour
	part.Material = Enum.Material.Neon
	part.Transparency = transparency
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.CastShadow = false
	if shape then
		part.Shape = shape
	end
	part.Parent = effectsFolder
	task.delay(seconds, function()
		part:Destroy()
	end)
	return part
end

-- A flat red ring on the ground: "something lands here".
local function warningRing(name: string, centre: Vector3, radius: number, seconds: number): Part
	return effect(
		name,
		Vector3.new(0.3, radius * 2, radius * 2),
		CFrame.new(centre + Vector3.new(0, 0.25, 0)) * CFrame.Angles(0, 0, math.rad(90)),
		Color3.fromRGB(255, 40, 40),
		0.45,
		seconds,
		Enum.PartType.Cylinder
	)
end

-- A harmless explosion to look at.
local function boom(position: Vector3, radius: number)
	local explosion = Instance.new("Explosion")
	explosion.Position = position
	explosion.BlastRadius = radius
	explosion.BlastPressure = 0
	explosion.DestroyJointRadiusPercent = 0
	explosion.ExplosionType = Enum.ExplosionType.NoCraters
	explosion.Parent = effectsFolder
	task.delay(1, function()
		explosion:Destroy()
	end)
end

-- Knocks back everyone near `centre` (on the ground, within `radius`).
local function blast(centre: Vector3, radius: number, strength: number, stun: number, message: string?)
	for _, player in Players:GetPlayers() do
		local root = getRoot(player)
		if root then
			local offset = root.Position - centre
			local away = flat(offset)
			if away.Magnitude <= radius and math.abs(offset.Y) < 14 then
				knockbackFunction:Invoke(player, if away.Magnitude > 0.1 then away else Vector3.zAxis, strength, stun)
				playSoundEvent:FireClient(player, "Ouch")
				if message then
					notify(player, message, "Warning")
				end
			end
		end
	end
end

--------------------------------------------------------------------------------
-- Boss Raid
--------------------------------------------------------------------------------

type Boss = {
	Model: Model,
	Root: BasePart,
	Hitbox: BasePart,
	Name: string,
	Tier: ExtrasConfig.BossTier,
	Height: number,
	Speed: number,
	Health: number,
	MaxHealth: number,
	Damage: { [Player]: number },
	LastHit: { [Player]: number },
	Target: Vector3,
	NextAttack: number,
	LastAttack: string?,
	-- Standing still for an attack (or in the air, slamming).
	Busy: boolean,
	Enraged: boolean,
	Defeated: boolean,
}

local boss: Boss? = nil
local damageBoss: (current: Boss, player: Player, amount: number) -> ()

local function arena(): BasePart?
	local part = map:FindFirstChild("BossArena")
	return if part and part:IsA("BasePart") then part else nil
end

local function arenaGround(): number
	local area = arena()
	return if area then area.Position.Y - area.Size.Y / 2 else 0
end

local function randomSpot(area: BasePart): Vector3
	local half = area.Size / 2 - Vector3.new(20, 0, 12)
	local x = rng:NextNumber(-math.max(half.X, 1), math.max(half.X, 1))
	local z = rng:NextNumber(-math.max(half.Z, 1), math.max(half.Z, 1))
	return Vector3.new(area.Position.X + x, arenaGround(), area.Position.Z + z)
end

local function alive(current: Boss): boolean
	return boss == current and not current.Defeated
end

local function publishHealth(current: Boss)
	current.Model:SetAttribute("BossHealth", current.Health)
	ReplicatedStorage:SetAttribute("BossHealth", current.Health)
end

local function placeBoss(current: Boss, position: Vector3, facing: Vector3?)
	local look = if facing and flat(facing).Magnitude > 0.05 then flat(facing).Unit else current.Root.CFrame.LookVector
	current.Root.CFrame = CFrame.lookAt(position, position + look)
	current.Hitbox.CFrame = CFrame.new(position + Vector3.new(0, current.Height / 2, 0))
end

local function removeBoss(escaped: boolean)
	local current = boss
	boss = nil
	ReplicatedStorage:SetAttribute("BossName", nil)
	ReplicatedStorage:SetAttribute("BossTier", nil)
	ReplicatedStorage:SetAttribute("BossTierColour", nil)
	ReplicatedStorage:SetAttribute("BossEnraged", nil)
	ReplicatedStorage:SetAttribute("BossHealth", 0)
	ReplicatedStorage:SetAttribute("BossMaxHealth", 0)
	effectsFolder:ClearAllChildren()
	if current == nil then
		return
	end
	if escaped and not current.Defeated then
		notifyAll(string.format("%s got away! Maybe next time.", current.Name), "Warning")
	end
	current.Model:Destroy()
end

-- Raiders in reach: living players within `range` of the boss.
local function raidersNear(current: Boss, range: number): { { Player: Player, Root: BasePart } }
	local found = {}
	for _, player in Players:GetPlayers() do
		local root = getRoot(player)
		if root and flat(root.Position - current.Root.Position).Magnitude <= range then
			table.insert(found, { Player = player, Root = root })
		end
	end
	return found
end

local function spawnBoss()
	removeBoss(false)
	local area = arena()
	if area == nil then
		warn(LOG_PREFIX .. " No BossArena in the map; the Boss Raid has no boss.")
		return
	end
	local choices: { BrainrotConfig.Brainrot } = {}
	for _, id in ExtrasConfig.BossIds do
		local definition = BrainrotConfig.ById[id]
		if definition then
			table.insert(choices, definition)
		end
	end
	if #choices == 0 then
		return
	end
	local definition = choices[rng:NextInteger(1, #choices)]
	-- (NextBossTier: a tier picked by hand, for testing.)
	local forced = ReplicatedStorage:GetAttribute("NextBossTier")
	local tier = if typeof(forced) == "string" and ExtrasConfig.BossTierByName[forced]
		then ExtrasConfig.BossTierByName[forced]
		else weighted(ExtrasConfig.BossTiers, function(choice: ExtrasConfig.BossTier): number
			return choice.Weight
		end)
	local maxHealth = math.floor(math.max(ExtrasConfig.BossMinHealth, #Players:GetPlayers() * ExtrasConfig.BossHealthPerPlayer) * tier.Health)
	local height = ExtrasConfig.BossHeight * tier.Size

	local model = Instance.new("Model")
	model.Name = "Boss"
	local root = Instance.new("Part")
	root.Name = "Root"
	root.Size = Vector3.one
	root.Transparency = 1
	root.Anchored = true
	root.CanCollide = false
	root.CanQuery = false
	root.CanTouch = false
	root.Parent = model
	model.PrimaryPart = root
	local hitbox = Instance.new("Part")
	hitbox.Name = "Hitbox"
	hitbox.Size = Vector3.new(height * 0.6, height, height * 0.6)
	hitbox.Transparency = 1
	hitbox.Anchored = true
	hitbox.CanCollide = false
	hitbox.CanTouch = false
	hitbox.CanQuery = true
	hitbox.Parent = model
	local clicker = Instance.new("ClickDetector")
	clicker.MaxActivationDistance = ExtrasConfig.BossClickRange
	clicker.CursorIcon = "rbxasset://SystemCursors/Cross"
	clicker.Parent = hitbox

	local start = randomSpot(area)
	root.CFrame = CFrame.new(start)
	hitbox.CFrame = CFrame.new(start + Vector3.new(0, height / 2, 0))
	-- The imported model if there is one (else each client builds it).
	local template = TemplateModels.get(definition.Id)
	if template then
		TemplateModels.build(model, root, template, height)
	end
	model:SetAttribute("BrainrotId", definition.Id)
	model:SetAttribute("FigureHeight", height)
	model:SetAttribute("CustomModel", template ~= nil)
	model:SetAttribute("Rarity", "Brainrot God")
	model:SetAttribute("Mutation", "Boss")
	model:SetAttribute("Motion", "Walk")
	model:SetAttribute("State", "Boss")
	model:SetAttribute("BossTier", tier.Name)
	model:SetAttribute("BossMaxHealth", maxHealth)
	model:SetAttribute("BossHealth", maxHealth)
	model:SetAttribute("Stomp", 0)
	model:SetAttribute("StompRadius", ExtrasConfig.BossStompRadius * tier.Size)

	local name = "BOSS " .. definition.DisplayName
	local current: Boss = {
		Model = model,
		Root = root,
		Hitbox = hitbox,
		Name = name,
		Tier = tier,
		Height = height,
		Speed = ExtrasConfig.BossSpeed * tier.Speed,
		Health = maxHealth,
		MaxHealth = maxHealth,
		Damage = {},
		LastHit = {},
		Target = randomSpot(area),
		NextAttack = os.clock() + tier.AttackSeconds,
		LastAttack = nil,
		Busy = false,
		Enraged = false,
		Defeated = false,
	}
	boss = current
	ReplicatedStorage:SetAttribute("BossName", name)
	ReplicatedStorage:SetAttribute("BossTier", tier.Label)
	ReplicatedStorage:SetAttribute("BossTierColour", tier.Colour)
	ReplicatedStorage:SetAttribute("BossMaxHealth", maxHealth)
	publishHealth(current)
	model.Parent = brainrotsFolder

	local topPrize = BrainrotConfig.ById[tier.Prizes[1]]
	notifyAll(
		string.format(
			"%s %s appeared! Top raider wins a %s%s.",
			tier.Label,
			name,
			if topPrize then topPrize.DisplayName else "lucky block",
			if tier.EveryonePrize then ", and everyone who helps gets a lucky block" else ""
		),
		"Warning"
	)

	clicker.MouseClick:Connect(function(player: Player)
		local playerRoot = getRoot(player)
		if playerRoot == nil or boss ~= current then
			return
		end
		local now = os.clock()
		if now - (current.LastHit[player] or 0) < ExtrasConfig.BossClickCooldown then
			return
		end
		if (playerRoot.Position - current.Root.Position).Magnitude > ExtrasConfig.BossClickRange + height then
			return
		end
		current.LastHit[player] = now
		damageBoss(current, player, ExtrasConfig.BossClickDamage)
	end)
end

local function defeat(current: Boss)
	current.Defeated = true
	current.Busy = false
	current.Model:SetAttribute("State", "Defeated")
	effectsFolder:ClearAllChildren()
	local tier = current.Tier
	local ranking: { { Player: Player, Damage: number } } = {}
	local total = 0
	for player, amount in current.Damage do
		if player.Parent == Players then
			table.insert(ranking, { Player = player, Damage = amount })
			total += amount
		end
	end
	table.sort(ranking, function(a, b)
		return a.Damage > b.Damage
	end)
	local names: { string } = {}
	for place, entry in ranking do
		local player = entry.Player
		local helped = total > 0 and entry.Damage / total >= ExtrasConfig.BossMinShare
		local prize = if place <= #tier.Prizes then tier.Prizes[place] elseif helped then tier.EveryonePrize else nil
		if prize then
			giveBrainrotFunction:Invoke(player, prize)
			local definition = BrainrotConfig.ById[prize]
			local prizeName = if definition then definition.DisplayName else prize
			if place <= #tier.Prizes then
				table.insert(names, string.format("%d. %s", place, player.DisplayName))
				notify(player, string.format("You were #%d in the raid! You won a %s!", place, prizeName), "Success", "Purchase")
			else
				notify(player, string.format("You helped beat the boss! You won a %s!", prizeName), "Success", "Purchase")
			end
		end
		if helped then
			local cash = math.floor(math.max(ExtrasConfig.BossMinCash, income(player) * 60 * ExtrasConfig.BossCashMinutes) * tier.CashMultiplier)
			addCashFunction:Invoke(player, cash)
			local message = string.format("Boss beaten! +%s for helping.", NumberFormat.cash(cash))
			if rng:NextNumber() < ExtrasConfig.BossHatChance then
				local hatName = addHatFunction:Invoke(player, "Random", 1)
				local hat = if typeof(hatName) == "string" then ExtrasConfig.HatByName[hatName] else nil
				if hat then
					message ..= string.format(" And a %s %s!", hat.Icon, hat.DisplayName)
				end
			end
			notify(player, message, "Success", "Collect")
			activityEvent:Fire(player, "BossWin", 1)
			activityEvent:Fire(player, "BossHit", math.floor(entry.Damage / 50))
		end
	end
	notifyAll(
		string.format("%s %s is defeated! Top raiders: %s", tier.Label, current.Name, if #names > 0 then table.concat(names, ", ") else "nobody"),
		"Success",
		"Event"
	)
	-- Beating the boss ends the Boss Raid (GameplayManager's event loop
	-- watches EventEndsAt).
	ReplicatedStorage:SetAttribute("EventEndsAt", Workspace:GetServerTimeNow() + 3)
	task.delay(3, function()
		if boss == current then
			removeBoss(false)
		end
	end)
end

local function enrage(current: Boss)
	current.Enraged = true
	current.Speed *= ExtrasConfig.BossRageSpeedup
	current.Model:SetAttribute("Enraged", true)
	ReplicatedStorage:SetAttribute("BossEnraged", true)
	local fire = Instance.new("Fire")
	fire.Name = "Rage"
	fire.Size = current.Height * 0.35
	fire.Heat = 12
	fire.Color = Color3.fromRGB(255, 60, 20)
	fire.SecondaryColor = Color3.fromRGB(255, 200, 40)
	fire.Parent = current.Hitbox
	notifyAll(string.format("😡 %s is ENRAGED! It attacks faster!", current.Name), "Warning", "Alarm")
end

damageBoss = function(current: Boss, player: Player, amount: number)
	if not alive(current) then
		return
	end
	current.Health = math.max(0, current.Health - amount)
	current.Damage[player] = (current.Damage[player] or 0) + amount
	publishHealth(current)
	if current.Health <= 0 then
		defeat(current)
	elseif not current.Enraged and current.Health <= current.MaxHealth * ExtrasConfig.BossRageFraction then
		enrage(current)
	end
end

--------------------------------------------------------------------------------
-- Boss attacks: each warns first, then hits whoever didn't get out of the way
--------------------------------------------------------------------------------

local function stomp(current: Boss)
	current.Model:SetAttribute("Stomp", Workspace:GetServerTimeNow())
	blast(current.Root.Position, ExtrasConfig.BossStompRadius * current.Tier.Size, ExtrasConfig.BossStompKnockback, 0.6, nil)
end

-- A red line to where it's aiming, then a laser beam along it.
local function laser(current: Boss)
	local targets = raidersNear(current, ExtrasConfig.BossLaserRange)
	if #targets == 0 then
		stomp(current)
		return
	end
	local target = targets[rng:NextInteger(1, #targets)]
	current.Busy = true
	local eye = current.Root.Position + Vector3.new(0, current.Height * 0.72, 0)
	local aim = target.Root.Position - Vector3.new(0, 1, 0)
	local direction = (aim - eye).Unit
	local finish = eye + direction * ExtrasConfig.BossLaserRange
	local length = (finish - eye).Magnitude
	local middle = CFrame.lookAt((eye + finish) / 2, finish)
	placeBoss(current, current.Root.Position, aim - current.Root.Position)
	effect("LaserWarning", Vector3.new(0.35, 0.35, length), middle, Color3.fromRGB(255, 40, 40), 0.35, ExtrasConfig.BossLaserWindup)
	playSoundEvent:FireClient(target.Player, "Alarm")
	task.wait(ExtrasConfig.BossLaserWindup)
	if not alive(current) then
		return
	end
	effect("Laser", Vector3.new(2.6, 2.6, length), middle, Color3.fromRGB(255, 70, 60), 0, 0.4)
	for _, player in Players:GetPlayers() do
		local root = getRoot(player)
		if root then
			-- Distance from the beam.
			local along = math.clamp((root.Position - eye):Dot(direction), 0, length)
			local closest = eye + direction * along
			local gap = root.Position - closest
			if gap.Magnitude <= ExtrasConfig.BossLaserWidth then
				knockbackFunction:Invoke(player, if flat(gap).Magnitude > 0.1 then flat(gap) else flat(direction), ExtrasConfig.BossLaserKnockback, 1)
				playSoundEvent:FireClient(player, "Zap")
				notify(player, "⚡ Zapped by the boss's laser!", "Warning")
			end
		end
	end
	current.Busy = false
end

-- A red ring under someone; whoever's still in it is grabbed and thrown.
local function throw(current: Boss)
	local targets = raidersNear(current, ExtrasConfig.BossThrowRange)
	if #targets == 0 then
		laser(current)
		return
	end
	table.sort(targets, function(a, b)
		return (a.Root.Position - current.Root.Position).Magnitude < (b.Root.Position - current.Root.Position).Magnitude
	end)
	local target = targets[1]
	current.Busy = true
	local spot = Vector3.new(target.Root.Position.X, arenaGround(), target.Root.Position.Z)
	placeBoss(current, current.Root.Position, spot - current.Root.Position)
	warningRing("GrabWarning", spot, ExtrasConfig.BossThrowRadius, ExtrasConfig.BossThrowWindup)
	playSoundEvent:FireClient(target.Player, "Alarm")
	task.wait(ExtrasConfig.BossThrowWindup)
	if not alive(current) then
		return
	end
	for _, player in Players:GetPlayers() do
		local root = getRoot(player)
		if root and flat(root.Position - spot).Magnitude <= ExtrasConfig.BossThrowRadius then
			local away = flat(root.Position - current.Root.Position)
			knockbackFunction:Invoke(player, if away.Magnitude > 0.1 then away else Vector3.zAxis, ExtrasConfig.BossThrowStrength, 1.5)
			playSoundEvent:FireClient(player, "Launch")
			notify(player, string.format("%s grabbed you and THREW you!", current.Name), "Warning")
		end
	end
	current.Model:SetAttribute("Stomp", Workspace:GetServerTimeNow())
	current.Busy = false
end

-- Red circles near the raiders, then a meteor lands on each.
local function meteors(current: Boss)
	local targets = raidersNear(current, 120)
	local area = arena()
	local spots: { Vector3 } = {}
	for index = 1, ExtrasConfig.BossMeteorCount do
		local spot: Vector3
		if #targets > 0 and index % 2 == 1 then
			local target = targets[rng:NextInteger(1, #targets)]
			spot = target.Root.Position + Vector3.new(rng:NextNumber(-6, 6), 0, rng:NextNumber(-6, 6))
		elseif area then
			spot = randomSpot(area)
		else
			spot = current.Root.Position + Vector3.new(rng:NextNumber(-30, 30), 0, rng:NextNumber(-30, 30))
		end
		spot = Vector3.new(spot.X, arenaGround(), spot.Z)
		table.insert(spots, spot)
		warningRing("MeteorWarning", spot, ExtrasConfig.BossMeteorRadius, ExtrasConfig.BossMeteorWindup)
	end
	-- The meteors fall.
	local rocks: { Part } = {}
	for _, spot in spots do
		local rock = effect("Meteor", Vector3.one * 5, CFrame.new(spot + Vector3.new(0, 80, 0)), Color3.fromRGB(255, 110, 30), 0, ExtrasConfig.BossMeteorWindup + 0.2, Enum.PartType.Ball)
		table.insert(rocks, rock)
	end
	local started = os.clock()
	while os.clock() - started < ExtrasConfig.BossMeteorWindup do
		local alpha = math.clamp((os.clock() - started) / ExtrasConfig.BossMeteorWindup, 0, 1)
		for index, rock in rocks do
			rock.CFrame = CFrame.new(spots[index] + Vector3.new(0, 80 * (1 - alpha * alpha), 0))
		end
		task.wait(1 / 15)
	end
	if not alive(current) then
		return
	end
	for _, spot in spots do
		boom(spot + Vector3.new(0, 1, 0), ExtrasConfig.BossMeteorRadius)
		blast(spot, ExtrasConfig.BossMeteorRadius, ExtrasConfig.BossMeteorKnockback, 0.8, "☄️ A meteor got you!")
	end
end

-- It leaps onto someone (a ring where it'll land) and slams down.
local function slam(current: Boss)
	local targets = raidersNear(current, 80)
	if #targets == 0 then
		stomp(current)
		return
	end
	local target = targets[rng:NextInteger(1, #targets)]
	current.Busy = true
	local from = current.Root.Position
	local to = Vector3.new(target.Root.Position.X, arenaGround(), target.Root.Position.Z)
	local radius = ExtrasConfig.BossSlamRadius * current.Tier.Size
	warningRing("SlamWarning", to, radius, ExtrasConfig.BossSlamWindup)
	playSoundEvent:FireClient(target.Player, "Alarm")
	local started = os.clock()
	while os.clock() - started < ExtrasConfig.BossSlamWindup do
		if not alive(current) then
			return
		end
		local alpha = math.clamp((os.clock() - started) / ExtrasConfig.BossSlamWindup, 0, 1)
		local position = from:Lerp(to, alpha) + Vector3.new(0, math.sin(alpha * math.pi) * current.Height * 1.2, 0)
		placeBoss(current, position, to - from)
		task.wait(1 / 20)
	end
	if not alive(current) then
		return
	end
	placeBoss(current, to, to - from)
	current.Target = to
	current.Model:SetAttribute("Stomp", Workspace:GetServerTimeNow())
	boom(to + Vector3.new(0, 2, 0), radius * 0.6)
	blast(to, radius, ExtrasConfig.BossSlamKnockback, 1, string.format("💥 %s slammed down on you!", current.Name))
	current.Busy = false
end

local ATTACKS: { [string]: (Boss) -> () } = {
	Stomp = stomp,
	Laser = laser,
	Throw = throw,
	Meteors = meteors,
	Slam = slam,
}

local function attack(current: Boss)
	local choices = current.Tier.Attacks
	local name = choices[rng:NextInteger(1, #choices)]
	-- Not the same attack twice in a row, if it has others.
	if name == current.LastAttack and #choices > 1 then
		name = choices[rng:NextInteger(1, #choices)]
	end
	-- (NextBossAttack: an attack picked by hand, for testing.)
	local forced = ReplicatedStorage:GetAttribute("NextBossAttack")
	if typeof(forced) == "string" and ATTACKS[forced] then
		name = forced
		ReplicatedStorage:SetAttribute("NextBossAttack", nil)
	end
	current.LastAttack = name
	local run = ATTACKS[name] or stomp
	task.spawn(function()
		local ok, err = pcall(function()
			run(current)
		end)
		if not ok then
			current.Busy = false
			warn(string.format("%s Boss attack %s failed: %s", LOG_PREFIX, name, tostring(err)))
		end
	end)
end

local function stepBoss(dt: number)
	local current = boss
	if current == nil or current.Defeated then
		return
	end
	if not current.Busy then
		local area = arena()
		local position = current.Root.Position
		local offset = flat(current.Target - position)
		if offset.Magnitude < 3 then
			if area then
				current.Target = randomSpot(area)
			end
		else
			local step = math.min(offset.Magnitude, current.Speed * dt)
			placeBoss(current, position + offset.Unit * step, offset)
		end
	end
	if os.clock() >= current.NextAttack and not current.Busy then
		current.NextAttack = os.clock() + current.Tier.AttackSeconds / (if current.Enraged then ExtrasConfig.BossRageSpeedup else 1)
		attack(current)
	end
end

-- A slap glove swung at the boss hurts it more than a click.
slapSwingEvent.Event:Connect(function(playerArg: any)
	local current = boss
	if current == nil or typeof(playerArg) ~= "Instance" or not playerArg:IsA("Player") then
		return
	end
	local root = getRoot(playerArg)
	if root == nil then
		return
	end
	local offset = flat(current.Root.Position - root.Position)
	if offset.Magnitude <= GearConfig.SlapRange + current.Height * 0.35 and (offset.Magnitude < 1 or root.CFrame.LookVector:Dot(offset.Unit) > 0.2) then
		damageBoss(current, playerArg, ExtrasConfig.BossSlapDamage)
	end
end)

--------------------------------------------------------------------------------
-- Bank Heist
--------------------------------------------------------------------------------

type LootSpot = { Model: Model, Prompt: ProximityPrompt?, Taken: boolean, Kind: ExtrasConfig.HeistLoot, Sign: TextLabel? }
type Laser = { Part: Part, Phase: number }

local heistOpen = false
local heistAlarm = false
local lootSpots: { LootSpot } = {}
local lasers: { Laser } = {}
local laserClock = 0
local laserHits: { [Player]: number } = {}
local banked: { [Player]: number } = {}
local doorClosedPivot: CFrame? = nil
local doorMoving = 0

local function vault(): Model?
	local found = map:FindFirstChild("Vault")
	return if found and found:IsA("Model") then found else nil
end

local function vaultInside(): BasePart?
	local building = vault()
	local inside = if building then building:FindFirstChild("VaultInside") else nil
	return if inside and inside:IsA("BasePart") then inside else nil
end

local function moveDoor(open: boolean)
	local building = vault()
	local door = if building then building:FindFirstChild("VaultDoor") else nil
	local closed = if building then building:FindFirstChild("DoorClosed") else nil
	local opened = if building then building:FindFirstChild("DoorOpen") else nil
	if not (door and door:IsA("Model") and closed and closed:IsA("BasePart") and opened and opened:IsA("BasePart")) then
		return
	end
	-- The door moves around its disc.
	if door.PrimaryPart == nil then
		local disc = door:FindFirstChild("Disc")
		door.PrimaryPart = if disc and disc:IsA("BasePart") then disc else door:FindFirstChildWhichIsA("BasePart")
	end
	local closedPivot = doorClosedPivot or door:GetPivot()
	doorClosedPivot = closedPivot
	local shift = opened.Position - closed.Position
	local from = door:GetPivot()
	local to = if open then closedPivot + shift else closedPivot
	doorMoving += 1
	local token = doorMoving
	task.spawn(function()
		local started = os.clock()
		while token == doorMoving do
			local alpha = math.clamp((os.clock() - started) / DOOR_SECONDS, 0, 1)
			local eased = alpha * alpha * (3 - 2 * alpha)
			door:PivotTo(from:Lerp(to, eased))
			if alpha >= 1 then
				break
			end
			task.wait(1 / 20)
		end
	end)
end

local function randomLoot(): ExtrasConfig.HeistLoot
	return weighted(ExtrasConfig.HeistLoot, function(kind: ExtrasConfig.HeistLoot): number
		return kind.Weight
	end)
end

-- Shows a pile's loot: its bars and cash, a sign saying what it is, and a
-- sparkling diamond on top of a diamond pile.
local barLooks: { [BasePart]: { Colour: Color3, Material: Enum.Material } } = {}

local function dressPile(spot: LootSpot, visible: boolean)
	for _, part in spot.Model:GetDescendants() do
		if part:IsA("BasePart") and part.Name ~= "Pile" and part.Name ~= "Diamond" then
			part.Transparency = if visible then 0 else 1
			if string.sub(part.Name, 1, 3) == "Bar" then
				-- Gold bars as built; green bundles of cash; glassy diamonds.
				local look = barLooks[part] or { Colour = part.Color, Material = part.Material }
				barLooks[part] = look
				local kind = spot.Kind.Name
				part.Color = if kind == "Gold" then look.Colour else spot.Kind.Colour
				part.Material = if kind == "Gold" then look.Material elseif kind == "Diamond" then Enum.Material.Glass else Enum.Material.SmoothPlastic
			end
		end
	end
	local oldDiamond = spot.Model:FindFirstChild("Diamond")
	if oldDiamond then
		oldDiamond:Destroy()
	end
	local pile = spot.Model:FindFirstChild("Pile")
	if not (pile and pile:IsA("BasePart")) then
		return
	end
	if visible and spot.Kind.Name == "Diamond" then
		local diamond = Instance.new("Part")
		diamond.Name = "Diamond"
		diamond.Size = Vector3.new(1.8, 1.8, 1.8)
		diamond.CFrame = pile.CFrame * CFrame.new(0, 3.6, 0) * CFrame.Angles(math.rad(45), 0, math.rad(45))
		diamond.Color = spot.Kind.Colour
		diamond.Material = Enum.Material.Neon
		diamond.Anchored = true
		diamond.CanCollide = false
		diamond.CanQuery = false
		diamond.CanTouch = false
		local sparkles = Instance.new("Sparkles")
		sparkles.SparkleColor = spot.Kind.Colour
		sparkles.Parent = diamond
		diamond.Parent = spot.Model
	end
	if spot.Sign then
		spot.Sign.Text = spot.Kind.Label
		spot.Sign.TextColor3 = spot.Kind.Colour
		spot.Sign.Visible = visible
	end
	if spot.Prompt then
		spot.Prompt.ObjectText = spot.Kind.Label
	end
end

local function clearLoot(player: Player)
	player:SetAttribute("CarryingLoot", nil)
	player:SetAttribute("LootValue", nil)
	player:SetAttribute("LootKind", nil)
	player:SetAttribute("LootSpeed", 0)
	local character = player.Character
	local bag = if character then character:FindFirstChild("LootBag") else nil
	if bag then
		bag:Destroy()
	end
end

local function lootKind(name: any): ExtrasConfig.HeistLoot
	for _, kind in ExtrasConfig.HeistLoot do
		if kind.Name == name then
			return kind
		end
	end
	return ExtrasConfig.HeistLoot[1]
end

local function makeBag(name: string, kind: ExtrasConfig.HeistLoot): Part
	local bag = Instance.new("Part")
	bag.Name = name
	bag.Shape = Enum.PartType.Ball
	bag.Size = Vector3.new(2.6, 2.6, 2.6)
	bag.Color = kind.Colour:Lerp(Color3.fromRGB(150, 110, 60), 0.5)
	bag.Material = if kind.Name == "Diamond" then Enum.Material.Neon else Enum.Material.Fabric
	bag.CanCollide = false
	bag.CanQuery = false
	bag.CanTouch = false
	local label = Instance.new("BillboardGui")
	label.Size = UDim2.fromScale(2, 2)
	label.StudsOffset = Vector3.new(0, 0.2, 0)
	label.LightInfluence = 0
	label.MaxDistance = 80
	local sign = Instance.new("TextLabel")
	sign.BackgroundTransparency = 1
	sign.Size = UDim2.fromScale(1, 1)
	sign.Text = if kind.Name == "Diamond" then "💎" elseif kind.Name == "Gold" then "🟨" else "💰"
	sign.TextScaled = true
	sign.Parent = label
	label.Parent = bag
	return bag
end

local function attachBag(player: Player, kind: ExtrasConfig.HeistLoot)
	local character = player.Character
	local torso = if character
		then (character:FindFirstChild("UpperTorso") or character:FindFirstChild("Torso") or character:FindFirstChild("HumanoidRootPart"))
		else nil
	if character == nil or torso == nil or not torso:IsA("BasePart") then
		return
	end
	local bag = makeBag("LootBag", kind)
	bag.Massless = true
	bag.CFrame = torso.CFrame * CFrame.new(0, 0.4, 1.6)
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = torso
	weld.Part1 = bag
	weld.Parent = bag
	bag.Parent = character
end

local function giveLoot(player: Player, value: number, kind: ExtrasConfig.HeistLoot)
	player:SetAttribute("CarryingLoot", true)
	player:SetAttribute("LootValue", value)
	player:SetAttribute("LootKind", kind.Name)
	player:SetAttribute("LootSpeed", kind.Speed)
	attachBag(player, kind)
end

-- A dropped bag anyone can pick up for a while.
local function dropLoot(player: Player, message: string)
	local value = tonumber(player:GetAttribute("LootValue")) or 0
	local kind = lootKind(player:GetAttribute("LootKind"))
	local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	clearLoot(player)
	notify(player, message, "Warning")
	if value <= 0 or root == nil or not root:IsA("BasePart") then
		return
	end
	local bag = makeBag("DroppedLoot", kind)
	bag.Anchored = true
	bag.Position = root.Position - Vector3.new(0, 1.6, 0)
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Grab Loot"
	prompt.ObjectText = string.format("%s %s", kind.Label, NumberFormat.cash(value))
	prompt.HoldDuration = 0.4
	prompt.MaxActivationDistance = 8
	prompt.RequiresLineOfSight = false
	prompt:SetAttribute("PromptKind", "Loot")
	prompt.Parent = bag
	prompt.Triggered:Connect(function(taker: Player)
		if bag.Parent == nil or taker:GetAttribute("CarryingLoot") == true or taker:GetAttribute("Carrying") == true then
			return
		end
		bag:Destroy()
		giveLoot(taker, value, kind)
		notify(taker, string.format("You grabbed a dropped bag worth %s! Get it to your base!", NumberFormat.cash(value)), "Success", "Collect")
	end)
	bag.Parent = map
	task.delay(DROPPED_LOOT_SECONDS, function()
		if bag.Parent then
			bag:Destroy()
		end
	end)
end

local function onGrab(spot: LootSpot, player: Player)
	if not heistOpen or spot.Taken then
		return
	end
	if player:GetAttribute("CarryingLoot") == true then
		notify(player, "You're already carrying loot! Get it home first.", "Warning")
		return
	end
	if player:GetAttribute("Carrying") == true then
		notify(player, "Your hands are full!", "Warning")
		return
	end
	local kind = spot.Kind
	local multiplier = if heistAlarm then ExtrasConfig.HeistAlarmMultiplier else 1
	local value = math.floor(math.max(kind.Min, income(player) * kind.IncomeSeconds) * multiplier)
	spot.Taken = true
	dressPile(spot, false)
	if spot.Prompt then
		spot.Prompt.Enabled = false
	end
	giveLoot(player, value, kind)
	notify(player, string.format("You grabbed %s worth %s! Run it back to your base!", kind.Label, NumberFormat.cash(value)), "Success", "Collect")
	task.delay(ExtrasConfig.HeistRespawnSeconds, function()
		if heistOpen and spot.Taken then
			spot.Taken = false
			spot.Kind = randomLoot()
			dressPile(spot, true)
			if spot.Prompt then
				spot.Prompt.Enabled = true
			end
		end
	end)
end

-- Security lasers: bars at leg height across the vault, sweeping front to back.
local function addLasers()
	local inside = vaultInside()
	if inside == nil then
		return
	end
	for index = 1, ExtrasConfig.HeistLaserCount do
		local bar = Instance.new("Part")
		bar.Name = "SecurityLaser"
		bar.Size = Vector3.new(inside.Size.X, 0.35, 0.35)
		bar.Color = Color3.fromRGB(255, 30, 30)
		bar.Material = Enum.Material.Neon
		bar.Transparency = 0.1
		bar.Anchored = true
		bar.CanCollide = false
		bar.CanQuery = false
		bar.CanTouch = false
		bar.CastShadow = false
		bar.Parent = effectsFolder
		table.insert(lasers, { Part = bar, Phase = (index - 1) / ExtrasConfig.HeistLaserCount })
	end
end

local function removeLasers()
	for _, entry in lasers do
		entry.Part:Destroy()
	end
	lasers = {}
end

local function openHeist()
	local building = vault()
	if building == nil then
		warn(LOG_PREFIX .. " No Vault in the map; the Bank Heist has nothing to rob.")
		return
	end
	heistOpen = true
	heistAlarm = false
	banked = {}
	ReplicatedStorage:SetAttribute("HeistOpen", true)
	ReplicatedStorage:SetAttribute("HeistAlarm", false)
	moveDoor(true)
	lootSpots = {}
	local lootFolder = building:FindFirstChild("Loot")
	if lootFolder then
		for _, child in lootFolder:GetChildren() do
			local pile = child:FindFirstChild("Pile")
			if child:IsA("Model") and pile and pile:IsA("BasePart") then
				local spot: LootSpot = { Model = child, Prompt = nil, Taken = false, Kind = randomLoot(), Sign = nil }
				local prompt = Instance.new("ProximityPrompt")
				prompt.ActionText = "Grab Loot"
				prompt.HoldDuration = ExtrasConfig.HeistGrabSeconds
				prompt.MaxActivationDistance = 9
				prompt.RequiresLineOfSight = false
				prompt:SetAttribute("PromptKind", "Loot")
				prompt.Parent = pile
				prompt.Triggered:Connect(function(player: Player)
					onGrab(spot, player)
				end)
				spot.Prompt = prompt
				local billboard = Instance.new("BillboardGui")
				billboard.Name = "LootSign"
				billboard.Size = UDim2.fromScale(6, 1.4)
				billboard.StudsOffset = Vector3.new(0, 5.2, 0)
				billboard.LightInfluence = 0
				billboard.MaxDistance = 70
				local sign = Instance.new("TextLabel")
				sign.BackgroundTransparency = 1
				sign.Size = UDim2.fromScale(1, 1)
				sign.Font = Enum.Font.FredokaOne
				sign.TextScaled = true
				local stroke = Instance.new("UIStroke")
				stroke.Thickness = 2
				stroke.Parent = sign
				sign.Parent = billboard
				billboard.Parent = pile
				spot.Sign = sign
				dressPile(spot, true)
				table.insert(lootSpots, spot)
			end
		end
	end
	addLasers()
	notifyAll("🏦 The vault is open! Grab loot, jump over the lasers and get it home.", "Info")
end

local function closeHeist()
	if not heistOpen then
		return
	end
	heistOpen = false
	heistAlarm = false
	ReplicatedStorage:SetAttribute("HeistOpen", false)
	ReplicatedStorage:SetAttribute("HeistAlarm", false)
	moveDoor(false)
	removeLasers()
	for _, spot in lootSpots do
		if spot.Prompt then
			spot.Prompt:Destroy()
		end
		local sign = spot.Model:FindFirstChild("LootSign", true)
		if sign then
			sign:Destroy()
		end
		spot.Kind = lootKind("Gold")
		spot.Sign = nil
		dressPile(spot, true)
	end
	lootSpots = {}
	-- The best robber wins a lucky block.
	local best: Player? = nil
	local bestValue = 0
	for player, value in banked do
		if player.Parent == Players and value > bestValue then
			best, bestValue = player, value
		end
	end
	banked = {}
	if best then
		local prize = BrainrotConfig.ById[ExtrasConfig.HeistTopPrize]
		giveBrainrotFunction:Invoke(best, ExtrasConfig.HeistTopPrize)
		notifyAll(
			string.format("🏆 Best robber: %s (%s)! They win a %s.", best.DisplayName, NumberFormat.cash(bestValue), if prize then prize.DisplayName else "lucky block"),
			"Success",
			"Event"
		)
	end
end

local function plotInterior(player: Player): BasePart?
	for _, plot in plotsFolder:GetChildren() do
		if plot:GetAttribute("OwnerUserId") == player.UserId then
			local interior = plot:FindFirstChild("Interior")
			return if interior and interior:IsA("BasePart") then interior else nil
		end
	end
	return nil
end

-- The lasers sweep, zap whoever's in the way, and speed up for the alarm.
local function stepLasers(dt: number)
	local inside = vaultInside()
	if not heistOpen or inside == nil or #lasers == 0 then
		return
	end
	local endsAt = tonumber(ReplicatedStorage:GetAttribute("EventEndsAt")) or 0
	if not heistAlarm and endsAt > 0 and endsAt - Workspace:GetServerTimeNow() <= ExtrasConfig.HeistAlarmSeconds then
		heistAlarm = true
		ReplicatedStorage:SetAttribute("HeistAlarm", true)
		notifyAll("🚨 ALARM! Loot is worth DOUBLE now, but the lasers are faster!", "Warning", "Alarm")
	end
	local speed = if heistAlarm then ExtrasConfig.HeistAlarmLaserSpeed else ExtrasConfig.HeistLaserSpeed
	local depth = inside.Size.Z - 2
	laserClock += dt * speed / math.max(depth, 1)
	local floorY = -inside.Size.Y / 2
	local now = os.clock()
	for index, entry in lasers do
		-- Back and forth along the vault, each a little behind the last,
		-- alternating ankle and knee height.
		local t = (laserClock + entry.Phase) % 2
		local along = (if t < 1 then t else 2 - t) - 0.5
		local height = if index % 2 == 1 then 1.8 else 3.2
		local cframe = inside.CFrame * CFrame.new(0, floorY + height, along * depth)
		entry.Part.CFrame = cframe
		for _, player in Players:GetPlayers() do
			local root = getRoot(player)
			if root == nil or now - (laserHits[player] or 0) < LASER_HIT_COOLDOWN then
				continue
			end
			local localPosition = cframe:PointToObjectSpace(root.Position)
			-- The feet are about 3 studs under the root; a jump clears it.
			local feet = localPosition.Y - 3
			if math.abs(localPosition.X) <= inside.Size.X / 2 and math.abs(localPosition.Z) <= 1.4 and feet <= 0.4 and feet >= -5 then
				laserHits[player] = now
				local outward = -inside.CFrame.LookVector
				knockbackFunction:Invoke(player, flat(outward), ExtrasConfig.HeistLaserKnockback, 0.8)
				playSoundEvent:FireClient(player, "Zap")
				if player:GetAttribute("CarryingLoot") == true then
					dropLoot(player, "⚡ A security laser zapped you and you dropped your loot!")
				else
					notify(player, "⚡ Zapped by a security laser! Jump over them.", "Warning")
				end
			end
		end
	end
end

-- Bags carried into their owner's base are cashed in.
local function stepLoot(_dt: number)
	for _, player in Players:GetPlayers() do
		if player:GetAttribute("CarryingLoot") ~= true then
			continue
		end
		local root = getRoot(player)
		if root == nil then
			dropLoot(player, "You dropped your loot!")
			continue
		end
		local interior = plotInterior(player)
		if interior and isInside(interior, root.Position) then
			local value = tonumber(player:GetAttribute("LootValue")) or 0
			clearLoot(player)
			if value > 0 then
				addCashFunction:Invoke(player, value)
				if heistOpen then
					banked[player] = (banked[player] or 0) + value
				end
				notify(player, string.format("Heist complete! +%s", NumberFormat.cash(value)), "Success", "Collect")
				activityEvent:Fire(player, "Heist", 1)
			end
		end
	end
end

slappedEvent.Event:Connect(function(slapper: any, target: any)
	if typeof(target) == "Instance" and target:IsA("Player") and target:GetAttribute("CarryingLoot") == true then
		dropLoot(target, "You got slapped and dropped your loot!")
		if typeof(slapper) == "Instance" and slapper:IsA("Player") then
			notify(slapper, string.format("%s dropped their loot! Grab it!", target.DisplayName), "Success")
		end
	end
end)

--------------------------------------------------------------------------------
-- Events and the loop
--------------------------------------------------------------------------------

local function eventByName(name: string?): GameConfig.GameEvent?
	if name == nil then
		return nil
	end
	for _, event in GameConfig.Events do
		if event.Name == name then
			return event
		end
	end
	return nil
end

eventChangedEvent.Event:Connect(function(name: any)
	local event = eventByName(if typeof(name) == "string" then name else nil)
	if event and event.Boss then
		spawnBoss()
	elseif event and event.Heist then
		openHeist()
	else
		removeBoss(true)
		closeHeist()
	end
end)

Players.PlayerRemoving:Connect(function(player: Player)
	local current = boss
	if current then
		current.Damage[player] = nil
		current.LastHit[player] = nil
	end
	laserHits[player] = nil
	banked[player] = nil
end)
Players.PlayerAdded:Connect(function(player: Player)
	player:SetAttribute("LootSpeed", 0)
	player.CharacterRemoving:Connect(function()
		if player:GetAttribute("CarryingLoot") == true then
			clearLoot(player)
		end
	end)
end)
ReplicatedStorage:SetAttribute("BossHealth", 0)
ReplicatedStorage:SetAttribute("BossMaxHealth", 0)
ReplicatedStorage:SetAttribute("HeistOpen", false)
ReplicatedStorage:SetAttribute("HeistAlarm", false)

task.spawn(function()
	local last = os.clock()
	while true do
		task.wait(TICK_SECONDS)
		local now = os.clock()
		local dt = math.min(now - last, 0.5)
		last = now
		for label, step in { Boss = stepBoss, Lasers = stepLasers, Loot = stepLoot } :: { [string]: (number) -> () } do
			local ok, err = pcall(function()
				step(dt)
			end)
			if not ok then
				warn(string.format("%s %s failed: %s", LOG_PREFIX, label, tostring(err)))
			end
		end
	end
end)

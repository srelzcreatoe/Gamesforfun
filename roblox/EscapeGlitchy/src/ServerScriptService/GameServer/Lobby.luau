-- The waiting lobby: a spooky courtyard with a giant Glitchy statue, an obby
-- that pays coins, a live leaderboard, a skin shop stall and a how-to-play
-- board.
--
-- If Workspace already has a Model named "Lobby" it is used as it is. Parts in
-- it named "ShopCounter", "ObbyFinish" and "Leaderboard" (with the same setup
-- as the built one) still get their features.

local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))
local Build = require(script.Parent.Build)
local Data = require(script.Parent.Data)

local Lobby = {}

local ORIGIN = Vector3.new(0, 200, 0) -- the top of the lobby floor
local HALF = 70 -- the lobby is 140 x 140 studs
local LEADERBOARD_ROWS = 8

local STONE = Color3.fromRGB(70, 68, 78)
local IRON = Color3.fromRGB(35, 35, 40)
local WARM = Color3.fromRGB(255, 200, 140)

local function at(x: number, y: number, z: number): Vector3
	return ORIGIN + Vector3.new(x, y, z)
end

local function lampPost(parent: Instance, x: number, z: number)
	-- A cylinder's length runs along its X axis, so size it 10 long and stand it up.
	local post = Build.Part(parent, "LampPost", Vector3.new(10, 0.6, 0.6), at(x, 5, z), IRON, Enum.Material.Metal)
	post.Shape = Enum.PartType.Cylinder
	post.CFrame = CFrame.new(at(x, 5, z)) * CFrame.Angles(0, 0, math.rad(90))
	local lamp = Build.Part(parent, "Lamp", Vector3.new(1.4, 1.4, 1.4), at(x, 10.5, z), WARM, Enum.Material.Neon)
	lamp.Shape = Enum.PartType.Ball
	Build.Light(lamp, 30, 1.3, WARM)
end

local function tree(parent: Instance, x: number, z: number)
	Build.Part(parent, "Trunk", Vector3.new(1.6, 10, 1.6), at(x, 5, z), Color3.fromRGB(60, 42, 30), Enum.Material.Wood)
	local leaves = Build.Part(parent, "Leaves", Vector3.new(11, 11, 11), at(x, 13, z), Color3.fromRGB(35, 60, 40), Enum.Material.LeafyGrass)
	leaves.Shape = Enum.PartType.Ball
end

-- A giant, blocky Glitchy on a pedestal, looking at the spawn.
local function statue(parent: Instance, z: number)
	local skin = Config.GetSkin(Config.DefaultMonsterSkin)
	local body = if skin then skin.BodyColor else Config.MonsterBodyColor
	local headColor = if skin then skin.HeadColor else Config.MonsterHeadColor
	local eyeColor = if skin then skin.EyeColor else Config.MonsterEyeColor

	local model = Build.Model(parent, "Statue")
	local s = 3 -- scale
	local pedestal = Build.Part(model, "Pedestal", Vector3.new(14, 3, 10), at(0, 1.5, z), STONE, Enum.Material.Slate)
	Build.Label(pedestal, Enum.NormalId.Back, string.upper(Config.MonsterName), { Color = eyeColor, Font = Enum.Font.Creepster })
	local top = 3
	for _, side in { -1, 1 } do
		Build.Part(model, "Leg", Vector3.new(s, 2 * s, s), at(side * 0.5 * s, top + s, z), body)
		-- Arms reach forward, towards the players.
		Build.Part(model, "Arm", Vector3.new(s, s, 2 * s), at(side * 1.5 * s, top + 3.5 * s, z + 0.5 * s), body)
	end
	Build.Part(model, "Torso", Vector3.new(2 * s, 2 * s, s), at(0, top + 3 * s, z), body)
	local head = Build.Part(model, "Head", Vector3.new(1.2 * s, 1.2 * s, 1.2 * s), at(0, top + 4.6 * s, z), headColor)
	for _, side in { -1, 1 } do
		local eye = Build.Part(
			model,
			"Eye",
			Vector3.new(0.3 * s, 0.3 * s, 0.1),
			head.Position + Vector3.new(side * 0.25 * s, 0.1 * s, 0.6 * s + 0.05),
			eyeColor,
			Enum.Material.Neon
		)
		eye.CanCollide = false
	end
	Build.Light(head, 25, 2, eyeColor)
	local outline = Instance.new("Highlight")
	outline.FillTransparency = 1
	outline.OutlineColor = eyeColor
	outline.DepthMode = Enum.HighlightDepthMode.Occluded
	outline.Parent = model

	-- A few gravestones in front of it.
	for _, spot in { { -14, 12 }, { -8, 16 }, { 9, 14 }, { 15, 10 }, { -2, 19 } } do
		local stone = Build.Part(model, "Gravestone", Vector3.new(2.2, 3, 0.6), at(spot[1], 1.5, z + spot[2]), Color3.fromRGB(110, 110, 115), Enum.Material.Slate)
		stone.CFrame *= CFrame.Angles(math.rad(math.random(-8, 8)), 0, math.rad(math.random(-6, 6)))
	end
end

-- A board that shows the best players in the server.
local function leaderboard(parent: Instance, x: number)
	local board = Build.Part(parent, "Leaderboard", Vector3.new(1, 18, 24), at(x, 11, 0), Color3.fromRGB(20, 20, 26), Enum.Material.SmoothPlastic)
	Build.Part(parent, "LeaderboardPost", Vector3.new(1.2, 3, 1.2), at(x, 1, -8), IRON, Enum.Material.Metal)
	Build.Part(parent, "LeaderboardPost", Vector3.new(1.2, 3, 1.2), at(x, 1, 8), IRON, Enum.Material.Metal)
	local surface = Instance.new("SurfaceGui")
	surface.Name = "Board"
	surface.Face = Enum.NormalId.Right -- faces the middle of the lobby
	surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	surface.PixelsPerStud = 25
	surface.Parent = board
	local list = Instance.new("UIListLayout")
	list.SortOrder = Enum.SortOrder.LayoutOrder
	list.Padding = UDim.new(0.01, 0)
	list.Parent = surface
	local function row(name: string, order: number, text: string, color: Color3, heightScale: number)
		local label = Instance.new("TextLabel")
		label.Name = name
		label.LayoutOrder = order
		label.Size = UDim2.fromScale(1, heightScale)
		label.BackgroundTransparency = 1
		label.Font = Enum.Font.GothamBold
		label.TextScaled = true
		label.TextColor3 = color
		label.Text = text
		label.Parent = surface
	end
	row("Title", 0, "TOP SURVIVORS", Config.MonsterEyeColor, 0.16)
	for i = 1, LEADERBOARD_ROWS do
		row("Row" .. i, i, "", Color3.new(1, 1, 1), 0.09)
	end
end

-- A market stall that opens the skin shop.
local function shopStall(parent: Instance, x: number)
	Build.Part(parent, "ShopCounter", Vector3.new(3, 3.5, 12), at(x, 1.75, 0), Color3.fromRGB(95, 65, 40), Enum.Material.Wood)
	for _, z in { -6, 6 } do
		Build.Part(parent, "StallPost", Vector3.new(0.6, 10, 0.6), at(x + 1, 5, z), Color3.fromRGB(80, 55, 35), Enum.Material.Wood)
	end
	for i = 0, 5 do
		Build.Part(
			parent,
			"Awning",
			Vector3.new(6, 0.4, 2),
			CFrame.new(at(x - 1, 10, -5 + i * 2)) * CFrame.Angles(0, 0, math.rad(-12)),
			if i % 2 == 0 then Color3.fromRGB(170, 30, 40) else Color3.fromRGB(235, 230, 220),
			Enum.Material.Fabric
		)
	end
	local sign = Build.Part(parent, "ShopSign", Vector3.new(0.5, 3, 12), at(x + 1, 12.5, 0), Color3.fromRGB(25, 20, 20))
	Build.Label(sign, Enum.NormalId.Left, "SKIN SHOP", { Color = Color3.fromRGB(255, 210, 70) })
	Build.Light(sign, 18, 1, WARM)
end

local function obby(parent: Instance)
	local model = Build.Model(parent, "Obby")
	local colors = { Color3.fromRGB(170, 40, 60), Color3.fromRGB(60, 50, 150), Color3.fromRGB(40, 130, 90) }
	local sign = Build.Part(model, "ObbySign", Vector3.new(8, 4, 0.5), at(48, 5, 60), Color3.fromRGB(20, 20, 26))
	Build.Label(sign, Enum.NormalId.Front, `OBBY  +{Config.ObbyCoins} coins`, { Color = Color3.fromRGB(255, 210, 70) })
	-- Platforms that climb from east to west along the south edge.
	local x, y = 40, 2
	for i = 1, 12 do
		local width = if i % 4 == 0 then 1.6 else 4 -- every fourth one is a thin beam
		Build.Part(model, "Platform", Vector3.new(4, 1, width), at(x, y, 55), colors[i % #colors + 1], Enum.Material.SmoothPlastic)
		x -= 8
		y += if i % 3 == 0 then 1 else 2
	end
	local finishY = y
	Build.Part(model, "FinishPlatform", Vector3.new(10, 1, 10), at(x - 2, finishY, 55), Color3.fromRGB(230, 190, 60), Enum.Material.Metal)
	local finish = Build.Part(model, "ObbyFinish", Vector3.new(4, 1, 4), at(x - 2, finishY + 1, 55), Color3.fromRGB(255, 220, 90), Enum.Material.Neon)
	finish.CanCollide = false
	Build.Light(finish, 16, 1.5, Color3.fromRGB(255, 220, 90))
end

local function howToPlay(parent: Instance)
	local board = Build.Part(parent, "HowToPlay", Vector3.new(26, 13, 1), at(0, 8, 34), Color3.fromRGB(28, 24, 22), Enum.Material.Wood)
	Build.Part(parent, "BoardLeg", Vector3.new(1, 3, 1), at(-11, 1, 34), IRON, Enum.Material.Metal)
	Build.Part(parent, "BoardLeg", Vector3.new(1, 3, 1), at(11, 1, 34), IRON, Enum.Material.Metal)
	local label = Build.Label(
		board,
		Enum.NormalId.Front,
		"HOW TO PLAY\n"
			.. "Find items and use them on the locks.\n"
			.. "Read the code on a note, enter it on the keypad.\n"
			.. "Open every exit lock, then RUN for the exit!\n"
			.. "Hide in closets and lockers. Watch for traps!\n"
			.. "Caught? Press SPECTATE to watch the others.",
		{ Color = Color3.fromRGB(235, 225, 200), PixelsPerStud = 30 }
	)
	label.Font = Enum.Font.Gotham
end

-- Night, a little fog, and moonlight. Only used for the built lobby, so your
-- own lighting is left alone if you make your own lobby.
local function spookyLighting()
	Lighting.ClockTime = 0
	Lighting.Brightness = 1.5
	Lighting.Ambient = Color3.fromRGB(55, 55, 70)
	Lighting.OutdoorAmbient = Color3.fromRGB(85, 85, 110)
	local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere") or Instance.new("Atmosphere")
	atmosphere.Density = 0.32
	atmosphere.Color = Color3.fromRGB(110, 110, 140)
	atmosphere.Decay = Color3.fromRGB(50, 50, 70)
	atmosphere.Glare = 0
	atmosphere.Haze = 1.5
	atmosphere.Parent = Lighting
end

function Lobby.Build(): Model
	local existing = workspace:FindFirstChild("Lobby")
	if existing and existing:IsA("Model") then
		return existing
	end

	local lobby = Build.Model(nil, "Lobby")
	local decor = Build.Folder(lobby, "Decor")

	-- Ground, paths and the plaza around the spawn
	Build.Part(lobby, "Ground", Vector3.new(HALF * 2, 2, HALF * 2), at(0, -1, 0), Color3.fromRGB(40, 55, 42), Enum.Material.LeafyGrass)
	local path = Color3.fromRGB(95, 92, 100)
	Build.Part(decor, "Path", Vector3.new(8, 0.2, 90), at(0, 0.1, -10), path, Enum.Material.Cobblestone)
	Build.Part(decor, "Path", Vector3.new(110, 0.2, 8), at(0, 0.1, 0), path, Enum.Material.Cobblestone)
	local plaza = Build.Part(decor, "Plaza", Vector3.new(0.4, 30, 30), at(0, 0.2, 0), STONE, Enum.Material.Cobblestone)
	plaza.Shape = Enum.PartType.Cylinder
	plaza.CFrame = CFrame.new(at(0, 0.2, 0)) * CFrame.Angles(0, 0, math.rad(90))

	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "LobbySpawn"
	spawn.Anchored = true
	spawn.Size = Vector3.new(10, 1, 10)
	spawn.CFrame = CFrame.new(at(0, 0.5, 0))
	spawn.Duration = 0 -- no force field
	spawn.Neutral = true
	spawn.Color = Color3.fromRGB(90, 90, 110)
	spawn.Material = Enum.Material.Slate
	spawn.Parent = lobby

	-- Fence around the edge, and invisible walls so nobody falls off
	for i = -HALF, HALF, 10 do
		for _, spot in { { i, -HALF }, { i, HALF }, { -HALF, i }, { HALF, i } } do
			Build.Part(decor, "FencePost", Vector3.new(0.6, 6, 0.6), at(spot[1], 3, spot[2]), IRON, Enum.Material.Metal)
		end
	end
	for _, side in { -1, 1 } do
		for _, height in { 2, 5 } do
			Build.Part(decor, "FenceRail", Vector3.new(HALF * 2, 0.3, 0.3), at(0, height, side * HALF), IRON, Enum.Material.Metal)
			Build.Part(decor, "FenceRail", Vector3.new(0.3, 0.3, HALF * 2), at(side * HALF, height, 0), IRON, Enum.Material.Metal)
		end
		for _, wall in {
			Build.Part(lobby, "Barrier", Vector3.new(HALF * 2, 60, 1), at(0, 30, side * (HALF + 1)), Color3.new()),
			Build.Part(lobby, "Barrier", Vector3.new(1, 60, HALF * 2), at(side * (HALF + 1), 30, 0), Color3.new()),
		} do
			wall.Transparency = 1
		end
	end

	-- Lamp posts around the plaza, trees in the corners
	for i = 0, 7 do
		local angle = i / 8 * math.pi * 2
		lampPost(decor, math.cos(angle) * 20, math.sin(angle) * 20)
	end
	for _, spot in { { -58, -58 }, { 58, -58 }, { -60, 32 }, { 60, 34 }, { -30, -60 }, { 30, -60 } } do
		tree(decor, spot[1], spot[2])
	end

	statue(lobby, -46)
	leaderboard(lobby, -56)
	shopStall(lobby, 46)
	obby(lobby)
	howToPlay(lobby)

	lobby.Parent = workspace
	if Config.SpookyLighting then
		spookyLighting()
	end

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

local function updateLeaderboard(board: SurfaceGui)
	local entries = {}
	for _, player in Players:GetPlayers() do
		local stats = player:FindFirstChild("leaderstats")
		local escapes = stats and stats:FindFirstChild("Escapes")
		local coins = stats and stats:FindFirstChild("Coins")
		table.insert(entries, {
			name = player.DisplayName,
			escapes = if escapes and escapes:IsA("IntValue") then escapes.Value else 0,
			coins = if coins and coins:IsA("IntValue") then coins.Value else 0,
		})
	end
	table.sort(entries, function(a, b)
		if a.escapes ~= b.escapes then
			return a.escapes > b.escapes
		end
		return a.coins > b.coins
	end)
	for i = 1, LEADERBOARD_ROWS do
		local label = board:FindFirstChild("Row" .. i)
		local entry = entries[i]
		if label and label:IsA("TextLabel") then
			label.Text = if entry then `{i}. {entry.name}   {entry.escapes} escapes   {entry.coins} coins` else ""
		end
	end
end

-- Turns on the lobby's shop stall, obby reward and leaderboard.
function Lobby.Start(lobby: Model, options: { notify: (Player, string) -> (), openShopRemote: RemoteEvent })
	local counter = lobby:FindFirstChild("ShopCounter", true)
	if counter and counter:IsA("BasePart") then
		local prompt = Instance.new("ProximityPrompt")
		prompt.ActionText = "Open shop"
		prompt.ObjectText = "Skin Shop"
		prompt.MaxActivationDistance = 10
		prompt.RequiresLineOfSight = false
		prompt.Parent = counter
		prompt.Triggered:Connect(function(player)
			options.openShopRemote:FireClient(player)
		end)
	end

	local finish = lobby:FindFirstChild("ObbyFinish", true)
	if finish and finish:IsA("BasePart") then
		local lastReward: { [Player]: number } = {}
		local lastMessage: { [Player]: number } = {}
		finish.Touched:Connect(function(hit)
			local player = Players:GetPlayerFromCharacter(hit.Parent)
			if not player then
				return
			end
			local now = os.clock()
			local waitLeft = (lastReward[player] or -math.huge) + Config.ObbyCooldown - now
			if waitLeft <= 0 then
				lastReward[player] = now
				Data.AddCoins(player, Config.ObbyCoins)
				options.notify(player, `You beat the obby! +{Config.ObbyCoins} coins`)
			elseif (lastMessage[player] or -math.huge) + 10 < now then
				lastMessage[player] = now
				options.notify(player, `Obby coins again in {math.ceil(waitLeft / 60)} min`)
			end
		end)
		Players.PlayerRemoving:Connect(function(player)
			lastReward[player] = nil
			lastMessage[player] = nil
		end)
	end

	local boardPart = lobby:FindFirstChild("Leaderboard", true)
	local board = boardPart and boardPart:FindFirstChild("Board")
	if board and board:IsA("SurfaceGui") then
		task.spawn(function()
			while board.Parent do
				updateLeaderboard(board)
				task.wait(5)
			end
		end)
	end
end

return Lobby

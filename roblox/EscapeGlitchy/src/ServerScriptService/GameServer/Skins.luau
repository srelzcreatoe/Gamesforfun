-- The skin shop: buying and equipping skins, Robux purchases through Game
-- Passes, and dressing characters in their skin. Skins are listed in Config.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))
local Data = require(script.Parent.Data)

local Skins = {}

export type MonsterLook = { HeadColor: Color3, BodyColor: Color3, EyeColor: Color3 }

local notify: (Player, string) -> ()
local respawn: (Player) -> ()
local lastRequest: { [Player]: number } = {}

-- Waits a few seconds at most for the avatar's clothes and accessories to
-- finish loading, so a skin is not applied underneath them. Returns false if
-- the character is gone by then.
function Skins.WaitForAppearance(player: Player, character: Model): boolean
	local deadline = os.clock() + 5
	while not player:HasAppearanceLoaded() and os.clock() < deadline do
		task.wait(0.1)
	end
	return character.Parent ~= nil and player.Character == character
end

-- Removes clothes, accessories and any previous skin effects.
function Skins.ClearLook(character: Model)
	for _, child in character:GetChildren() do
		if child:IsA("Accessory") or child:IsA("Clothing") or child:IsA("ShirtGraphic") or child.Name == "SkinOutline" then
			child:Destroy()
		elseif child:IsA("BasePart") and child.Name ~= "HumanoidRootPart" and child.Name ~= "Eye" then
			child.Material = Enum.Material.Plastic
			child.Transparency = 0
		end
	end
end

local function setBodyColors(character: Model, head: Color3, torso: Color3, arms: Color3, legs: Color3)
	local bodyColors = character:FindFirstChildOfClass("BodyColors")
	if not bodyColors then
		bodyColors = Instance.new("BodyColors")
		bodyColors.Parent = character
	end
	bodyColors.HeadColor3 = head
	bodyColors.TorsoColor3 = torso
	bodyColors.LeftArmColor3 = arms
	bodyColors.RightArmColor3 = arms
	bodyColors.LeftLegColor3 = legs
	bodyColors.RightLegColor3 = legs
end

function Skins.ApplySurvivorSkin(character: Model, skinId: string)
	local skin = Config.GetSkin(skinId)
	if not skin or skin.Type ~= "Survivor" or skinId == Config.DefaultSurvivorSkin then
		return -- the default skin is just the player's own avatar
	end
	Skins.ClearLook(character)
	local gray = Color3.fromRGB(160, 160, 160)
	setBodyColors(character, skin.HeadColor or gray, skin.TorsoColor or gray, skin.ArmColor or gray, skin.LegColor or gray)

	for _, part in character:GetChildren() do
		if part:IsA("BasePart") and part.Name ~= "HumanoidRootPart" then
			if skin.Material then
				part.Material = skin.Material
			end
			if skin.Transparency then
				part.Transparency = skin.Transparency
			end
		end
	end
	local head = character:FindFirstChild("Head")
	local face = head and head:FindFirstChildWhichIsA("Decal")
	if face and skin.Transparency then
		face.Transparency = skin.Transparency
	end

	if skin.Outline then
		local outline = Instance.new("Highlight")
		outline.Name = "SkinOutline"
		outline.FillTransparency = 1
		outline.OutlineColor = skin.Outline
		outline.DepthMode = Enum.HighlightDepthMode.Occluded
		outline.Parent = character
	end
end

-- The colors for a monster skin (falls back to the default monster skin).
function Skins.GetMonsterLook(skinId: string?): MonsterLook
	local skin = skinId and Config.GetSkin(skinId)
	if not skin or skin.Type ~= "Monster" then
		skin = Config.GetSkin(Config.DefaultMonsterSkin)
	end
	return {
		HeadColor = skin and skin.HeadColor or Config.MonsterHeadColor,
		BodyColor = skin and skin.BodyColor or Config.MonsterBodyColor,
		EyeColor = skin and skin.EyeColor or Config.MonsterEyeColor,
	}
end

-- Paints a character in a monster skin's colors (eyes are added by Monster).
function Skins.ApplyMonsterColors(character: Model, look: MonsterLook)
	Skins.ClearLook(character)
	setBodyColors(character, look.HeadColor, look.BodyColor, look.BodyColor, look.BodyColor)
end

local function equip(player: Player, skin)
	Data.SetEquippedSkin(player, skin.Type, skin.Id)
	if skin.Type == "Monster" then
		notify(player, `{skin.Name} equipped! You'll look like this when you're the monster.`)
	elseif player:GetAttribute("Role") == nil then
		respawn(player) -- in the lobby: respawn so the new look shows right away
	else
		notify(player, `{skin.Name} will show the next time you spawn.`)
	end
end

local function grantGamePass(player: Player, gamePassId: number)
	for _, skin in Config.Skins do
		if skin.GamePassId and skin.GamePassId ~= 0 and skin.GamePassId == gamePassId and not Data.OwnsSkin(player, skin.Id) then
			Data.GiveSkin(player, skin.Id)
			notify(player, `You unlocked {skin.Name}!`)
		end
	end
end

local function checkGamePasses(player: Player)
	for _, skin in Config.Skins do
		local gamePassId = skin.GamePassId
		if gamePassId and gamePassId ~= 0 and not Data.OwnsSkin(player, skin.Id) then
			local ok, owns = pcall(function()
				return MarketplaceService:UserOwnsGamePassAsync(player.UserId, gamePassId)
			end)
			if ok and owns then
				Data.GiveSkin(player, skin.Id)
			end
		end
	end
end

local function onCharacterAdded(player: Player, character: Model)
	if not Skins.WaitForAppearance(player, character) then
		return
	end
	-- The monster's look is handled by the Monster module.
	if player:GetAttribute("Role") ~= "Monster" then
		Skins.ApplySurvivorSkin(character, Data.GetEquippedSkin(player, "Survivor"))
	end
end

local function watchPlayer(player: Player)
	player.CharacterAdded:Connect(function(character)
		onCharacterAdded(player, character)
	end)
end

---------------------------------------------------------------------------
-- Public
---------------------------------------------------------------------------

function Skins.Init(options: { notify: (Player, string) -> (), respawn: (Player) -> (), shopRemote: RemoteEvent })
	notify = options.notify
	respawn = options.respawn

	Players.PlayerAdded:Connect(watchPlayer)
	for _, player in Players:GetPlayers() do
		watchPlayer(player)
	end
	Players.PlayerRemoving:Connect(function(player)
		lastRequest[player] = nil
	end)

	options.shopRemote.OnServerEvent:Connect(function(player, action, skinId)
		if typeof(action) ~= "string" or typeof(skinId) ~= "string" then
			return
		end
		local skin = Config.GetSkin(skinId)
		if not skin then
			return
		end
		local now = os.clock()
		if (lastRequest[player] or 0) + 0.5 > now then
			return
		end
		lastRequest[player] = now

		if action == "Buy" then
			if Data.OwnsSkin(player, skin.Id) then
				return
			end
			if not Data.SpendCoins(player, skin.Price) then
				notify(player, "Not enough coins yet. Escape to earn more!")
				return
			end
			Data.GiveSkin(player, skin.Id)
			notify(player, `You bought {skin.Name}!`)
			equip(player, skin)
		elseif action == "Equip" then
			if Data.OwnsSkin(player, skin.Id) and Data.GetEquippedSkin(player, skin.Type) ~= skin.Id then
				equip(player, skin)
			end
		end
	end)

	MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, gamePassId, wasPurchased)
		if wasPurchased then
			grantGamePass(player, gamePassId)
		end
	end)
end

-- Called once a player's saved data has loaded.
function Skins.OnDataLoaded(player: Player)
	checkGamePasses(player)
	-- Their character probably spawned before the data arrived; dress it now.
	local character = player.Character
	if character and player:GetAttribute("Role") == nil then
		task.spawn(onCharacterAdded, player, character)
	end
end

return Skins

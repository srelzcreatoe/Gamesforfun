-- All the settings you are likely to want to change live in this one file.
-- The server and the client both read it, so keep it in ReplicatedStorage.

local Config = {}

Config.GameName = "Escape Glitchy"
Config.MonsterName = "Glitchy"

---------------------------------------------------------------------------
-- Round flow (all times are in seconds)
---------------------------------------------------------------------------
Config.MinPlayers = 1
Config.IntermissionTime = 20
Config.HeadStartTime = 15 -- how long survivors get before the monster is released
Config.RoundTime = 8 * 60
Config.RoundOverTime = 6 -- how long the "round over" screen stays up

-- "Bot": an AI monster hunts everyone (works with 1 player).
-- "Player": a random player becomes the monster. Needs at least 2 players,
-- otherwise the round falls back to "Bot".
Config.MonsterMode = "Bot"

---------------------------------------------------------------------------
-- Monster
---------------------------------------------------------------------------
Config.BotWanderSpeed = 10
Config.BotChaseSpeed = 15 -- players walk at 16, so a careful player can get away
Config.MonsterPlayerSpeed = 17
Config.CatchDistance = 4.5 -- sideways reach
Config.CatchHeight = 8 -- reach up/down, so survivors can't hide on top of furniture
Config.SightRange = 90 -- the bot sees players this far away if nothing is in the way
Config.HearingRange = 18 -- the bot notices players this close even through walls
Config.ChaseMemory = 4 -- seconds the bot keeps hunting a player it lost sight of
Config.CatchPause = 2 -- the bot stands still this long after catching someone

Config.MonsterBodyColor = Color3.fromRGB(28, 28, 34)
Config.MonsterHeadColor = Color3.fromRGB(45, 45, 52)
Config.MonsterEyeColor = Color3.fromRGB(255, 30, 30)

---------------------------------------------------------------------------
-- Voting, traps, hiding
---------------------------------------------------------------------------
Config.Voting = true -- everyone votes for the chapter and the mode during intermission

Config.TrapsPerRound = 3 -- traps a player monster can place (F key / Trap button)
Config.TrapTime = 4 -- seconds a survivor is stuck in a trap
Config.BotTrapInterval = 45 -- the bot drops a trap about this often (0 = never)
Config.MaxBotTraps = 3 -- the most bot traps in the map at once

Config.MaxHideTime = 25 -- seconds a survivor can stay in a closet or locker

---------------------------------------------------------------------------
-- Lobby
---------------------------------------------------------------------------
Config.SpookyLighting = true -- night and fog (only when the built-in lobby is used)
Config.ObbyCoins = 10
Config.ObbyCooldown = 300 -- seconds before the obby pays out to the same player again

---------------------------------------------------------------------------
-- Scares
---------------------------------------------------------------------------
Config.JumpscareTime = 1.5
-- Paste a sound id here to play it during the jumpscare, for example
-- "rbxassetid://1234567890". Upload your own or pick one from the Creator Store.
Config.JumpscareSoundId = ""
Config.WarningRange = 45 -- the screen edges glow red when the monster is this close

---------------------------------------------------------------------------
-- Rewards (shown on the leaderboard and saved between visits)
---------------------------------------------------------------------------
Config.EscapeCoins = 50
Config.CatchCoins = 20 -- for a player monster, per survivor caught
Config.PlayCoins = 5 -- for everyone who took part in a round

---------------------------------------------------------------------------
-- Items
-- The key of each entry is the item id. Maps refer to items by id:
--   * item spawn points have an attribute Item = "RedKey"
--   * locks have an attribute RequiredItem = "RedKey"
-- Shape is "Key", "Tool", "Card" or "Fuse". To use your own model, put a Model or Part named
-- after the item id (e.g. "RedKey") in ServerStorage > ItemModels.
---------------------------------------------------------------------------
Config.Items = {
	RedKey = { DisplayName = "Red Key", Color = Color3.fromRGB(225, 45, 45), Shape = "Key" },
	BlueKey = { DisplayName = "Blue Key", Color = Color3.fromRGB(45, 110, 235), Shape = "Key" },
	Wrench = { DisplayName = "Wrench", Color = Color3.fromRGB(165, 165, 175), Shape = "Tool" },
	JanitorKey = { DisplayName = "Janitor Key", Color = Color3.fromRGB(230, 180, 40), Shape = "Key" },
	Fuse = { DisplayName = "Fuse", Color = Color3.fromRGB(255, 140, 30), Shape = "Fuse" },
	Keycard = { DisplayName = "Keycard", Color = Color3.fromRGB(60, 200, 120), Shape = "Card" },
}

---------------------------------------------------------------------------
-- Skin shop
-- "Survivor" skins change how you look as a survivor.
-- "Monster" skins change how the monster looks when YOU are the monster
-- (Player mode). BotSkin picks the look of the AI monster.
--
-- Price is in coins. To also sell a skin for Robux: create a Game Pass on the
-- Creator Dashboard (your game > Monetization > Passes) and put its id in
-- GamePassId. Buying the pass unlocks the skin.
--
-- Survivor skin options: HeadColor, TorsoColor, ArmColor, LegColor,
-- Material, Transparency (0-1), Outline (a glowing outline color).
-- Monster skin options: HeadColor, BodyColor, EyeColor.
---------------------------------------------------------------------------
Config.DefaultSurvivorSkin = "Default"
Config.DefaultMonsterSkin = "Glitchy"
Config.BotSkin = "Glitchy"

Config.Skins = {
	-- Survivors
	{ Id = "Default", Type = "Survivor", Name = "Your Avatar", Price = 0 },
	{
		Id = "Noob",
		Type = "Survivor",
		Name = "Classic Noob",
		Price = 50,
		HeadColor = Color3.fromRGB(245, 205, 48),
		TorsoColor = Color3.fromRGB(13, 105, 172),
		ArmColor = Color3.fromRGB(245, 205, 48),
		LegColor = Color3.fromRGB(40, 127, 71),
	},
	{
		Id = "Midnight",
		Type = "Survivor",
		Name = "Midnight",
		Price = 150,
		HeadColor = Color3.fromRGB(40, 45, 80),
		TorsoColor = Color3.fromRGB(20, 25, 55),
		ArmColor = Color3.fromRGB(30, 35, 70),
		LegColor = Color3.fromRGB(15, 18, 40),
		Outline = Color3.fromRGB(90, 150, 255),
	},
	{
		Id = "Ghost",
		Type = "Survivor",
		Name = "Ghost",
		Price = 300,
		HeadColor = Color3.fromRGB(230, 240, 255),
		TorsoColor = Color3.fromRGB(210, 225, 245),
		ArmColor = Color3.fromRGB(220, 232, 250),
		LegColor = Color3.fromRGB(200, 215, 240),
		Transparency = 0.35,
	},
	{
		Id = "Golden",
		Type = "Survivor",
		Name = "Golden",
		Price = 750,
		HeadColor = Color3.fromRGB(255, 200, 60),
		TorsoColor = Color3.fromRGB(240, 180, 40),
		ArmColor = Color3.fromRGB(250, 190, 50),
		LegColor = Color3.fromRGB(225, 165, 30),
		Material = Enum.Material.Metal,
	},
	{
		Id = "Galaxy",
		Type = "Survivor",
		Name = "Galaxy",
		Price = 2000,
		GamePassId = 0, -- put a Game Pass id here to also sell it for Robux
		HeadColor = Color3.fromRGB(120, 60, 200),
		TorsoColor = Color3.fromRGB(60, 20, 120),
		ArmColor = Color3.fromRGB(90, 40, 170),
		LegColor = Color3.fromRGB(40, 10, 90),
		Material = Enum.Material.Neon,
		Outline = Color3.fromRGB(255, 120, 255),
	},

	-- Monsters
	{
		Id = "Glitchy",
		Type = "Monster",
		Name = "Glitchy",
		Price = 0,
		HeadColor = Config.MonsterHeadColor,
		BodyColor = Config.MonsterBodyColor,
		EyeColor = Config.MonsterEyeColor,
	},
	{
		Id = "Toxic",
		Type = "Monster",
		Name = "Toxic",
		Price = 200,
		HeadColor = Color3.fromRGB(40, 70, 35),
		BodyColor = Color3.fromRGB(25, 45, 25),
		EyeColor = Color3.fromRGB(90, 255, 60),
	},
	{
		Id = "Frostbite",
		Type = "Monster",
		Name = "Frostbite",
		Price = 350,
		HeadColor = Color3.fromRGB(225, 240, 250),
		BodyColor = Color3.fromRGB(190, 215, 235),
		EyeColor = Color3.fromRGB(40, 190, 255),
	},
	{
		Id = "Inferno",
		Type = "Monster",
		Name = "Inferno",
		Price = 600,
		HeadColor = Color3.fromRGB(90, 20, 10),
		BodyColor = Color3.fromRGB(55, 12, 8),
		EyeColor = Color3.fromRGB(255, 150, 0),
	},
}

function Config.GetSkin(skinId: string)
	for _, skin in Config.Skins do
		if skin.Id == skinId then
			return skin
		end
	end
	return nil
end

return Config

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
Config.CatchDistance = 4.5
Config.SightRange = 90 -- the bot sees players this far away if nothing is in the way
Config.HearingRange = 18 -- the bot notices players this close even through walls
Config.ChaseMemory = 4 -- seconds the bot keeps hunting a player it lost sight of
Config.CatchPause = 2 -- the bot stands still this long after catching someone

Config.MonsterBodyColor = Color3.fromRGB(28, 28, 34)
Config.MonsterHeadColor = Color3.fromRGB(45, 45, 52)
Config.MonsterEyeColor = Color3.fromRGB(255, 30, 30)

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
-- Shape is "Key" or "Tool". To use your own model, put a Model or Part named
-- after the item id (e.g. "RedKey") in ServerStorage > ItemModels.
---------------------------------------------------------------------------
Config.Items = {
	RedKey = { DisplayName = "Red Key", Color = Color3.fromRGB(225, 45, 45), Shape = "Key" },
	BlueKey = { DisplayName = "Blue Key", Color = Color3.fromRGB(45, 110, 235), Shape = "Key" },
	Wrench = { DisplayName = "Wrench", Color = Color3.fromRGB(165, 165, 175), Shape = "Tool" },
}

return Config

--!strict
--[[
	Music and sound effects. Every ID is audio from Roblox's Creator Store that
	any experience may play: Roblox's own UI and game sounds, and licensed
	production music (APM). To use your own, upload it in the Creator Dashboard
	and put its ID here. If a sound fails to load on a player's device, a
	built-in Roblox sound plays instead; music is simply skipped.
]]

export type SoundInfo = {
	Id: number,
	Volume: number,
}

local function sound(id: number, volume: number): SoundInfo
	return table.freeze({ Id = id, Volume = volume })
end

export type Station = { Name: string, Icon: string, Tracks: { number } }

local AudioConfig: {
	Music: { number },
	Stations: { Station },
	MusicVolume: number,
	FallbackSound: string,
	Sounds: { [string]: SoundInfo },
	RainSound: SoundInfo,
} = {
	-- The first track plays first, then the rest shuffle (about 50 minutes).
	Music = table.freeze({
		1847524834, -- Happy And Quirky A (APM)
		9047837288, -- Playful Promenade (APM)
		9047843332, -- The Jazzy Pizzman (APM)
		140228184971194, -- Game Lobby Alternate (APM)
		1842976958, -- Arcade Weekend (APM)
		1843599021, -- Fun Arcade (APM)
		9045965605, -- Fun and Games (APM)
		9048376991, -- Nice Day for 8 Bit (APM)
		1837768352, -- Retro Gamer (APM)
		1837768444, -- Coin Bonus (APM)
		1845555797, -- Carnival Jive (APM)
		95854834681311, -- Playful Pranks (APM)
		1839802242, -- Bouncy Funk (APM)
		1847418399, -- Goofy Groove (APM)
		1847448281, -- Wacky Races (APM)
		9047363636, -- Playtime Pop (APM)
		1842834040, -- Bouncy Castle (APM)
		1848353356, -- Funky Chicken (APM)
		1844612050, -- Toytown Reggae (APM)
		80170854893452, -- Sneaky Sneaky (APM)
		9045939292, -- Code Heist (APM)
		9043029912, -- Mischief Maker (APM)
	}),
	-- The radio (Settings and the Radio button): Mix plays Music above; the
	-- others play just their own tracks.
	Stations = table.freeze({
		table.freeze({ Name = "Mix", Icon = "🎶", Tracks = table.freeze({}) }),
		table.freeze({
			Name = "Arcade",
			Icon = "🕹️",
			Tracks = table.freeze({
				1842976958, -- Arcade Weekend (APM)
				1843599021, -- Fun Arcade (APM)
				9045965605, -- Fun and Games (APM)
				9048376991, -- Nice Day for 8 Bit (APM)
				1837768352, -- Retro Gamer (APM)
				1837768444, -- Coin Bonus (APM)
				140228184971194, -- Game Lobby Alternate (APM)
			}),
		}),
		table.freeze({
			Name = "Cartoon",
			Icon = "🤡",
			Tracks = table.freeze({
				1847524834, -- Happy And Quirky A (APM)
				9047837288, -- Playful Promenade (APM)
				9047843332, -- The Jazzy Pizzman (APM)
				1845555797, -- Carnival Jive (APM)
				95854834681311, -- Playful Pranks (APM)
				1847418399, -- Goofy Groove (APM)
				1847448281, -- Wacky Races (APM)
				9047363636, -- Playtime Pop (APM)
				1842834040, -- Bouncy Castle (APM)
				1839802242, -- Bouncy Funk (APM)
				1848353356, -- Funky Chicken (APM)
				1844612050, -- Toytown Reggae (APM)
			}),
		}),
		table.freeze({
			Name = "Heist",
			Icon = "🕵️",
			Tracks = table.freeze({
				80170854893452, -- Sneaky Sneaky (APM)
				9045939292, -- Code Heist (APM)
				9043029912, -- Mischief Maker (APM)
				1837463238, -- Heist Time (APM)
				1841825097, -- The Robbery (APM)
				9042159897, -- Cyber Heist (APM)
				1844258065, -- The Heist (APM)
			}),
		}),
		table.freeze({
			Name = "Chill",
			Icon = "😎",
			Tracks = table.freeze({
				9043887091, -- Lo-fi Chill A (APM)
				9044565954, -- Smooth Vibes (APM)
				9046863253, -- Poolside (APM)
				9046862941, -- Sunset Chill (APM)
				9047104411, -- Beach Cushions (APM)
				9046864489, -- Violet Clouds (APM)
				9044564552, -- Sunday Chilling (APM)
				9048510686, -- Slow Boat (APM)
			}),
		}),
	}),
	MusicVolume = 0.22,
	FallbackSound = "rbxasset://sounds/electronicpingshort.wav",

	Sounds = table.freeze({
		-- Interface
		Click = sound(17208396156, 0.5), -- Roblox GUI - Select
		Open = sound(17208405682, 0.45), -- Roblox GUI - Swipe
		Error = sound(17208353912, 0.6), -- Roblox GUI - Negative
		Notify = sound(17208361335, 0.5), -- Roblox GUI - Notification High
		-- Money
		Purchase = sound(10066947742, 0.7), -- RBLX UI Purchase
		Collect = sound(127645268874265, 0.6), -- CoinTransfer_01
		Sell = sound(127645268874265, 0.6),
		OfflineCash = sound(16480575861, 0.7), -- Pinball Big Metal Tally
		Rebirth = sound(17208327798, 0.8), -- Roblox GUI - Aura
		-- Stealing
		Grab = sound(17208319162, 0.7), -- Roblox GUI - Pickup
		Alarm = sound(16480578169, 0.8), -- Pinball 8-bit Riser
		StealSuccess = sound(12222253, 0.7), -- victory.wav
		Stolen = sound(17208372272, 0.7), -- Roblox GUI - Notification Low
		Returned = sound(15675055424, 0.6), -- Roblox UI Cute Pop
		Sniped = sound(17208353912, 0.7),
		-- Base
		Lock = sound(16480560857, 0.7), -- Pinball Giant Button Press
		Zap = sound(16480558943, 0.8), -- Pinball Joystick Buzz
		-- Gear and events
		Slap = sound(12222046, 0.8), -- hit.wav
		Swing = sound(12222200, 0.6), -- swoosh.wav
		Cloak = sound(15675024286, 0.6), -- Roblox UI Whoosh 01
		Event = sound(15675043410, 0.8), -- Roblox UI Tonal Stinger
		-- Troll items
		Freeze = sound(12222005, 0.7), -- glassbreak.wav
		Place = sound(12222124, 0.6), -- Short spring sound.wav
		Ouch = sound(12222058, 0.8), -- Kid saying Ouch.wav
		Launch = sound(12222084, 0.7), -- Rocket shot.wav
		Boogie = sound(1839931391, 0.6), -- Pizza Dance (APM)
		-- Weather
		Thunder = sound(12222030, 0.7), -- HalloweenThunder.wav
		Lightning = sound(12222019, 0.5), -- HalloweenLightning.wav
	}),
	-- Looped while it rains.
	RainSound = sound(1516791621, 0.35), -- Rain Effect
}

return table.freeze(AudioConfig)

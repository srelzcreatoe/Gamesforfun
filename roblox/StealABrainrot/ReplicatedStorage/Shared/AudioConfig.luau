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

local AudioConfig: {
	Music: { number },
	MusicVolume: number,
	FallbackSound: string,
	Sounds: { [string]: SoundInfo },
} = {
	-- Played in order, looping.
	Music = table.freeze({
		1847524834, -- Happy And Quirky A (APM)
		9047837288, -- Playful Promenade (APM)
		9047843332, -- The Jazzy Pizzman (APM)
		140228184971194, -- Game Lobby Alternate (APM)
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
	}),
}

return table.freeze(AudioConfig)

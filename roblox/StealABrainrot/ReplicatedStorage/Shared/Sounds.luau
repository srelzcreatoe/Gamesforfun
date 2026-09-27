--!strict
--[[
	Sounds (client only)

	Plays the background music playlist (in order, over and over) and the
	sound effects listed in AudioConfig. Sound effects that fail to load on
	this device fall back to a built-in Roblox sound; a music track that
	doesn't load, or stops partway, is skipped.
]]

local ContentProvider = game:GetService("ContentProvider")
local Debris = game:GetService("Debris")
local SoundService = game:GetService("SoundService")

local AudioConfig = require(script.Parent:WaitForChild("AudioConfig"))

-- A track that hasn't loaded after this long is skipped.
local TRACK_LOAD_TIMEOUT_SECONDS = 12
-- A playing track that hasn't moved for this long is moved on from.
local TRACK_STALL_SECONDS = 5
-- If no track will load at all, try again this often.
local TRACK_RETRY_SECONDS = 30

local Sounds = {}

local folder = Instance.new("Folder")
folder.Name = "GameSounds"
folder.Parent = SoundService

local effectsGroup = Instance.new("SoundGroup")
effectsGroup.Name = "Effects"
effectsGroup.Volume = 1
effectsGroup.Parent = folder

local musicGroup = Instance.new("SoundGroup")
musicGroup.Name = "Music"
musicGroup.Volume = 1
musicGroup.Parent = folder

local templates: { [string]: Sound } = {}
for name, info in AudioConfig.Sounds do
	local sound = Instance.new("Sound")
	sound.Name = name
	sound.SoundId = "rbxassetid://" .. tostring(info.Id)
	sound.Volume = info.Volume
	sound.SoundGroup = effectsGroup
	sound.Parent = folder
	templates[name] = sound
end

-- Swap sounds that can't be downloaded for the built-in fallback.
task.spawn(function()
	local list: { Instance } = {}
	for _, sound in templates do
		table.insert(list, sound)
	end
	pcall(function()
		ContentProvider:PreloadAsync(list, function(contentId: string, status: Enum.AssetFetchStatus)
			if status == Enum.AssetFetchStatus.Failure then
				for _, sound in templates do
					if sound.SoundId == contentId then
						sound.SoundId = AudioConfig.FallbackSound
					end
				end
			end
		end)
	end)
end)

-- Plays a sound effect from AudioConfig.Sounds by name.
function Sounds.play(name: string)
	local template: Sound? = templates[name]
	if template == nil then
		return
	end
	local sound = template:Clone()
	sound.Parent = folder
	sound.Ended:Once(function()
		sound:Destroy()
	end)
	Debris:AddItem(sound, 10)
	sound:Play()
end

--------------------------------------------------------------------------------
-- Music
--------------------------------------------------------------------------------

-- The playlist plays in order, one track after another, and starts over from
-- the first when it runs out. A watchdog makes sure it never just stops: a
-- track that doesn't load, or stops moving (even without Ended firing), is
-- moved on from, and if nothing will load it keeps trying.

local music = Instance.new("Sound")
music.Name = "BackgroundMusic"
music.Volume = AudioConfig.MusicVolume
music.SoundGroup = musicGroup
music.Parent = folder

local musicEnabled = true
-- The Settings slider's music volume (set further down).
local savedMusicVolume = 1
local function musicVolumeOr1(): number
	return if savedMusicVolume > 0 then savedMusicVolume else 1
end
local musicStarted = false
local trackIndex = 0
-- Tracks in a row that didn't load; after a whole playlist of them it waits.
local failuresInARow = 0
local trackStartedAt = 0
local lastPosition = -1
local lastMovedAt = 0

local function playTrack(index: number)
	local tracks = AudioConfig.Music
	if #tracks == 0 then
		return
	end
	trackIndex = (index - 1) % #tracks + 1
	music.SoundId = "rbxassetid://" .. tostring(tracks[trackIndex])
	music.TimePosition = 0
	music:Play()
	trackStartedAt = os.clock()
	lastPosition = -1
	lastMovedAt = trackStartedAt
end

local function playNextTrack()
	playTrack(trackIndex + 1)
end

music.Ended:Connect(function()
	failuresInARow = 0
	if musicStarted and musicEnabled then
		playNextTrack()
	end
end)

task.spawn(function()
	while true do
		task.wait(1)
		local now = os.clock()
		if not (musicStarted and musicEnabled) then
			-- Paused on purpose: that isn't stuck.
			lastMovedAt = now
		elseif not music.IsLoaded then
			-- After a whole playlist that wouldn't load, wait longer between tries.
			local limit = if failuresInARow >= #AudioConfig.Music then TRACK_RETRY_SECONDS else TRACK_LOAD_TIMEOUT_SECONDS
			if now - trackStartedAt >= limit then
				failuresInARow += 1
				playNextTrack()
			end
		else
			local position = music.TimePosition
			if position ~= lastPosition then
				lastPosition = position
				lastMovedAt = now
				if position > 0 then
					failuresInARow = 0
				end
			elseif now - lastMovedAt >= TRACK_STALL_SECONDS then
				-- It stopped or got stuck without finishing: carry on.
				playNextTrack()
			end
		end
	end
end)

function Sounds.startMusic()
	if musicStarted then
		return
	end
	musicStarted = true
	if musicEnabled then
		playTrack(1)
	end
end

function Sounds.isMusicEnabled(): boolean
	return musicEnabled
end

function Sounds.setMusicEnabled(enabled: boolean)
	musicEnabled = enabled
	musicGroup.Volume = if enabled then musicVolumeOr1() else 0
	if enabled and musicStarted and not music.IsPlaying then
		if music.SoundId == "" then
			playTrack(1)
		else
			music:Resume()
		end
	elseif not enabled then
		music:Pause()
	end
end

-- Volume sliders (Settings), 0..1. Music at 0 pauses the track.
function Sounds.setMusicVolume(volume: number)
	savedMusicVolume = math.clamp(volume, 0, 1)
	Sounds.setMusicEnabled(savedMusicVolume > 0)
end

function Sounds.setEffectsVolume(volume: number)
	effectsGroup.Volume = math.clamp(volume, 0, 1)
end

-- A sound effect that repeats until the returned function is called.
function Sounds.loop(name: string, intervalSeconds: number): () -> ()
	local running = true
	task.spawn(function()
		while running do
			Sounds.play(name)
			task.wait(intervalSeconds)
		end
	end)
	return function()
		running = false
	end
end

return table.freeze(Sounds)

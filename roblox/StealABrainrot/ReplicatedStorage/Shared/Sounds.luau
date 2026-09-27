--!strict
--[[
	Sounds (client only)

	Plays the background music playlist (shuffled) and the sound effects
	listed in AudioConfig. Sound effects that fail to load on this device fall back to a
	built-in Roblox sound; a music track that doesn't load is skipped.
]]

local ContentProvider = game:GetService("ContentProvider")
local Debris = game:GetService("Debris")
local SoundService = game:GetService("SoundService")

local AudioConfig = require(script.Parent:WaitForChild("AudioConfig"))

-- A track that hasn't loaded after this long is skipped.
local TRACK_LOAD_TIMEOUT_SECONDS = 12

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
local trackQueue: { number } = {}
local lastTrack: number? = nil
local trackToken = 0
local shuffleRng = Random.new()

-- The radio station's tracks (Mix = the whole AudioConfig.Music playlist).
local stationName = "Mix"
local function stationTracks(): { number }
	for _, station in AudioConfig.Stations do
		if station.Name == stationName and #station.Tracks > 0 then
			return station.Tracks
		end
	end
	return AudioConfig.Music
end

-- The first track in AudioConfig.Music plays first. After that the playlist is
-- shuffled, and shuffled again each time it runs out, never playing the same
-- track twice in a row.
local function nextTrack(): number
	local tracks = stationTracks()
	if #trackQueue == 0 then
		if lastTrack == nil then
			trackQueue = { tracks[1] }
		else
			trackQueue = table.clone(tracks)
			for i = #trackQueue, 2, -1 do
				local j = shuffleRng:NextInteger(1, i)
				trackQueue[i], trackQueue[j] = trackQueue[j], trackQueue[i]
			end
			if #trackQueue > 1 and trackQueue[1] == lastTrack then
				trackQueue[1], trackQueue[#trackQueue] = trackQueue[#trackQueue], trackQueue[1]
			end
		end
	end
	local track = table.remove(trackQueue, 1) :: number
	lastTrack = track
	return track
end

local function playNextTrack(failures: number)
	local tracks = stationTracks()
	if #tracks == 0 or failures >= #tracks then
		return
	end
	trackToken += 1
	local token = trackToken
	music.SoundId = "rbxassetid://" .. tostring(nextTrack())
	music.TimePosition = 0
	music:Play()
	task.delay(TRACK_LOAD_TIMEOUT_SECONDS, function()
		if trackToken == token and not music.IsLoaded then
			playNextTrack(failures + 1)
		end
	end)
end

music.Ended:Connect(function()
	if musicEnabled then
		playNextTrack(0)
	end
end)

function Sounds.startMusic()
	if musicStarted then
		return
	end
	musicStarted = true
	if musicEnabled then
		playNextTrack(0)
	end
end

-- Switches the radio station and starts one of its tracks.
function Sounds.setStation(name: string)
	local found = false
	for _, station in AudioConfig.Stations do
		found = found or station.Name == name
	end
	if not found or name == stationName then
		return
	end
	stationName = name
	trackQueue = {}
	-- A new station starts on a random track of its own.
	lastTrack = if name == "Mix" then nil else -1
	if musicStarted and musicEnabled then
		playNextTrack(0)
	end
end

function Sounds.getStation(): string
	return stationName
end

function Sounds.isMusicEnabled(): boolean
	return musicEnabled
end

function Sounds.setMusicEnabled(enabled: boolean)
	musicEnabled = enabled
	musicGroup.Volume = if enabled then musicVolumeOr1() else 0
	if enabled and musicStarted and not music.IsPlaying then
		if music.SoundId == "" then
			playNextTrack(0)
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

--!strict
--[[
	WorldManager
	Location: ServerScriptService (Script)

	Day, night and weather, the same for everyone on the server:
	  * Lighting.ClockTime runs through a whole day every
	    GameConfig.DayLengthSeconds (the day part is longer than the night);
	    the street lamps light up at night (lights inside the bases are always on)
	  * Blood Moon, Galaxy Night, Boss Raids and Bank Heists turn it to
	    midnight while they run
	  * every few minutes the weather changes (Clear, Rain, Snow, Thunderstorm
	    or Fog, weighted by GameConfig.Weather)
	The WorldEffects client script draws the weather and event skies.

	Client-facing state:
	  ReplicatedStorage attributes Weather (string), WeatherEndsAt (server time)
]]

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local GameConfig = require(Shared:WaitForChild("GameConfig"))

local UPDATE_SECONDS = 0.5
-- Share of the cycle that is daytime (6:00 to 18:00).
local DAY_FRACTION = 0.7
-- Seconds for the sky to turn to midnight when a night event starts or ends.
local NIGHT_BLEND_SECONDS = 6
local NIGHT_SKIES: { [string]: boolean } = { Blood = true, Galaxy = true, Boss = true, Heist = true }

local rng = Random.new()

-- The server starts at 10:00.
local cycleStart = Workspace:GetServerTimeNow() - GameConfig.DayLengthSeconds * DAY_FRACTION * (4 / 12)
local nightBlend = 0

local function naturalClock(now: number): number
	local phase = ((now - cycleStart) % GameConfig.DayLengthSeconds) / GameConfig.DayLengthSeconds
	if phase < DAY_FRACTION then
		return 6 + 12 * phase / DAY_FRACTION
	end
	return (18 + 12 * (phase - DAY_FRACTION) / (1 - DAY_FRACTION)) % 24
end

local function isNight(clock: number): boolean
	return clock < 6.3 or clock > 17.7
end

-- Map lights that only shine at night. Lights marked AlwaysOn (inside the
-- bases, the Fuse Machine) stay on.
local lamps: { Light } = {}
do
	local map = Workspace:WaitForChild("Map")
	for _, descendant in map:GetDescendants() do
		if descendant:IsA("Light") and descendant:GetAttribute("AlwaysOn") ~= true then
			table.insert(lamps, descendant)
		end
	end
end

local lampsOn: boolean? = nil
local function setLamps(on: boolean)
	if lampsOn == on then
		return
	end
	lampsOn = on
	for _, lamp in lamps do
		lamp.Enabled = on
	end
end

local function updateClock(dt: number)
	local sky = ReplicatedStorage:GetAttribute("EventSky")
	local wantNight = typeof(sky) == "string" and NIGHT_SKIES[sky] == true
	local step = dt / NIGHT_BLEND_SECONDS
	nightBlend = math.clamp(nightBlend + (if wantNight then step else -step), 0, 1)

	local clock = naturalClock(Workspace:GetServerTimeNow())
	if nightBlend > 0 then
		-- The short way round the clock to midnight.
		local toMidnight = ((0 - clock + 12) % 24) - 12
		clock = (clock + toMidnight * nightBlend) % 24
	end
	Lighting.ClockTime = clock
	setLamps(isNight(clock))
end

local function pickWeather(previous: string?): string
	local total = 0
	for _, weather in GameConfig.Weather do
		if weather.Name ~= previous then
			total += weather.Weight
		end
	end
	local roll = rng:NextNumber(0, total)
	for _, weather in GameConfig.Weather do
		if weather.Name ~= previous then
			roll -= weather.Weight
			if roll <= 0 then
				return weather.Name
			end
		end
	end
	return "Clear"
end

ReplicatedStorage:SetAttribute("Weather", "Clear")
ReplicatedStorage:SetAttribute("WeatherEndsAt", Workspace:GetServerTimeNow() + GameConfig.WeatherMinSeconds)

task.spawn(function()
	while true do
		task.wait(UPDATE_SECONDS)
		xpcall(updateClock, function(err: any)
			warn("[WorldManager] Day cycle failed: " .. tostring(err))
		end, UPDATE_SECONDS)
	end
end)

task.spawn(function()
	local current: string = "Clear"
	task.wait(GameConfig.WeatherMinSeconds)
	while true do
		current = pickWeather(current)
		local seconds = rng:NextNumber(GameConfig.WeatherMinSeconds, GameConfig.WeatherMaxSeconds)
		ReplicatedStorage:SetAttribute("Weather", current)
		ReplicatedStorage:SetAttribute("WeatherEndsAt", Workspace:GetServerTimeNow() + seconds)
		task.wait(seconds)
	end
end)

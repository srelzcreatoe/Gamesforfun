--!strict
--[[
	DataAndMonetizationManager
	Location: ServerScriptService (Script)

	Owns every player's persistent data (Cash, Rebirths, OwnedGamePasses), the
	leaderstats folder, and all Robux purchases for Steal a Brainrot.

	Security model
	  * The in-memory profile on the server is the only source of truth. Clients
	    cannot write to it: there are no RemoteEvents here, leaderstats edits made
	    on a client never replicate, and the server API below lives in
	    ServerStorage, which clients cannot see.
	  * Session locking: a profile is locked to one server session while a player
	    is in it. A second server waits for the lock to be released (or steals it
	    after a timeout), and the old session can no longer write once its lock is
	    gone. This stops the classic "server hop before save" duplication exploit.
	  * Developer products are granted ONLY through ProcessReceipt. Each PurchaseId
	    is recorded inside the same DataStore write as the reward, so a receipt can
	    never be granted twice, and PurchaseGranted is returned only after that
	    write succeeds.
	  * PromptGamePassPurchaseFinished can be spoofed by exploit executors, so game
	    pass ownership is always re-verified with UserOwnsGamePassAsync.

	Server API (ServerStorage.DataAndMonetization), for other server scripts:
	  BindableFunction AddCash(player, amount) -> boolean
	  BindableFunction SpendCash(player, amount) -> boolean
	  BindableFunction AddRebirths(player, amount) -> boolean
	  BindableFunction GetPlayerData(player) -> { Cash, Rebirths, OwnedGamePasses }?
	  BindableFunction GetBrainrots(player) -> { string }?
	  BindableFunction SetBrainrots(player, brainrotIds) -> boolean
	  BindableFunction OwnsGamePass(player, gamePassIdOrName) -> boolean
	  BindableFunction IsLaserBypassActive(player) -> boolean
	  BindableFunction GetServerRarityMultiplier() -> number
	  BindableEvent    EMPLaserOverriderPurchased(player, durationSeconds, endsAtServerTime)
	  BindableEvent    EMPLaserOverriderExpired(player)
	  BindableEvent    ServerRarityBoostChanged(multiplier, endsAtServerTime, purchaser?)
	  BindableEvent    GamePassOwnershipChanged(player, gamePassName, isOwned)

	Replicated state (read-only for clients, handy for UI):
	  Player attribute        DataLoaded (boolean)
	  Player attribute        LaserBypassEndsAt (Workspace:GetServerTimeNow() time)
	  Player attribute        OwnsGamePass_<Name> (boolean)
	  ReplicatedStorage attr  ServerRarityMultiplier (number)
	  ReplicatedStorage attr  ServerRarityBoostEndsAt (Workspace:GetServerTimeNow() time, 0 = inactive)

	Only ONE script in the experience may assign MarketplaceService.ProcessReceipt.
]]

local DataStoreService = game:GetService("DataStoreService")
local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")

--------------------------------------------------------------------------------
-- Configuration
--------------------------------------------------------------------------------

local LOG_PREFIX = "[DataAndMonetizationManager]"

local DATA_STORE_NAME = "BrainrotGame_v1"
local DATA_KEY_PREFIX = "Player_"
local SCHEMA_VERSION = 1

local AUTOSAVE_INTERVAL_SECONDS = 120
local AUTOSAVE_STAGGER_SECONDS = 0.5
local SESSION_LOCK_STALE_SECONDS = 600
local SESSION_LOCK_RETRY_SECONDS = 5
local SESSION_LOCK_MAX_RETRIES = 4
local LOAD_MAX_ATTEMPTS = 5
-- Studio fails fast so testing without API access doesn't stall on retries.
local STUDIO_LOAD_MAX_ATTEMPTS = 2
local AUTOSAVE_MAX_ATTEMPTS = 3
local RECEIPT_SAVE_MAX_ATTEMPTS = 3
local RELEASE_SAVE_MAX_ATTEMPTS = 3
local REQUEST_BUDGET_TIMEOUT_SECONDS = 10
local RECEIPT_PROFILE_WAIT_SECONDS = 20
local SHUTDOWN_TIMEOUT_SECONDS = 25

local MAX_CASH = 1e15
local MAX_REBIRTHS = 1e9
local MAX_PURCHASE_HISTORY = 100
local MAX_PURCHASE_ID_LENGTH = 128

-- In Studio without "Enable Studio Access to API Services", DataStores throw.
-- When true, Studio players get default data that is never saved instead of
-- being kicked. Live servers always kick when data cannot be loaded.
local ALLOW_UNSAVED_STUDIO_SESSIONS = true

-- Product IDs, game pass IDs and reward amounts live in the shared config so
-- the client shop uses the same values. Clients cannot change the server's copy.
local MonetizationConfig = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("MonetizationConfig"))

local PRODUCT_IDS = MonetizationConfig.ProductIds
local SMALL_CASH_BUNDLE_AMOUNT = MonetizationConfig.SmallCashBundleAmount
local MEDIUM_CASH_BUNDLE_AMOUNT = MonetizationConfig.MediumCashBundleAmount
local LASER_BYPASS_DURATION_SECONDS = MonetizationConfig.LaserBypassDurationSeconds
local SERVER_RARITY_BOOST_DURATION_SECONDS = MonetizationConfig.ServerRarityBoostDurationSeconds
local SERVER_RARITY_BOOST_MULTIPLIER = MonetizationConfig.ServerRarityBoostMultiplier

-- Game passes whose ownership is tracked in OwnedGamePasses; names are used for
-- attributes and the server API.
local GAME_PASSES: { [string]: number } = MonetizationConfig.GamePasses

-- Brainrots a player owns, saved as a list of brainrot IDs.
local MAX_BRAINROTS = 64
local MAX_BRAINROT_ID_LENGTH = 64

-- Delays before each ownership check after a game pass purchase prompt closes.
local GAME_PASS_VERIFY_DELAYS: { number } = { 0, 2, 5, 10 }

--------------------------------------------------------------------------------
-- Types
--------------------------------------------------------------------------------

type PlayerData = {
	Cash: number,
	Rebirths: number,
	OwnedGamePasses: { [string]: boolean },
	Brainrots: { string },
	PurchaseHistory: { string },
}

type SessionLock = {
	JobId: string,
	SessionId: string,
	LockedAt: number,
}

type SaveRecord = {
	SchemaVersion: number,
	Data: PlayerData,
	SessionLock: SessionLock?,
	LastSavedAt: number,
}

-- Loading   : DataStore read / lock acquisition in progress
-- Active    : loaded and locked; saves and purchases allowed
-- Unsaved   : Studio fallback with default data; nothing is ever written
-- Releasing : final save in progress
-- Released  : finished; no further reads or writes
type ProfileState = "Loading" | "Active" | "Unsaved" | "Releasing" | "Released"

type Profile = {
	Player: Player,
	UserId: number,
	Key: string,
	SessionId: string,
	State: ProfileState,
	Data: PlayerData,
	PlayerLeft: boolean,
	LockLost: boolean,
	MutexLocked: boolean,
	UnsavedPurchaseIds: { [string]: boolean },
	CashValue: IntValue?,
	RebirthsValue: IntValue?,
}

type LoadResult = "Loaded" | "Failed" | "Aborted"

type ProductHandler = (profile: Profile) -> boolean

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------

local profiles: { [Player]: Profile } = {}
local laserBypassEndsAt: { [Player]: number } = {}
local serverRarityBoostEndsAt = 0
local isShuttingDown = false

local gamePassNamesById: { [number]: string } = {}
for passName, passId in GAME_PASSES do
	gamePassNamesById[passId] = passName
end

local playerDataStore: DataStore? = nil
do
	local ok, result = pcall(function(): DataStore
		return DataStoreService:GetDataStore(DATA_STORE_NAME)
	end)
	if ok then
		playerDataStore = result
	else
		warn(string.format("%s Could not open DataStore '%s': %s", LOG_PREFIX, DATA_STORE_NAME, tostring(result)))
	end
end

--------------------------------------------------------------------------------
-- Server API instances (ServerStorage is invisible to clients)
--------------------------------------------------------------------------------

local apiFolder = Instance.new("Folder")
apiFolder.Name = "DataAndMonetization"

local function createBindableEvent(name: string): BindableEvent
	local bindable = Instance.new("BindableEvent")
	bindable.Name = name
	bindable.Parent = apiFolder
	return bindable
end

local empLaserPurchasedEvent = createBindableEvent("EMPLaserOverriderPurchased")
local empLaserExpiredEvent = createBindableEvent("EMPLaserOverriderExpired")
local serverRarityBoostChangedEvent = createBindableEvent("ServerRarityBoostChanged")
local gamePassOwnershipChangedEvent = createBindableEvent("GamePassOwnershipChanged")

ReplicatedStorage:SetAttribute("ServerRarityMultiplier", 1)
ReplicatedStorage:SetAttribute("ServerRarityBoostEndsAt", 0)

--------------------------------------------------------------------------------
-- Validation and sanitising
--------------------------------------------------------------------------------

local function isFiniteNumber(value: any): boolean
	return typeof(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local function toWholeNumber(value: any, maxValue: number): number
	if not isFiniteNumber(value) then
		return 0
	end
	return math.clamp(math.floor(value), 0, maxValue)
end

local function asPlayer(value: any): Player?
	if typeof(value) == "Instance" and value:IsA("Player") then
		return value
	end
	return nil
end

local function createDefaultData(): PlayerData
	return {
		Cash = 0,
		Rebirths = 0,
		OwnedGamePasses = {},
		Brainrots = {},
		PurchaseHistory = {},
	}
end

local function isValidBrainrotId(value: any): boolean
	return typeof(value) == "string" and #value > 0 and #value <= MAX_BRAINROT_ID_LENGTH
end

local function sanitizeBrainrotIds(raw: any): { string }
	local brainrotIds: { string } = {}
	if typeof(raw) == "table" then
		for _, brainrotId in ipairs(raw) do
			if #brainrotIds >= MAX_BRAINROTS then
				break
			end
			if isValidBrainrotId(brainrotId) then
				table.insert(brainrotIds, brainrotId)
			end
		end
	end
	return brainrotIds
end

local function sanitizeData(raw: any): PlayerData
	if typeof(raw) ~= "table" then
		return createDefaultData()
	end

	local ownedGamePasses: { [string]: boolean } = {}
	local rawPasses = raw.OwnedGamePasses
	if typeof(rawPasses) == "table" then
		for passKey, owned in rawPasses do
			if typeof(passKey) == "string" and #passKey <= 32 and typeof(owned) == "boolean" then
				ownedGamePasses[passKey] = owned
			end
		end
	end

	local purchaseHistory: { string } = {}
	local rawHistory = raw.PurchaseHistory
	if typeof(rawHistory) == "table" then
		for _, purchaseId in ipairs(rawHistory) do
			if typeof(purchaseId) == "string" and #purchaseId > 0 and #purchaseId <= MAX_PURCHASE_ID_LENGTH then
				table.insert(purchaseHistory, purchaseId)
			end
		end
	end
	while #purchaseHistory > MAX_PURCHASE_HISTORY do
		table.remove(purchaseHistory, 1)
	end

	return {
		Cash = toWholeNumber(raw.Cash, MAX_CASH),
		Rebirths = toWholeNumber(raw.Rebirths, MAX_REBIRTHS),
		OwnedGamePasses = ownedGamePasses,
		Brainrots = sanitizeBrainrotIds(raw.Brainrots),
		PurchaseHistory = purchaseHistory,
	}
end

local function sanitizeLock(raw: any): SessionLock?
	if typeof(raw) ~= "table" then
		return nil
	end
	if typeof(raw.JobId) ~= "string" or typeof(raw.SessionId) ~= "string" or not isFiniteNumber(raw.LockedAt) then
		return nil
	end
	return {
		JobId = raw.JobId,
		SessionId = raw.SessionId,
		LockedAt = raw.LockedAt,
	}
end

local function sanitizeRecord(raw: any): SaveRecord
	if typeof(raw) ~= "table" then
		return {
			SchemaVersion = SCHEMA_VERSION,
			Data = createDefaultData(),
			SessionLock = nil,
			LastSavedAt = 0,
		}
	end
	return {
		SchemaVersion = SCHEMA_VERSION,
		Data = sanitizeData(raw.Data),
		SessionLock = sanitizeLock(raw.SessionLock),
		LastSavedAt = if isFiniteNumber(raw.LastSavedAt) then raw.LastSavedAt else 0,
	}
end

local function copyDataForSave(data: PlayerData): PlayerData
	return {
		Cash = data.Cash,
		Rebirths = data.Rebirths,
		OwnedGamePasses = table.clone(data.OwnedGamePasses),
		Brainrots = table.clone(data.Brainrots),
		PurchaseHistory = table.clone(data.PurchaseHistory),
	}
end

--------------------------------------------------------------------------------
-- Profile helpers
--------------------------------------------------------------------------------

local function isUsable(profile: Profile): boolean
	return profile.State == "Active" or profile.State == "Unsaved"
end

local function getUsableProfile(player: Player): Profile?
	local profile = profiles[player]
	if profile and isUsable(profile) then
		return profile
	end
	return nil
end

-- Serialises every yielding operation (saves, receipts, release) per profile.
local function acquireProfileMutex(profile: Profile)
	while profile.MutexLocked do
		task.wait()
	end
	profile.MutexLocked = true
end

local function releaseProfileMutex(profile: Profile)
	profile.MutexLocked = false
end

local function setCash(profile: Profile, amount: number)
	local sanitized = toWholeNumber(amount, MAX_CASH)
	profile.Data.Cash = sanitized
	local cashValue = profile.CashValue
	if cashValue and cashValue.Value ~= sanitized then
		cashValue.Value = sanitized
	end
end

local function setRebirths(profile: Profile, amount: number)
	local sanitized = toWholeNumber(amount, MAX_REBIRTHS)
	profile.Data.Rebirths = sanitized
	local rebirthsValue = profile.RebirthsValue
	if rebirthsValue and rebirthsValue.Value ~= sanitized then
		rebirthsValue.Value = sanitized
	end
end

local function addCash(profile: Profile, amount: number): boolean
	if not isFiniteNumber(amount) or amount <= 0 then
		return false
	end
	setCash(profile, profile.Data.Cash + math.floor(amount))
	return true
end

local function spendCash(profile: Profile, amount: number): boolean
	if not isFiniteNumber(amount) or amount <= 0 then
		return false
	end
	local cost = math.ceil(amount)
	if profile.Data.Cash < cost then
		return false
	end
	setCash(profile, profile.Data.Cash - cost)
	return true
end

local function addRebirths(profile: Profile, amount: number): boolean
	if not isFiniteNumber(amount) or amount <= 0 then
		return false
	end
	setRebirths(profile, profile.Data.Rebirths + math.floor(amount))
	return true
end

local function setGamePassOwned(profile: Profile, passId: number, owned: boolean)
	local passKey = tostring(passId)
	local wasOwned = profile.Data.OwnedGamePasses[passKey] == true
	profile.Data.OwnedGamePasses[passKey] = owned

	local passName = gamePassNamesById[passId]
	if passName then
		profile.Player:SetAttribute("OwnsGamePass_" .. passName, owned)
		if wasOwned ~= owned then
			gamePassOwnershipChangedEvent:Fire(profile.Player, passName, owned)
		end
	end
end

local function hasProcessedPurchase(profile: Profile, purchaseId: string): boolean
	return table.find(profile.Data.PurchaseHistory, purchaseId) ~= nil
end

local function recordPurchase(profile: Profile, purchaseId: string)
	local history = profile.Data.PurchaseHistory
	table.insert(history, purchaseId)
	while #history > MAX_PURCHASE_HISTORY do
		table.remove(history, 1)
	end
	profile.UnsavedPurchaseIds[purchaseId] = true
end

local function snapshotProfiles(): { Profile }
	local list: { Profile } = {}
	for _, profile in profiles do
		table.insert(list, profile)
	end
	return list
end

--------------------------------------------------------------------------------
-- DataStore access
--------------------------------------------------------------------------------

local function waitForRequestBudget(requestType: Enum.DataStoreRequestType)
	local started = os.clock()
	while os.clock() - started < REQUEST_BUDGET_TIMEOUT_SECONDS do
		local ok, budget = pcall(function(): number
			return DataStoreService:GetRequestBudgetForRequestType(requestType)
		end)
		if not ok or budget > 0 then
			return
		end
		task.wait(0.5)
	end
end

local function getGdprUserIds(profile: Profile): { number }?
	-- Associates the key with the user for Roblox's right-to-erasure tooling.
	-- Local Studio test players have non-positive UserIds, which are rejected.
	if profile.UserId > 0 then
		return { profile.UserId }
	end
	return nil
end

local function onSessionLockLost(profile: Profile)
	if profile.LockLost then
		return
	end
	profile.LockLost = true
	profile.State = "Released"
	warn(string.format("%s Session lock for %d was taken by another server; this session will no longer save.", LOG_PREFIX, profile.UserId))
	task.defer(function()
		if profile.Player.Parent == Players then
			profile.Player:Kick("Your data was opened on another server. Please rejoin.")
		end
	end)
end

-- Caller must hold the profile mutex.
local function saveProfileAsync(profile: Profile, releaseLock: boolean, maxAttempts: number): boolean
	local store = playerDataStore
	if store == nil or profile.LockLost then
		return false
	end

	for attempt = 1, maxAttempts do
		waitForRequestBudget(Enum.DataStoreRequestType.UpdateAsync)

		local lockLost = false
		local writtenRecord: SaveRecord? = nil

		local ok, err = pcall(function()
			store:UpdateAsync(profile.Key, function(oldValue: any): (any, { number }?)
				lockLost = false
				writtenRecord = nil

				local currentLock = if typeof(oldValue) == "table" then sanitizeLock(oldValue.SessionLock) else nil
				if currentLock == nil or currentLock.SessionId ~= profile.SessionId then
					lockLost = true
					return nil, nil
				end

				local now = os.time()
				local record: SaveRecord = {
					SchemaVersion = SCHEMA_VERSION,
					Data = copyDataForSave(profile.Data),
					SessionLock = if releaseLock
						then nil
						else { JobId = game.JobId, SessionId = profile.SessionId, LockedAt = now },
					LastSavedAt = now,
				}
				writtenRecord = record
				return record, getGdprUserIds(profile)
			end)
		end)

		if ok then
			if lockLost then
				onSessionLockLost(profile)
				return false
			end
			local savedRecord = writtenRecord
			if savedRecord then
				for _, purchaseId in savedRecord.Data.PurchaseHistory do
					profile.UnsavedPurchaseIds[purchaseId] = nil
				end
				return true
			end
			warn(string.format("%s Save for %d returned without writing (attempt %d/%d).", LOG_PREFIX, profile.UserId, attempt, maxAttempts))
		else
			warn(string.format("%s Save for %d failed (attempt %d/%d): %s", LOG_PREFIX, profile.UserId, attempt, maxAttempts, tostring(err)))
		end

		if attempt < maxAttempts then
			task.wait(2 ^ (attempt - 1))
		end
	end

	return false
end

local function loadProfileAsync(profile: Profile): LoadResult
	local store = playerDataStore
	if store == nil then
		return "Failed"
	end

	local failedAttempts = 0
	local lockRetries = 0

	while true do
		if profile.PlayerLeft then
			return "Aborted"
		end

		-- After waiting long enough for the previous server to save and release,
		-- take the lock. That server's saves are rejected from then on, so its
		-- unsaved progress is dropped rather than duplicated.
		local forceSteal = lockRetries >= SESSION_LOCK_MAX_RETRIES
		local blockedByLock = false
		local loadedRecord: SaveRecord? = nil

		waitForRequestBudget(Enum.DataStoreRequestType.UpdateAsync)

		local ok, err = pcall(function()
			store:UpdateAsync(profile.Key, function(oldValue: any): (any, { number }?)
				blockedByLock = false
				loadedRecord = nil

				local record = sanitizeRecord(oldValue)
				local now = os.time()
				local existingLock = record.SessionLock
				if
					existingLock
					and existingLock.SessionId ~= profile.SessionId
					and now - existingLock.LockedAt < SESSION_LOCK_STALE_SECONDS
					and not forceSteal
				then
					blockedByLock = true
					return nil, nil
				end

				record.SessionLock = { JobId = game.JobId, SessionId = profile.SessionId, LockedAt = now }
				record.LastSavedAt = now
				loadedRecord = record
				return record, getGdprUserIds(profile)
			end)
		end)

		local record = loadedRecord
		if ok and record then
			if forceSteal then
				warn(string.format("%s Took over a session lock for %d that was not released in time.", LOG_PREFIX, profile.UserId))
			end
			profile.Data = record.Data
			return "Loaded"
		elseif ok and blockedByLock then
			lockRetries += 1
			task.wait(SESSION_LOCK_RETRY_SECONDS)
		else
			failedAttempts += 1
			local maxAttempts = if RunService:IsStudio() then STUDIO_LOAD_MAX_ATTEMPTS else LOAD_MAX_ATTEMPTS
			warn(string.format("%s Load for %d failed (attempt %d/%d): %s", LOG_PREFIX, profile.UserId, failedAttempts, maxAttempts, tostring(err)))
			if failedAttempts >= maxAttempts then
				return "Failed"
			end
			task.wait(2 ^ (failedAttempts - 1))
		end
	end
end

local function releaseProfileAsync(profile: Profile)
	profile.PlayerLeft = true
	if profile.State == "Loading" then
		-- The loader sees PlayerLeft and releases the lock once it has it.
		return
	end

	acquireProfileMutex(profile)
	local ok, err = pcall(function()
		if profile.State == "Active" then
			profile.State = "Releasing"
			if not saveProfileAsync(profile, true, RELEASE_SAVE_MAX_ATTEMPTS) then
				warn(string.format("%s Final save for %d failed; the next server will take over the lock.", LOG_PREFIX, profile.UserId))
			end
		end
		profile.State = "Released"
	end)
	releaseProfileMutex(profile)

	if not ok then
		profile.State = "Released"
		warn(string.format("%s Error while releasing %d: %s", LOG_PREFIX, profile.UserId, tostring(err)))
	end
	if profiles[profile.Player] == profile then
		profiles[profile.Player] = nil
	end
end

local function autosaveProfileAsync(profile: Profile)
	acquireProfileMutex(profile)
	local ok, err = pcall(function()
		if profile.State == "Active" then
			saveProfileAsync(profile, false, AUTOSAVE_MAX_ATTEMPTS)
		end
	end)
	releaseProfileMutex(profile)
	if not ok then
		warn(string.format("%s Autosave error for %d: %s", LOG_PREFIX, profile.UserId, tostring(err)))
	end
end

--------------------------------------------------------------------------------
-- Game passes
--------------------------------------------------------------------------------

local function checkGamePassOwnershipAsync(userId: number, passId: number): boolean?
	local ok, result = pcall(function(): boolean
		return MarketplaceService:UserOwnsGamePassAsync(userId, passId)
	end)
	if ok then
		return result == true
	end
	warn(string.format("%s UserOwnsGamePassAsync(%d, %d) failed: %s", LOG_PREFIX, userId, passId, tostring(result)))
	return nil
end

local function syncGamePassesAsync(profile: Profile)
	for _, passId in GAME_PASSES do
		local owned = checkGamePassOwnershipAsync(profile.UserId, passId)
		if not isUsable(profile) then
			return
		end
		if owned == nil then
			-- API unavailable: fall back to the ownership saved from a verified check.
			owned = profile.Data.OwnedGamePasses[tostring(passId)] == true
		end
		setGamePassOwned(profile, passId, owned == true)
	end
end

local function onGamePassPurchaseFinished(player: Player, passId: number, wasPurchased: boolean)
	if not wasPurchased or typeof(passId) ~= "number" or gamePassNamesById[passId] == nil then
		return
	end

	for _, delaySeconds in GAME_PASS_VERIFY_DELAYS do
		if delaySeconds > 0 then
			task.wait(delaySeconds)
		end
		if player.Parent ~= Players then
			return
		end
		if checkGamePassOwnershipAsync(player.UserId, passId) == true then
			local profile = getUsableProfile(player)
			if profile then
				setGamePassOwned(profile, passId, true)
			end
			return
		end
	end

	warn(string.format("%s Could not verify game pass %d for %d; ownership will sync on next join.", LOG_PREFIX, passId, player.UserId))
end

--------------------------------------------------------------------------------
-- Timed purchase effects
--------------------------------------------------------------------------------

local function isLaserBypassActive(player: Player): boolean
	local endsAt = laserBypassEndsAt[player]
	return endsAt ~= nil and Workspace:GetServerTimeNow() < endsAt
end

local function activateLaserBypass(player: Player): boolean
	local now = Workspace:GetServerTimeNow()
	local currentEnd = laserBypassEndsAt[player]
	local startFrom = if currentEnd and currentEnd > now then currentEnd else now
	local endsAt = startFrom + LASER_BYPASS_DURATION_SECONDS

	laserBypassEndsAt[player] = endsAt
	player:SetAttribute("LaserBypassEndsAt", endsAt)
	empLaserPurchasedEvent:Fire(player, LASER_BYPASS_DURATION_SECONDS, endsAt)

	task.delay(endsAt - now, function()
		-- A later purchase extends the timer and schedules its own expiry.
		if laserBypassEndsAt[player] ~= endsAt then
			return
		end
		laserBypassEndsAt[player] = nil
		if player.Parent == Players then
			player:SetAttribute("LaserBypassEndsAt", nil)
			empLaserExpiredEvent:Fire(player)
		end
	end)

	return true
end

local function getServerRarityMultiplier(): number
	if Workspace:GetServerTimeNow() < serverRarityBoostEndsAt then
		return SERVER_RARITY_BOOST_MULTIPLIER
	end
	return 1
end

local function activateServerRarityBoost(purchaser: Player): boolean
	local now = Workspace:GetServerTimeNow()
	local endsAt = math.max(serverRarityBoostEndsAt, now) + SERVER_RARITY_BOOST_DURATION_SECONDS
	serverRarityBoostEndsAt = endsAt

	ReplicatedStorage:SetAttribute("ServerRarityMultiplier", SERVER_RARITY_BOOST_MULTIPLIER)
	ReplicatedStorage:SetAttribute("ServerRarityBoostEndsAt", endsAt)
	serverRarityBoostChangedEvent:Fire(SERVER_RARITY_BOOST_MULTIPLIER, endsAt, purchaser)

	task.delay(endsAt - now, function()
		if serverRarityBoostEndsAt ~= endsAt then
			return
		end
		ReplicatedStorage:SetAttribute("ServerRarityMultiplier", 1)
		ReplicatedStorage:SetAttribute("ServerRarityBoostEndsAt", 0)
		serverRarityBoostChangedEvent:Fire(1, 0, nil)
	end)

	return true
end

--------------------------------------------------------------------------------
-- Developer products
--------------------------------------------------------------------------------

local PRODUCT_HANDLERS: { [number]: ProductHandler } = {
	[PRODUCT_IDS.SmallCashBundle] = function(profile: Profile): boolean
		return addCash(profile, SMALL_CASH_BUNDLE_AMOUNT)
	end,
	[PRODUCT_IDS.MediumCashBundle] = function(profile: Profile): boolean
		return addCash(profile, MEDIUM_CASH_BUNDLE_AMOUNT)
	end,
	[PRODUCT_IDS.EMPLaserOverrider] = function(profile: Profile): boolean
		return activateLaserBypass(profile.Player)
	end,
	[PRODUCT_IDS.ServerRarityBoost] = function(profile: Profile): boolean
		return activateServerRarityBoost(profile.Player)
	end,
}

local function waitForActiveProfileAsync(player: Player, timeoutSeconds: number): Profile?
	local started = os.clock()
	while player.Parent == Players and os.clock() - started < timeoutSeconds do
		local profile = profiles[player]
		if profile then
			if profile.State == "Active" then
				return profile
			elseif profile.State ~= "Loading" then
				return nil
			end
		end
		task.wait(0.25)
	end
	return nil
end

local function processReceipt(receiptInfo: { [string]: any }): Enum.ProductPurchaseDecision
	local notProcessed = Enum.ProductPurchaseDecision.NotProcessedYet

	local playerId = receiptInfo.PlayerId
	local productId = receiptInfo.ProductId
	local purchaseId = receiptInfo.PurchaseId
	if
		typeof(playerId) ~= "number"
		or typeof(productId) ~= "number"
		or typeof(purchaseId) ~= "string"
		or #purchaseId == 0
		or #purchaseId > MAX_PURCHASE_ID_LENGTH
	then
		warn(string.format("%s Rejected malformed receipt.", LOG_PREFIX))
		return notProcessed
	end

	local handler = PRODUCT_HANDLERS[productId]
	if handler == nil then
		warn(string.format("%s No handler for product %d (purchase %s); leaving it unprocessed.", LOG_PREFIX, productId, purchaseId))
		return notProcessed
	end

	-- Roblox retries unprocessed receipts the next time the player joins.
	local player = Players:GetPlayerByUserId(playerId)
	if player == nil then
		return notProcessed
	end

	local profile = waitForActiveProfileAsync(player, RECEIPT_PROFILE_WAIT_SECONDS)
	if profile == nil then
		return notProcessed
	end

	acquireProfileMutex(profile)
	local ok, result = pcall(function(): Enum.ProductPurchaseDecision
		if profile.State ~= "Active" then
			return notProcessed
		end

		-- The reward and its PurchaseId are applied together, so a retry of a
		-- receipt that is already in the history only needs the save confirmed.
		if not hasProcessedPurchase(profile, purchaseId) then
			if not handler(profile) then
				warn(string.format("%s Handler for product %d declined purchase %s.", LOG_PREFIX, productId, purchaseId))
				return notProcessed
			end
			recordPurchase(profile, purchaseId)
		end

		if profile.UnsavedPurchaseIds[purchaseId] then
			saveProfileAsync(profile, false, RECEIPT_SAVE_MAX_ATTEMPTS)
		end

		if profile.UnsavedPurchaseIds[purchaseId] then
			return notProcessed
		end
		return Enum.ProductPurchaseDecision.PurchaseGranted
	end)
	releaseProfileMutex(profile)

	if not ok then
		warn(string.format("%s Error processing purchase %s: %s", LOG_PREFIX, purchaseId, tostring(result)))
		return notProcessed
	end

	local decision: Enum.ProductPurchaseDecision = result
	if decision == Enum.ProductPurchaseDecision.PurchaseGranted then
		print(string.format("%s Granted product %d to %d (purchase %s).", LOG_PREFIX, productId, playerId, purchaseId))
	end
	return decision
end

--------------------------------------------------------------------------------
-- Leaderstats
--------------------------------------------------------------------------------

local function createLeaderstats(profile: Profile)
	local player = profile.Player
	local existing = player:FindFirstChild("leaderstats")
	if existing then
		existing:Destroy()
	end

	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"

	local cashValue = Instance.new("IntValue")
	cashValue.Name = "Cash"
	cashValue.Value = profile.Data.Cash
	cashValue.Parent = leaderstats

	local rebirthsValue = Instance.new("IntValue")
	rebirthsValue.Name = "Rebirths"
	rebirthsValue.Value = profile.Data.Rebirths
	rebirthsValue.Parent = leaderstats

	profile.CashValue = cashValue
	profile.RebirthsValue = rebirthsValue

	-- Server scripts may also write these values directly; client-side edits
	-- never replicate, so only trusted server changes reach these handlers.
	cashValue.Changed:Connect(function(newValue: number)
		if isUsable(profile) and newValue ~= profile.Data.Cash then
			setCash(profile, newValue)
		end
	end)
	rebirthsValue.Changed:Connect(function(newValue: number)
		if isUsable(profile) and newValue ~= profile.Data.Rebirths then
			setRebirths(profile, newValue)
		end
	end)

	leaderstats.Parent = player
end

--------------------------------------------------------------------------------
-- Player lifecycle
--------------------------------------------------------------------------------

local function onPlayerAdded(player: Player)
	if profiles[player] then
		return
	end

	local profile: Profile = {
		Player = player,
		UserId = player.UserId,
		Key = DATA_KEY_PREFIX .. tostring(player.UserId),
		SessionId = HttpService:GenerateGUID(false),
		State = "Loading",
		Data = createDefaultData(),
		PlayerLeft = false,
		LockLost = false,
		MutexLocked = false,
		UnsavedPurchaseIds = {},
		CashValue = nil,
		RebirthsValue = nil,
	}
	profiles[player] = profile

	local result = loadProfileAsync(profile)

	if result == "Aborted" then
		profile.State = "Released"
		profiles[player] = nil
		return
	elseif result == "Loaded" then
		profile.State = "Active"
		if profile.PlayerLeft or player.Parent ~= Players or isShuttingDown then
			releaseProfileAsync(profile)
			return
		end
	elseif ALLOW_UNSAVED_STUDIO_SESSIONS and RunService:IsStudio() then
		warn(string.format("%s Studio: using unsaved default data for %s. Enable Studio API access to test saving and purchases.", LOG_PREFIX, player.Name))
		profile.State = "Unsaved"
		profile.Data = createDefaultData()
		if profile.PlayerLeft then
			profile.State = "Released"
			profiles[player] = nil
			return
		end
	else
		profile.State = "Released"
		profiles[player] = nil
		player:Kick("We couldn't load your data. Please rejoin in a moment.")
		return
	end

	createLeaderstats(profile)
	player:SetAttribute("DataLoaded", true)
	task.spawn(syncGamePassesAsync, profile)
end

local function onPlayerRemoving(player: Player)
	laserBypassEndsAt[player] = nil
	local profile = profiles[player]
	if profile then
		releaseProfileAsync(profile)
	end
end

--------------------------------------------------------------------------------
-- Server API
--------------------------------------------------------------------------------

local function createBindableFunction(name: string, callback: (...any) -> ...any)
	local bindable = Instance.new("BindableFunction")
	bindable.Name = name
	bindable.OnInvoke = callback
	bindable.Parent = apiFolder
end

createBindableFunction("AddCash", function(playerArg: any, amount: any): boolean
	local player = asPlayer(playerArg)
	local profile = if player then getUsableProfile(player) else nil
	return profile ~= nil and addCash(profile, amount)
end)

createBindableFunction("SpendCash", function(playerArg: any, amount: any): boolean
	local player = asPlayer(playerArg)
	local profile = if player then getUsableProfile(player) else nil
	return profile ~= nil and spendCash(profile, amount)
end)

createBindableFunction("AddRebirths", function(playerArg: any, amount: any): boolean
	local player = asPlayer(playerArg)
	local profile = if player then getUsableProfile(player) else nil
	return profile ~= nil and addRebirths(profile, amount)
end)

createBindableFunction("GetPlayerData", function(playerArg: any): { [string]: any }?
	local player = asPlayer(playerArg)
	local profile = if player then getUsableProfile(player) else nil
	if profile == nil then
		return nil
	end
	return {
		Cash = profile.Data.Cash,
		Rebirths = profile.Data.Rebirths,
		OwnedGamePasses = table.clone(profile.Data.OwnedGamePasses),
	}
end)

createBindableFunction("GetBrainrots", function(playerArg: any): { string }?
	local player = asPlayer(playerArg)
	local profile = if player then getUsableProfile(player) else nil
	if profile == nil then
		return nil
	end
	return table.clone(profile.Data.Brainrots)
end)

createBindableFunction("SetBrainrots", function(playerArg: any, brainrotIds: any): boolean
	local player = asPlayer(playerArg)
	local profile = if player then getUsableProfile(player) else nil
	if profile == nil or typeof(brainrotIds) ~= "table" then
		return false
	end
	-- Accept only a contiguous array of valid IDs.
	local count = 0
	for index, brainrotId in brainrotIds do
		count += 1
		if typeof(index) ~= "number" or not isValidBrainrotId(brainrotId) then
			return false
		end
	end
	if count > MAX_BRAINROTS then
		return false
	end
	local validated: { string } = table.create(count)
	for index = 1, count do
		local brainrotId = brainrotIds[index]
		if brainrotId == nil then
			return false
		end
		validated[index] = brainrotId
	end
	profile.Data.Brainrots = validated
	return true
end)

createBindableFunction("OwnsGamePass", function(playerArg: any, gamePass: any): boolean
	local player = asPlayer(playerArg)
	local profile = if player then getUsableProfile(player) else nil
	if profile == nil then
		return false
	end
	local passId: number? = if typeof(gamePass) == "number"
		then gamePass
		elseif typeof(gamePass) == "string" then GAME_PASSES[gamePass]
		else nil
	return passId ~= nil and profile.Data.OwnedGamePasses[tostring(passId)] == true
end)

createBindableFunction("IsLaserBypassActive", function(playerArg: any): boolean
	local player = asPlayer(playerArg)
	return player ~= nil and isLaserBypassActive(player)
end)

createBindableFunction("GetServerRarityMultiplier", function(): number
	return getServerRarityMultiplier()
end)

-- Parent last so WaitForChild("DataAndMonetization") implies every child exists.
apiFolder.Parent = ServerStorage

--------------------------------------------------------------------------------
-- Wiring
--------------------------------------------------------------------------------

MarketplaceService.ProcessReceipt = processReceipt
MarketplaceService.PromptGamePassPurchaseFinished:Connect(onGamePassPurchaseFinished)

Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(onPlayerRemoving)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

task.spawn(function()
	while not isShuttingDown do
		task.wait(AUTOSAVE_INTERVAL_SECONDS)
		if isShuttingDown then
			break
		end
		for _, profile in snapshotProfiles() do
			if isShuttingDown then
				break
			end
			if profile.State == "Active" then
				task.spawn(autosaveProfileAsync, profile)
				task.wait(AUTOSAVE_STAGGER_SECONDS)
			end
		end
	end
end)

game:BindToClose(function()
	isShuttingDown = true
	for _, profile in snapshotProfiles() do
		task.spawn(releaseProfileAsync, profile)
	end

	local started = os.clock()
	while next(profiles) ~= nil and os.clock() - started < SHUTDOWN_TIMEOUT_SECONDS do
		task.wait(0.1)
	end
end)

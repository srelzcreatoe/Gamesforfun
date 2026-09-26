--!strict
-- Gear sold for Cash at the Gear Shop stall. Owned gear is saved and given back
-- every time you spawn. GearManager on the server makes each tool work.
-- Troll items are bought with Robux in the Shop (see MonetizationConfig) and
-- come with a few charges each.

export type Gear = {
	Id: string,
	DisplayName: string,
	-- 0 = everyone gets it for free.
	Price: number,
	Description: string,
	Color: Color3,
	Order: number,
}

export type TrollItem = {
	Id: string,
	DisplayName: string,
	Description: string,
	Color: Color3,
}

local Gear: { Gear } = {
	{
		Id = "Slap",
		DisplayName = "Slap",
		Price = 0,
		Description = "A giant slap glove on a stick. A slapped thief drops the brainrot!",
		Color = Color3.fromRGB(150, 70, 255),
		Order = 1,
	},
	{
		Id = "SpeedCoil",
		DisplayName = "Speed Coil",
		Price = 7500,
		Description = "Run much faster while you hold it (not while carrying a brainrot).",
		Color = Color3.fromRGB(60, 200, 255),
		Order = 2,
	},
	{
		Id = "GravityCoil",
		DisplayName = "Gravity Coil",
		Price = 20000,
		Description = "Jump three times higher while you hold it.",
		Color = Color3.fromRGB(170, 90, 255),
		Order = 3,
	},
	{
		Id = "InvisibilityCloak",
		DisplayName = "Invisibility Cloak",
		Price = 100000,
		Description = "Click to turn invisible for 8 seconds. Grabbing a brainrot reveals you.",
		Color = Color3.fromRGB(120, 130, 150),
		Order = 4,
	},
}

local TrollItems: { TrollItem } = {
	{
		Id = "FreezeRay",
		DisplayName = "Freeze Ray",
		Description = "Freeze the player in front of you solid. Frozen thieves drop their brainrot!",
		Color = Color3.fromRGB(120, 220, 255),
	},
	{
		Id = "SpikeTrap",
		DisplayName = "Spike Trap",
		Description = "Put down a spike trap. Whoever steps on it gets stuck and drops their brainrot.",
		Color = Color3.fromRGB(170, 175, 185),
	},
	{
		Id = "LandMine",
		DisplayName = "Land Mine",
		Description = "Hide a land mine. It launches whoever steps on it sky high!",
		Color = Color3.fromRGB(220, 50, 40),
	},
	{
		Id = "BoogieBomb",
		DisplayName = "Boogie Bomb",
		Description = "Everyone around you can't stop dancing for a few seconds!",
		Color = Color3.fromRGB(255, 90, 200),
	},
}

local TrollItemById: { [string]: TrollItem } = {}
for _, item in TrollItems do
	TrollItemById[item.Id] = table.freeze(item)
end

local ById: { [string]: Gear } = {}
for _, gear in Gear do
	ById[gear.Id] = table.freeze(gear)
end

return table.freeze({
	Gear = table.freeze(Gear),
	ById = table.freeze(ById),
	SlapCooldownSeconds = 0.8,
	SlapRange = 8,
	SlapKnockback = 70,
	SpeedCoilBonus = 12,
	GravityCoilJumpHeight = 22,
	DefaultJumpHeight = 7.2,
	CloakSeconds = 8,
	CloakCooldownSeconds = 30,
	-- Buying needs you to be this close to the Gear Shop counter.
	ShopDistance = 30,

	TrollItems = table.freeze(TrollItems),
	TrollItemById = table.freeze(TrollItemById),
	ItemCooldownSeconds = 1.5,
	FreezeRange = 45,
	FreezeSeconds = 4,
	SpikeStunSeconds = 3,
	MineLaunchSpeed = 110,
	MineStunSeconds = 2,
	BoogieRadius = 22,
	BoogieSeconds = 4,
	-- Placed traps and mines: how long they stay, how many each player can
	-- have out and how close someone has to step.
	TrapLifetimeSeconds = 120,
	MaxTrapsPerPlayer = 3,
	TrapTriggerRadius = 3.5,
})

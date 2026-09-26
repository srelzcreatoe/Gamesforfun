--!strict
-- Gear sold for Cash at the Gear Shop stall. Owned gear is saved and given back
-- every time you spawn. GearManager on the server makes each tool work.

export type Gear = {
	Id: string,
	DisplayName: string,
	-- 0 = everyone gets it for free.
	Price: number,
	Description: string,
	Color: Color3,
	Order: number,
}

local Gear: { Gear } = {
	{
		Id = "Slap",
		DisplayName = "Slap",
		Price = 0,
		Description = "Slap other players away. A slapped thief drops the brainrot!",
		Color = Color3.fromRGB(255, 190, 150),
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
})

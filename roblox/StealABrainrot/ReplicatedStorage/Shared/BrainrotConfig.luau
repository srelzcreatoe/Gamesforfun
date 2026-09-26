--!strict
-- Every brainrot that can appear on the conveyor, the rarity tiers and the
-- mutations (Gold, Diamond, Rainbow).
-- Each brainrot's blocky 3D model (made with Higgsfield) is packed in
-- ReplicatedStorage.Assets.Brainrots and shown by the BrainrotVisuals client
-- script; the server's simple block figure is the fallback. To use a model you
-- imported in Studio instead, put a Model named after the brainrot's Id in
-- ReplicatedStorage.BrainrotModels; it is scaled to the brainrot's height.

export type BodyShape = "Ball" | "Block"

export type Rarity = {
	Name: string,
	Color: Color3,
	-- Relative spawn chance on the conveyor.
	Weight: number,
	Glow: boolean,
}

export type Mutation = {
	Name: string,
	-- Chance for a conveyor brainrot to spawn with this mutation.
	Chance: number,
	-- Multiplies both income and price.
	Multiplier: number,
	Color: Color3,
}

export type Brainrot = {
	Id: string,
	DisplayName: string,
	Rarity: string,
	Price: number,
	IncomePerSecond: number,
	BodyShape: BodyShape,
	BodyColor: Color3,
	AccentColor: Color3,
	Scale: number,
}

local Rarities: { Rarity } = {
	{ Name = "Common", Color = Color3.fromRGB(210, 210, 210), Weight = 60, Glow = false },
	{ Name = "Rare", Color = Color3.fromRGB(70, 150, 255), Weight = 26, Glow = false },
	{ Name = "Epic", Color = Color3.fromRGB(175, 90, 255), Weight = 10, Glow = false },
	{ Name = "Legendary", Color = Color3.fromRGB(255, 190, 40), Weight = 3.4, Glow = true },
	{ Name = "Mythic", Color = Color3.fromRGB(255, 60, 90), Weight = 0.6, Glow = true },
}

local function brainrot(
	id: string,
	displayName: string,
	rarity: string,
	price: number,
	incomePerSecond: number,
	bodyShape: BodyShape,
	bodyColor: Color3,
	accentColor: Color3,
	scale: number
): Brainrot
	return table.freeze({
		Id = id,
		DisplayName = displayName,
		Rarity = rarity,
		Price = price,
		IncomePerSecond = incomePerSecond,
		BodyShape = bodyShape,
		BodyColor = bodyColor,
		AccentColor = accentColor,
		Scale = scale,
	})
end

local rgb = Color3.fromRGB

local Brainrots: { Brainrot } = {
	brainrot("NoobiniPizzanini", "Noobini Pizzanini", "Common", 25, 1, "Ball", rgb(255, 200, 120), rgb(220, 60, 40), 0.9),
	brainrot("LiriliLarila", "Lirili Larila", "Common", 60, 2, "Block", rgb(120, 180, 90), rgb(240, 240, 240), 1),
	brainrot("TimCheese", "Tim Cheese", "Common", 120, 3, "Block", rgb(255, 215, 60), rgb(200, 150, 40), 0.9),
	brainrot("Fluriflura", "Fluriflura", "Common", 200, 4, "Ball", rgb(255, 150, 200), rgb(255, 255, 255), 0.9),
	brainrot("TrippiTroppi", "Trippi Troppi", "Rare", 500, 8, "Ball", rgb(90, 160, 255), rgb(255, 180, 120), 1),
	brainrot("TungTungTungSahur", "Tung Tung Tung Sahur", "Rare", 900, 12, "Block", rgb(170, 120, 70), rgb(90, 60, 30), 1.1),
	brainrot("BonecaAmbalabu", "Boneca Ambalabu", "Rare", 1400, 16, "Ball", rgb(140, 200, 120), rgb(60, 60, 60), 1),
	brainrot("BrrBrrPatapim", "Brr Brr Patapim", "Epic", 3500, 38, "Block", rgb(110, 170, 80), rgb(150, 100, 60), 1.15),
	brainrot("CappuccinoAssassino", "Cappuccino Assassino", "Epic", 6000, 55, "Ball", rgb(120, 80, 50), rgb(40, 40, 40), 1.1),
	brainrot("BananitaDolphinita", "Bananita Dolphinita", "Epic", 8000, 70, "Ball", rgb(255, 230, 80), rgb(90, 170, 255), 1.1),
	brainrot("ChimpanziniBananini", "Chimpanzini Bananini", "Legendary", 25000, 180, "Block", rgb(255, 220, 60), rgb(120, 80, 40), 1.2),
	brainrot("BallerinaCappuccina", "Ballerina Cappuccina", "Legendary", 40000, 260, "Ball", rgb(255, 180, 210), rgb(120, 80, 50), 1.2),
	brainrot("BombardiroCrocodilo", "Bombardiro Crocodilo", "Mythic", 120000, 800, "Block", rgb(80, 140, 80), rgb(150, 150, 160), 1.35),
	brainrot("TralaleroTralala", "Tralalero Tralala", "Mythic", 250000, 1500, "Ball", rgb(80, 170, 255), rgb(255, 255, 255), 1.4),
}

local ById: { [string]: Brainrot } = {}
local ByRarity: { [string]: { Brainrot } } = {}
local RarityByName: { [string]: Rarity } = {}

for _, rarity in Rarities do
	RarityByName[rarity.Name] = rarity
	ByRarity[rarity.Name] = {}
end
for _, definition in Brainrots do
	ById[definition.Id] = definition
	table.insert(ByRarity[definition.Rarity], definition)
end

local Mutations: { Mutation } = {
	{ Name = "Gold", Chance = 0.06, Multiplier = 1.5, Color = Color3.fromRGB(255, 205, 50) },
	{ Name = "Diamond", Chance = 0.025, Multiplier = 2, Color = Color3.fromRGB(110, 225, 255) },
	{ Name = "Rainbow", Chance = 0.006, Multiplier = 5, Color = Color3.fromRGB(255, 110, 220) },
}

local MutationByName: { [string]: Mutation } = {}
for _, mutation in Mutations do
	MutationByName[mutation.Name] = mutation
end

-- Saved brainrots are "Id" or "Id:Mutation".
local function encode(brainrotId: string, mutationName: string?): string
	return if mutationName then brainrotId .. ":" .. mutationName else brainrotId
end

local function decode(entry: string): (Brainrot?, Mutation?)
	local brainrotId, mutationName = string.match(entry, "^(%w+):?(%w*)$")
	if brainrotId == nil then
		return nil, nil
	end
	local mutation = if mutationName and mutationName ~= "" then MutationByName[mutationName] else nil
	return ById[brainrotId], mutation
end

return table.freeze({
	Mutations = table.freeze(Mutations),
	MutationByName = table.freeze(MutationByName),
	encode = encode,
	decode = decode,
	Rarities = table.freeze(Rarities),
	Brainrots = table.freeze(Brainrots),
	ById = table.freeze(ById),
	ByRarity = table.freeze(ByRarity),
	RarityByName = table.freeze(RarityByName),
})

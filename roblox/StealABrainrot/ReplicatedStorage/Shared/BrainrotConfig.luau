--!strict
-- Every brainrot that can appear on the conveyor, the rarity tiers and the
-- mutations.
-- Each brainrot's blocky 3D model (made with Higgsfield) is packed in
-- ReplicatedStorage.Assets.Brainrots and shown by the BrainrotVisuals client
-- script; the server's simple block figure is the fallback. To use a model you
-- imported in Studio instead (for example one made on Customuse), put a Model
-- named after the brainrot's Id in ReplicatedStorage.BrainrotModels; it is
-- scaled to the brainrot's height.

export type BodyShape = "Ball" | "Block"

-- How a brainrot moves: Walk swings its legs, Fly hovers and banks, Drive
-- bounces along, Spin pirouettes and Hop jumps.
export type Motion = "Walk" | "Fly" | "Drive" | "Spin" | "Hop"

export type Rarity = {
	Name: string,
	Color: Color3,
	-- Relative spawn chance on the conveyor.
	Weight: number,
	Glow: boolean,
	-- Billboard text style: "Plain", "Rainbow" or "Secret".
	Style: string,
}

export type Mutation = {
	Name: string,
	-- Chance for a conveyor brainrot to spawn with this mutation. Event-only
	-- mutations have 0 and only appear during their event.
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
	Motion: Motion,
	Tags: { string },
}

local rgb = Color3.fromRGB

local Rarities: { Rarity } = {
	{ Name = "Common", Color = rgb(210, 210, 210), Weight = 55, Glow = false, Style = "Plain" },
	{ Name = "Rare", Color = rgb(70, 150, 255), Weight = 26, Glow = false, Style = "Plain" },
	{ Name = "Epic", Color = rgb(175, 90, 255), Weight = 12, Glow = false, Style = "Plain" },
	{ Name = "Legendary", Color = rgb(255, 190, 40), Weight = 4.5, Glow = true, Style = "Plain" },
	{ Name = "Mythic", Color = rgb(255, 60, 90), Weight = 1.8, Glow = true, Style = "Plain" },
	{ Name = "Brainrot God", Color = rgb(255, 120, 255), Weight = 0.5, Glow = true, Style = "Rainbow" },
	{ Name = "Secret", Color = rgb(20, 20, 20), Weight = 0.12, Glow = true, Style = "Secret" },
}

local function brainrot(
	id: string,
	displayName: string,
	rarity: string,
	price: number,
	incomePerSecond: number,
	bodyColor: Color3,
	accentColor: Color3,
	scale: number,
	motion: Motion?,
	tags: { string }?
): Brainrot
	return table.freeze({
		Id = id,
		DisplayName = displayName,
		Rarity = rarity,
		Price = price,
		IncomePerSecond = incomePerSecond,
		BodyShape = "Block" :: BodyShape,
		BodyColor = bodyColor,
		AccentColor = accentColor,
		Scale = scale,
		Motion = (motion or "Walk") :: Motion,
		Tags = table.freeze(table.clone(tags or {})),
	})
end

local TACO = { "Taco" }

local Brainrots: { Brainrot } = {
	-- Common
	brainrot("NoobiniPizzanini", "Noobini Pizzanini", "Common", 25, 1, rgb(255, 200, 90), rgb(200, 50, 40), 0.9),
	brainrot("LiriliLarila", "Lirili Larila", "Common", 60, 2, rgb(90, 170, 70), rgb(140, 90, 50), 0.95),
	brainrot("TimCheese", "Tim Cheese", "Common", 120, 3, rgb(255, 215, 60), rgb(130, 80, 40), 0.9),
	brainrot("Fluriflura", "Fluriflura", "Common", 200, 4, rgb(255, 110, 190), rgb(70, 170, 60), 0.9),
	brainrot("GufoTortillo", "Gufo Tortillo", "Common", 300, 5, rgb(150, 95, 50), rgb(255, 200, 40), 0.85),
	brainrot("CubettoBlu", "Cubetto Blu", "Common", 450, 7, rgb(40, 130, 230), rgb(200, 200, 205), 0.9),
	brainrot("MaialinoTaco", "Maialino Taco", "Common", 600, 8, rgb(255, 170, 190), rgb(240, 200, 60), 0.9, "Walk", TACO),
	-- Rare
	brainrot("TrippiTroppi", "Trippi Troppi", "Rare", 900, 12, rgb(150, 150, 160), rgb(255, 130, 50), 1),
	brainrot("TungTungTungSahur", "Tung Tung Tung Sahur", "Rare", 1400, 16, rgb(200, 130, 50), rgb(120, 70, 30), 1.1),
	brainrot("BonecaAmbalabu", "Boneca Ambalabu", "Rare", 2000, 22, rgb(90, 180, 60), rgb(40, 40, 40), 1),
	brainrot("PorcelliniTacolini", "Porcellini Tacolini", "Rare", 2800, 28, rgb(255, 170, 190), rgb(240, 200, 60), 0.95, "Walk", TACO),
	brainrot("MattoncinoCattivo", "Mattoncino Cattivo", "Rare", 3500, 34, rgb(130, 130, 135), rgb(255, 120, 30), 1.05),
	brainrot("BurritoHotspotito", "Burrito Hotspotito", "Rare", 4500, 40, rgb(230, 190, 120), rgb(30, 30, 30), 1, "Walk", TACO),
	-- Epic
	brainrot("BrrBrrPatapim", "Brr Brr Patapim", "Epic", 7000, 60, rgb(110, 170, 60), rgb(150, 100, 50), 1.15),
	brainrot("CappuccinoAssassino", "Cappuccino Assassino", "Epic", 9500, 75, rgb(235, 230, 220), rgb(30, 30, 30), 1.1),
	brainrot("BananitaDolphinita", "Bananita Dolphinita", "Epic", 12000, 90, rgb(130, 190, 240), rgb(250, 220, 60), 1.1),
	brainrot("PettirossoTacchino", "Pettirosso Tacchino", "Epic", 15000, 110, rgb(220, 40, 40), rgb(30, 30, 30), 1.05),
	brainrot("CapraAvocadra", "Capra Avocadra", "Epic", 20000, 140, rgb(140, 200, 60), rgb(120, 70, 30), 1.1),
	brainrot("ToroPalloncino", "Toro Palloncino", "Epic", 26000, 170, rgb(150, 80, 40), rgb(240, 230, 200), 1.1, "Hop"),
	-- Legendary
	brainrot("ChimpanziniBananini", "Chimpanzini Bananini", "Legendary", 40000, 240, rgb(250, 220, 60), rgb(110, 70, 40), 1.2),
	brainrot("BallerinaCappuccina", "Ballerina Cappuccina", "Legendary", 55000, 320, rgb(255, 170, 200), rgb(250, 240, 230), 1.25, "Spin"),
	brainrot("CapibaraTacoloco", "Capibara Tacoloco", "Legendary", 75000, 420, rgb(150, 100, 50), rgb(240, 200, 60), 1.1, "Walk", TACO),
	brainrot("Cioccolatone", "Cioccolatone", "Legendary", 100000, 550, rgb(110, 60, 30), rgb(255, 150, 190), 1.3),
	brainrot("PeperoncinoFigo", "Peperoncino Figo", "Legendary", 130000, 700, rgb(220, 30, 30), rgb(80, 200, 60), 1.3, "Walk", TACO),
	-- Mythic
	brainrot("BombardiroCrocodilo", "Bombardiro Crocodilo", "Mythic", 250000, 1200, rgb(80, 150, 60), rgb(150, 150, 160), 0.85, "Fly"),
	brainrot("TralaleroTralala", "Tralalero Tralala", "Mythic", 400000, 1800, rgb(40, 130, 230), rgb(250, 250, 250), 1.3),
	brainrot("CoccodrilloTacorito", "Coccodrillo Tacorito", "Mythic", 600000, 2600, rgb(230, 200, 140), rgb(60, 170, 60), 1.4, "Walk", TACO),
	brainrot("RattoSchiaffone", "Ratto Schiaffone", "Mythic", 850000, 3500, rgb(30, 30, 35), rgb(170, 60, 230), 1.4),
	-- Brainrot God
	brainrot("GattoPizzanave", "Gatto Pizzanave", "Brainrot God", 2000000, 8000, rgb(240, 170, 70), rgb(150, 150, 160), 1, "Fly"),
	brainrot("PiccioneMacchina", "Piccione Macchina", "Brainrot God", 3500000, 13000, rgb(140, 140, 150), rgb(60, 160, 120), 1.4, "Drive"),
	brainrot("TacoplanoBombardino", "Tacoplano Bombardino", "Brainrot God", 5000000, 18000, rgb(130, 130, 140), rgb(240, 200, 60), 0.75, "Fly", TACO),
	-- Secret
	brainrot("SpaghettiTualetti", "Spaghetti Tualetti", "Secret", 15000000, 50000, rgb(245, 245, 245), rgb(250, 210, 80), 1.5, "Hop"),
	brainrot("TacoritaBicicleta", "Tacorita Bicicleta", "Secret", 25000000, 75000, rgb(240, 200, 60), rgb(40, 110, 230), 1.4, "Drive", TACO),
	brainrot("SessantaSette", "67", "Secret", 67000000, 167000, rgb(40, 140, 240), rgb(250, 250, 250), 1.8),
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
	{ Name = "Gold", Chance = 0.06, Multiplier = 1.5, Color = rgb(255, 205, 50) },
	{ Name = "Diamond", Chance = 0.025, Multiplier = 2, Color = rgb(110, 225, 255) },
	{ Name = "Rainbow", Chance = 0.006, Multiplier = 5, Color = rgb(255, 110, 220) },
	-- Only during their events.
	{ Name = "Bloodrot", Chance = 0, Multiplier = 3, Color = rgb(200, 20, 40) },
	{ Name = "Galaxy", Chance = 0, Multiplier = 4, Color = rgb(150, 80, 255) },
	{ Name = "Lava", Chance = 0, Multiplier = 3.5, Color = rgb(255, 100, 20) },
	{ Name = "Frozen", Chance = 0, Multiplier = 2.5, Color = rgb(170, 230, 255) },
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

local function hasTag(definition: Brainrot, tag: string): boolean
	return table.find(definition.Tags, tag) ~= nil
end

return table.freeze({
	Mutations = table.freeze(Mutations),
	MutationByName = table.freeze(MutationByName),
	encode = encode,
	decode = decode,
	hasTag = hasTag,
	Rarities = table.freeze(Rarities),
	Brainrots = table.freeze(Brainrots),
	ById = table.freeze(ById),
	ByRarity = table.freeze(ByRarity),
	RarityByName = table.freeze(RarityByName),
})

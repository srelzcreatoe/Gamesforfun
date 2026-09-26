--!strict
-- Every brainrot that can appear on the conveyor, the rarity tiers, the
-- mutations and traits, and the lucky blocks.
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

-- Rolled at spawn like a mutation, and stacks with it: Fire burns, Tiny and
-- Giant change the size, Glitched flickers and Nyan leaves a rainbow trail.
export type Trait = {
	Name: string,
	Chance: number,
	-- Multiplies both income and price.
	Multiplier: number,
	-- Size change (1 = normal).
	Scale: number,
	Color: Color3,
	Icon: string,
}

export type Kind = "Brainrot" | "LuckyBlock"

export type Brainrot = {
	Id: string,
	Kind: Kind,
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
	-- Lucky blocks: the chance of each rarity when opened.
	Odds: { [string]: number }?,
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
		Kind = "Brainrot" :: Kind,
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
	brainrot("BombardiroCrocodilo", "Bombardiro Crocodilo", "Mythic", 250000, 1200, rgb(80, 150, 60), rgb(150, 150, 160), 0.8, "Fly"),
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

-- Lucky blocks walk home like brainrots (hopping) and earn nothing; their
-- owner opens them in their base for a random brainrot. The first three can
-- turn up on the conveyor (ConveyorWeight); the Secret one is Robux only.
local function luckyBlock(
	id: string,
	displayName: string,
	rarity: string,
	price: number,
	color: Color3,
	accent: Color3,
	odds: { [string]: number }
): Brainrot
	return table.freeze({
		Id = id,
		Kind = "LuckyBlock" :: Kind,
		DisplayName = displayName,
		Rarity = rarity,
		Price = price,
		IncomePerSecond = 0,
		BodyShape = "Block" :: BodyShape,
		BodyColor = color,
		AccentColor = accent,
		Scale = 1,
		Motion = "Hop" :: Motion,
		Tags = table.freeze({}),
		Odds = table.freeze(odds),
	})
end

local LuckyBlocks: { Brainrot } = {
	luckyBlock("LuckyBlock", "Lucky Block", "Epic", 25000, rgb(255, 200, 40), rgb(255, 255, 255), {
		Rare = 40,
		Epic = 35,
		Legendary = 20,
		Mythic = 5,
	}),
	luckyBlock("MythicLuckyBlock", "Mythic Lucky Block", "Mythic", 400000, rgb(255, 60, 90), rgb(255, 220, 230), {
		Legendary = 50,
		Mythic = 40,
		["Brainrot God"] = 9,
		Secret = 1,
	}),
	luckyBlock("GodLuckyBlock", "Brainrot God Lucky Block", "Brainrot God", 5000000, rgb(255, 120, 255), rgb(120, 240, 255), {
		Mythic = 55,
		["Brainrot God"] = 40,
		Secret = 5,
	}),
	luckyBlock("SecretLuckyBlock", "Secret Lucky Block", "Secret", 50000000, rgb(25, 25, 30), rgb(255, 255, 255), {
		["Brainrot God"] = 70,
		Secret = 30,
	}),
}
-- How often each lucky block turns up on the conveyor (relative), and the
-- chance for any conveyor spawn to be a lucky block.
local LuckyBlockWeights: { [string]: number } = table.freeze({
	LuckyBlock = 80,
	MythicLuckyBlock = 17,
	GodLuckyBlock = 3,
})
local LUCKY_BLOCK_CHANCE = 0.05

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
-- Lucky blocks can be saved, bought and stolen like brainrots, but aren't in
-- Brainrots, ByRarity or the Index.
for _, definition in LuckyBlocks do
	ById[definition.Id] = definition
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

local Traits: { Trait } = {
	{ Name = "Fire", Chance = 0.03, Multiplier = 2, Scale = 1, Color = rgb(255, 120, 30), Icon = "🔥" },
	{ Name = "Tiny", Chance = 0.03, Multiplier = 1.5, Scale = 0.6, Color = rgb(140, 255, 200), Icon = "🐜" },
	{ Name = "Giant", Chance = 0.02, Multiplier = 3, Scale = 1.6, Color = rgb(255, 210, 80), Icon = "🗿" },
	{ Name = "Glitched", Chance = 0.006, Multiplier = 6, Scale = 1, Color = rgb(60, 255, 240), Icon = "👾" },
	{ Name = "Nyan", Chance = 0.003, Multiplier = 8, Scale = 1, Color = rgb(255, 120, 220), Icon = "🌈" },
}

local TraitByName: { [string]: Trait } = {}
for _, trait in Traits do
	TraitByName[trait.Name] = trait
end

-- Saved brainrots are "Id", "Id:Mutation", "Id::Trait" or "Id:Mutation:Trait".
local function encode(brainrotId: string, mutationName: string?, traitName: string?): string
	if traitName then
		return brainrotId .. ":" .. (mutationName or "") .. ":" .. traitName
	end
	return if mutationName then brainrotId .. ":" .. mutationName else brainrotId
end

local function decode(entry: string): (Brainrot?, Mutation?, Trait?)
	local brainrotId, mutationName, traitName = string.match(entry, "^(%w+):?(%w*):?(%w*)$")
	if brainrotId == nil then
		return nil, nil, nil
	end
	local mutation = if mutationName and mutationName ~= "" then MutationByName[mutationName] else nil
	local trait = if traitName and traitName ~= "" then TraitByName[traitName] else nil
	return ById[brainrotId], mutation, trait
end

-- Income and price multiplier from a mutation and a trait together.
local function multiplier(mutation: Mutation?, trait: Trait?): number
	return (if mutation then mutation.Multiplier else 1) * (if trait then trait.Multiplier else 1)
end

local function isLuckyBlock(definition: Brainrot): boolean
	return definition.Kind == "LuckyBlock"
end

-- "Fire Gold Tim Cheese"
local function fullName(definition: Brainrot, mutation: Mutation?, trait: Trait?): string
	local name = definition.DisplayName
	if mutation then
		name = mutation.Name .. " " .. name
	end
	if trait then
		name = trait.Name .. " " .. name
	end
	return name
end

local function hasTag(definition: Brainrot, tag: string): boolean
	return table.find(definition.Tags, tag) ~= nil
end

return table.freeze({
	Mutations = table.freeze(Mutations),
	MutationByName = table.freeze(MutationByName),
	Traits = table.freeze(Traits),
	TraitByName = table.freeze(TraitByName),
	LuckyBlocks = table.freeze(LuckyBlocks),
	LuckyBlockWeights = LuckyBlockWeights,
	LuckyBlockChance = LUCKY_BLOCK_CHANCE,
	encode = encode,
	decode = decode,
	multiplier = multiplier,
	isLuckyBlock = isLuckyBlock,
	fullName = fullName,
	hasTag = hasTag,
	Rarities = table.freeze(Rarities),
	Brainrots = table.freeze(Brainrots),
	ById = table.freeze(ById),
	ByRarity = table.freeze(ByRarity),
	RarityByName = table.freeze(RarityByName),
})

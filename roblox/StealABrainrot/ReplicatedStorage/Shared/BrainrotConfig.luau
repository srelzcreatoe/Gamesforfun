--!strict
-- Every brainrot that can appear on the conveyor, the rarity tiers, the
-- mutations and traits, and the lucky blocks.
-- Each brainrot's blocky 3D model (made with Higgsfield and voxelised, or
-- built from blocks by hand: see tools/blocky) is packed in
-- ReplicatedStorage.Assets.Brainrots and shown by the BrainrotVisuals client
-- script; the server's simple block figure is the fallback. To use a model you
-- imported in Studio instead (for example one made on Customuse), put a Model
-- named after the brainrot's Id in ReplicatedStorage.BrainrotModels; it is
-- scaled to the brainrot's height.

export type BodyShape = "Ball" | "Block"

-- How a brainrot moves: Walk swings its legs, Fly hovers and banks, Drive
-- bounces along, Spin pirouettes, Hop jumps and Skate rides a skateboard
-- (carving, pushing and popping tricks).
export type Motion = "Walk" | "Fly" | "Drive" | "Spin" | "Hop" | "Skate"

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
	-- Built from blocks (tools/blocky) rather than made with Higgsfield: an
	-- imported Studio model never replaces it.
	BlockBuilt: boolean,
	-- Never on the conveyor or in lucky blocks: Limited ones are sold in the
	-- weekly shop, Season ones are season pass rewards.
	Exclusive: boolean,
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
		BlockBuilt = false,
		Exclusive = false,
	})
end

-- A brainrot built from blocks (tools/blocky/designs_*.py).
local function blocky(
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
	local definition = table.clone(brainrot(id, displayName, rarity, price, incomePerSecond, bodyColor, accentColor, scale, motion, tags))
	definition.BlockBuilt = true
	definition.Exclusive = table.find(definition.Tags, "Limited") ~= nil or table.find(definition.Tags, "Season") ~= nil
	return table.freeze(definition)
end

local TACO = { "Taco" }
local LIMITED = { "Limited" }
local SEASON = { "Season" }

local Brainrots: { Brainrot } = {
	-- Common
	blocky("NoobiniPizzanini", "Noobini Pizzanini", "Common", 25, 1, rgb(255, 200, 60), rgb(13, 105, 172), 0.95),
	blocky("BaconinoCapellino", "Baconino Capellino", "Common", 35, 1, rgb(200, 70, 60), rgb(120, 70, 40), 0.9),
	brainrot("LiriliLarila", "Lirili Larila", "Common", 60, 2, rgb(90, 170, 70), rgb(140, 90, 50), 0.95),
	blocky("OofinoCadutino", "Oofino Cadutino", "Common", 85, 2, rgb(245, 205, 48), rgb(164, 189, 71), 0.9),
	brainrot("TimCheese", "Tim Cheese", "Common", 120, 3, rgb(255, 215, 60), rgb(130, 80, 40), 0.9),
	blocky("TalpaDiFero", "Talpa Di Fero", "Common", 150, 3, rgb(120, 100, 90), rgb(160, 165, 175), 0.9),
	brainrot("Fluriflura", "Fluriflura", "Common", 200, 4, rgb(255, 110, 190), rgb(70, 170, 60), 0.9),
	blocky("PipiKiwi", "Pipi Kiwi", "Common", 250, 4, rgb(140, 100, 60), rgb(120, 200, 60), 0.85),
	brainrot("GufoTortillo", "Gufo Tortillo", "Common", 300, 5, rgb(150, 95, 50), rgb(255, 200, 40), 0.85),
	blocky("SpaghettiNoobetti", "Spaghetti Noobetti", "Common", 350, 5, rgb(245, 245, 245), rgb(220, 60, 40), 0.9),
	blocky("RacooniJandelini", "Racooni Jandelini", "Common", 400, 6, rgb(130, 130, 140), rgb(30, 30, 35), 0.95),
	brainrot("CubettoBlu", "Cubetto Blu", "Common", 450, 7, rgb(40, 130, 230), rgb(200, 200, 205), 0.9),
	blocky("LavamattoneObbino", "Lavamattone Obbino", "Common", 520, 7, rgb(255, 90, 30), rgb(255, 220, 60), 0.85, "Hop"),
	brainrot("MaialinoTaco", "Maialino Taco", "Common", 600, 8, rgb(255, 170, 190), rgb(240, 200, 60), 0.9, "Walk", TACO),
	blocky("CoilinoVelocino", "Coilino Velocino", "Common", 700, 9, rgb(220, 40, 40), rgb(245, 245, 245), 0.9, "Hop"),
	blocky("SvininaBombardino", "Svinina Bombardino", "Common", 800, 10, rgb(255, 160, 180), rgb(130, 135, 145), 0.8, "Fly"),

	-- Rare
	brainrot("TrippiTroppi", "Trippi Troppi", "Rare", 900, 12, rgb(150, 150, 160), rgb(255, 130, 50), 1),
	blocky("BloxyColino", "Bloxy Colino", "Rare", 1100, 14, rgb(215, 30, 40), rgb(60, 140, 255), 0.95),
	brainrot("TungTungTungSahur", "Tung Tung Tung Sahur", "Rare", 1400, 16, rgb(200, 130, 50), rgb(120, 70, 30), 1.1),
	blocky("TixiniBiglietti", "Tixini Biglietti", "Rare", 1700, 19, rgb(250, 200, 50), rgb(30, 30, 30), 0.95),
	brainrot("BonecaAmbalabu", "Boneca Ambalabu", "Rare", 2000, 22, rgb(90, 180, 60), rgb(40, 40, 40), 1),
	blocky("UovinoCacciatore", "Uovino Cacciatore", "Rare", 2400, 25, rgb(255, 180, 210), rgb(60, 140, 60), 0.95),
	brainrot("PorcelliniTacolini", "Porcellini Tacolini", "Rare", 2800, 28, rgb(255, 170, 190), rgb(240, 200, 60), 0.95, "Walk", TACO),
	blocky("TaTaTaTaSahur", "Ta Ta Ta Ta Sahur", "Rare", 3100, 31, rgb(190, 110, 60), rgb(120, 70, 30), 1.05),
	blocky("BaconiniCroccantini", "Baconini Croccantini", "Rare", 3200, 30, rgb(220, 70, 50), rgb(40, 90, 150), 1),
	brainrot("MattoncinoCattivo", "Mattoncino Cattivo", "Rare", 3500, 34, rgb(130, 130, 135), rgb(255, 120, 30), 1.05),
	blocky("TipiTopiTaco", "Tipi Topi Taco", "Rare", 3800, 36, rgb(245, 200, 80), rgb(150, 150, 160), 0.95, "Walk", TACO),
	blocky("CactoHipopotamo", "Cacto Hipopotamo", "Rare", 4200, 38, rgb(80, 170, 70), rgb(255, 120, 180), 1.05),
	brainrot("BurritoHotspotito", "Burrito Hotspotito", "Rare", 4500, 40, rgb(230, 190, 120), rgb(30, 30, 30), 1, "Walk", TACO),
	blocky("RobuxinoMonetino", "Robuxino Monetino", "Rare", 5000, 44, rgb(240, 190, 50), rgb(90, 200, 110), 1),
	blocky("ZibraZubraZibralini", "Zibra Zubra Zibralini", "Rare", 5500, 48, rgb(245, 245, 245), rgb(25, 25, 25), 1.1),
	blocky("GravitinoLunare", "Gravitino Lunare", "Rare", 6200, 52, rgb(150, 80, 230), rgb(255, 230, 120), 1, "Fly"),

	-- Epic
	brainrot("BrrBrrPatapim", "Brr Brr Patapim", "Epic", 7000, 60, rgb(110, 170, 60), rgb(150, 100, 50), 1.15),
	blocky("LaginoPingone", "Lagino Pingone", "Epic", 8000, 66, rgb(40, 40, 45), rgb(255, 60, 60), 1),
	brainrot("CappuccinoAssassino", "Cappuccino Assassino", "Epic", 9500, 75, rgb(235, 230, 220), rgb(30, 30, 30), 1.1),
	blocky("SpadinoLinkino", "Spadino Linkino", "Epic", 11000, 84, rgb(180, 185, 195), rgb(230, 180, 50), 1.2),
	blocky("NubbinoLasagnino", "Nubbino Lasagnino", "Epic", 11000, 85, rgb(240, 200, 70), rgb(60, 160, 60), 1.05),
	brainrot("BananitaDolphinita", "Bananita Dolphinita", "Epic", 12000, 90, rgb(130, 190, 240), rgb(250, 220, 60), 1.1),
	blocky("SalaminoPenguino", "Salamino Penguino", "Epic", 13500, 100, rgb(160, 40, 50), rgb(255, 150, 40), 1),
	brainrot("PettirossoTacchino", "Pettirosso Tacchino", "Epic", 15000, 110, rgb(220, 40, 40), rgb(30, 30, 30), 1.05),
	blocky("DoginoPizzarino", "Dogino Pizzarino", "Epic", 17000, 122, rgb(230, 160, 80), rgb(245, 245, 245), 1.05),
	brainrot("CapraAvocadra", "Capra Avocadra", "Epic", 20000, 140, rgb(140, 200, 60), rgb(120, 70, 30), 1.1),
	blocky("TukannoBananno", "Tukanno Bananno", "Epic", 23000, 155, rgb(30, 30, 35), rgb(255, 220, 40), 1.1),
	brainrot("ToroPalloncino", "Toro Palloncino", "Epic", 26000, 170, rgb(150, 80, 40), rgb(240, 230, 200), 1.1, "Hop"),
	blocky("CannolinoCannone", "Cannolino Cannone", "Epic", 28000, 180, rgb(230, 170, 80), rgb(120, 80, 40), 1, "Drive"),
	blocky("TigriliniWatermelini", "Tigrilini Watermelini", "Epic", 31000, 200, rgb(60, 160, 60), rgb(255, 140, 30), 1.1),
	blocky("KorbloxoScheletrino", "Korbloxo Scheletrino", "Epic", 34000, 215, rgb(40, 50, 110), rgb(120, 200, 255), 1.2, "Walk", LIMITED),

	-- Legendary
	brainrot("ChimpanziniBananini", "Chimpanzini Bananini", "Legendary", 40000, 240, rgb(250, 220, 60), rgb(110, 70, 40), 1.2),
	blocky("PizzaioloTurbino", "Pizzaiolo Turbino", "Legendary", 45000, 265, rgb(245, 245, 245), rgb(200, 40, 40), 1.2),
	blocky("PandacciniBananini", "Pandaccini Bananini", "Legendary", 50000, 290, rgb(250, 220, 60), rgb(30, 30, 30), 1.2),
	brainrot("BallerinaCappuccina", "Ballerina Cappuccina", "Legendary", 55000, 320, rgb(255, 170, 200), rgb(250, 240, 230), 1.25, "Spin"),
	blocky("GelatoneGigantone", "Gelatone Gigantone", "Legendary", 62000, 350, rgb(255, 150, 190), rgb(210, 160, 90), 1.25),
	blocky("BurbaloniLoliloli", "Burbaloni Loliloli", "Legendary", 68000, 385, rgb(130, 90, 50), rgb(245, 240, 225), 1.1),
	brainrot("CapibaraTacoloco", "Capibara Tacoloco", "Legendary", 75000, 420, rgb(150, 100, 50), rgb(240, 200, 60), 1.1, "Walk", TACO),
	blocky("LasagnoLeoncino", "Lasagno Leoncino", "Legendary", 85000, 470, rgb(240, 200, 110), rgb(200, 50, 40), 1.15),
	blocky("OspitinoSenzanome", "Ospitino Senzanome", "Legendary", 90000, 480, rgb(230, 230, 230), rgb(30, 30, 35), 1.15),
	blocky("BuilderinoMattoncino", "Builderino Mattoncino", "Legendary", 92000, 505, rgb(255, 200, 30), rgb(255, 120, 30), 1.2),
	brainrot("Cioccolatone", "Cioccolatone", "Legendary", 100000, 550, rgb(110, 60, 30), rgb(255, 150, 190), 1.3),
	blocky("StrawberelliFlamingelli", "Strawberelli Flamingelli", "Legendary", 115000, 620, rgb(230, 40, 60), rgb(255, 150, 190), 1.3),
	brainrot("PeperoncinoFigo", "Peperoncino Figo", "Legendary", 130000, 700, rgb(220, 30, 30), rgb(80, 200, 60), 1.3, "Walk", TACO),
	blocky("PizzolinoFantasmino", "Pizzolino Fantasmino", "Legendary", 140000, 750, rgb(250, 210, 70), rgb(245, 245, 245), 1.2, "Fly"),
	blocky("BlueberriniOctopusini", "Blueberrini Octopusini", "Legendary", 145000, 770, rgb(60, 60, 170), rgb(150, 120, 230), 1.2),
	brainrot("ChefCrabracadabra", "Chef Crabracadabra", "Legendary", 160000, 850, rgb(215, 35, 30), rgb(245, 245, 245), 1.2),
	blocky("GlorboFruttodrillo", "Glorbo Fruttodrillo", "Legendary", 175000, 920, rgb(60, 150, 60), rgb(230, 60, 70), 1.25),
	blocky("LionelCactuseli", "Lionel Cactuseli", "Legendary", 190000, 1000, rgb(70, 160, 70), rgb(255, 120, 190), 1.3),
	blocky("ValkyrioPolpetto", "Valkyrio Polpetto", "Legendary", 210000, 1100, rgb(130, 70, 40), rgb(200, 205, 215), 1.25, "Walk", LIMITED),

	-- Mythic
	brainrot("BombardiroCrocodilo", "Bombardiro Crocodilo", "Mythic", 250000, 1200, rgb(80, 150, 60), rgb(150, 150, 160), 0.8, "Fly"),
	blocky("AeroplaninoPaninino", "Aeroplanino Paninino", "Mythic", 300000, 1400, rgb(220, 170, 90), rgb(230, 80, 80), 0.9, "Fly"),
	blocky("GuestiGuacanini", "Guesti Guacanini", "Mythic", 350000, 1600, rgb(120, 180, 70), rgb(25, 25, 30), 1.3),
	brainrot("TralaleroTralala", "Tralalero Tralala", "Mythic", 400000, 1800, rgb(40, 130, 230), rgb(250, 250, 250), 1.3),
	blocky("OrangutiniAnanassini", "Orangutini Ananassini", "Mythic", 500000, 2200, rgb(250, 200, 50), rgb(210, 110, 40), 1.35),
	brainrot("CoccodrilloTacorito", "Coccodrillo Tacorito", "Mythic", 600000, 2600, rgb(230, 200, 140), rgb(60, 170, 60), 1.4, "Walk", TACO),
	blocky("RobotinoRobloxino", "Robotino Robloxino", "Mythic", 700000, 2950, rgb(160, 165, 175), rgb(60, 220, 255), 1.35),
	blocky("NonnaMattarella", "Nonna Mattarella", "Mythic", 700000, 3000, rgb(30, 30, 35), rgb(160, 25, 35), 1.25),
	brainrot("RattoSchiaffone", "Ratto Schiaffone", "Mythic", 850000, 3500, rgb(30, 30, 35), rgb(170, 60, 230), 1.4),
	blocky("RhinoToasterino", "Rhino Toasterino", "Mythic", 950000, 3900, rgb(200, 205, 215), rgb(210, 150, 70), 1.3),
	blocky("BombombiniGusini", "Bombombini Gusini", "Mythic", 1050000, 4300, rgb(245, 245, 245), rgb(130, 135, 145), 0.9, "Fly"),
	brainrot("FrigoCamelo", "Frigo Camelo", "Mythic", 1200000, 4800, rgb(235, 235, 240), rgb(210, 150, 80), 1.4),
	blocky("GorilloWatermelondrillo", "Gorillo Watermelondrillo", "Mythic", 1400000, 5500, rgb(70, 70, 75), rgb(60, 160, 60), 1.45),
	blocky("HeadlessoZuccone", "Headlesso Zuccone", "Mythic", 1600000, 6200, rgb(30, 30, 35), rgb(255, 130, 20), 1.35, "Walk", LIMITED),
	blocky("DominussoCappuccinoso", "Dominusso Cappuccinoso", "Mythic", 1800000, 7000, rgb(30, 35, 60), rgb(240, 190, 60), 1.35, "Walk", LIMITED),

	-- Brainrot God
	brainrot("GattoPizzanave", "Gatto Pizzanave", "Brainrot God", 2000000, 8000, rgb(240, 170, 70), rgb(150, 150, 160), 1, "Fly"),
	blocky("EspressoSignora", "Espresso Signora", "Brainrot God", 2500000, 9800, rgb(245, 245, 245), rgb(110, 60, 30), 1.3),
	blocky("OrcaleroOrcala", "Orcalero Orcala", "Brainrot God", 3000000, 11500, rgb(25, 25, 30), rgb(245, 245, 245), 1.4),
	brainrot("PiccioneMacchina", "Piccione Macchina", "Brainrot God", 3500000, 13000, rgb(140, 140, 150), rgb(60, 160, 120), 1.4, "Drive"),
	blocky("EspressinoMotorino", "Espressino Motorino", "Brainrot God", 3800000, 14000, rgb(245, 245, 245), rgb(210, 30, 40), 1.25, "Drive"),
	blocky("StatutinoLibertino", "Statutino Libertino", "Brainrot God", 4200000, 15500, rgb(110, 190, 160), rgb(255, 170, 40), 1.45),
	blocky("GattatinoNeonino", "Gattatino Neonino", "Brainrot God", 4500000, 16500, rgb(60, 30, 90), rgb(255, 60, 200), 1.3),
	brainrot("TacoplanoBombardino", "Tacoplano Bombardino", "Brainrot God", 5000000, 18000, rgb(130, 130, 140), rgb(240, 200, 60), 0.75, "Fly", TACO),
	blocky("SqualoRobuxiano", "Squalo Robuxiano", "Brainrot God", 6000000, 21000, rgb(60, 170, 90), rgb(240, 190, 50), 1.4),
	blocky("GirafaCelestre", "Girafa Celestre", "Brainrot God", 7000000, 23500, rgb(245, 200, 90), rgb(240, 240, 250), 1.6),
	brainrot("CocofantoElefanto", "Cocofanto Elefanto", "Brainrot God", 8000000, 26000, rgb(120, 70, 35), rgb(150, 150, 160), 1.5),
	blocky("TrenostruzzoTurbo3000", "Trenostruzzo Turbo 3000", "Brainrot God", 9000000, 29000, rgb(40, 40, 45), rgb(220, 40, 40), 1.2, "Drive"),
	blocky("BanhammeroGiustiziere", "Banhammero Giustiziere", "Brainrot God", 10000000, 32000, rgb(30, 30, 35), rgb(220, 30, 40), 1.5),
	blocky("SparklinoFedorino", "Sparklino Fedorino", "Brainrot God", 12000000, 37000, rgb(245, 245, 240), rgb(140, 60, 200), 1.4, "Walk", LIMITED),
	blocky("CanelitoCannolito", "Canelito Cannolito", "Brainrot God", 13500000, 41000, rgb(234, 208, 162), rgb(216, 50, 43), 1.1),

	-- Secret
	brainrot("SpaghettiTualetti", "Spaghetti Tualetti", "Secret", 15000000, 50000, rgb(245, 245, 245), rgb(250, 210, 80), 1.5, "Hop"),
	blocky("OofosauroRex", "Oofosauro Rex", "Secret", 18000000, 58000, rgb(245, 205, 48), rgb(13, 105, 172), 1.6),
	blocky("GraipussMedussi", "Graipuss Medussi", "Secret", 20000000, 64000, rgb(120, 50, 170), rgb(90, 170, 60), 1.4, "Fly"),
	brainrot("TacoritaBicicleta", "Tacorita Bicicleta", "Secret", 25000000, 75000, rgb(240, 200, 60), rgb(40, 110, 230), 1.4, "Drive", TACO),
	blocky("LosTralaleritos", "Los Tralaleritos", "Secret", 28000000, 82000, rgb(40, 130, 230), rgb(240, 190, 50), 1.4),
	blocky("SpaghettoneSqualone", "Spaghettone Squalone", "Secret", 30000000, 88000, rgb(225, 185, 90), rgb(245, 245, 245), 1.1, "Fly"),
	blocky("ChicleteiraBicicleteira", "Chicleteira Bicicleteira", "Secret", 32000000, 95000, rgb(255, 120, 180), rgb(220, 40, 50), 1.4, "Drive"),
	brainrot("LaVacaSaturnoSaturnita", "La Vaca Saturno Saturnita", "Secret", 35000000, 110000, rgb(245, 150, 50), rgb(240, 200, 40), 1.5),
	blocky("NuclearoDinossauro", "Nuclearo Dinossauro", "Secret", 40000000, 120000, rgb(40, 90, 40), rgb(170, 255, 60), 1.7),
	blocky("GalatticoGuestone", "Galattico Guestone", "Secret", 45000000, 130000, rgb(50, 30, 110), rgb(255, 120, 220), 1.7),
	blocky("DragonCannelloni", "Dragon Cannelloni", "Secret", 50000000, 140000, rgb(245, 220, 150), rgb(210, 50, 40), 1.3, "Fly"),
	blocky("BenjiniSkatini", "Benjini Skatini", "Secret", 58000000, 155000, rgb(29, 29, 34), rgb(228, 197, 142), 1.6, "Skate"),
	brainrot("SessantaSette", "67", "Secret", 67000000, 167000, rgb(40, 140, 240), rgb(250, 250, 250), 1.8),
	blocky("LaGrandeCombinasion", "La Grande Combinasion", "Secret", 80000000, 190000, rgb(40, 130, 230), rgb(240, 190, 50), 1.9),
	blocky("StrawberryElephant", "Strawberry Elephant", "Secret", 100000000, 230000, rgb(225, 40, 55), rgb(80, 170, 60), 1.8),
	blocky("AdminoSupremo", "Admino Supremo", "Secret", 150000000, 300000, rgb(200, 30, 40), rgb(255, 210, 60), 1.7, "Walk", SEASON),
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
		BlockBuilt = false,
		Exclusive = false,
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
-- What the conveyor, lucky blocks and fusing can give (and what the Index
-- pages need): everything but the exclusive brainrots.
local Obtainable: { Brainrot } = {}
local DropsByRarity: { [string]: { Brainrot } } = {}
for _, rarity in Rarities do
	DropsByRarity[rarity.Name] = {}
end
for _, definition in Brainrots do
	ById[definition.Id] = definition
	table.insert(ByRarity[definition.Rarity], definition)
	if not definition.Exclusive then
		table.insert(Obtainable, definition)
		table.insert(DropsByRarity[definition.Rarity], definition)
	end
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
	{ Name = "Taco", Chance = 0, Multiplier = 3, Color = rgb(255, 185, 50) },
	{ Name = "Lucky", Chance = 0, Multiplier = 2.5, Color = rgb(60, 235, 120) },
	{ Name = "Cash", Chance = 0, Multiplier = 3, Color = rgb(170, 255, 90) },
	{ Name = "Storm", Chance = 0, Multiplier = 4, Color = rgb(110, 170, 255) },
	{ Name = "Heist", Chance = 0, Multiplier = 3.5, Color = rgb(255, 215, 70) },
	{ Name = "Boss", Chance = 0, Multiplier = 5, Color = rgb(255, 80, 40) },
	-- ADMIN ABUSE only, and rarely even then.
	{ Name = "Admin", Chance = 0, Multiplier = 7, Color = rgb(255, 40, 70) },
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
-- A brainrot in a base also saves its hat and how long it has been levelling
-- up: "Id:Mutation:Trait:Hat:Seconds" (see encodeFull).
local ENTRY_PATTERN = "^(%w+):?(%w*):?(%w*):?(%w*):?(%d*)$"

local function encode(brainrotId: string, mutationName: string?, traitName: string?): string
	if traitName then
		return brainrotId .. ":" .. (mutationName or "") .. ":" .. traitName
	end
	return if mutationName then brainrotId .. ":" .. mutationName else brainrotId
end

-- Like encode, plus the brainrot's hat and level time (whole seconds).
local function encodeFull(brainrotId: string, mutationName: string?, traitName: string?, hatName: string?, seconds: number?): string
	local whole = math.max(0, math.floor(seconds or 0))
	if (hatName == nil or hatName == "") and whole == 0 then
		return encode(brainrotId, mutationName, traitName)
	end
	return string.format("%s:%s:%s:%s:%d", brainrotId, mutationName or "", traitName or "", hatName or "", whole)
end

local function decode(entry: string): (Brainrot?, Mutation?, Trait?)
	local brainrotId, mutationName, traitName = string.match(entry, ENTRY_PATTERN)
	if brainrotId == nil then
		return nil, nil, nil
	end
	local mutation = if mutationName and mutationName ~= "" then MutationByName[mutationName] else nil
	local trait = if traitName and traitName ~= "" then TraitByName[traitName] else nil
	return ById[brainrotId], mutation, trait
end

-- The hat (a name, or nil) and level seconds saved with an entry.
local function decodeExtras(entry: string): (string?, number)
	local _, _, _, hatName, seconds = string.match(entry, ENTRY_PATTERN)
	return if hatName and hatName ~= "" then hatName else nil, tonumber(seconds) or 0
end

-- The entry without its hat and level ("Id:Mutation:Trait").
local function plainEntry(entry: string): string
	local brainrotId, mutationName, traitName = string.match(entry, ENTRY_PATTERN)
	if brainrotId == nil then
		return entry
	end
	return encode(brainrotId, if mutationName ~= "" then mutationName else nil, if traitName ~= "" then traitName else nil)
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
	encodeFull = encodeFull,
	decode = decode,
	decodeExtras = decodeExtras,
	plainEntry = plainEntry,
	multiplier = multiplier,
	isLuckyBlock = isLuckyBlock,
	fullName = fullName,
	hasTag = hasTag,
	Rarities = table.freeze(Rarities),
	Brainrots = table.freeze(Brainrots),
	Obtainable = table.freeze(Obtainable),
	ById = table.freeze(ById),
	ByRarity = table.freeze(ByRarity),
	DropsByRarity = table.freeze(DropsByRarity),
	RarityByName = table.freeze(RarityByName),
})

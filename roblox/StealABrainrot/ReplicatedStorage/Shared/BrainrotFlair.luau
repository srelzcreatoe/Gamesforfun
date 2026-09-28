--!strict
-- Extra flash for the rarest exclusive brainrots (the Dominusso Cappuccinoso
-- Crate's and the Brainrot God Lucky Block's specials): glowing squares
-- rising off them like flames, sparkles, a fire on the head, a shine and a
-- coloured glow, on top of their rarity's effects. Shown by the
-- BrainrotVisuals client script (not in Low graphics).

export type Flair = {
	-- How many glowing squares rise off it at a time, and their colours.
	Squares: number,
	SquareColours: { Color3 },
	-- Sparkles a second, and their colours.
	Sparkles: number,
	SparkleColours: ColorSequence,
	-- A fire on its head (colour and second colour), if any.
	Fire: { Color3 }?,
	-- How shiny its blocks are (0 to 1), and its glow.
	Shine: number,
	Glow: Color3,
}

local rgb = Color3.fromRGB

local GOLD = { rgb(255, 214, 60), rgb(255, 170, 30), rgb(255, 244, 170) }

local Flair: { [string]: Flair } = {
	DominussoAureo = {
		Squares = 16,
		SquareColours = GOLD,
		Sparkles = 24,
		SparkleColours = ColorSequence.new(rgb(255, 250, 200), rgb(255, 190, 40)),
		Fire = { rgb(255, 200, 60), rgb(255, 250, 210) },
		Shine = 0.35,
		Glow = rgb(255, 200, 70),
	},
	DominussoRexino = {
		Squares = 16,
		SquareColours = { rgb(170, 70, 255), rgb(230, 130, 255), rgb(255, 205, 70) },
		Sparkles = 22,
		SparkleColours = ColorSequence.new(rgb(240, 200, 255), rgb(160, 60, 255)),
		Fire = { rgb(170, 60, 255), rgb(255, 150, 255) },
		Shine = 0.25,
		Glow = rgb(180, 90, 255),
	},
	HackerinoVerdino = {
		Squares = 16,
		SquareColours = { rgb(60, 255, 100), rgb(30, 190, 70), rgb(200, 255, 210) },
		Sparkles = 18,
		SparkleColours = ColorSequence.new(rgb(120, 255, 150), rgb(255, 50, 60)),
		Fire = nil,
		Shine = 0.2,
		Glow = rgb(60, 255, 110),
	},
	NinjaccioViolino = {
		Squares = 14,
		SquareColours = { rgb(140, 90, 255), rgb(200, 160, 255), rgb(255, 255, 255) },
		Sparkles = 26,
		SparkleColours = ColorSequence.new({
			ColorSequenceKeypoint.new(0, rgb(255, 255, 255)),
			ColorSequenceKeypoint.new(0.5, rgb(200, 150, 255)),
			ColorSequenceKeypoint.new(1, rgb(255, 120, 230)),
		}),
		Fire = nil,
		Shine = 0.25,
		Glow = rgb(150, 90, 255),
	},
	RobuxoneDorato = {
		Squares = 14,
		SquareColours = GOLD,
		Sparkles = 22,
		SparkleColours = ColorSequence.new(rgb(255, 255, 220), rgb(255, 200, 50)),
		Fire = nil,
		Shine = 0.35,
		Glow = rgb(255, 205, 80),
	},
	TungTungTungOro = {
		Squares = 16,
		SquareColours = { rgb(255, 210, 50), rgb(255, 140, 30), rgb(255, 245, 180) },
		Sparkles = 22,
		SparkleColours = ColorSequence.new(rgb(255, 250, 200), rgb(255, 170, 30)),
		Fire = { rgb(255, 150, 30), rgb(255, 230, 90) },
		Shine = 0.4,
		Glow = rgb(255, 190, 60),
	},
	TungTungTungDiamante = {
		Squares = 16,
		SquareColours = { rgb(120, 225, 255), rgb(200, 245, 255), rgb(90, 170, 255) },
		Sparkles = 26,
		SparkleColours = ColorSequence.new(rgb(255, 255, 255), rgb(110, 220, 255)),
		Fire = { rgb(80, 200, 255), rgb(220, 250, 255) },
		Shine = 0.45,
		Glow = rgb(120, 220, 255),
	},
}

for _, flair in Flair do
	table.freeze(flair)
end

return table.freeze(Flair)

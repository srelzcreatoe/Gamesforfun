-- Shared helpers and colors for the client UI.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Config"))

local UI = {}

UI.FONT = Enum.Font.GothamBold
UI.RED = Config.MonsterEyeColor
UI.WHITE = Color3.new(1, 1, 1)
UI.BLACK = Color3.new(0, 0, 0)

-- Instance.new with properties; Parent is set last.
function UI.create(className: string, properties: { [string]: any }): any
	local instance = Instance.new(className)
	local parent = properties.Parent
	properties.Parent = nil
	for key, value in properties do
		(instance :: any)[key] = value
	end
	instance.Parent = parent
	return instance
end

function UI.round(parent: Instance, radius: number?)
	UI.create("UICorner", { CornerRadius = UDim.new(0, radius or 8), Parent = parent })
end

-- A rounded text button.
function UI.button(parent: Instance, text: string, properties: { [string]: any }?): TextButton
	local props = properties or {}
	props.Parent = parent
	props.Text = text
	props.Font = props.Font or UI.FONT
	props.TextSize = props.TextSize or 16
	props.TextColor3 = props.TextColor3 or UI.WHITE
	props.BackgroundColor3 = props.BackgroundColor3 or Color3.fromRGB(50, 50, 60)
	local button = UI.create("TextButton", props)
	UI.round(button, 6)
	return button
end

return UI

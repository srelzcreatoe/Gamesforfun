--!strict
--[[
	UIKit (client only)

	The building blocks of every menu, so they all look the same: chunky
	glossy buttons with a thick black outline that bounce when you touch them,
	outlined FredokaOne text, rounded panels, the big square side buttons with
	a wiggling Higgsfield icon, and pop-up windows (only one open at a time,
	whichever script made it).
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local AssetLoader = require(script.Parent:WaitForChild("AssetLoader"))
local BrainrotConfig = require(script.Parent:WaitForChild("BrainrotConfig"))
local NumberFormat = require(script.Parent:WaitForChild("NumberFormat"))
local Sounds = require(script.Parent:WaitForChild("Sounds"))

local UIKit = {}

UIKit.Font = Enum.Font.FredokaOne
UIKit.Colors = table.freeze({
	Panel = Color3.fromRGB(30, 32, 52),
	PanelLight = Color3.fromRGB(48, 52, 82),
	PanelDark = Color3.fromRGB(22, 23, 38),
	Text = Color3.new(1, 1, 1),
	Muted = Color3.fromRGB(190, 196, 225),
	Cash = Color3.fromRGB(80, 255, 110),
	Income = Color3.fromRGB(255, 230, 70),
	Buy = Color3.fromRGB(46, 204, 113),
	Close = Color3.fromRGB(235, 70, 70),
	Disabled = Color3.fromRGB(95, 98, 118),
	Owned = Color3.fromRGB(46, 204, 113),
	Gold = Color3.fromRGB(255, 200, 40),
	Outline = Color3.fromRGB(20, 20, 30),
})

function UIKit.create(className: string, properties: { [string]: any }, children: { Instance }?): Instance
	local instance = Instance.new(className)
	for key, value in properties do
		(instance :: any)[key] = value
	end
	if children then
		for _, child in children do
			child.Parent = instance
		end
	end
	return instance
end
local create = UIKit.create

function UIKit.corner(radius: number): Instance
	return create("UICorner", { CornerRadius = UDim.new(0, radius) })
end

function UIKit.round(): Instance
	return create("UICorner", { CornerRadius = UDim.new(0.5, 0) })
end

function UIKit.stroke(color: Color3, thickness: number): Instance
	return create("UIStroke", { Color = color, Thickness = thickness, ApplyStrokeMode = Enum.ApplyStrokeMode.Border })
end

-- Lighter at the top, like the original's glossy buttons.
function UIKit.gloss(): Instance
	return create("UIGradient", {
		Color = ColorSequence.new(Color3.new(1, 1, 1), Color3.fromRGB(190, 190, 190)),
		Rotation = 90,
	})
end

function UIKit.padding(pixels: number): Instance
	local amount = UDim.new(0, pixels)
	return create("UIPadding", { PaddingLeft = amount, PaddingRight = amount, PaddingTop = amount, PaddingBottom = amount })
end

-- Outlined, auto-scaling text. `OutlineThickness` (not a real property) sets
-- the black outline.
function UIKit.label(properties: { [string]: any }): TextLabel
	local defaults: { [string]: any } = {
		BackgroundTransparency = 1,
		Font = UIKit.Font,
		TextColor3 = UIKit.Colors.Text,
		TextScaled = true,
	}
	for key, value in properties do
		defaults[key] = value
	end
	local outlineThickness = properties.OutlineThickness or 2
	defaults.OutlineThickness = nil
	local textLabel = create("TextLabel", defaults) :: TextLabel
	create("UITextSizeConstraint", { MaxTextSize = properties.TextSize or 32 }).Parent = textLabel
	create("UIStroke", { Color = Color3.new(0, 0, 0), Thickness = outlineThickness }).Parent = textLabel
	return textLabel
end

-- Bigger on hover, squished while pressed, a springy pop when released.
function UIKit.addBounce(target: GuiButton, hoverScale: number)
	local scale = Instance.new("UIScale")
	scale.Parent = target
	local function tweenTo(value: number, seconds: number, style: Enum.EasingStyle)
		TweenService:Create(scale, TweenInfo.new(seconds, style, Enum.EasingDirection.Out), { Scale = value }):Play()
	end
	local hovering = false
	target.MouseEnter:Connect(function()
		hovering = true
		tweenTo(hoverScale, 0.15, Enum.EasingStyle.Back)
	end)
	target.MouseLeave:Connect(function()
		hovering = false
		tweenTo(1, 0.15, Enum.EasingStyle.Quad)
	end)
	target.MouseButton1Down:Connect(function()
		tweenTo(0.88, 0.08, Enum.EasingStyle.Quad)
	end)
	target.MouseButton1Up:Connect(function()
		tweenTo(if hovering then hoverScale else 1, 0.35, Enum.EasingStyle.Elastic)
	end)
	target.Activated:Connect(function()
		scale.Scale = 0.9
		tweenTo(if hovering then hoverScale else 1, 0.4, Enum.EasingStyle.Elastic)
	end)
end

function UIKit.button(text: string, color: Color3, properties: { [string]: any }): TextButton
	local defaults: { [string]: any } = {
		BackgroundColor3 = color,
		AutoButtonColor = true,
		Font = UIKit.Font,
		Text = text,
		TextColor3 = UIKit.Colors.Text,
		TextScaled = true,
	}
	for key, value in properties do
		defaults[key] = value
	end
	local textButton = create("TextButton", defaults, {
		UIKit.corner(10),
		UIKit.stroke(Color3.new(0, 0, 0), 2),
		UIKit.gloss(),
		create("UIPadding", {
			PaddingLeft = UDim.new(0, 8),
			PaddingRight = UDim.new(0, 8),
			PaddingTop = UDim.new(0, 4),
			PaddingBottom = UDim.new(0, 4),
		}),
		create("UITextSizeConstraint", { MaxTextSize = 28 }),
	}) :: TextButton
	textButton.Activated:Connect(function()
		Sounds.play("Click")
	end)
	UIKit.addBounce(textButton, 1.05)
	return textButton
end

-- Greys a button out (or back) without losing its colour.
function UIKit.setEnabled(target: GuiButton, enabled: boolean, color: Color3)
	target.BackgroundColor3 = if enabled then color else UIKit.Colors.Disabled
	target.AutoButtonColor = enabled
end

function UIKit.setImage(imageLabel: ImageLabel, image: EditableImage?): boolean
	if image == nil then
		return false
	end
	imageLabel.ImageContent = Content.fromObject(image)
	imageLabel.Visible = true
	return true
end

-- A progress bar: returns the frame and a function to set it (0..1, text).
function UIKit.progressBar(color: Color3, properties: { [string]: any }): (Frame, (fraction: number, text: string) -> ())
	local back = create("Frame", {
		BackgroundColor3 = UIKit.Colors.PanelDark,
	}, { UIKit.corner(10), UIKit.stroke(Color3.new(0, 0, 0), 2) }) :: Frame
	for key, value in properties do
		(back :: any)[key] = value
	end
	local fill = create("Frame", {
		Name = "Fill",
		Size = UDim2.fromScale(0, 1),
		BackgroundColor3 = color,
	}, { UIKit.corner(10), UIKit.gloss() }) :: Frame
	fill.Parent = back
	local text = UIKit.label({ Name = "Text", Size = UDim2.fromScale(1, 1), Text = "", TextSize = 20, ZIndex = 2 })
	text.Parent = back
	return back, function(fraction: number, value: string)
		fill.Size = UDim2.fromScale(math.clamp(fraction, 0, 1), 1)
		text.Text = value
	end
end

--------------------------------------------------------------------------------
-- Side buttons: big square glossy blocks with a thick outline, a shadow, a
-- bobbing icon and a bold label. A red "!" dot shows when something waits.
--------------------------------------------------------------------------------

UIKit.SideSize = 96
local wiggleIcons: { ImageLabel } = {}

function UIKit.sideColumn(parent: Instance, name: string, count: number, properties: { [string]: any }): Frame
	local column = create("Frame", {
		Name = name,
		Size = UDim2.fromOffset(UIKit.SideSize, count * UIKit.SideSize + (count - 1) * 22),
		BackgroundTransparency = 1,
	}, {
		create("UIListLayout", { Padding = UDim.new(0, 22), SortOrder = Enum.SortOrder.LayoutOrder }),
	}) :: Frame
	for key, value in properties do
		(column :: any)[key] = value
	end
	column.Parent = parent
	return column
end

function UIKit.sideButton(column: Instance, name: string, text: string, color: Color3, iconName: string, order: number, fallback: string?): TextButton
	-- A holder so the shadow and the icon can stick out of the button.
	local holder = create("Frame", {
		Name = name .. "Holder",
		Size = UDim2.fromOffset(UIKit.SideSize, UIKit.SideSize),
		BackgroundTransparency = 1,
		LayoutOrder = order,
	}) :: Frame

	create("Frame", {
		Name = "Shadow",
		Position = UDim2.fromOffset(0, 6),
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Color3.new(0, 0, 0),
		BackgroundTransparency = 0.45,
		ZIndex = 1,
	}, { UIKit.corner(18) }).Parent = holder

	local dark = color:Lerp(Color3.new(0, 0, 0), 0.35)
	local square = create("TextButton", {
		Name = name,
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Color3.new(1, 1, 1),
		AutoButtonColor = false,
		Text = "",
		ZIndex = 2,
	}, {
		UIKit.corner(18),
		create("UIStroke", { Color = UIKit.Colors.Outline, Thickness = 4, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }),
		create("UIGradient", {
			Color = ColorSequence.new({
				ColorSequenceKeypoint.new(0, color:Lerp(Color3.new(1, 1, 1), 0.25)),
				ColorSequenceKeypoint.new(0.55, color),
				ColorSequenceKeypoint.new(1, dark),
			}),
			Rotation = 90,
		}),
	}) :: TextButton

	create("Frame", {
		Name = "Shine",
		Position = UDim2.new(0, 7, 0, 6),
		Size = UDim2.new(1, -14, 0.36, 0),
		BackgroundColor3 = Color3.new(1, 1, 1),
		BackgroundTransparency = 0.72,
		ZIndex = 3,
	}, { UIKit.corner(12) }).Parent = square

	local icon = create("ImageLabel", {
		Name = "Icon",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(0.5, 0, 0.38, 0),
		Size = UDim2.fromOffset(82, 82),
		BackgroundTransparency = 1,
		Rotation = -8,
		ZIndex = 4,
		Visible = false,
	}) :: ImageLabel
	icon.Parent = square
	local hasIcon = UIKit.setImage(icon, AssetLoader.getUIIcon(iconName))
	if hasIcon then
		table.insert(wiggleIcons, icon)
	elseif fallback then
		-- An emoji stands in until the icon is packed.
		UIKit.label({
			Name = "IconText",
			AnchorPoint = Vector2.new(0.5, 0.5),
			Position = UDim2.new(0.5, 0, 0.36, 0),
			Size = UDim2.fromOffset(56, 56),
			Text = fallback,
			TextSize = 50,
			ZIndex = 4,
		}).Parent = square
		hasIcon = true
	end

	UIKit.label({
		Name = "Label",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, 6),
		Size = if hasIcon then UDim2.new(1, 8, 0, 30) else UDim2.new(1, -6, 1, -8),
		Text = text,
		TextSize = if hasIcon then 26 else 30,
		OutlineThickness = 3,
		ZIndex = 5,
	}).Parent = square

	-- The "something's waiting" dot.
	local dot = UIKit.label({
		Name = "Alert",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(1, -6, 0, 6),
		Size = UDim2.fromOffset(30, 30),
		BackgroundTransparency = 0,
		BackgroundColor3 = Color3.fromRGB(235, 40, 60),
		Text = "!",
		TextSize = 24,
		ZIndex = 6,
		Visible = false,
	})
	UIKit.round().Parent = dot
	create("UIStroke", { Color = Color3.new(1, 1, 1), Thickness = 2, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }).Parent = dot
	dot.Parent = square

	square.Activated:Connect(function()
		Sounds.play("Click")
	end)
	UIKit.addBounce(square, 1.1)
	square.Parent = holder
	holder.Parent = column
	return square
end

function UIKit.setAlert(square: GuiObject, on: boolean)
	local dot = square:FindFirstChild("Alert")
	if dot and dot:IsA("GuiObject") then
		dot.Visible = on
	end
end

-- Icons bob and wiggle, each a little out of step; alert dots pulse.
RunService.RenderStepped:Connect(function()
	local t = os.clock()
	for index, icon in wiggleIcons do
		local phase = t * 2.2 + index * 1.3
		icon.Rotation = -8 + math.sin(phase) * 6
		icon.Position = UDim2.new(0.5, 0, 0.38, -3 + math.sin(phase * 1.3) * 3)
	end
end)

--------------------------------------------------------------------------------
-- Windows: one open at a time across every script.
--------------------------------------------------------------------------------

local modals: { Frame } = {}

function UIKit.modal(parent: Instance, name: string, title: string, accent: Color3, size: Vector2): (Frame, Frame)
	local frame = create("Frame", {
		Name = name,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		-- Fills most of a small screen, capped at the design size on large ones.
		Size = UDim2.fromScale(0.92, 0.8),
		BackgroundColor3 = UIKit.Colors.Panel,
		Visible = false,
	}, {
		UIKit.corner(18),
		UIKit.stroke(Color3.new(0, 0, 0), 4),
		create("UISizeConstraint", { MaxSize = size }),
		create("UIAspectRatioConstraint", { AspectRatio = size.X / size.Y }),
	}) :: Frame

	create("Frame", {
		Name = "Header",
		Size = UDim2.new(1, 0, 0, 62),
		BackgroundColor3 = accent,
	}, { UIKit.corner(18), UIKit.gloss() }).Parent = frame

	UIKit.label({
		Name = "Title",
		Position = UDim2.fromOffset(20, 8),
		Size = UDim2.new(1, -90, 0, 46),
		Text = title,
		TextSize = 40,
		TextXAlignment = Enum.TextXAlignment.Left,
		OutlineThickness = 3,
	}).Parent = frame

	local closeButton = UIKit.button("X", UIKit.Colors.Close, {
		Name = "CloseButton",
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -10, 0, 9),
		Size = UDim2.fromOffset(44, 44),
	})
	closeButton.Parent = frame
	closeButton.Activated:Connect(function()
		frame.Visible = false
	end)

	local body = create("Frame", {
		Name = "Body",
		Position = UDim2.fromOffset(16, 74),
		Size = UDim2.new(1, -32, 1, -90),
		BackgroundTransparency = 1,
	}) :: Frame
	body.Parent = frame
	frame.Parent = parent
	table.insert(modals, frame)
	return frame, body
end

-- Opens a window (closing any other) or closes it. Returns true if it opened.
function UIKit.toggleModal(frame: Frame): boolean
	local open = not frame.Visible
	for _, other in modals do
		other.Visible = false
	end
	frame.Visible = open
	if open then
		Sounds.play("Open")
		-- A little pop as it opens.
		local scale = frame:FindFirstChild("PopScale") :: UIScale?
		if scale == nil then
			local newScale = Instance.new("UIScale")
			newScale.Name = "PopScale"
			newScale.Parent = frame
			scale = newScale
		end
		local popScale = scale :: UIScale
		popScale.Scale = 0.85
		TweenService:Create(popScale, TweenInfo.new(0.3, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()
	end
	return open
end

function UIKit.openModal(frame: Frame)
	if not frame.Visible then
		UIKit.toggleModal(frame)
	end
end

-- Tabs across the top of a window body: returns the page frames by name.
function UIKit.tabs(body: Frame, names: { string }, accent: Color3): ({ [string]: Frame }, (name: string) -> ())
	local bar = create("Frame", {
		Name = "Tabs",
		Size = UDim2.new(1, 0, 0, 40),
		BackgroundTransparency = 1,
	}, {
		create("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			Padding = UDim.new(0, 8),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	}) :: Frame
	bar.Parent = body
	local pages: { [string]: Frame } = {}
	local buttons: { [string]: TextButton } = {}
	local function select(name: string)
		for pageName, page in pages do
			page.Visible = pageName == name
			buttons[pageName].BackgroundColor3 = if pageName == name then accent else UIKit.Colors.PanelLight
		end
	end
	for order, name in names do
		local tab = UIKit.button(name, UIKit.Colors.PanelLight, {
			Name = name .. "Tab",
			Size = UDim2.new(1 / #names, -8, 1, 0),
			LayoutOrder = order,
		})
		tab.Parent = bar
		buttons[name] = tab
		local page = create("Frame", {
			Name = name,
			Position = UDim2.fromOffset(0, 50),
			Size = UDim2.new(1, 0, 1, -50),
			BackgroundTransparency = 1,
			Visible = false,
		}) :: Frame
		page.Parent = body
		pages[name] = page
		tab.Activated:Connect(function()
			select(name)
		end)
	end
	select(names[1])
	return pages, select
end

-- Confetti bursting from a point on the screen (0..1 each way).
function UIKit.confetti(parent: Instance, origin: Vector2, count: number)
	for _ = 1, count do
		local piece = create("Frame", {
			AnchorPoint = Vector2.new(0.5, 0.5),
			Position = UDim2.fromScale(origin.X, origin.Y),
			Size = UDim2.fromOffset(math.random(8, 14), math.random(12, 20)),
			BackgroundColor3 = Color3.fromHSV(math.random(), 0.8, 1),
			Rotation = math.random(0, 360),
			ZIndex = 50,
		}) :: Frame
		piece.Parent = parent
		local angle = math.random() * math.pi * 2
		local distance = 0.15 + math.random() * 0.35
		local target = UDim2.fromScale(origin.X + math.cos(angle) * distance, origin.Y + math.sin(angle) * distance + 0.25)
		local tween = TweenService:Create(piece, TweenInfo.new(1.2 + math.random() * 0.8, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
			Position = target,
			Rotation = piece.Rotation + math.random(-360, 360),
			BackgroundTransparency = 1,
		})
		tween.Completed:Connect(function()
			piece:Destroy()
		end)
		tween:Play()
	end
end

--------------------------------------------------------------------------------
-- Pop-up messages: GameClient shows them; any script can ask.
--------------------------------------------------------------------------------

local toastHandler: ((message: string, kind: string) -> ())? = nil

function UIKit.setToastHandler(handler: (message: string, kind: string) -> ())
	toastHandler = handler
end

function UIKit.toast(message: string, kind: string)
	local handler = toastHandler
	if handler then
		handler(message, kind)
	end
end

--------------------------------------------------------------------------------
-- Small screens: shrinks HUD pieces (not the windows, which fit themselves).
--------------------------------------------------------------------------------

function UIKit.autoScale(target: GuiObject, designHeight: number?)
	local scale = Instance.new("UIScale")
	scale.Name = "ScreenScale"
	scale.Parent = target
	local function update()
		local camera = Workspace.CurrentCamera
		local size = if camera then camera.ViewportSize else nil
		local viewport = if typeof(size) == "Vector2" then size else Vector2.new(1280, 760)
		if viewport.Y <= 1 then
			return
		end
		scale.Scale = math.clamp(math.min(viewport.Y / (designHeight or 760), viewport.X / 1280), 0.5, 1)
	end
	update()
	local camera = Workspace.CurrentCamera
	if camera then
		camera:GetPropertyChangedSignal("ViewportSize"):Connect(update)
	end
end

--------------------------------------------------------------------------------
-- Brainrot pictures: a still 3D model in a ViewportFrame.
--------------------------------------------------------------------------------

-- A lucky block for previews: a cube with "?" marks is too fiddly in a
-- viewport, so a coloured cube with glowing edges.
local function luckyBlockModel(definition: BrainrotConfig.Brainrot, height: number): Model
	local model = Instance.new("Model")
	local cube = Instance.new("Part")
	cube.Size = Vector3.one * height * 0.8
	cube.Color = definition.BodyColor
	cube.Material = Enum.Material.SmoothPlastic
	cube.Anchored = true
	cube.CFrame = CFrame.identity
	cube.Parent = model
	for _, axis in { Vector3.xAxis, Vector3.yAxis, Vector3.zAxis } do
		local band = Instance.new("Part")
		band.Size = (Vector3.one - axis * 0.9) * height * 0.82
		band.Color = definition.AccentColor
		band.Material = Enum.Material.Neon
		band.Anchored = true
		band.Transparency = 0.2
		band.CFrame = CFrame.identity
		band.Parent = model
	end
	model.PrimaryPart = cube
	return model
end

-- A still copy of a brainrot, `height` studs tall and centred on the origin:
-- its imported model if there is one, else the blocky model.
function UIKit.previewModel(brainrotId: string, height: number): Model?
	local definition = BrainrotConfig.ById[brainrotId]
	if definition and BrainrotConfig.isLuckyBlock(definition) then
		return luckyBlockModel(definition, height)
	end
	local templates = ReplicatedStorage:FindFirstChild("BrainrotModels")
	local template = if templates then templates:FindFirstChild(brainrotId) else nil
	if template and template:IsA("Model") and #template:GetChildren() > 0 then
		local clone = template:Clone()
		local scale = height / math.max(tonumber(template:GetAttribute("Height")) or 1, 0.01)
		for _, part in clone:GetDescendants() do
			if part:IsA("BasePart") then
				local rest = part.CFrame
				part.Size *= scale
				part.CFrame = CFrame.new(rest.Position * scale - Vector3.new(0, height / 2, 0)) * rest.Rotation
				part.Anchored = true
			end
		end
		clone.WorldPivot = CFrame.identity
		return clone
	end
	return AssetLoader.createBrainrotModel(brainrotId, nil, height)
end

-- A ViewportFrame showing a brainrot (filled in the background).
function UIKit.brainrotViewport(brainrotId: string, background: Color3, properties: { [string]: any }): ViewportFrame
	local viewport = create("ViewportFrame", {
		BackgroundColor3 = background,
		Ambient = Color3.fromRGB(200, 200, 200),
		LightColor = Color3.new(1, 1, 1),
		LightDirection = Vector3.new(-0.4, -1, 0.6),
	}, { UIKit.corner(10) }) :: ViewportFrame
	for key, value in properties do
		(viewport :: any)[key] = value
	end
	task.spawn(function()
		local model = UIKit.previewModel(brainrotId, 4)
		if model == nil or viewport.Parent == nil then
			return
		end
		model.Parent = viewport
		local camera = Instance.new("Camera")
		camera.FieldOfView = 40
		camera.CFrame = CFrame.lookAt(Vector3.new(0, 0.6, -8.5), Vector3.zero)
		camera.Parent = viewport
		viewport.CurrentCamera = camera
	end)
	return viewport
end

-- A card for a brainrot entry ("Id:Mutation:Trait"): picture, name, rarity
-- and income. Returns the card as a button.
function UIKit.brainrotCard(entry: string, properties: { [string]: any }): TextButton
	local definition, mutation, trait = BrainrotConfig.decode(entry)
	local rarity = if definition then BrainrotConfig.RarityByName[definition.Rarity] else nil
	local rarityColour = if rarity then rarity.Color else Color3.new(1, 1, 1)
	local card = create("TextButton", {
		Name = "Card",
		BackgroundColor3 = UIKit.Colors.PanelLight,
		AutoButtonColor = true,
		Text = "",
	}, { UIKit.corner(12), UIKit.stroke(if mutation then mutation.Color else rarityColour, 3) }) :: TextButton
	for key, value in properties do
		(card :: any)[key] = value
	end
	if definition then
		UIKit.brainrotViewport(definition.Id, rarityColour:Lerp(Color3.new(0, 0, 0), 0.55), {
			Name = "Preview",
			Position = UDim2.new(0, 6, 0, 6),
			Size = UDim2.new(1, -12, 0.52, 0),
		}).Parent = card
		UIKit.label({
			Name = "BrainrotName",
			Position = UDim2.new(0, 4, 0.56, 0),
			Size = UDim2.new(1, -8, 0.15, 0),
			Text = BrainrotConfig.fullName(definition, mutation, trait),
			TextSize = 18,
		}).Parent = card
		UIKit.label({
			Name = "Rarity",
			Position = UDim2.new(0, 4, 0.71, 0),
			Size = UDim2.new(1, -8, 0.13, 0),
			Text = definition.Rarity,
			TextColor3 = rarityColour,
			TextSize = 16,
		}).Parent = card
		local income = definition.IncomePerSecond * BrainrotConfig.multiplier(mutation, trait)
		UIKit.label({
			Name = "Income",
			Position = UDim2.new(0, 4, 0.84, 0),
			Size = UDim2.new(1, -8, 0.13, 0),
			Text = if BrainrotConfig.isLuckyBlock(definition) then "Lucky Block" else NumberFormat.cash(income) .. "/s",
			TextColor3 = UIKit.Colors.Income,
			TextSize = 16,
		}).Parent = card
	end
	return card
end

return UIKit

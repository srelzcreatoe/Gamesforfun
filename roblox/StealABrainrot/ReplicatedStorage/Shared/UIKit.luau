--!strict
--[[
	UIKit (client only)

	The building blocks of every menu, so they all look the same: chunky
	glossy buttons with a thick black outline that bounce when you touch them,
	outlined FredokaOne text, rounded panels, the big square side buttons with
	a wiggling Higgsfield icon, and pop-up windows (only one open at a time,
	whichever script made it).
]]

local AssetService = game:GetService("AssetService")
local ContextActionService = game:GetService("ContextActionService")
local GuiService = game:GetService("GuiService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
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
UIKit.SideGap = 22

-- Pixels the side columns keep clear: Roblox's top bar and the Cash, income
-- and boost labels at the bottom.
local SIDE_RESERVED_HEIGHT = 230
local SIDE_CENTRE_OFFSET = -69
local SIDE_COLUMN_HEIGHT = 3 * UIKit.SideSize + 2 * UIKit.SideGap

-- How much the side columns are scaled down on this screen.
local function sideFactor(viewport: Vector2): number
	return math.clamp(math.min((viewport.Y - SIDE_RESERVED_HEIGHT) / SIDE_COLUMN_HEIGHT, viewport.X / 1280), 0.5, 1)
end
local wiggleIcons: { ImageLabel } = {}

function UIKit.sideColumn(parent: Instance, name: string, count: number, properties: { [string]: any }): Frame
	local column = create("Frame", {
		Name = name,
		Size = UDim2.fromOffset(UIKit.SideSize, count * UIKit.SideSize + (count - 1) * UIKit.SideGap),
		BackgroundTransparency = 1,
	}, {
		create("UIListLayout", { Padding = UDim.new(0, UIKit.SideGap), SortOrder = Enum.SortOrder.LayoutOrder }),
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

	-- The label stays inside the button (long words shrink to fit).
	UIKit.label({
		Name = "Label",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, 4),
		Size = if hasIcon then UDim2.new(1, -10, 0, 28) else UDim2.new(1, -10, 1, -8),
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

-- Controllers: when a window opens, a button in it is selected (see
-- setDefaultSelection) so the D-pad or stick moves between its buttons, B
-- closes it, and the selection goes back where it was.
local defaultSelections: { [Frame]: GuiObject } = {}
local selectedBefore: { [Frame]: GuiObject? } = {}
local CLOSE_ACTION = "UIKitCloseWindow"

local function usingGamepad(): boolean
	return string.find(UserInputService:GetLastInputType().Name, "Gamepad", 1, true) ~= nil
end

local function isShown(target: GuiObject): boolean
	local node: Instance? = target
	while node and node:IsA("GuiObject") do
		if not node.Visible then
			return false
		end
		node = node.Parent
	end
	return target.Parent ~= nil
end

local function firstSelection(frame: Frame): GuiObject?
	local chosen = defaultSelections[frame]
	if chosen and chosen:IsDescendantOf(frame) and isShown(chosen) then
		return chosen
	end
	for _, descendant in frame:GetDescendants() do
		if descendant:IsA("GuiButton") and descendant.Name ~= "CloseButton" and descendant.Selectable and isShown(descendant) then
			return descendant
		end
	end
	return frame:FindFirstChild("CloseButton") :: GuiObject?
end

local function closeTopWindow(_action: string, state: Enum.UserInputState, _input: any): Enum.ContextActionResult
	if state ~= Enum.UserInputState.Begin then
		return Enum.ContextActionResult.Pass
	end
	for _, frame in modals do
		if frame.Visible then
			frame.Visible = false
			return Enum.ContextActionResult.Sink
		end
	end
	return Enum.ContextActionResult.Pass
end

local function onModalVisibility(frame: Frame)
	if frame.Visible then
		if usingGamepad() then
			selectedBefore[frame] = GuiService.SelectedObject
			GuiService.SelectedObject = firstSelection(frame)
		end
	else
		local selected = GuiService.SelectedObject
		if selected and selected:IsDescendantOf(frame) then
			local before = selectedBefore[frame]
			GuiService.SelectedObject = if before and isShown(before) then before else nil
		end
		selectedBefore[frame] = nil
	end
	local anyOpen = false
	for _, other in modals do
		anyOpen = anyOpen or other.Visible
	end
	if anyOpen then
		ContextActionService:BindActionAtPriority(CLOSE_ACTION, closeTopWindow, false, Enum.ContextActionPriority.High.Value, Enum.KeyCode.ButtonB)
	else
		ContextActionService:UnbindAction(CLOSE_ACTION)
	end
end

-- The button a controller starts on when this window opens.
function UIKit.setDefaultSelection(frame: Frame, target: GuiObject)
	defaultSelections[frame] = target
end

-- The outline round whatever a controller has selected (set it as the
-- PlayerGui's SelectionImageObject).
function UIKit.selectionHighlight(): Frame
	return create("Frame", {
		Name = "SelectionHighlight",
		Size = UDim2.new(1, 8, 1, 8),
		Position = UDim2.fromOffset(-4, -4),
		BackgroundTransparency = 1,
	}, {
		UIKit.corner(12),
		create("UIStroke", { Color = Color3.fromRGB(255, 230, 60), Thickness = 4, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }),
	}) :: Frame
end

-- Windows are always laid out at their design size and scaled down as a
-- whole to fit the screen, so everything in them fits on any screen.
-- Roblox's top bar takes this much of the screen.
local TOP_BAR_HEIGHT = 58

local function viewportSize(): Vector2
	local camera = Workspace.CurrentCamera
	local size = if camera then camera.ViewportSize else nil
	return if typeof(size) == "Vector2" and size.Y > 1 then size else Vector2.new(1280, 760)
end

-- Windows fit between the two pairs of side button columns (which would
-- otherwise cover their edges) and under Roblox's top bar.
local function fitScale(frame: Frame): number
	local viewport = viewportSize()
	local size = frame.Size
	local sides = 16 + (2 * UIKit.SideSize + 20) * sideFactor(viewport) + 12
	local width = viewport.X - 2 * sides
	return math.min(1, width / size.X.Offset, (viewport.Y - TOP_BAR_HEIGHT) * 0.92 / size.Y.Offset)
end

local function refit(frame: Frame)
	local scale = frame:FindFirstChild("FitScale") :: UIScale?
	if scale then
		scale.Scale = fitScale(frame)
	end
end

function UIKit.modal(parent: Instance, name: string, title: string, accent: Color3, size: Vector2): (Frame, Frame)
	local frame = create("Frame", {
		Name = name,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(size.X, size.Y),
		BackgroundColor3 = UIKit.Colors.Panel,
		Visible = false,
	}, {
		UIKit.corner(18),
		UIKit.stroke(Color3.new(0, 0, 0), 4),
		create("UIScale", { Name = "FitScale" }),
	}) :: Frame
	refit(frame)

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
	frame:GetPropertyChangedSignal("Visible"):Connect(function()
		onModalVisibility(frame)
	end)
	return frame, body
end

-- Opens a window (closing any other) or closes it. Returns true if it opened.
function UIKit.toggleModal(frame: Frame): boolean
	local open = not frame.Visible
	for _, other in modals do
		other.Visible = false
	end
	frame.Visible = open
	local scale = frame:FindFirstChild("FitScale") :: UIScale?
	if open and scale then
		Sounds.play("Open")
		-- A little pop as it opens.
		local target = fitScale(frame)
		scale.Scale = target * 0.85
		TweenService:Create(scale, TweenInfo.new(0.3, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = target }):Play()
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

-- Places a column of side buttons: as big as fits between the top bar and
-- the Cash in the bottom-left corner (never covering it), and a little above
-- the middle of the screen. `slot` 0 is at the screen edge, 1 next to it.
-- Every column is placed as if it had three buttons, so all of them are the
-- same size and a shorter one lines up with the top buttons of the others.
function UIKit.placeSideColumn(column: Frame, onRight: boolean, slot: number)
	local scale = Instance.new("UIScale")
	scale.Name = "ScreenScale"
	scale.Parent = column
	local function update()
		local camera = Workspace.CurrentCamera
		local size = if camera then camera.ViewportSize else nil
		local viewport = if typeof(size) == "Vector2" then size else Vector2.new(1280, 760)
		if viewport.Y <= 1 then
			return
		end
		local factor = sideFactor(viewport)
		scale.Scale = factor
		local x = 16 + slot * (UIKit.SideSize + 20) * factor
		local top = SIDE_CENTRE_OFFSET - SIDE_COLUMN_HEIGHT * factor / 2
		column.AnchorPoint = Vector2.new(if onRight then 1 else 0, 0)
		column.Position = if onRight then UDim2.new(1, -x, 0.5, top) else UDim2.new(0, x, 0.5, top)
	end
	update()
	local camera = Workspace.CurrentCamera
	if camera then
		camera:GetPropertyChangedSignal("ViewportSize"):Connect(update)
	end
end

-- Grid cells for `columns` columns that exactly fill a scrolling list
-- `width` pixels wide (clear of its scroll bar), with `gap` between them.
function UIKit.gridCells(width: number, columns: number, gap: number, scrollBar: number): number
	return math.floor((width - scrollBar - 4 - (columns - 1) * gap) / columns)
end

-- The room a window has on screen (between the side buttons, under the top
-- bar), in pixels.
function UIKit.windowArea(): Vector2
	local viewport = viewportSize()
	local sides = 16 + (2 * UIKit.SideSize + 20) * sideFactor(viewport) + 12
	return Vector2.new(viewport.X - 2 * sides, (viewport.Y - TOP_BAR_HEIGHT) * 0.92)
end

-- A window that takes the room the screen has rather than shrinking a fixed
-- design: on a phone it keeps its text and buttons big (at least `minScale`)
-- and gets narrower (fewer columns) instead. `onResize` gets its new design
-- size whenever the screen changes.
function UIKit.fillScreen(frame: Frame, maxSize: Vector2, minSize: Vector2, minScale: number, onResize: (Vector2) -> ())
	local function update()
		local area = UIKit.windowArea()
		local scale = math.clamp(area.Y / 560, minScale, 1)
		local size = Vector2.new(math.clamp(area.X / scale, minSize.X, maxSize.X), math.clamp(area.Y / scale, minSize.Y, maxSize.Y))
		UIKit.resizeModal(frame, Vector2.new(math.floor(size.X), math.floor(size.Y)))
		onResize(Vector2.new(frame.Size.X.Offset, frame.Size.Y.Offset))
	end
	update()
	local camera = Workspace.CurrentCamera
	if camera then
		camera:GetPropertyChangedSignal("ViewportSize"):Connect(update)
	end
end

-- Changes a window's design size (see UIKit.modal), e.g. to fit its content.
function UIKit.resizeModal(frame: Frame, size: Vector2)
	frame.Size = UDim2.fromOffset(size.X, size.Y)
	refit(frame)
end

-- The size of a window's Body at its design size.
function UIKit.bodySize(frame: Frame): Vector2
	return Vector2.new(frame.Size.X.Offset - 32, frame.Size.Y.Offset - 90)
end

-- Windows follow the screen size.
do
	local function refitAll()
		for _, frame in modals do
			refit(frame)
		end
	end
	local camera = Workspace.CurrentCamera
	if camera then
		camera:GetPropertyChangedSignal("ViewportSize"):Connect(refitAll)
	end
	Workspace:GetPropertyChangedSignal("CurrentCamera"):Connect(function()
		local newCamera = Workspace.CurrentCamera
		if newCamera then
			newCamera:GetPropertyChangedSignal("ViewportSize"):Connect(refitAll)
			refitAll()
		end
	end)
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
	-- Deferred until whoever asked for it has put it in place: an imported
	-- model is copied without waiting, and this used to give up on a viewport
	-- that wasn't in anything yet (so the shop's pictures stayed empty).
	task.defer(function()
		if viewport.Parent == nil then
			return
		end
		local model = UIKit.previewModel(brainrotId, 4)
		if model == nil then
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

--------------------------------------------------------------------------------
-- The shop look, like Grow a Garden's: wooden windows with a studded green
-- title bar, a square red close button and green Robux buttons. The studs and
-- the Robux sign are drawn in code, so nothing has to be uploaded.
--------------------------------------------------------------------------------

UIKit.Garden = table.freeze({
	Wood = Color3.fromRGB(141, 90, 46),
	WoodDark = Color3.fromRGB(99, 60, 28),
	WoodEdge = Color3.fromRGB(56, 32, 14),
	Tile = Color3.fromRGB(122, 77, 38),
	Green = Color3.fromRGB(98, 191, 63),
	GreenEdge = Color3.fromRGB(46, 110, 28),
	Buy = Color3.fromRGB(64, 205, 64),
	BuyEdge = Color3.fromRGB(24, 105, 24),
	Close = Color3.fromRGB(228, 46, 40),
	CloseEdge = Color3.fromRGB(110, 12, 10),
})

-- A small picture drawn pixel by pixel; nil where the game can't make one.
local function drawImage(size: number, shade: (x: number, y: number) -> (number, number, number, number)): EditableImage?
	local ok, image = pcall(function(): EditableImage?
		return AssetService:CreateEditableImage({ Size = Vector2.new(size, size) })
	end)
	if not ok or image == nil then
		return nil
	end
	local pixels = buffer.create(size * size * 4)
	for y = 0, size - 1 do
		for x = 0, size - 1 do
			local r, g, b, a = shade(x + 0.5, y + 0.5)
			local offset = (y * size + x) * 4
			buffer.writeu8(pixels, offset, r)
			buffer.writeu8(pixels, offset + 1, g)
			buffer.writeu8(pixels, offset + 2, b)
			buffer.writeu8(pixels, offset + 3, a)
		end
	end
	local written = pcall(function()
		image:WritePixelsBuffer(Vector2.zero, Vector2.new(size, size), pixels)
	end)
	return if written then image else nil
end

local drawn: { [string]: EditableImage } = {}
local drawnTried: { [string]: boolean } = {}
local function drawnOnce(name: string, size: number, shade: (x: number, y: number) -> (number, number, number, number)): EditableImage?
	if not drawnTried[name] then
		drawnTried[name] = true
		local image = drawImage(size, shade)
		if image then
			drawn[name] = image
		end
	end
	return drawn[name]
end

-- One Lego stud, lit from the top left, with its shadow.
function UIKit.studTexture(): EditableImage?
	return drawnOnce("Stud", 32, function(x: number, y: number): (number, number, number, number)
		local dx, dy = x - 15, y - 15
		local distance = math.sqrt(dx * dx + dy * dy)
		if distance <= 9 then
			if distance > 8 then
				return 0, 0, 0, 60
			end
			local light = -(dx + dy) / 12.7
			if light > 0 then
				return 255, 255, 255, math.floor(70 + 110 * light)
			end
			return 0, 0, 0, math.floor(-light * 70)
		end
		local sx, sy = x - 16.5, y - 16.5
		if math.sqrt(sx * sx + sy * sy) <= 9 then
			return 0, 0, 0, 70
		end
		return 0, 0, 0, 0
	end)
end

-- Tiles studs over a panel, under whatever is in it.
function UIKit.addStuds(target: GuiObject, tile: number, transparency: number)
	local image = UIKit.studTexture()
	if image == nil then
		return
	end
	local layer = create("ImageLabel", {
		Name = "Studs",
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		ScaleType = Enum.ScaleType.Tile,
		TileSize = UDim2.fromOffset(tile, tile),
		ImageTransparency = transparency,
		ZIndex = 0,
	}) :: ImageLabel
	local round = target:FindFirstChildOfClass("UICorner")
	if round then
		round:Clone().Parent = layer
	end
	UIKit.setImage(layer, image)
	layer.Parent = target
end

local function insideHexagon(x: number, y: number, radius: number): boolean
	local ax, ay = math.abs(x), math.abs(y)
	return ax <= radius * 0.866 and ay <= radius - ax * 0.57735
end

-- The Robux sign: a hexagon ring round a square.
function UIKit.robuxIcon(): EditableImage?
	return drawnOnce("Robux", 48, function(x: number, y: number): (number, number, number, number)
		local covered = 0
		for sy = 0, 2 do
			for sx = 0, 2 do
				local px, py = x - 24 + (sx - 1) / 3, y - 24 + (sy - 1) / 3
				local square = math.abs(px) <= 6 and math.abs(py) <= 6
				if square or (insideHexagon(px, py, 21) and not insideHexagon(px, py, 14.5)) then
					covered += 1
				end
			end
		end
		return 255, 255, 255, math.floor(covered / 9 * 255 + 0.5)
	end)
end

-- A green buy button showing the Robux sign and a price. Returns it and a
-- function to change what it says (`robux` false: plain text like OWNED).
function UIKit.robuxButton(properties: { [string]: any }): (TextButton, (text: string, robux: boolean) -> ())
	local garden = UIKit.Garden
	local target = UIKit.button("", garden.Buy, properties)
	local edge = target:FindFirstChildOfClass("UIStroke")
	if edge then
		edge.Color = garden.BuyEdge
		edge.Thickness = 3
	end
	local row = create("Frame", {
		Name = "Content",
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
	}, {
		create("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			HorizontalAlignment = Enum.HorizontalAlignment.Center,
			VerticalAlignment = Enum.VerticalAlignment.Center,
			Padding = UDim.new(0, 4),
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	}) :: Frame
	local icon = create("ImageLabel", {
		Name = "RobuxIcon",
		Size = UDim2.fromScale(0.72, 0.72),
		SizeConstraint = Enum.SizeConstraint.RelativeYY,
		BackgroundTransparency = 1,
		LayoutOrder = 1,
		Visible = false,
	}) :: ImageLabel
	local image = UIKit.robuxIcon()
	icon.Parent = row
	local price = UIKit.label({
		Name = "Price",
		Size = UDim2.fromScale(1, 1),
		Text = "",
		TextSize = 30,
		LayoutOrder = 2,
		OutlineThickness = 2,
	})
	price.Parent = row
	row.Parent = target
	local function set(text: string, robux: boolean)
		local withIcon = robux and image ~= nil
		if withIcon and image then
			UIKit.setImage(icon, image)
		end
		icon.Visible = withIcon
		price.Text = if robux and not withIcon then "R$ " .. text else text
		price.TextXAlignment = if withIcon then Enum.TextXAlignment.Left else Enum.TextXAlignment.Center
		price.Size = UDim2.fromScale(if withIcon then math.clamp(#text * 0.11, 0.3, 0.66) else 1, 1)
	end
	set("BUY", false)
	return target, set
end

-- Dresses a window (from UIKit.modal) as a wooden one with a studded green
-- title bar and a square red close button.
function UIKit.gardenStyle(frame: Frame)
	local garden = UIKit.Garden
	frame.BackgroundColor3 = garden.Wood
	local round = frame:FindFirstChildOfClass("UICorner")
	if round then
		round.CornerRadius = UDim.new(0, 12)
	end
	local edge = frame:FindFirstChildOfClass("UIStroke")
	if edge then
		edge.Color = garden.WoodEdge
		edge.Thickness = 5
	end
	UIKit.addStuds(frame, 34, 0.86)
	local header = frame:FindFirstChild("Header")
	if header and header:IsA("Frame") then
		header.BackgroundColor3 = garden.Green
		local headerRound = header:FindFirstChildOfClass("UICorner")
		if headerRound then
			headerRound.CornerRadius = UDim.new(0, 12)
		end
		-- Square bottom corners and a dark edge under the bar.
		create("Frame", {
			Name = "Base",
			AnchorPoint = Vector2.new(0, 1),
			Position = UDim2.fromScale(0, 1),
			Size = UDim2.new(1, 0, 0, 14),
			BackgroundColor3 = garden.Green:Lerp(Color3.new(0, 0, 0), 0.22),
			BorderSizePixel = 0,
		}).Parent = header
		create("Frame", {
			Name = "Edge",
			Position = UDim2.fromScale(0, 1),
			Size = UDim2.new(1, 0, 0, 4),
			BackgroundColor3 = garden.GreenEdge,
			BorderSizePixel = 0,
		}).Parent = header
		UIKit.addStuds(header, 26, 0.5)
	end
	local title = frame:FindFirstChild("Title")
	if title and title:IsA("TextLabel") then
		local outline = title:FindFirstChildOfClass("UIStroke")
		if outline then
			outline.Thickness = 4
			outline.Color = Color3.fromRGB(30, 60, 20)
		end
	end
	local close = frame:FindFirstChild("CloseButton")
	if close and close:IsA("TextButton") then
		close.BackgroundColor3 = garden.Close
		local closeRound = close:FindFirstChildOfClass("UICorner")
		if closeRound then
			closeRound.CornerRadius = UDim.new(0, 6)
		end
		local closeEdge = close:FindFirstChildOfClass("UIStroke")
		if closeEdge then
			closeEdge.Color = garden.CloseEdge
			closeEdge.Thickness = 3
		end
	end
end

return UIKit

--!strict
--[[
	StudioNotice
	Location: StarterPlayerScripts (LocalScript)

	Only in Studio: a banner when brainrots made on Customuse or Higgsfield
	have no imported model. Without it the game builds a rough copy from
	blocks, which looks mushy. GameplayManager counts them into the
	ReplicatedStorage attribute ModelsNotImported. Players never see this.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

if not RunService:IsStudio() then
	return
end

local player = Players.LocalPlayer
local banner: TextButton? = nil

local function show()
	local count = tonumber(ReplicatedStorage:GetAttribute("ModelsNotImported")) or 0
	if count <= 0 then
		if banner then
			banner:Destroy()
			banner = nil
		end
		return
	end
	if banner == nil then
		local gui = Instance.new("ScreenGui")
		gui.Name = "StudioNotice"
		gui.DisplayOrder = 40
		gui.ResetOnSpawn = false
		gui.IgnoreGuiInset = true
		local button = Instance.new("TextButton")
		button.Name = "Banner"
		button.AnchorPoint = Vector2.new(0.5, 0)
		button.Position = UDim2.new(0.5, 0, 0, 64)
		button.Size = UDim2.new(0.7, 0, 0, 78)
		button.BackgroundColor3 = Color3.fromRGB(255, 214, 64)
		button.AutoButtonColor = false
		button.Font = Enum.Font.FredokaOne
		button.TextColor3 = Color3.fromRGB(40, 24, 10)
		button.TextScaled = true
		button.TextWrapped = true
		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, 12)
		corner.Parent = button
		local stroke = Instance.new("UIStroke")
		stroke.Thickness = 3
		stroke.Color = Color3.fromRGB(40, 24, 10)
		stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
		stroke.Parent = button
		local padding = Instance.new("UIPadding")
		padding.PaddingLeft = UDim.new(0, 14)
		padding.PaddingRight = UDim.new(0, 14)
		padding.PaddingTop = UDim.new(0, 6)
		padding.PaddingBottom = UDim.new(0, 6)
		padding.Parent = button
		local size = Instance.new("UISizeConstraint")
		size.MaxSize = Vector2.new(980, 78)
		size.Parent = button
		local textSize = Instance.new("UITextSizeConstraint")
		textSize.MaxTextSize = 22
		textSize.Parent = button
		button.Activated:Connect(function()
			gui:Destroy()
		end)
		button.Parent = gui
		gui.Parent = player:WaitForChild("PlayerGui")
		banner = button
	end
	local current = banner
	if current then
		current.Text = string.format(
			"⚠️ %d brainrots aren't imported, so they look blocky and mushy. Fix: File → Import 3D → BrainrotModels/Import/BrainrotModels.glb, File → Save, play again. (Only you see this, in Studio. Click to hide.)",
			count
		)
	end
end

ReplicatedStorage:GetAttributeChangedSignal("ModelsNotImported"):Connect(show)
show()

--!strict
--[[
	BrainrotVisuals
	Location: StarterPlayer.StarterPlayerScripts (LocalScript)

	The server builds every brainrot as a simple block figure. On this client,
	each one is swapped for its Higgsfield 3D model (rebuilt by AssetLoader). If a
	model can't be built, the block figure simply stays visible.

	The 3D model is welded to the brainrot's Root, so it follows the conveyor,
	walks to its pedestal and rides on a thief's head like the figure does.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local AssetLoader = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("AssetLoader"))

local MODEL_NAME = "HiggsfieldModel"

local map = Workspace:WaitForChild("Map")
local brainrotsFolder = map:WaitForChild("Brainrots")

local function attachModel(instance: Instance)
	if not instance:IsA("Model") or instance:GetAttribute("CustomModel") == true then
		return
	end
	local brainrotId = instance:GetAttribute("BrainrotId")
	local height = instance:GetAttribute("FigureHeight")
	if typeof(brainrotId) ~= "string" or typeof(height) ~= "number" or instance:FindFirstChild(MODEL_NAME) then
		return
	end
	local root = instance:WaitForChild("Root", 10)
	if root == nil or not root:IsA("BasePart") then
		return
	end

	local part = AssetLoader.createBrainrotPart(brainrotId, height)
	if part == nil then
		return
	end
	if instance.Parent == nil or root.Parent ~= instance then
		part:Destroy()
		return
	end

	part.Name = MODEL_NAME
	part.CFrame = root.CFrame * CFrame.new(0, height / 2, 0)
	part.Anchored = false
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Massless = true

	local weld = Instance.new("WeldConstraint")
	weld.Part0 = root
	weld.Part1 = part
	weld.Parent = part
	part.Parent = instance

	-- Hide the block figure on this client only.
	for _, descendant in instance:GetDescendants() do
		if descendant:IsA("BasePart") and descendant ~= root and descendant ~= part then
			descendant.LocalTransparencyModifier = 1
		end
	end
end

brainrotsFolder.ChildAdded:Connect(function(child: Instance)
	task.spawn(attachModel, child)
end)
for _, child in brainrotsFolder:GetChildren() do
	task.spawn(attachModel, child)
end

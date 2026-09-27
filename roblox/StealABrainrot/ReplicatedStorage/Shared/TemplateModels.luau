--!strict
--[[
	TemplateModels

	The imported brainrot models: GameplayManager turns each import into a
	template in ReplicatedStorage.BrainrotModels (standing on the origin, facing
	-Z, with a Height attribute). build copies one onto a brainrot's Root at the
	brainrot's height, every part held by a Weld named "Pose" whose C0
	BrainrotVisuals animates. Used for brainrots on the map and guards (on the
	server) and for pets (on each client).
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local TemplateModels = {}

-- The box around some parts, in world space.
function TemplateModels.bounds(parts: { BasePart }): (Vector3, Vector3)
	local low = Vector3.new(math.huge, math.huge, math.huge)
	local high = -low
	for _, part in parts do
		local half = part.Size / 2
		for _, corner in
			{
				Vector3.new(-1, -1, -1),
				Vector3.new(-1, -1, 1),
				Vector3.new(-1, 1, -1),
				Vector3.new(-1, 1, 1),
				Vector3.new(1, -1, -1),
				Vector3.new(1, -1, 1),
				Vector3.new(1, 1, -1),
				Vector3.new(1, 1, 1),
			}
		do
			local point = part.CFrame:PointToWorldSpace(half * corner)
			low = low:Min(point)
			high = high:Max(point)
		end
	end
	return low, high
end

-- A brainrot's imported template, if it has one.
function TemplateModels.get(brainrotId: string): Model?
	local folder = ReplicatedStorage:FindFirstChild("BrainrotModels")
	local template = if folder then folder:FindFirstChild(brainrotId) else nil
	if template and template:IsA("Model") and #template:GetChildren() > 0 then
		return template
	end
	return nil
end

-- Copies a template at `targetHeight` onto `root` (the brainrot's feet) and
-- parents it to `model`. Moving pieces get their joint (Hip) and phase:
-- block-built ones from their Pivot attribute, legs of the others at the top
-- middle of the leg. Returns the height.
function TemplateModels.build(model: Model, root: BasePart, template: Model, targetHeight: number): number
	local clone = template:Clone()
	local height = tonumber(template:GetAttribute("Height")) or 1
	local scale = targetHeight / math.max(height, 0.01)
	for _, part in clone:GetDescendants() do
		if part:IsA("BasePart") then
			local rest = part.CFrame
			local offset = CFrame.new(rest.Position * scale) * rest.Rotation
			part.Size *= scale
			part.Anchored = false
			part.CanCollide = false
			part.CanQuery = false
			part.CanTouch = false
			part.Massless = true
			part.CFrame = root.CFrame * offset
			local weld = Instance.new("Weld")
			weld.Name = "Pose"
			weld.Part0 = root
			weld.Part1 = part
			weld.C0 = offset
			weld.Parent = part
			local pivot = part:GetAttribute("Pivot")
			if typeof(pivot) == "Vector3" then
				-- A block-built brainrot's moving piece turns about its joint,
				-- in the root's space.
				part:SetAttribute("Hip", pivot * scale)
				part:SetAttribute("LegPhase", if part:GetAttribute("PiecePhase") == 1 then 1 else 0)
			elseif string.sub(part.Name, 1, 3) == "Leg" then
				-- The hip: the top middle of the leg, in the root's space.
				local _, top = TemplateModels.bounds({ part })
				part:SetAttribute("Hip", Vector3.new(offset.X, top.Y - root.Position.Y, offset.Z))
				part:SetAttribute("LegPhase", if part.Name == "Leg2" then 1 else 0)
			end
		end
	end
	clone.Parent = model
	return targetHeight
end

return table.freeze(TemplateModels)

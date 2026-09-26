--!strict
-- Number and time formatting shared by server billboards and the client HUD.

local NumberFormat = {}

local SUFFIXES = { "K", "M", "B", "T", "Qa", "Qi" }

function NumberFormat.commas(value: number): string
	local whole = tostring(math.floor(math.abs(value)))
	local formatted = whole:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	if formatted:sub(1, 1) == "," then
		formatted = formatted:sub(2)
	end
	return if value < 0 then "-" .. formatted else formatted
end

function NumberFormat.abbreviate(value: number): string
	local magnitude = math.abs(value)
	if magnitude < 1000 then
		return tostring(math.floor(value))
	end
	local index = 0
	while magnitude >= 1000 and index < #SUFFIXES do
		magnitude /= 1000
		index += 1
	end
	local text = if magnitude < 10 then string.format("%.2f", magnitude) else string.format("%.1f", magnitude)
	text = text:gsub("%.?0+$", "")
	return (if value < 0 then "-" else "") .. text .. SUFFIXES[index]
end

function NumberFormat.cash(value: number): string
	return "$" .. NumberFormat.abbreviate(value)
end

function NumberFormat.duration(seconds: number): string
	local total = math.max(0, math.ceil(seconds))
	return string.format("%d:%02d", total // 60, total % 60)
end

return table.freeze(NumberFormat)

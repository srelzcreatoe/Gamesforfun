class_name ProfileFactory
## Creates a fresh character profile (docs/DATA_SCHEMA.md §Profile).

static func new_profile(name: String, race_id: String, gender: String, class_id: String) -> Dictionary:
	var race: Dictionary = Registry.race(race_id)
	var stats := {"STR": 5, "SKP": 5, "STM": 5, "RES": 5, "VIT": 5, "PWR": 5, "ENE": 5}
	var base: Dictionary = race.get("base_stats", {})
	for k in stats.keys():
		stats[k] = int(base.get(k, stats[k]))
	var slots: Array = []
	slots.resize(36)
	for i in 36:
		slots[i] = null
	slots[0] = {"item": "senzu_bean", "count": 2}
	slots[1] = {"item": "dragon_radar", "count": 1}
	slots[2] = {"item": "capsule_house", "count": 1} if Registry.has_item("capsule_house") else null
	# No starter gi: DragonMineZ starts you in the body you built in the creator, and the
	# clothes are something you craft or are given. Armour slots start empty.
	return {
		"character": {
			"name": name, "race": race_id, "gender": gender, "class": class_id,
			"body_type": int(race.get("defaultBodyType", race.get("default_body_type", 0))),
			"hair_type": int(race.get("defaultHairType", race.get("default_hair_type", 1))),
			"hair_color": race.get("defaultHairColor", race.get("default_hair_color", "#222629")),
			"eye_type": int(race.get("defaultEyesType", race.get("default_eye_type", 0))),
			"eye_color": race.get("defaultEye1Color", race.get("default_eye_color", "#222629")),
			"skin_color": race.get("defaultBodyColor", race.get("default_body_color", "#FFD3C9")),
			"skin_color2": race.get("defaultBodyColor2", race.get("default_body_color2", "#572117")),
			"skin_color3": race.get("defaultBodyColor3", race.get("default_body_color3", "#FFD3C9")),
			"nose": int(race.get("defaultNoseType", 0)), "mouth": int(race.get("defaultMouthType", 0)), "tattoo": int(race.get("defaultTattooType", 0)),
			"aura_color": race.get("defaultAuraColor", race.get("default_aura_color", "#7FFFFF")),
		},
		"stats": stats, "tp": 0, "tp_total": 0, "alignment": 50,
		"skills": {"ki_control": 1, "fly": 0, "jump": 0, "sprint": 0, "ki_sense": 0, "potential_unlock": 0},
		"techniques": ["ki_blast"], "forms": {"unlocked": [], "mastery": {}, "current": ""},
		"quests": {"active": {}, "completed": [], "claimed": [], "tracked": ""},
		"inventory": {"slots": slots, "armor": [null, null, null, null], "hotbar": 0},
		"position": {"planet": "earth", "x": 0.5, "y": -1, "z": 0.5, "yaw": 0.0},
		"spawn": {"planet": "earth", "x": 0.5, "y": -1, "z": 0.5},
		"health": -1, "ki": -1, "stamina": -1, "hunger": 20, "oxygen": 10,
		"planets_unlocked": ["earth"], "dragon_balls": {}, "play_time": 0, "kills": {}, "flags": {},
	}

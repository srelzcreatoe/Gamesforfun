package com.cubicworld.inv

import com.badlogic.gdx.utils.JsonReader
import com.badlogic.gdx.utils.JsonValue

class RecipeInput(val itemName: String, val count: Int) {
    var itemId: Int = -1
}

class RecipeDef(
    val name: String,
    val station: String,          // hand | handwork_mat | forge_table | kiln | cookpot
    val inputs: List<RecipeInput>,
    val outputName: String,
    val outputCount: Int,
) {
    var outputId: Int = -1
}

class RecipeRegistry private constructor(val recipes: List<RecipeDef>) {

    fun resolve(items: ItemRegistry) {
        for (r in recipes) {
            r.outputId = items.requireByName(r.outputName).id
            for (i in r.inputs) i.itemId = items.requireByName(i.itemName).id
        }
    }

    fun forStation(station: String): List<RecipeDef> = recipes.filter { it.station == station }

    val size: Int get() = recipes.size

    companion object {
        val STATIONS = setOf("hand", "handwork_mat", "forge_table", "kiln", "cookpot")

        fun parse(json: String): RecipeRegistry {
            val root = JsonReader().parse(json)
            val list = ArrayList<RecipeDef>()
            var v: JsonValue? = root.get("recipes").child
            while (v != null) {
                val inputs = ArrayList<RecipeInput>()
                var inp: JsonValue? = v.get("inputs").child
                while (inp != null) {
                    inputs.add(RecipeInput(inp.getString("item"), inp.getInt("count", 1)))
                    inp = inp.next
                }
                val out = v.get("output")
                val station = v.getString("station", "hand")
                require(station in STATIONS) { "Recipe ${v.getString("name", "?")}: unknown station $station" }
                list.add(
                    RecipeDef(
                        name = v.getString("name", out.getString("item")),
                        station = station,
                        inputs = inputs,
                        outputName = out.getString("item"),
                        outputCount = out.getInt("count", 1),
                    )
                )
                v = v.next
            }
            return RecipeRegistry(list)
        }
    }
}

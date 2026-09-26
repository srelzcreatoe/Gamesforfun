package com.cubicworld.render

import com.badlogic.gdx.graphics.Camera
import com.badlogic.gdx.graphics.glutils.ShapeRenderer
import com.cubicworld.player.RayHit

/** Wireframe highlight around the targeted block. */
class BlockOutlineRenderer {

    private val shapes = ShapeRenderer()
    var highContrast = false

    fun render(camera: Camera, hit: RayHit) {
        if (!hit.hit) return
        shapes.projectionMatrix = camera.combined
        shapes.begin(ShapeRenderer.ShapeType.Line)
        if (highContrast) shapes.setColor(1f, 1f, 0.2f, 1f)
        else shapes.setColor(0.05f, 0.05f, 0.05f, 0.85f)
        val e = 0.004f
        shapes.box(
            hit.x - e, hit.y - e, hit.z + 1 + e,
            1 + 2 * e, 1 + 2 * e, 1 + 2 * e,
        )
        shapes.end()
    }

    fun dispose() = shapes.dispose()
}

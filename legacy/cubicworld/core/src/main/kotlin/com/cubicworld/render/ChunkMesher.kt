package com.cubicworld.render

import com.badlogic.gdx.graphics.Color
import com.badlogic.gdx.utils.FloatArray as GdxFloatArray
import com.badlogic.gdx.utils.ShortArray as GdxShortArray
import com.cubicworld.world.BlockDef
import com.cubicworld.world.BlockRegistry
import com.cubicworld.world.BlockShape

/**
 * Immutable snapshot of an 18x18x18 region (16-cube section plus one-cell
 * border) taken on the main thread; workers mesh from this without touching
 * live chunk data.
 */
class MeshInput(
    val originX: Int, val originY: Int, val originZ: Int,
    val stamp: Int,
) {
    companion object { const val N = 18 }
    val ids = ShortArray(N * N * N)
    val light = ByteArray(N * N * N)
    val states = ByteArray(N * N * N)
    /** per-column tints, index ((z+1)*18 + (x+1))*3 */
    val grassTint = FloatArray(N * N * 3)
    val leafTint = FloatArray(N * N * 3)

    fun idx(x: Int, y: Int, z: Int): Int = ((y + 1) * N + (z + 1)) * N + (x + 1)
}

/** CPU-side mesh buffers for one section, ready for GL upload. */
class MeshOutput(val originX: Int, val originY: Int, val originZ: Int, val stamp: Int) {
    val solidVerts = GdxFloatArray(4096)
    val solidIdx = GdxShortArray(1024)
    val cutoutVerts = GdxFloatArray(1024)
    val cutoutIdx = GdxShortArray(256)
    val waterVerts = GdxFloatArray(1024)
    val waterIdx = GdxShortArray(256)

    val isEmpty: Boolean
        get() = solidIdx.size == 0 && cutoutIdx.size == 0 && waterIdx.size == 0
}

/**
 * Builds section geometry with hidden-face removal, per-vertex smooth light,
 * ambient occlusion and biome tinting. Pure CPU code — safe on worker threads.
 * Vertex layout: pos(3) uv(2) colorPacked(1: rgb tint, a ao) light(1) = 7 floats.
 */
class ChunkMesher(private val blocks: BlockRegistry, private val atlas: TextureAtlasManager) {

    companion object {
        const val VERTEX_SIZE = 7

        // per-face: normal, then 4 corner positions (outward CCW winding)
        private val NORMALS = arrayOf(
            intArrayOf(0, 1, 0), intArrayOf(0, -1, 0), intArrayOf(0, 0, -1),
            intArrayOf(0, 0, 1), intArrayOf(1, 0, 0), intArrayOf(-1, 0, 0),
        )
        private val CORNERS = arrayOf(
            // top
            arrayOf(intArrayOf(0, 1, 0), intArrayOf(0, 1, 1), intArrayOf(1, 1, 1), intArrayOf(1, 1, 0)),
            // bottom
            arrayOf(intArrayOf(0, 0, 0), intArrayOf(1, 0, 0), intArrayOf(1, 0, 1), intArrayOf(0, 0, 1)),
            // north (-z)
            arrayOf(intArrayOf(0, 0, 0), intArrayOf(0, 1, 0), intArrayOf(1, 1, 0), intArrayOf(1, 0, 0)),
            // south (+z)
            arrayOf(intArrayOf(1, 0, 1), intArrayOf(1, 1, 1), intArrayOf(0, 1, 1), intArrayOf(0, 0, 1)),
            // east (+x)
            arrayOf(intArrayOf(1, 0, 0), intArrayOf(1, 1, 0), intArrayOf(1, 1, 1), intArrayOf(1, 0, 1)),
            // west (-x)
            arrayOf(intArrayOf(0, 0, 1), intArrayOf(0, 1, 1), intArrayOf(0, 1, 0), intArrayOf(0, 0, 0)),
        )
    }

    // per-thread scratch: build() runs concurrently on multiple mesher workers
    private val uvTmpLocal = ThreadLocal.withInitial { FloatArray(4) }
    private val uvTmp: FloatArray get() = uvTmpLocal.get()

    fun build(input: MeshInput): MeshOutput {
        val out = MeshOutput(input.originX, input.originY, input.originZ, input.stamp)
        for (y in 0 until 16) for (z in 0 until 16) for (x in 0 until 16) {
            val id = input.ids[input.idx(x, y, z)].toInt()
            if (id == 0) continue
            val def = blocks.byId(id)
            when (def.shape) {
                BlockShape.CUBE -> meshCube(input, out, x, y, z, def)
                BlockShape.SLAB -> meshSlab(input, out, x, y, z, def)
                BlockShape.CROSS -> meshCross(input, out, x, y, z, def)
                BlockShape.LIQUID -> meshLiquid(input, out, x, y, z, def)
                BlockShape.LADDER -> meshLadder(input, out, x, y, z, def)
            }
        }
        return out
    }

    // ---- helpers ----------------------------------------------------------

    private fun defAt(input: MeshInput, x: Int, y: Int, z: Int): BlockDef {
        if (y + input.originY < 0) return blocks.byId(0)
        return blocks.byId(input.ids[input.idx(x, y, z)].toInt())
    }

    private fun opaqueAt(input: MeshInput, x: Int, y: Int, z: Int): Boolean = defAt(input, x, y, z).opaque

    private fun lightAt(input: MeshInput, x: Int, y: Int, z: Int): Int =
        input.light[input.idx(x, y, z)].toInt() and 0xFF

    /**
     * Smooth per-vertex light: average sky/block light over the 4 cells that
     * share this vertex in the sampling layer (the cell the face looks into).
     */
    private fun vertexLight(input: MeshInput, sx: Int, sy: Int, sz: Int, du: IntArray, dv: IntArray): Float {
        var sky = 0; var block = 0; var count = 0
        for (i in 0 until 4) {
            val ox = sx + (if (i and 1 != 0) du[0] else 0) + (if (i and 2 != 0) dv[0] else 0)
            val oy = sy + (if (i and 1 != 0) du[1] else 0) + (if (i and 2 != 0) dv[1] else 0)
            val oz = sz + (if (i and 1 != 0) du[2] else 0) + (if (i and 2 != 0) dv[2] else 0)
            if (ox < -1 || ox > 16 || oy < -1 || oy > 16 || oz < -1 || oz > 16) continue
            if (opaqueAt(input, ox, oy, oz)) continue
            val l = lightAt(input, ox, oy, oz)
            sky += (l ushr 4) and 0xF
            block += l and 0xF
            count++
        }
        if (count == 0) return 0f
        val skyAvg = sky / count
        val blockAvg = block / count
        return (skyAvg * 16 + blockAvg) / 255f
    }

    private fun vertexAo(input: MeshInput, sx: Int, sy: Int, sz: Int, du: IntArray, dv: IntArray): Float {
        val s1 = if (opaqueAt(input, sx + du[0], sy + du[1], sz + du[2])) 1 else 0
        val s2 = if (opaqueAt(input, sx + dv[0], sy + dv[1], sz + dv[2])) 1 else 0
        val c = if (s1 == 1 && s2 == 1) 1
        else if (opaqueAt(input, sx + du[0] + dv[0], sy + du[1] + dv[1], sz + du[2] + dv[2])) 1 else 0
        return 1f - 0.28f * (s1 + s2 + c)
    }

    private fun tintFor(input: MeshInput, x: Int, z: Int, def: BlockDef, face: Int): FloatArray? {
        val ti = ((z + 1) * MeshInput.N + (x + 1)) * 3
        return when {
            def.name.endsWith("_leaves") -> input.leafTint.copyOfRange(ti, ti + 3)
            def.name == "grass_sod" && face == BlockDef.FACE_TOP -> input.grassTint.copyOfRange(ti, ti + 3)
            def.shape == BlockShape.CROSS && def.material == com.cubicworld.world.BlockMaterial.PLANT &&
                !def.name.endsWith("_crop") -> input.grassTint.copyOfRange(ti, ti + 3)
            else -> null
        }
    }

    private fun emitQuad(
        verts: GdxFloatArray, idx: GdxShortArray,
        px: FloatArray, py: FloatArray, pz: FloatArray,
        us: FloatArray, vs: FloatArray,
        tint: FloatArray?, ao: FloatArray, lightVals: FloatArray,
        flip: Boolean,
    ) {
        val base = verts.size / VERTEX_SIZE
        if (base + 4 > 32760) return   // section overflow guard: drop excess quads
        for (i in 0 until 4) {
            verts.add(px[i]); verts.add(py[i]); verts.add(pz[i])
            verts.add(us[i]); verts.add(vs[i])
            val r = tint?.get(0) ?: 1f
            val g = tint?.get(1) ?: 1f
            val b = tint?.get(2) ?: 1f
            verts.add(Color.toFloatBits(r, g, b, ao[i]))
            verts.add(lightVals[i])
        }
        // flip the quad split when AO is anisotropic to avoid seam artefacts
        if (!flip) {
            idx.add((base).toShort()); idx.add((base + 1).toShort()); idx.add((base + 2).toShort())
            idx.add((base + 2).toShort()); idx.add((base + 3).toShort()); idx.add((base).toShort())
        } else {
            idx.add((base + 1).toShort()); idx.add((base + 2).toShort()); idx.add((base + 3).toShort())
            idx.add((base + 3).toShort()); idx.add((base).toShort()); idx.add((base + 1).toShort())
        }
    }

    // ---- cube -------------------------------------------------------------

    private fun bufferFor(out: MeshOutput, def: BlockDef): Pair<GdxFloatArray, GdxShortArray> = when {
        def.isLiquid || def.translucent -> out.waterVerts to out.waterIdx
        !def.opaque -> out.cutoutVerts to out.cutoutIdx
        else -> out.solidVerts to out.solidIdx
    }

    private fun meshCube(input: MeshInput, out: MeshOutput, x: Int, y: Int, z: Int, def: BlockDef, topY: Float = 1f) {
        val (verts, idx) = bufferFor(out, def)
        for (face in 0 until 6) {
            val n = NORMALS[face]
            val nDef = defAt(input, x + n[0], y + n[1], z + n[2])
            val visible = when {
                nDef.isAir -> true
                nDef.opaque -> false
                nDef.id == def.id && def.seeThrough -> false   // e.g. glass against glass
                else -> true
            }
            if (!visible) continue
            emitFace(input, verts, idx, x, y, z, face, def.tiles[face], def, topY)
        }
    }

    private fun emitFace(
        input: MeshInput, verts: GdxFloatArray, idx: GdxShortArray,
        x: Int, y: Int, z: Int, face: Int, tile: Int, def: BlockDef, topY: Float,
    ) {
        val n = NORMALS[face]
        val corners = CORNERS[face]
        atlas.uv(tile, uvTmp)
        val px = FloatArray(4); val py = FloatArray(4); val pz = FloatArray(4)
        val us = FloatArray(4); val vs = FloatArray(4)
        val ao = FloatArray(4); val lightVals = FloatArray(4)
        val sx = x + n[0]; val sy = y + n[1]; val sz = z + n[2]
        val wx = input.originX.toFloat(); val wy = input.originY.toFloat(); val wz = input.originZ.toFloat()

        for (i in 0 until 4) {
            val c = corners[i]
            val cy = if (c[1] == 1) topY else 0f
            px[i] = wx + x + c[0]
            py[i] = wy + y + cy
            pz[i] = wz + z + c[2]
            // uv: sides map v by height, top/bottom map by x/z
            when (face) {
                0, 1 -> { // top/bottom
                    us[i] = if (c[0] == 1) uvTmp[2] else uvTmp[0]
                    vs[i] = if (c[2] == 1) uvTmp[3] else uvTmp[1]
                }
                2, 3 -> { // north/south: u by x
                    us[i] = if (c[0] == 1) uvTmp[2] else uvTmp[0]
                    vs[i] = if (c[1] == 1) uvTmp[1] + (uvTmp[3] - uvTmp[1]) * (1f - topY) else uvTmp[3]
                }
                else -> { // east/west: u by z
                    us[i] = if (c[2] == 1) uvTmp[2] else uvTmp[0]
                    vs[i] = if (c[1] == 1) uvTmp[1] + (uvTmp[3] - uvTmp[1]) * (1f - topY) else uvTmp[3]
                }
            }
            // planar offsets toward this corner (axes other than the normal axis)
            val du = IntArray(3); val dv = IntArray(3)
            var axisIdx = 0
            for (axis in 0 until 3) {
                if (n[axis] != 0) continue
                val cv = c[axis]
                val off = if (cv == 1) 1 else -1
                if (axisIdx == 0) du[axis] = off else dv[axis] = off
                axisIdx++
            }
            ao[i] = vertexAo(input, sx, sy, sz, du, dv)
            lightVals[i] = vertexLight(input, sx, sy, sz, du, dv)
        }
        val flip = ao[0] + ao[2] < ao[1] + ao[3]
        val tint = tintFor(input, x, z, def, face)
        emitQuad(verts, idx, px, py, pz, us, vs, tint, ao, lightVals, flip)
    }

    // ---- slab -------------------------------------------------------------

    private fun meshSlab(input: MeshInput, out: MeshOutput, x: Int, y: Int, z: Int, def: BlockDef) {
        val (verts, idx) = bufferFor(out, def)
        for (face in 0 until 6) {
            val n = NORMALS[face]
            if (face != BlockDef.FACE_TOP) {
                val nDef = defAt(input, x + n[0], y + n[1], z + n[2])
                if (nDef.opaque) continue
            }
            emitFace(input, verts, idx, x, y, z, face, def.tiles[face], def, 0.5f)
        }
    }

    // ---- cross (plants) ---------------------------------------------------

    private fun meshCross(input: MeshInput, out: MeshOutput, x: Int, y: Int, z: Int, def: BlockDef) {
        val (verts, idx) = bufferFor(out, def)
        atlas.uv(def.tiles[2], uvTmp)
        val state = input.states[input.idx(x, y, z)].toInt()
        val h = if (def.name.endsWith("_crop")) 0.35f + 0.22f * state.coerceIn(0, 3) else 1f
        val l = lightAt(input, x, y, z)
        val lightVal = ((l ushr 4) * 16 + (l and 0xF)).toFloat() / 255f
        val lightVals = floatArrayOf(lightVal, lightVal, lightVal, lightVal)
        val ao = floatArrayOf(1f, 1f, 1f, 1f)
        val tint = tintFor(input, x, z, def, 2)
        val wx = input.originX + x.toFloat()
        val wy = input.originY + y.toFloat()
        val wz = input.originZ + z.toFloat()
        val vTop = uvTmp[1] + (uvTmp[3] - uvTmp[1]) * (1f - h)
        val a = 0.15f; val b = 0.85f
        // two crossed quads, each emitted with both windings (visible from all sides)
        for (d in 0 until 2) {
            val x0 = if (d == 0) a else a
            val z0 = if (d == 0) a else b
            val x1 = if (d == 0) b else b
            val z1 = if (d == 0) b else a
            for (w in 0 until 2) {
                val px: FloatArray; val pz: FloatArray
                if (w == 0) {
                    px = floatArrayOf(wx + x0, wx + x0, wx + x1, wx + x1)
                    pz = floatArrayOf(wz + z0, wz + z0, wz + z1, wz + z1)
                } else {
                    px = floatArrayOf(wx + x1, wx + x1, wx + x0, wx + x0)
                    pz = floatArrayOf(wz + z1, wz + z1, wz + z0, wz + z0)
                }
                val py = floatArrayOf(wy, wy + h, wy + h, wy)
                val us = floatArrayOf(uvTmp[0], uvTmp[0], uvTmp[2], uvTmp[2])
                val vs = floatArrayOf(uvTmp[3], vTop, vTop, uvTmp[3])
                emitQuad(verts, idx, px, py, pz, us, vs, tint, ao, lightVals, false)
            }
        }
    }

    // ---- liquid -----------------------------------------------------------

    private fun meshLiquid(input: MeshInput, out: MeshOutput, x: Int, y: Int, z: Int, def: BlockDef) {
        val (verts, idx) = bufferFor(out, def)
        val level = (input.states[input.idx(x, y, z)].toInt() and 0x7)
        val topY = (0.9f - level * 0.1f).coerceAtLeast(0.2f)
        val above = defAt(input, x, y + 1, z)
        for (face in 0 until 6) {
            val n = NORMALS[face]
            val nDef = defAt(input, x + n[0], y + n[1], z + n[2])
            val visible = when {
                nDef.id == def.id -> false
                face == BlockDef.FACE_TOP -> true
                nDef.opaque -> false
                nDef.isLiquid -> false
                else -> true
            }
            if (!visible) continue
            val h = if (above.id == def.id) 1f else topY
            emitFace(input, verts, idx, x, y, z, face, def.tiles[face], def, h)
        }
    }

    // ---- ladder -----------------------------------------------------------

    private fun meshLadder(input: MeshInput, out: MeshOutput, x: Int, y: Int, z: Int, def: BlockDef) {
        val (verts, idx) = bufferFor(out, def)
        // attach to the first solid horizontal neighbour
        var face = 2
        for (f in 2 until 6) {
            val n = NORMALS[f]
            if (defAt(input, x + n[0], y + n[1], z + n[2]).opaque) { face = f; break }
        }
        val n = NORMALS[face]
        atlas.uv(def.tiles[2], uvTmp)
        val l = lightAt(input, x, y, z)
        val lightVal = ((l ushr 4) * 16 + (l and 0xF)).toFloat() / 255f
        val lightVals = floatArrayOf(lightVal, lightVal, lightVal, lightVal)
        val ao = floatArrayOf(1f, 1f, 1f, 1f)
        val wx = input.originX + x.toFloat()
        val wy = input.originY + y.toFloat()
        val wz = input.originZ + z.toFloat()
        val off = 0.06f
        // plane flush against the wall, both windings
        val px: FloatArray; val pz: FloatArray
        if (n[0] != 0) {
            val fx = if (n[0] == 1) 1f - off else off
            px = floatArrayOf(wx + fx, wx + fx, wx + fx, wx + fx)
            pz = floatArrayOf(wz, wz, wz + 1f, wz + 1f)
        } else {
            val fz = if (n[2] == 1) 1f - off else off
            px = floatArrayOf(wx, wx, wx + 1f, wx + 1f)
            pz = floatArrayOf(wz + fz, wz + fz, wz + fz, wz + fz)
        }
        val py = floatArrayOf(wy, wy + 1f, wy + 1f, wy)
        val us = floatArrayOf(uvTmp[0], uvTmp[0], uvTmp[2], uvTmp[2])
        val vs = floatArrayOf(uvTmp[3], uvTmp[1], uvTmp[1], uvTmp[3])
        emitQuad(verts, idx, px, py, pz, us, vs, null, ao, lightVals, false)
        // reverse winding copy
        val rpx = floatArrayOf(px[3], px[2], px[1], px[0])
        val rpy = floatArrayOf(py[3], py[2], py[1], py[0])
        val rpz = floatArrayOf(pz[3], pz[2], pz[1], pz[0])
        val rus = floatArrayOf(us[3], us[2], us[1], us[0])
        val rvs = floatArrayOf(vs[3], vs[2], vs[1], vs[0])
        emitQuad(verts, idx, rpx, rpy, rpz, rus, rvs, null, ao, lightVals, false)
    }
}

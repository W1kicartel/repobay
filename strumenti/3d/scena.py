# Repobay: common functions for the 3D illustrations (Blender 5.2, bpy).
# Palette from docs/MARCHIO.md (black + purple, 2026-10-11), designer-toy materials, iso camera, Cycles render with shadow catcher.
import bpy, bmesh, math, os, sys, time, random
from mathutils import Vector, Matrix, Euler, Quaternion

QUI = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(QUI, '..', '..', 'web', 'img'))
FONT = '/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf'

HEX = {
    'carta': 'F2EFF7', 'carta2': 'E7E1F1', 'bianco': 'FDFCFF', 'inchiostro': '0D0B11',
    'inchiostro2': '4F4762', 'segnale': '7B3DFF', 'cobalto': '5B5CFF', 'sole': 'FF6BD6',
    'menta': 'C7B4FF', 'rosa': 'FFB3E8',
    # the role names stay (cobalto = builder, sole = installer, menta = business), the colours are the new palette:
    # iris, orchid, lavender. The product box ('kraft') is aubergine black, so the R in purple stands out
    'kraft': '2A2433',
}

R90 = math.pi / 2


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return a


def s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(h):
    h = HEX.get(h, h).lstrip('#')
    return tuple(s2l(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


# ---------------------------------------------------------------- scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATS.clear()


def link(ob, parent=None):
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def empty(name='gruppo', loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0, parent=None):
    ob = bpy.data.objects.new(name, None)
    ob.location = loc
    ob.rotation_euler = rot
    ob.scale = (scale, scale, scale)
    return link(ob, parent)


_MATS = {}


def mat(col, rough=0.55, spec=0.12, emis=0.0):
    key = (col, rough, spec, emis)
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new(f'{col}_{rough}_{emis}')
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')
    c = lin(col)
    if emis > 0:
        b.inputs['Base Color'].default_value = (0, 0, 0, 1)
        b.inputs['Emission Color'].default_value = c
        b.inputs['Emission Strength'].default_value = emis
    else:
        b.inputs['Base Color'].default_value = c
    b.inputs['Roughness'].default_value = rough
    b.inputs['Specular IOR Level'].default_value = spec
    m.diffuse_color = c
    _MATS[key] = m
    return m


def _obj(name, bm, material, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    if material is not None:
        ob.data.materials.append(material if isinstance(material, bpy.types.Material) else mat(material))
    ob.location = loc
    ob.rotation_euler = rot
    return link(ob, parent)


def _bevel(ob, w, seg=4, angle=None):
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = w
    m.segments = seg
    if angle is None:
        m.limit_method = 'NONE'
    else:
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(angle)
    try:
        m.harden_normals = True
    except Exception:
        pass
    return m


def rbox(dims, loc=(0, 0, 0), col='bianco', bevel=0.08, rot=(0, 0, 0), parent=None, seg=4, name='box', m=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * dims[0], v.co.y * dims[1], v.co.z * dims[2]))
    ob = _obj(name, bm, m or mat(col), loc, rot, parent)
    b = min(bevel, min(dims) * 0.49)
    if b > 0:
        _bevel(ob, b, seg)
    return ob


def sphere(r, loc=(0, 0, 0), col='bianco', scale=(1, 1, 1), parent=None, rot=(0, 0, 0), cut_below=None, name='sfera', m=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=r)
    if cut_below is not None:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut_below], context='VERTS')
        # close the bottom
        edges = [e for e in bm.edges if e.is_boundary]
        if edges:
            bmesh.ops.holes_fill(bm, edges=edges)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
    return _obj(name, bm, m or mat(col), loc, rot, parent)


def capsule(p1, p2, r, col='bianco', parent=None, name='capsula', m=None, sy=1.0):
    p1, p2 = Vector(p1), Vector(p2)
    L = (p2 - p1).length
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=r)
    for v in bm.verts:
        v.co.y *= sy
        if v.co.z > 1e-6:
            v.co.z += L
    q = (p2 - p1).to_track_quat('Z', 'Y')
    ob = _obj(name, bm, m or mat(col), p1, (0, 0, 0), parent)
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = q
    return ob


def cyl(r, depth, loc=(0, 0, 0), col='bianco', rot=(0, 0, 0), bevel=0.03, verts=64, parent=None, r2=None, name='cil', m=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r,
                          radius2=r if r2 is None else r2, depth=depth)
    ob = _obj(name, bm, m or mat(col), loc, rot, parent)
    if bevel > 0:
        _bevel(ob, min(bevel, depth * 0.45, r * 0.45), 4, angle=30 if verts > 12 else 20)
    return ob


def torus(R, r, loc=(0, 0, 0), col='bianco', rot=(0, 0, 0), parent=None, scale=(1, 1, 1), name='toro', m=None, maj=48, mino=16):
    bm = bmesh.new()
    for i in range(maj):
        a = 2 * math.pi * i / maj
        for j in range(mino):
            b = 2 * math.pi * j / mino
            x = (R + r * math.cos(b)) * math.cos(a)
            y = (R + r * math.cos(b)) * math.sin(a)
            z = r * math.sin(b)
            bm.verts.new((x * scale[0], y * scale[1], z * scale[2]))
    bm.verts.ensure_lookup_table()
    for i in range(maj):
        for j in range(mino):
            a = i * mino + j
            b = ((i + 1) % maj) * mino + j
            c = ((i + 1) % maj) * mino + (j + 1) % mino
            d = i * mino + (j + 1) % mino
            bm.faces.new((bm.verts[a], bm.verts[b], bm.verts[c], bm.verts[d]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(name, bm, m or mat(col), loc, rot, parent)


def tube(points, r, col='inchiostro', parent=None, name='tubo', m=None, res=4):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for p, c in zip(sp.points, points):
        p.co = (c[0], c[1], c[2], 1)
    ob = bpy.data.objects.new(name, cu)
    ob.data.materials.append(m or mat(col))
    return link(ob, parent)


def arc_points(a, b, h, n=40):
    """Points on a parabolic arc from a to b with height h above the line."""
    a, b = Vector(a), Vector(b)
    out = []
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t)
        p.z += 4 * h * t * (1 - t)
        out.append(p)
    return out


def letter(ch, size, loc=(0, 0, 0), rot=(0, 0, 0), col='segnale', depth=0.05, parent=None):
    cu = bpy.data.curves.new('lettera', 'FONT')
    cu.body = ch
    cu.font = bpy.data.fonts.load(FONT, check_existing=True)
    cu.size = size
    cu.extrude = depth
    cu.bevel_depth = depth * 0.5
    cu.bevel_resolution = 3
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new('lettera', cu)
    ob.data.materials.append(mat(col))
    ob.location = loc
    ob.rotation_euler = rot
    return link(ob, parent)


def boolean(target, cutter, op='DIFFERENCE'):
    m = target.modifiers.new('bool', 'BOOLEAN')
    m.operation = op
    m.object = cutter
    m.solver = 'EXACT'
    # the bevel must come after the boolean? keep bevel first for cleaner rims
    cutter.hide_render = True
    cutter.hide_viewport = True
    return m


# ---------------------------------------------------------------- characters
SKIN = 'bianco'


def figura(ruolo='dev', posa='in_piedi', loc=(0, 0, 0), rot_z=0.0, scale=1.0, parent=None,
           mano_d=None, mano_s=None):
    """Faceless capsule toy figure, facing -Y, origin at the feet (or the seat when sitting).
    ruolo: 'dev' (cobalt hoodie, headphones) or 'inst' (sun jumpsuit, orange cap, tool belt).
    posa: 'in_piedi' | 'seduto'. mano_d / mano_s: local hand positions (right = +X)."""
    root = empty(f'figura_{ruolo}', loc, (0, 0, rot_z), scale, parent)
    dev = ruolo == 'dev'
    top = 'cobalto' if dev else 'sole'
    pants = 'inchiostro2' if dev else 'sole'
    shoe = 'bianco' if dev else 'inchiostro2'
    sy = 0.84
    if posa == 'in_piedi':
        z0 = 0.0
        for sx in (-1, 1):
            capsule((0.16 * sx, 0, 0.2), (0.16 * sx, 0, 0.58), 0.135, pants, root)
            rbox((0.27, 0.38, 0.17), (0.16 * sx, -0.05, 0.085), shoe, 0.075, parent=root)
    else:  # sitting: seat at z=0, thighs forward, shins down
        z0 = -0.45
        for sx in (-1, 1):
            capsule((0.16 * sx, 0.0, 0.1), (0.16 * sx, -0.5, 0.1), 0.135, pants, root)
            capsule((0.16 * sx, -0.52, 0.08), (0.16 * sx, -0.56, -0.36), 0.125, pants, root)
            rbox((0.27, 0.38, 0.17), (0.16 * sx, -0.62, -0.395), shoe, 0.075, parent=root)
    zt = z0
    # torso
    t = capsule((0, 0, zt + 0.68), (0, 0, zt + 1.02), 0.35, top, root, sy=sy)
    head_c = Vector((0, 0, zt + 1.74))
    sphere(0.45, head_c, SKIN, parent=root, name='testa')
    # arms
    sh = {1: Vector((0.37, 0, zt + 1.12)), -1: Vector((-0.37, 0, zt + 1.12))}
    hands = {1: Vector(mano_d) if mano_d else Vector((0.52, -0.02, zt + 0.62)),
             -1: Vector(mano_s) if mano_s else Vector((-0.52, -0.02, zt + 0.62))}
    for sx in (1, -1):
        a, h = sh[sx], hands[sx]
        d = (h - a)
        end = a + d * max(0.0, (d.length - 0.1) / d.length)
        capsule(a, end, 0.115, top, root)
        sphere(0.14, h, SKIN, parent=root, name='mano')
    if dev:
        # hood collar + drawstrings
        torus(0.27, 0.095, (0, 0.05, zt + 1.33), top, (math.radians(-12), 0, 0), root, scale=(1, 0.95, 1))
        for sx in (-1, 1):
            capsule((0.075 * sx, -0.3, zt + 1.2), (0.085 * sx, -0.33, zt + 1.0), 0.022, 'bianco', root)
        # headphones
        pts = []
        for i in range(25):
            a = math.pi * i / 24
            pts.append((math.cos(a) * 0.49, 0.0, head_c.z + 0.02 + math.sin(a) * 0.49))
        tube(pts, 0.052, 'inchiostro', root)
        for sx in (-1, 1):
            cyl(0.17, 0.15, (sx * 0.47, 0, head_c.z - 0.02), 'inchiostro', (0, R90, 0), 0.05, parent=root)
            cyl(0.1, 0.03, (sx * 0.555, 0, head_c.z - 0.02), 'rosa', (0, R90, 0), 0.012, parent=root)
    else:
        # cap
        sphere(0.48, head_c + Vector((0, 0.0, 0.03)), 'segnale', scale=(1, 1, 1.0), parent=root, cut_below=0.0, name='cappello')
        b = cyl(0.3, 0.05, head_c + Vector((0, -0.36, 0.06)), 'segnale', (math.radians(-8), 0, 0), 0.02, parent=root)
        b.scale = (1.0, 0.85, 1)
        sphere(0.06, head_c + Vector((0, 0, 0.51)), 'segnale', parent=root)
        # tool belt
        torus(0.345, 0.065, (0, 0, zt + 0.66), 'inchiostro2', parent=root, scale=(1, sy, 1))
        rbox((0.14, 0.05, 0.11), (0, -0.33, zt + 0.66), 'bianco', 0.025, parent=root)
        for sx in (-1, 1):
            rbox((0.17, 0.12, 0.2), (sx * 0.3, -0.18, zt + 0.55), 'inchiostro2', 0.04, (0, 0, sx * 0.5), root)
        # screwdriver and hammer in the pouches
        cyl(0.035, 0.18, (0.3, -0.18, zt + 0.73), 'segnale', (0, 0, 0), 0.015, parent=root)
        capsule((0.3, -0.18, zt + 0.82), (0.3, -0.18, zt + 0.9), 0.012, 'inchiostro2', root)
        capsule((-0.3, -0.18, zt + 0.62), (-0.33, -0.2, zt + 0.86), 0.03, 'cobalto', root)
        rbox((0.2, 0.07, 0.07), (-0.33, -0.2, zt + 0.89), 'inchiostro2', 0.025, (0, 0, 0.5), root)
        # chest pocket
        rbox((0.18, 0.04, 0.14), (0.14, -0.29, zt + 1.0), 'inchiostro2', 0.03, (math.radians(8), 0, 0), root)
    return root


# ---------------------------------------------------------------- objects
CODE_COLS = ['cobalto', 'segnale', 'menta', 'sole', 'rosa', 'bianco']


def portatile(loc=(0, 0, 0), rot_z=0.0, scale=1.0, parent=None, apertura=-14, seed=3):
    root = empty('portatile', loc, (0, 0, rot_z), scale, parent)
    W, D = 1.7, 1.15
    rbox((W, D, 0.09), (0, 0, 0.045), 'carta2', 0.035, parent=root)
    rbox((W * 0.82, D * 0.42, 0.02), (0, 0.12, 0.093), 'inchiostro2', 0.008, parent=root)
    # keys
    for row in range(4):
        for k in range(12):
            rbox((0.095, 0.075, 0.025), (-0.62 + k * 0.113, 0.27 - row * 0.1, 0.1), 'carta2', 0.01, parent=root)
    rbox((0.5, 0.3, 0.01), (0, -0.33, 0.093), 'inchiostro2', 0.01, parent=root)
    hinge = empty('cerniera', (0, D / 2 - 0.03, 0.08), (math.radians(apertura), 0, 0), 1.0, root)
    H = 1.12
    rbox((W, 0.07, H), (0, 0.0, H / 2), 'carta2', 0.035, parent=hinge)
    rbox((W - 0.14, 0.012, H - 0.16), (0, -0.04, H / 2 + 0.01), 'inchiostro', 0.005, parent=hinge)
    rnd = random.Random(seed)
    x0, y = -(W - 0.14) / 2 + 0.1, H - 0.17
    for line in range(7):
        ind = [0, 1, 2, 2, 1, 1, 0][line] * 0.12
        x = x0 + ind
        for s in range(rnd.choice([1, 2, 2, 3])):
            w = rnd.uniform(0.14, 0.42)
            if x + w > (W - 0.14) / 2 - 0.08:
                break
            c = rnd.choice(CODE_COLS)
            rbox((w, 0.02, 0.075), (x + w / 2, -0.05, y), None, 0.03, parent=hinge, m=mat(c, emis=1.0))
            x += w + 0.06
        y -= 0.125
    return root


def scatola(loc=(0, 0, 0), rot=(0, 0, 0), size=1.0, parent=None, R_facce=('-y', '+x')):
    root = empty('scatola', loc, rot, size, parent)
    s = 1.0
    rbox((s, s, s * 0.8), (0, 0, s * 0.4), 'kraft', 0.06, parent=root)
    # flaps seam and tape
    rbox((s * 0.98, 0.02, 0.01), (0, 0, s * 0.8 + 0.002), 'inchiostro2', 0.004, parent=root)
    rbox((0.24, s * 1.02, 0.03), (0, 0, s * 0.8), 'sole', 0.012, parent=root)
    rbox((0.24, 0.03, 0.22), (0, -s / 2 - 0.005, s * 0.8 - 0.1), 'sole', 0.012, parent=root)
    rbox((0.24, 0.03, 0.22), (0, s / 2 + 0.005, s * 0.8 - 0.1), 'sole', 0.012, parent=root)
    for f in R_facce:
        if f == '-y':
            letter('R', 0.5, (0.0, -s / 2 - 0.005, s * 0.36), (R90, 0, 0), 'segnale', 0.03, root)
        elif f == '+x':
            letter('R', 0.5, (s / 2 + 0.005, 0.0, s * 0.36), (R90, 0, R90), 'segnale', 0.03, root)
    return root


def negozio(loc=(0, 0, 0), rot_z=0.0, scale=1.0, parent=None, cartello=True, seed=5):
    root = empty('negozio', loc, (0, 0, rot_z), scale, parent)
    W, D, H = 2.8, 2.1, 2.3
    rbox((W + 0.5, D + 0.7, 0.14), (0, -0.2, 0.07), 'carta2', 0.05, parent=root)
    rbox((W, D, H), (0, 0, 0.14 + H / 2), 'bianco', 0.08, parent=root)
    rbox((W + 0.2, D + 0.2, 0.22), (0, 0, 0.14 + H + 0.08), 'inchiostro', 0.07, parent=root)
    yF = -D / 2
    # sign band
    rbox((W - 0.4, 0.1, 0.36), (0, yF - 0.03, 2.08), 'menta', 0.04, parent=root)
    for i in range(5):
        sphere(0.06, (-0.6 + i * 0.3, yF - 0.09, 2.08), 'bianco', parent=root)
    # door
    rbox((0.8, 0.1, 1.2), (-0.68, yF - 0.02, 0.14 + 0.6), 'menta', 0.05, parent=root)
    rbox((0.46, 0.04, 0.3), (-0.68, yF - 0.075, 1.13), 'inchiostro', 0.03, parent=root)
    sphere(0.055, (-0.38, yF - 0.1, 0.62), 'sole', parent=root)
    if cartello:
        # "APERTO" sign as a shape: plate with pill bars, hanging on two strings
        zs = 0.8
        rbox((0.56, 0.05, 0.28), (-0.68, yF - 0.13, zs), 'segnale', 0.035, parent=root)
        capsule((-0.86, yF - 0.165, zs + 0.04), (-0.66, yF - 0.165, zs + 0.04), 0.026, 'bianco', root)
        capsule((-0.58, yF - 0.165, zs + 0.04), (-0.5, yF - 0.165, zs + 0.04), 0.026, 'bianco', root)
        capsule((-0.86, yF - 0.165, zs - 0.05), (-0.74, yF - 0.165, zs - 0.05), 0.026, 'bianco', root)
        tube([(-0.9, yF - 0.13, zs + 0.13), (-0.68, yF - 0.13, zs + 0.3), (-0.46, yF - 0.13, zs + 0.13)], 0.009, 'inchiostro', root)
        sphere(0.03, (-0.68, yF - 0.1, zs + 0.3), 'inchiostro', parent=root)
    # shop window with goods
    rbox((1.05, 0.08, 0.8), (0.62, yF - 0.01, 0.93), 'inchiostro', 0.04, parent=root)
    rbox((1.15, 0.14, 0.08), (0.62, yF - 0.04, 0.5), 'bianco', 0.03, parent=root)
    rbox((0.26, 0.24, 0.22), (0.4, yF - 0.06, 0.65), 'kraft', 0.03, parent=root)
    rbox((0.2, 0.2, 0.16), (0.42, yF - 0.06, 0.84), 'segnale', 0.03, parent=root)
    cyl(0.1, 0.18, (0.78, yF - 0.06, 0.63), 'inchiostro2', bevel=0.02, parent=root)
    sphere(0.17, (0.78, yF - 0.06, 0.82), 'menta', parent=root)
    # awning: stripes + scallops
    n = 7
    sw = (W + 0.3) / n
    tilt = math.radians(24)
    depth = 0.72
    for i in range(n):
        c = 'segnale' if i % 2 == 0 else 'bianco'
        x = -(W + 0.3) / 2 + sw * (i + 0.5)
        y = yF - depth / 2 * math.cos(tilt)
        z = 1.9 - depth / 2 * math.sin(tilt)
        rbox((sw + 0.004, depth, 0.07), (x, y - 0.02, z), c, 0.025, (tilt, 0, 0), root)
        zf = 1.9 - depth * math.sin(tilt) - 0.02
        yf = yF - depth * math.cos(tilt) - 0.02
        cyl(sw / 2, 0.08, (x, yf, zf), c, (R90, 0, 0), 0.025, parent=root, name='smerlo')
    # plant
    cyl(0.2, 0.32, (1.45, yF - 0.3, 0.3), 'inchiostro2', bevel=0.04, parent=root)
    sphere(0.3, (1.45, yF - 0.3, 0.68), 'menta', scale=(1, 1, 1.1), parent=root)
    sphere(0.2, (1.33, yF - 0.4, 0.95), 'menta', parent=root)
    return root


def moneta(loc=(0, 0, 0), rot=(0, 0, 0), col='segnale', r=0.42, depth=0.12, simbolo='anello', parent=None, scale=1.0):
    root = empty('moneta', loc, rot, scale, parent)
    c = cyl(r, depth, (0, 0, 0), col, bevel=0.035, parent=root)
    face = depth / 2
    if simbolo == 'anello':
        for sz in (1, -1):
            torus(r * 0.72, 0.022, (0, 0, sz * face), col, parent=root, scale=(1, 1, 0.7))
    else:
        # engraved symbols: a boolean groove
        cut_parts = []
        for sz in (1, -1):
            zc = sz * face
            if simbolo == 'cerchio':
                cutter = torus(r * 0.45, 0.04, (0, 0, zc), col, parent=root, scale=(1, 1, 1.4))
            elif simbolo == 'rombo':
                cutter = rbox((r * 0.75, r * 0.75, 0.06), (0, 0, zc), col, 0.0, (0, 0, math.pi / 4), root)
                inner = None
            elif simbolo == 'esagono':
                cutter = cyl(r * 0.5, 0.06, (0, 0, zc), col, bevel=0.0, verts=6, parent=root)
            cut_parts.append(cutter)
        for cutter in cut_parts:
            boolean(c, cutter)
        # move bevel after booleans
        bev = c.modifiers['bevel']
        c.modifiers.move(0, len(c.modifiers) - 1) if False else None
        # a raised core inside the symbol for the "engraved line" read
        if simbolo == 'rombo':
            for sz in (1, -1):
                rbox((r * 0.5, r * 0.5, 0.05), (0, 0, sz * (face - 0.02)), col, 0.01, (0, 0, math.pi / 4), root)
        elif simbolo == 'esagono':
            for sz in (1, -1):
                cyl(r * 0.33, 0.05, (0, 0, sz * (face - 0.02)), col, bevel=0.01, verts=6, parent=root)
    return root


def ramo_git(loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0, parent=None):
    root = empty('ramo_git', loc, rot, scale, parent)
    a, b, c = Vector((0, 0, 0)), Vector((0, 0, 1.5)), Vector((0.75, 0, 1.0))
    tube([a, b], 0.075, 'inchiostro', root)
    pts = []
    for i in range(21):
        t = i / 20
        # from the trunk (z=0.25) curving out to the branch node
        p0, p1, p2 = Vector((0, 0, 0.3)), Vector((0.75, 0, 0.35)), c
        p = (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2
        pts.append(p)
    tube(pts, 0.075, 'inchiostro', root)
    sphere(0.2, a, 'cobalto', parent=root)
    sphere(0.2, b, 'cobalto', parent=root)
    sphere(0.2, c, 'segnale', parent=root)
    for p in (a, b, c):
        torus(0.2, 0.05, p, 'bianco', (R90, 0, 0), root)
    return root


def cassetta(loc=(0, 0, 0), rot_z=0.0, scale=1.0, parent=None, aperta=True):
    """Open toolbox (sun), lid tilted back, tools inside."""
    root = empty('cassetta', loc, (0, 0, rot_z), scale, parent)
    W, D, H = 2.0, 1.05, 0.8
    body = rbox((W, D, H), (0, 0, H / 2), 'sole', 0.07, parent=root)
    inner = rbox((W - 0.18, D - 0.18, H), (0, 0, H / 2 + 0.12), 'sole', 0.0, parent=root)
    boolean(body, inner)
    body.modifiers.move(1, 0)  # boolean first, then bevel
    rbox((W - 0.2, D - 0.2, 0.04), (0, 0, 0.2), 'inchiostro2', 0.01, parent=root)
    # latches
    for sx in (-1, 1):
        rbox((0.16, 0.05, 0.16), (sx * 0.6, -D / 2 - 0.02, H - 0.12), 'inchiostro', 0.03, parent=root)
    hinge = empty('cerniera', (0, D / 2, H), (math.radians(-118 if aperta else 0), 0, 0), 1.0, root)
    lid = rbox((W, D, 0.16), (0, -D / 2, 0.08), 'sole', 0.06, parent=hinge)
    # side handle on the +x end, a tray at the front-left with tools
    tube([(W / 2, -0.25, H - 0.25), (W / 2 + 0.16, -0.25, H - 0.2), (W / 2 + 0.16, 0.25, H - 0.2), (W / 2, 0.25, H - 0.25)], 0.045, 'inchiostro', root)
    tray = rbox((0.8, 0.42, 0.22), (-0.48, -D / 2 + 0.26, H + 0.04), 'sole', 0.04, parent=root)
    tin = rbox((0.68, 0.3, 0.3), (-0.48, -D / 2 + 0.26, H + 0.15), 'sole', 0.0, parent=root)
    boolean(tray, tin)
    tray.modifiers.move(1, 0)
    cyl(0.05, 0.3, (-0.7, -D / 2 + 0.26, H + 0.2), 'cobalto', (math.radians(-20), math.radians(15), 0), 0.02, parent=root)
    capsule((-0.66, -D / 2 + 0.22, H + 0.33), (-0.6, -D / 2 + 0.15, H + 0.55), 0.018, 'inchiostro2', root)
    cyl(0.05, 0.28, (-0.38, -D / 2 + 0.26, H + 0.18), 'segnale', (math.radians(10), math.radians(-25), 0), 0.02, parent=root)
    capsule((-0.33, -D / 2 + 0.28, H + 0.3), (-0.24, -D / 2 + 0.3, H + 0.48), 0.018, 'inchiostro2', root)
    # handle on the lid
    tube([(-0.45, -D / 2, 0.16), (-0.45, -D / 2, 0.36), (0.45, -D / 2, 0.36), (0.45, -D / 2, 0.16)], 0.06, 'inchiostro', hinge)
    return root


def chiave_inglese(loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0, col='inchiostro2', parent=None):
    root = empty('chiave', loc, rot, scale, parent)
    rbox((0.16, 0.07, 1.0), (0, 0, 0), col, 0.03, parent=root)
    head = cyl(0.2, 0.08, (0, 0, 0.56), col, (R90, 0, 0), 0.025, parent=root)
    jaw = rbox((0.14, 0.3, 0.3), (0, 0, 0.7), col, 0.0, parent=root)
    boolean(head, jaw)
    head.modifiers.move(1, 0)
    cyl(0.1, 0.08, (0, 0, -0.5), col, (R90, 0, 0), 0.025, parent=root)
    return root


def tratteggio(points, r=0.035, col='inchiostro', on=2, off=2, parent=None):
    """Dashed line along a polyline: groups of `on` segments every on+off."""
    i = 0
    n = len(points) - 1
    while i < n:
        a = points[i]
        b = points[min(i + on, n)]
        capsule(a, b, r, col, parent)
        i += on + off


# ---------------------------------------------------------------- light, camera, render
def luci(key=2.3, fill=0.75, ambient=0.42, key_dir=(-0.55, -0.85, 1.35), fill_dir=(1.0, -0.25, 0.6)):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('mondo')
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.97, 0.98, 1.0, 1)
    bg.inputs[1].default_value = ambient
    k = bpy.data.lights.new('chiave', 'SUN')
    k.energy = key
    k.angle = math.radians(14)
    k.color = (1.0, 0.94, 0.86)
    ko = link(bpy.data.objects.new('chiave', k))
    ko.rotation_mode = 'QUATERNION'
    ko.rotation_quaternion = Vector(key_dir).normalized().to_track_quat('Z', 'Y')
    f = bpy.data.lights.new('riempimento', 'SUN')
    f.energy = fill
    f.angle = math.radians(30)
    f.color = (0.85, 0.9, 1.0)
    fo = link(bpy.data.objects.new('riempimento', f))
    fo.rotation_mode = 'QUATERNION'
    fo.rotation_quaternion = Vector(fill_dir).normalized().to_track_quat('Z', 'Y')
    try:
        f.cycles.cast_shadow = False
    except Exception:
        pass
    try:
        f.use_shadow = False
    except Exception:
        pass


def pavimento(z=0.0):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60)
    ob = _obj('pavimento', bm, mat('bianco'), (0, 0, z), smooth=False)
    ob.is_shadow_catcher = True
    return ob


def camera(elev=30.0, azim=45.0):
    cam = bpy.data.cameras.new('camera')
    cam.type = 'ORTHO'
    cam.clip_start = 0.1
    cam.clip_end = 400
    ob = link(bpy.data.objects.new('camera', cam))
    ob.rotation_euler = (math.radians(90 - elev), 0, math.radians(azim))
    bpy.context.scene.camera = ob
    return ob


def _punti(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        if o.type not in ('MESH', 'CURVE', 'FONT') or o.hide_render:
            continue
        oe = o.evaluated_get(dg)
        try:
            me = oe.to_mesh()
        except Exception:
            continue
        mw = oe.matrix_world
        pts += [mw @ v.co for v in me.vertices]
        oe.to_mesh_clear()
    return pts


def inquadra(cam_ob, res, margin=0.06, escludi=('pavimento',), shift=(0.0, 0.0), extra=1.0):
    """Ortho framing on the projected geometry. shift = where the centre of the subject goes, in frame fractions."""
    bpy.context.view_layer.update()
    objs = [o for o in bpy.context.scene.objects if o.name not in escludi]
    R = cam_ob.rotation_euler.to_matrix()
    inv = R.transposed()
    pts = [inv @ p for p in _punti(objs)]
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    asp = res[0] / res[1]
    scale = max(w, h * asp) * (1 + 2 * margin) * extra
    cam_ob.data.ortho_scale = scale
    d = R @ Vector((0, 0, -1))
    # shift: move the camera so the subject sits at shift (fractions of width/height from centre)
    sx = -shift[0] * scale
    sy = -shift[1] * scale / asp
    cam_ob.location = R @ Vector((cx + sx, cy + sy, 0)) - d * 120
    return scale


def render(nome, res, samples=64, prova=False, trasparente=True):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type != 'CPU'
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('GPU non disponibile:', e)
    sc.cycles.samples = 12 if prova else samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.03
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 2
    sc.cycles.transmission_bounces = 0
    sc.cycles.transparent_max_bounces = 4
    sc.render.film_transparent = trasparente
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 30 if prova else 100
    sc.render.filter_size = 1.3
    vs = sc.view_settings
    vs.view_transform = 'Standard'
    vs.look = 'None'
    vs.exposure = 0
    vs.gamma = 1
    sc.display_settings.display_device = 'sRGB'
    sc.sequencer_colorspace_settings.name = 'sRGB'
    im = sc.render.image_settings
    im.file_format = 'PNG'
    im.color_mode = 'RGBA' if trasparente else 'RGB'
    im.color_depth = '8'
    im.compression = 90
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, ('prova-' if prova else '') + nome)
    sc.render.filepath = path
    if os.environ.get('SOLO_BLEND'):
        # only save the editable scene: SOLO_BLEND=1 Blender -b -P <script>.py
        d = os.path.join(QUI, 'blend')
        os.makedirs(d, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(d, nome.replace('.png', '.blend')), compress=True)
        print('BLEND salvato', nome)
        return path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'RENDER {nome} {res} {"prova" if prova else "finale"}: {time.time() - t:.1f}s -> {path}')
    return path

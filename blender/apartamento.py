# Apartamento Tipo A — escena realista generada por script (Blender 5.x, sin interfaz).
# Uso:
#   blender --background --factory-startup --python apartamento.py -- <modo> <motor> <N> <ancho> <muestras> <salida>
#   modo: still | anim      motor: CYCLES | BLENDER_EEVEE
# Ejes: X = largo (ventanal en x=10), Y = ancho, Z = altura. Metros.
import bpy, bmesh, sys, math, random, os, time
from mathutils import Vector, Matrix, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
arg = lambda i, d: argv[i] if len(argv) > i else d
MODE, ENGINE = arg(0, 'still'), arg(1, 'CYCLES')
N, W, SAMPLES = int(arg(2, 3)), int(arg(3, 960)), int(arg(4, 24))
OUT = arg(5, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'))
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
COL = scene.collection
PI = math.pi


def hexc(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# ------------------------------------------------------------------ materiales
# Interruptor global: 0 = material normal, 1 = color plano sin luz (para el pase de tinta).
SW = bpy.data.node_groups.new('SW', 'ShaderNodeTree')
SW.interface.new_socket(name='v', in_out='OUTPUT', socket_type='NodeSocketFloat')
_go, _val = SW.nodes.new('NodeGroupOutput'), SW.nodes.new('ShaderNodeValue')
_val.name = 'Value'
_val.outputs[0].default_value = 0.0
SW.links.new(_val.outputs[0], _go.inputs[0])
SW2 = bpy.data.node_groups.new('SW2', 'ShaderNodeTree')
SW2.interface.new_socket(name='v', in_out='OUTPUT', socket_type='NodeSocketFloat')
_go2, _val2 = SW2.nodes.new('NodeGroupOutput'), SW2.nodes.new('ShaderNodeValue')
_val2.name = 'Value'
_val2.outputs[0].default_value = 0.0
SW2.links.new(_val2.outputs[0], _go2.inputs[0])


def pmat(name, color, rough=0.5, metal=0.0, **inp):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*hexc(color), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    for k, v in inp.items():
        b.inputs[k.replace('_', ' ')].default_value = v
    nt = m.node_tree
    em, sw, mx = nt.nodes.new('ShaderNodeEmission'), nt.nodes.new('ShaderNodeGroup'), nt.nodes.new('ShaderNodeMixShader')
    em.inputs['Color'].default_value = (*hexc(color), 1)
    sw.node_tree = SW
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    nt.links.new(sw.outputs[0], mx.inputs[0])
    nt.links.new(b.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    inkem, sw2, mx2 = nt.nodes.new('ShaderNodeEmission'), nt.nodes.new('ShaderNodeGroup'), nt.nodes.new('ShaderNodeMixShader')
    inkem.name = 'INK'
    inkem.inputs['Color'].default_value = (1, 1, 1, 1)
    sw2.node_tree = SW2
    nt.links.new(sw2.outputs[0], mx2.inputs[0])
    nt.links.new(mx.outputs[0], mx2.inputs[1])
    nt.links.new(inkem.outputs[0], mx2.inputs[2])
    nt.links.new(mx2.outputs[0], out.inputs['Surface'])
    return m


def band(nt, fac, lo, hi, gray=0.0):
    """Línea donde lo < fac < hi (curva de nivel del ruido): trazo orgánico. gray = tono del trazo."""
    r = nt.nodes.new('ShaderNodeValToRGB')
    r.color_ramp.interpolation = 'CONSTANT'
    el = r.color_ramp.elements
    el.new(0.5)
    for e, (p, c) in zip(el, ((0.0, 1.0), (lo, gray), (hi, 1.0))):
        e.position = p
        e.color = (c, c, c, 1)
    nt.links.new(fac, r.inputs[0])
    return r.outputs[0]


def set_ink(m, sock):
    m.node_tree.links.new(sock, m.node_tree.nodes['INK'].inputs['Color'])


def nodes(m):
    nt = m.node_tree
    return nt, nt.nodes['Principled BSDF'], nt.nodes.new, nt.links.new


def coords(nt, scale=(1, 1, 1), kind='Object'):
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = scale
    nt.links.new(tc.outputs[kind], mp.inputs['Vector'])
    return mp.outputs['Vector']


def ramp(nt, fac, stops):
    r = nt.nodes.new('ShaderNodeValToRGB')
    el = r.color_ramp.elements
    while len(el) < len(stops):
        el.new(0.5)
    for e, (p, c) in zip(el, stops):
        e.position = p
        e.color = (*hexc(c), 1)
    nt.links.new(fac, r.inputs[0])
    return r.outputs[0]


def bump(nt, bsdf, height, strength=0.2, dist=0.01):
    b = nt.nodes.new('ShaderNodeBump')
    b.inputs['Strength'].default_value = strength
    b.inputs['Distance'].default_value = dist
    nt.links.new(height, b.inputs['Height'])
    nt.links.new(b.outputs['Normal'], bsdf.inputs['Normal'])


def noise_tex(nt, vec, scale, detail=6.0, rough=0.6, distortion=0.0):
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Distortion'].default_value = distortion
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    nt.links.new(vec, n.inputs['Vector'])
    return n.outputs[0]


def mix(nt, a, b, fac, blend='MIX'):
    m = nt.nodes.new('ShaderNodeMix')
    m.data_type = 'RGBA'
    m.blend_type = blend
    for sock, v in ((m.inputs[0], fac), (m.inputs[6], a), (m.inputs[7], b)):
        if isinstance(v, (int, float)):
            sock.default_value = v
        elif isinstance(v, tuple):
            sock.default_value = v
        else:
            nt.links.new(v, sock)
    return m.outputs[2]


def wood(name, c1, c2, rough=0.42, axis_scale=(1.2, 14, 14), planks=None):
    m = pmat(name, c1, rough)
    nt, b, new, link = nodes(m)
    grain = noise_tex(nt, coords(nt, axis_scale), 5, 9, 0.68)
    col = ramp(nt, grain, [(0.28, c1), (0.72, c2)])
    if planks:  # (largo, ancho)
        br = new('ShaderNodeTexBrick')
        br.offset = 0.37
        br.inputs['Scale'].default_value = 1
        br.inputs['Brick Width'].default_value = planks[0]
        br.inputs['Row Height'].default_value = planks[1]
        br.inputs['Mortar Size'].default_value = 0.0025
        br.inputs['Color1'].default_value = (0.7, 0.7, 0.7, 1)
        br.inputs['Color2'].default_value = (1, 1, 1, 1)
        br.inputs['Mortar'].default_value = (0.25, 0.2, 0.15, 1)
        link(coords(nt, (1, 1, 1)), br.inputs['Vector'])
        col = mix(nt, col, br.outputs['Color'], 1.0, 'MULTIPLY')
    link(col, b.inputs['Base Color'])
    bump(nt, b, grain, 0.08, 0.004)
    vet = band(nt, noise_tex(nt, coords(nt, (axis_scale[0] * 0.45, axis_scale[1] * 0.5, axis_scale[2] * 0.5)), 2.2, 1.5, 0.45), 0.488, 0.512, 0.25)
    if planks:
        jb = new('ShaderNodeTexBrick')
        jb.offset = 0.37
        jb.inputs['Scale'].default_value = 1
        jb.inputs['Brick Width'].default_value = planks[0]
        jb.inputs['Row Height'].default_value = planks[1]
        jb.inputs['Mortar Size'].default_value = 0.009
        jb.inputs['Color1'].default_value = (1, 1, 1, 1)
        jb.inputs['Color2'].default_value = (1, 1, 1, 1)
        jb.inputs['Mortar'].default_value = (0, 0, 0, 1)
        link(coords(nt, (1, 1, 1)), jb.inputs['Vector'])
        vet = mix(nt, vet, jb.outputs['Color'], 1.0, 'MULTIPLY')
    set_ink(m, vet)
    return m


def fabric(name, color, rough=0.95, weave=420):
    m = pmat(name, color, rough, Sheen_Weight=0.4)
    nt, b, new, link = nodes(m)
    bump(nt, b, noise_tex(nt, coords(nt), weave, 2, 0.5), 0.6, 0.003)
    set_ink(m, band(nt, noise_tex(nt, coords(nt, (52, 11, 52)), 1.0, 0, 0.5), 0.84, 1.0, 0.62))
    return m


def stone(name, c1, c2, rough=0.18):
    m = pmat(name, c1, rough)
    nt, b, new, link = nodes(m)
    veins = noise_tex(nt, coords(nt, (1.0, 1.0, 1.0)), 1.3, 14, 0.6, 1.6)
    link(ramp(nt, veins, [(0.47, c1), (0.5, c2), (0.53, c1)]), b.inputs['Base Color'])
    set_ink(m, band(nt, veins, 0.492, 0.508, 0.3))
    return m


def concrete(name, c1, c2, rough=0.55):
    m = pmat(name, c1, rough)
    nt, b, new, link = nodes(m)
    n = noise_tex(nt, coords(nt, (1, 1, 1)), 3.5, 10, 0.7)
    link(ramp(nt, n, [(0.3, c1), (0.75, c2)]), b.inputs['Base Color'])
    bump(nt, b, noise_tex(nt, coords(nt, (1, 1, 1)), 90, 4, 0.6), 0.06, 0.002)
    set_ink(m, band(nt, noise_tex(nt, coords(nt, (1, 1, 1)), 26, 0, 0.5), 0.8, 1.0, 0.55))
    return m


def emit(name, color, strength):
    return pmat(name, color, 0.4, Emission_Color=(*hexc(color), 1), Emission_Strength=strength)


def add_haze(m, color_socket=None, near=500, far=3600, amount=0.88):
    """Perspectiva aérea: lo lejano se funde con el color del cielo."""
    nt, b, new, link = nodes(m)
    cam = new('ShaderNodeCameraData')
    mr = new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = near
    mr.inputs['From Max'].default_value = far
    mr.inputs['To Max'].default_value = amount
    link(cam.outputs['View Distance'], mr.inputs['Value'])
    src = color_socket if color_socket else tuple(b.inputs['Base Color'].default_value)
    link(mix(nt, src, (*hexc(0xc9d9e6), 1), mr.outputs[0]), b.inputs['Base Color'])


M = dict(
    wall=pmat('pared', 0xf1ece3, 0.9), ceil=pmat('techo', 0xfaf8f4, 0.92),
    floor=wood('piso', 0xb8935f, 0xd3b488, 0.38, (0.9, 16, 16), planks=(1.8, 0.16)),
    oak=wood('roble', 0xa67f52, 0xc9a577, 0.45), walnut=wood('nogal', 0x4f3524, 0x7a563a, 0.4),
    stone=stone('piedra', 0xf2efe9, 0xb9b3a8), cabinet=pmat('mueble', 0x2f3d37, 0.45),
    sofa=fabric('lino', 0xd8cdbb), cushion=fabric('cojin', 0xe9e2d6), terra=fabric('terracota', 0xb1603c),
    green=fabric('verde', 0x3b5045), boucle=fabric('boucle', 0xb1603c, 1.0, 180),
    rug=fabric('lana', 0xe4dccd, 1.0, 260), rug2=fabric('lana2', 0xa98a68, 1.0, 260),
    metal=pmat('metal', 0x161616, 0.38, 1.0), brass=pmat('laton', 0xc9a25a, 0.24, 1.0),
    steel=pmat('acero', 0xc8c8c8, 0.3, 1.0), ceramic=pmat('ceramica', 0xe9e3d8, 0.35),
    pot=pmat('barro', 0xb67d5c, 0.8), tile=pmat('baldosa', 0xc9c2b4, 0.6),
    leaf=pmat('hoja', 0x3f6a3a, 0.5), paper=pmat('papel', 0xf5f0e6, 0.9),
    felt=pmat('fieltro', 0x24221f, 0.95), blackglass=pmat('vitro', 0x050505, 0.05),
    glass=pmat('vidrio', 0xffffff, 0.0, IOR=1.45, Transmission_Weight=1.0, Thin_Wall=True),
    linen=pmat('cortina', 0xf6f2ea, 0.9, Transmission_Weight=0.25),
    bulb=emit('bombillo', 0xffe2b5, 22), led=emit('led', 0xffd9a8, 9), spot=emit('spot', 0xfff0d8, 4),
    shade=pmat('pantalla', 0xf7eedc, 0.9, Emission_Color=(*hexc(0xffe2b5), 1), Emission_Strength=1.6),
    duvet=fabric('duvet', 0xf4f1ea, 0.95, 300), velvet=fabric('terciopelo', 0x35493f, 0.7, 600),
    towel=fabric('toalla', 0xe8e2d6, 1.0, 150), mirror=pmat('espejo', 0xffffff, 0.02, 1.0),
    slab=concrete('porcelanato', 0xc2bcb1, 0xaba59a), frost=pmat('esmerilado', 0xffffff, 0.4, IOR=1.45, Transmission_Weight=1.0),
    ochre=pmat('ocre', 0xb8863b, 0.8), fruit1=pmat('naranja', 0xd98b2b, 0.5), fruit2=pmat('limon', 0xd9b93a, 0.5),
)


nt_, b_, new_, link_ = nodes(M['wall'])
bump(nt_, b_, noise_tex(nt_, coords(nt_), 700, 3, 0.6), 0.05, 0.001)
BOOKS = [pmat('libro%d' % i, c, 0.7) for i, c in enumerate((0x8a3b2c, 0x2f4a3f, 0xd9cdb8, 0x1f2a36, 0xb8863b, 0xe9e2d6, 0x6b4a36, 0x394f63))]
ASPHALT = pmat('asfalto', 0x3b3d3f, 0.9)

# ------------------------------------------------------------------ geometría
def obj(name, bm, mat, loc=(0, 0, 0), rot=(0, 0, 0), smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    ob.location, ob.rotation_euler = loc, rot
    if mat:
        me.materials.append(mat)
    COL.objects.link(ob)
    return ob


def bevel(ob, w, seg=2):
    m = ob.modifiers.new('bisel', 'BEVEL')
    m.width, m.segments, m.limit_method = w, seg, 'ANGLE'
    m.angle_limit = math.radians(40)
    try:
        ob.modifiers.new('normales', 'WEIGHTED_NORMAL').keep_sharp = True
    except Exception:
        pass
    return ob


def box(size, loc, mat, bv=0.004, rot=(0, 0, 0), name='caja'):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    ob = obj(name, bm, mat, loc, rot, smooth=bool(bv))
    return bevel(ob, bv) if bv else ob


def puff(size, loc, mat, rot=(0, 0, 0), level=2, name='cojin'):
    """Almohada mullida."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
    for v in bm.verts:  # panza ligera
        k = 1 + 0.06 * (1 - max(abs(v.co.x), abs(v.co.y)) * 2)
        v.co.z *= k
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    ob = obj(name, bm, mat, loc, rot)
    s = ob.modifiers.new('sub', 'SUBSURF')
    s.levels = s.render_levels = level
    return ob


def soft(size, loc, mat, rot=(0, 0, 0), name='tapizado'):
    """Tapizado entallado: canto redondeado pequeño, caras planas."""
    ob = box(size, loc, mat, max(0.012, min(0.035, min(size) * 0.18)), rot, name)
    ob.modifiers['bisel'].segments = 4
    return ob


def slats(x0, n, step, y, zc, h, mat, w=0.03, d=0.025, along='x'):
    bm = bmesh.new()
    for i in range(n):
        if along == 'x':
            mtx = Matrix.Translation((x0 + i * step, y, zc)) @ Matrix.Diagonal((w, d, h, 1))
        else:
            mtx = Matrix.Translation((y, x0 + i * step, zc)) @ Matrix.Diagonal((d, w, h, 1))
        bmesh.ops.create_cube(bm, size=1, matrix=mtx)
    return bevel(obj('listones', bm, mat), 0.003)


def books(x, y0, y1, z, depth=0.2):
    """Fila de libros sobre un entrepaño, lomos hacia +X."""
    y = y0
    while y < y1 - 0.05:
        if random.random() < 0.12:
            y += random.uniform(0.08, 0.2)
            continue
        t, h = random.uniform(0.022, 0.05), random.uniform(0.19, 0.29)
        lean = random.uniform(-0.03, 0.03)
        box((depth * random.uniform(0.8, 1.0), t, h), (x, y + t / 2, z + h / 2), random.choice(BOOKS), 0.002, (lean, 0, 0))
        y += t + 0.003


def plate(loc, axis='y'):
    box((0.08, 0.006, 0.12) if axis == 'y' else (0.006, 0.08, 0.12), loc, M['ceil'], 0.002)


def lathe(profile, loc, mat, s=1.0, seg=56, name='torno'):
    """Pieza torneada (jarrón, cuenco, frasco). profile: (radio, altura) de abajo hacia arriba;
    para piezas huecas el perfil sube por fuera y baja por dentro."""
    verts, faces = [], []
    for (r, z) in profile:
        for k in range(seg):
            a = 2 * PI * k / seg
            verts.append((math.cos(a) * r * s, math.sin(a) * r * s, z * s))
    for i in range(len(profile) - 1):
        for k in range(seg):
            a, b = i * seg + k, i * seg + (k + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    COL.objects.link(ob)
    return ob


VASE = [(0.001, 0), (0.05, 0), (0.095, 0.05), (0.11, 0.12), (0.085, 0.2), (0.04, 0.25), (0.035, 0.3), (0.046, 0.322),
        (0.034, 0.322), (0.027, 0.26), (0.001, 0.25)]
BOWL = [(0.001, 0), (0.07, 0), (0.16, 0.03), (0.21, 0.085), (0.216, 0.092), (0.204, 0.088), (0.15, 0.036), (0.06, 0.012), (0.001, 0.012)]
BOTTLE = [(0.001, 0), (0.05, 0), (0.062, 0.02), (0.062, 0.14), (0.046, 0.2), (0.022, 0.236), (0.022, 0.275), (0.029, 0.283),
          (0.017, 0.283), (0.017, 0.24), (0.001, 0.238)]


def jar(h):
    return [(0.001, 0), (0.045, 0), (0.05, 0.01), (0.05, h - 0.02), (0.036, h), (0.02, h), (0.02, h + 0.012), (0.001, h + 0.012)]


def cyl(r1, r2, h, loc, mat, rot=(0, 0, 0), seg=48, bv=0.0, name='cil'):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h)
    ob = obj(name, bm, mat, loc, rot)
    return bevel(ob, bv) if bv else ob


def ball(r, loc, mat, scale=(1, 1, 1), name='esfera'):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=r)
    ob = obj(name, bm, mat, loc)
    ob.scale = scale
    return ob


def foliage(center, radius, count, mat, leaf=(0.13, 0.055), squash=1.0, name='follaje'):
    verts, faces = [], []
    for _ in range(count):
        d = Vector((random.gauss(0, 1), random.gauss(0, 1), random.gauss(0, 1) * squash)).normalized()
        p = Vector(center) + d * radius * (0.45 + 0.55 * random.random())
        a = Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-0.6, 0.3))).normalized()
        b = a.cross(d).normalized() * leaf[1] * random.uniform(0.7, 1.2)
        a = a * leaf[0] * random.uniform(0.7, 1.3)
        i = len(verts)
        verts += [p - b, p + a * 0.5 - b * 0.2 + d * 0.02, p + a, p + a * 0.5 + b]
        faces.append((i, i + 1, i + 2, i + 3))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    COL.objects.link(ob)
    return ob


def curtain(x, y0, width, height, mat):
    verts, faces = [], []
    n = 70
    for i in range(n + 1):
        y = y0 + width * i / n
        dx = math.sin(i * 0.85) * 0.035 + math.sin(i * 0.31) * 0.012
        verts += [(x + dx, y, 0.02), (x + dx * 0.7, y, height)]
        if i:
            j = (i - 1) * 2
            faces.append((j, j + 2, j + 3, j + 1))
    me = bpy.data.meshes.new('cortina')
    me.from_pydata(verts, [], faces)
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = bpy.data.objects.new('cortina', me)
    ob.modifiers.new('grosor', 'SOLIDIFY').thickness = 0.003
    COL.objects.link(ob)


RX, RY = (PI / 2, 0, 0), (0, PI / 2, 0)


def wall(axis, at, a0, a1, th=0.1, openings=(), mat=None, h=2.8):
    """Muro con vanos. axis 'x': plano x=at que corre en Y; 'y': plano y=at que corre en X."""
    mat = mat or M['wall']

    def seg(s0, s1, z0, z1):
        if s1 - s0 < 1e-3 or z1 - z0 < 1e-3:
            return
        mid, zc = (s0 + s1) / 2, (z0 + z1) / 2
        if axis == 'x':
            box((th, s1 - s0, z1 - z0), (at, mid, zc), mat, 0)
        else:
            box((s1 - s0, th, z1 - z0), (mid, at, zc), mat, 0)
    cur = a0
    for (o0, o1, z0, z1) in sorted(openings):
        seg(cur, o0, 0, h)
        seg(o0, o1, 0, z0)
        seg(o0, o1, z1, h)
        cur = o1
    seg(cur, a1, 0, h)


def casing(axis, at, o0, o1, th=0.14, top=2.1):
    for sp in (o0 - 0.03, o1 + 0.03):
        if axis == 'x':
            box((th, 0.06, top + 0.03), (at, sp, (top + 0.03) / 2), M['ceil'], 0.003)
        else:
            box((0.06, th, top + 0.03), (sp, at, (top + 0.03) / 2), M['ceil'], 0.003)
    if axis == 'x':
        box((th, o1 - o0 + 0.12, 0.06), (at, (o0 + o1) / 2, top + 0.03), M['ceil'], 0.003)
    else:
        box((o1 - o0 + 0.12, th, 0.06), ((o0 + o1) / 2, at, top + 0.03), M['ceil'], 0.003)


def pane(size, loc, mat=None):
    g = box(size, loc, mat or M['glass'], 0)
    g.visible_shadow = False
    return g


def spots(points, z=2.797):
    for (x, y) in points:
        cyl(0.05, 0.05, 0.006, (x, y, z), M['spot'], seg=24)
        cyl(0.062, 0.062, 0.004, (x, y, z + 0.002), M['steel'], seg=24)


def warm(loc, energy):
    ld = bpy.data.lights.new('calida', 'POINT')
    ld.energy, ld.color, ld.shadow_soft_size = energy, (1.0, 0.82, 0.62), 0.1
    lo = bpy.data.objects.new('calida', ld)
    lo.location = loc
    COL.objects.link(lo)


def bed(xh, yc, w, L, s, head, throw):
    """Cama con cabecera en x=xh; s=+1 se extiende hacia +X, -1 hacia -X."""
    xc = xh + s * (0.08 + L / 2)
    box((0.08, w + 1.0, 1.15), (xh + s * 0.04, yc, 0.6), head, 0.02)
    box((L, w, 0.2), (xc, yc, 0.2), M['oak'], 0.012)
    for dx in (-L / 2 + 0.1, L / 2 - 0.1):
        for dy in (-w / 2 + 0.1, w / 2 - 0.1):
            cyl(0.02, 0.02, 0.1, (xc + dx, yc + dy, 0.05), M['metal'], seg=12)
    soft((L - 0.04, w - 0.02, 0.24), (xc, yc, 0.42), M['cushion'])
    puff((L * 0.7, w + 0.08, 0.1), (xc + s * L * 0.14, yc, 0.56), M['duvet'])
    for dy in (-w / 4, w / 4):
        puff((0.16, w / 2 - 0.1, 0.42), (xh + s * 0.2, yc + dy, 0.74), M['cushion'], (0, s * 0.3, 0))
    puff((0.14, 0.5, 0.3), (xh + s * 0.42, yc, 0.68), throw, (0, s * 0.45, 0))
    soft((0.5, w + 0.12, 0.05), (xc + s * L * 0.34, yc, 0.61), throw)


def nightstand(x, y, lamp=True):
    box((0.42, 0.42, 0.36), (x, y, 0.36), M['oak'], 0.006)
    for sx in (-1, 1):
        for z in (0.275, 0.445):
            box((0.012, 0.39, 0.155), (x + sx * 0.212, y, z), M['oak'], 0.003)
            cyl(0.009, 0.009, 0.014, (x + sx * 0.224, y, z), M['brass'], RY, 16)
    for dx in (-0.17, 0.17):
        for dy in (-0.17, 0.17):
            cyl(0.012, 0.016, 0.18, (x + dx, y + dy, 0.09), M['metal'], seg=12)
    if lamp:
        cyl(0.05, 0.065, 0.16, (x, y, 0.62), M['ceramic'], seg=32, bv=0.006)
        cyl(0.12, 0.09, 0.16, (x, y, 0.79), M['shade'], seg=40)

# ------------------------------------------------------------------ cascarón
box((10.2, 7.4, 0.2), (5, 3.5, -0.1), M['floor'], 0)
box((10.6, 7.8, 0.2), (5, 3.5, 2.9), M['ceil'], 0)
box((10.6, 0.2, 3), (5, -0.1, 1.4), M['wall'], 0)
wall('y', 7.1, -0.3, 10.3, 0.2, [(0.3, 1.3, 0, 2.1)], h=2.9)
casing('y', 7.1, 0.3, 1.3, 0.24)
box((0.2, 7.4, 3), (-0.1, 3.5, 1.4), M['wall'], 0)
box((10, 0.012, 0.08), (5, 0.006, 0.04), M['ceil'], 0.003)
box((3.7, 0.012, 0.08), (3.2, 6.994, 0.04), M['ceil'], 0.003)
box((0.012, 7, 0.08), (0.006, 3.5, 0.04), M['ceil'], 0.003)
# Puerta
box((0.05, 0.92, 2.08), (0.03, 5.8, 1.04), M['walnut'], 0.004)
for dy in (-0.5, 0.5):
    box((0.07, 0.06, 2.14), (0.035, 5.8 + dy, 1.07), M['ceil'], 0.004)
box((0.07, 1.06, 0.06), (0.035, 5.8, 2.14), M['ceil'], 0.004)
cyl(0.009, 0.009, 0.13, (0.09, 5.47, 1.02), M['brass'], RX, 16)
cyl(0.022, 0.022, 0.012, (0.062, 5.42, 1.02), M['brass'], RY, 24)
# Luces empotradas
for x in (1.5, 3.5, 5.5, 7.5, 9.0):
    for y in (1.7, 5.3):
        cyl(0.05, 0.05, 0.006, (x, y, 2.797), M['spot'], seg=24)
        cyl(0.062, 0.062, 0.004, (x, y, 2.799), M['steel'], seg=24)

# ------------------------------------------------------------------ ventanal + balcón
box((0.2, 7.4, 0.48), (10, 3.5, 2.56), M['wall'], 0)
POSTS = [0.05, 1.5, 2.7, 4.3, 5.5, 6.95]
for y in POSTS:
    box((0.06, 0.05, 2.32), (10, y, 1.16), M['metal'], 0.003)
box((0.06, 6.95, 0.05), (10, 3.5, 2.3), M['metal'], 0.003)
box((0.06, 6.95, 0.03), (10, 3.5, 0.015), M['metal'], 0.003)
for i in range(len(POSTS) - 1):
    if i == 2:
        continue  # corrediza abierta
    a, b = POSTS[i], POSTS[i + 1]
    g = box((0.012, b - a - 0.05, 2.26), (10, (a + b) / 2, 1.15), M['glass'], 0)
    g.visible_shadow = False
g = box((0.012, 1.55, 2.26), (10.05, 5.0, 1.15), M['glass'], 0)
g.visible_shadow = False
for y in (5.0 - 0.775, 5.0 + 0.775):
    box((0.04, 0.04, 2.26), (10.05, y, 1.15), M['metal'], 0.003)
curtain(9.86, 0.12, 0.75, 2.3, M['linen'])
curtain(9.86, 6.13, 0.75, 2.3, M['linen'])
box((0.03, 6.9, 0.02), (9.86, 3.5, 2.31), M['steel'], 0.002)
box((1.9, 7.4, 0.2), (11.05, 3.5, -0.1), M['tile'], 0)
box((1.9, 7.8, 0.2), (11.05, 3.5, 2.9), M['ceil'], 0)
for y in (-0.1, 7.1):
    box((1.9, 0.2, 3), (11.05, y, 1.4), M['wall'], 0)
g = box((0.016, 7.2, 0.98), (11.95, 3.5, 0.53), M['glass'], 0)
g.visible_shadow = False
box((0.05, 7.3, 0.035), (11.95, 3.5, 1.04), M['steel'], 0.004)
for y in (0.05, 1.85, 3.5, 5.15, 6.95):
    box((0.03, 0.03, 1.02), (11.95, y, 0.51), M['steel'], 0.003)
box((0.38, 1.8, 0.44), (11.6, 6.0, 0.22), M['cabinet'], 0.008)
for i in range(5):
    foliage((11.6, 5.3 + i * 0.35, 0.62), 0.26, 36, M['leaf'], (0.2, 0.09), 0.7)
# Silla de balcón
box((0.62, 0.62, 0.05), (11.1, 1.3, 0.34), M['oak'], 0.006)
soft((0.56, 0.56, 0.1), (11.1, 1.3, 0.42), M['cushion'])
soft((0.56, 0.1, 0.44), (11.1, 0.98, 0.66), M['cushion'], (0.18, 0, 0))
for dx in (-0.27, 0.27):
    for dy in (-0.27, 0.27):
        box((0.04, 0.04, 0.34), (11.1 + dx, 1.3 + dy, 0.17), M['oak'], 0.004)

# ------------------------------------------------------------------ cocina
box((3.6, 0.56, 0.1), (2.2, 0.3, 0.05), M['felt'], 0)
box((3.6, 0.6, 0.78), (2.2, 0.3, 0.49), M['cabinet'], 0.003)
for i in range(6):
    x = 0.4 + 0.3 + i * 0.6
    box((0.592, 0.02, 0.76), (x, 0.61, 0.49), M['cabinet'], 0.004)
    box((0.16, 0.012, 0.012), (x, 0.63, 0.83), M['brass'], 0.003)
box((3.68, 0.66, 0.03), (2.2, 0.33, 0.895), M['stone'], 0.004)
box((3.6, 0.015, 0.6), (2.2, 0.008, 1.21), M['stone'], 0)
box((3.6, 0.36, 0.75), (2.2, 0.18, 1.9), M['oak'], 0.003)
for i in range(6):
    box((0.592, 0.018, 0.74), (0.7 + i * 0.6, 0.369, 1.9), M['oak'], 0.004)
box((3.5, 0.012, 0.008), (2.2, 0.3, 1.52), M['led'], 0)
box((0.9, 0.64, 2.3), (4.5, 0.32, 1.15), M['cabinet'], 0.003)
box((0.88, 0.02, 1.05), (4.5, 0.65, 0.58), M['cabinet'], 0.004)
box((0.6, 0.02, 0.6), (4.5, 0.652, 1.48), M['blackglass'], 0.004)
box((0.5, 0.014, 0.014), (4.5, 0.68, 1.83), M['steel'], 0.003)
box((0.88, 0.02, 0.4), (4.5, 0.65, 2.08), M['cabinet'], 0.004)
box((0.6, 0.5, 0.006), (1.2, 0.33, 0.913), M['blackglass'], 0.002)
box((0.5, 0.4, 0.004), (2.9, 0.34, 0.912), M['steel'], 0.002)
cyl(0.013, 0.013, 0.3, (2.9, 0.1, 1.06), M['brass'], seg=20)
cyl(0.011, 0.011, 0.2, (2.9, 0.2, 1.2), M['brass'], RX, 20)
box((0.3, 0.02, 0.4), (3.55, 0.05, 1.11), M['oak'], 0.004, (-0.1, 0, 0))
for i, (x, r, h) in enumerate(((0.55, 0.05, 0.16), (0.68, 0.045, 0.22), (0.82, 0.04, 0.12))):
    lathe(jar(h), (x, 0.2, 0.911), M['ceramic'])
# Isla
box((2.2, 0.75, 0.1), (2.9, 2.05, 0.05), M['felt'], 0)
box((2.3, 0.85, 0.78), (2.9, 2.05, 0.49), M['cabinet'], 0.004)
box((2.44, 1.0, 0.04), (2.9, 2.05, 0.9), M['stone'], 0.005)
for sx in (-1.2, 1.2):
    box((0.04, 1.0, 0.9), (2.9 + sx, 2.05, 0.45), M['stone'], 0.005)
for x in (2.2, 2.9, 3.6):
    cyl(0.19, 0.17, 0.045, (x, 2.92, 0.68), M['oak'], seg=40, bv=0.008)
    for a in range(4):
        ang = a * PI / 2 + PI / 4
        dx, dy = math.cos(ang) * 0.13, math.sin(ang) * 0.13
        cyl(0.011, 0.011, 0.67, (x + dx * 1.15, 2.92 + dy * 1.15, 0.33), M['metal'], (dy * 0.25, -dx * 0.25, 0), 12)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, segments=40, radius=0.17)
    r = obj('aro', bm, M['metal'], (x, 2.92, 0.22))
    r.modifiers.new('piel', 'SKIN')
    for v in r.data.skin_vertices[0].data:
        v.radius = (0.008, 0.008)
lathe(BOWL, (2.35, 2.0, 0.921), M['pot'])
for (dx, dy, m) in ((-0.05, 0.02, 'fruit1'), (0.06, -0.03, 'fruit1'), (0.0, 0.07, 'fruit2'), (0.02, -0.06, 'fruit2')):
    ball(0.045, (2.35 + dx, 2.0 + dy, 0.98), M[m])
lathe(BOTTLE, (3.5, 2.12, 0.921), M['green'])
box((0.26, 0.19, 0.03), (3.1, 1.9, 0.935), M['terra'], 0.004, (0, 0, 0.3))
# Colgantes
for x in (2.4, 3.4):
    cyl(0.003, 0.003, 0.9, (x, 2.05, 2.35), M['metal'], seg=8)
    cyl(0.16, 0.035, 0.2, (x, 2.05, 1.86), M['brass'], seg=48)
    ball(0.035, (x, 2.05, 1.8), M['bulb'])

# ------------------------------------------------------------------ comedor
box((1.9, 0.95, 0.04), (3.4, 5.1, 0.74), M['oak'], 0.008)
for dx in (-0.82, 0.82):
    for dy in (-0.36, 0.36):
        cyl(0.022, 0.034, 0.72, (3.4 + dx, 5.1 + dy, 0.36), M['oak'], seg=20)
for (x, y, s) in ((2.95, 4.36, 1), (3.85, 4.36, 1), (2.95, 5.84, -1), (3.85, 5.84, -1)):
    soft((0.45, 0.45, 0.07), (x, y, 0.46), M['terra'])
    soft((0.43, 0.06, 0.36), (x, y - 0.2 * s, 0.72), M['terra'], (0.12 * s, 0, 0))
    for dx in (-0.18, 0.18):
        for dy in (-0.18, 0.18):
            cyl(0.012, 0.016, 0.44, (x + dx, y + dy, 0.22), M['walnut'], seg=12)
        cyl(0.012, 0.014, 0.42, (x + dx, y - 0.2 * s, 0.65), M['walnut'], (0.12 * s, 0, 0), 12)
lathe(VASE, (3.4, 5.1, 0.761), M['ceramic'])
for i in range(6):
    cyl(0.003, 0.004, 0.62, (3.4 + random.uniform(-0.05, 0.05), 5.1 + random.uniform(-0.05, 0.05), 1.3),
        M['walnut'], (random.uniform(-0.35, 0.35), random.uniform(-0.35, 0.35), 0), 8)
cyl(0.003, 0.003, 0.72, (3.4, 5.1, 2.44), M['metal'], seg=8)
ball(0.14, (3.4, 5.1, 1.98), M['shade'])

# ------------------------------------------------------------------ sala
box((3.9, 2.9, 0.008), (7.2, 4.95, 0.004), M['rug2'], 0.002)
box((3.7, 2.7, 0.016), (7.2, 4.95, 0.008), M['rug'], 0.004)
# Sofá
box((2.7, 0.98, 0.2), (7.2, 6.1, 0.24), M['sofa'], 0.03)
soft((0.26, 0.98, 0.5), (5.95, 6.1, 0.42), M['sofa'])
soft((0.26, 0.98, 0.5), (8.45, 6.1, 0.42), M['sofa'])
soft((2.3, 0.26, 0.58), (7.2, 6.5, 0.56), M['sofa'])
for x in (6.63, 7.77):
    soft((1.12, 0.74, 0.2), (x, 6.0, 0.45), M['cushion'])
for x in (6.5, 7.2, 7.9):
    soft((0.66, 0.2, 0.44), (x, 6.3, 0.74), M['cushion'], (-0.22, 0, 0))
puff((0.44, 0.15, 0.42), (6.28, 6.16, 0.76), M['terra'], (-0.35, 0, 0.3))
puff((0.44, 0.15, 0.42), (8.12, 6.16, 0.76), M['green'], (-0.35, 0, -0.25))
for x in (5.95, 8.45):
    for y in (5.7, 6.5):
        cyl(0.018, 0.012, 0.14, (x, y, 0.07), M['walnut'], seg=12)
# Mesa de centro
cyl(0.52, 0.52, 0.035, (7.2, 4.6, 0.36), M['stone'], seg=96, bv=0.008)
cyl(0.2, 0.26, 0.34, (7.2, 4.6, 0.17), M['metal'], seg=64, bv=0.01)
box((0.3, 0.22, 0.035), (7.05, 4.55, 0.395), M['green'], 0.005, (0, 0, 0.3))
box((0.26, 0.2, 0.03), (7.05, 4.55, 0.428), M['terra'], 0.005, (0, 0, 0.1))
lathe(VASE, (7.42, 4.72, 0.379), M['ceramic'], 0.6)
# Sillón
rz = 0.5
box((0.78, 0.78, 0.06), (5.35, 4.5, 0.2), M['walnut'], 0.008, (0, 0, rz))
soft((0.74, 0.74, 0.22), (5.35, 4.5, 0.36), M['boucle'], (0, 0, rz))
soft((0.2, 0.78, 0.52), (5.07, 4.345, 0.56), M['boucle'], (0, -0.15, rz))
for (dx, dy) in ((-0.33, -0.33), (0.33, -0.33), (-0.33, 0.33), (0.33, 0.33)):
    px, py = dx * math.cos(rz) - dy * math.sin(rz), dx * math.sin(rz) + dy * math.cos(rz)
    cyl(0.014, 0.02, 0.18, (5.35 + px, 4.5 + py, 0.09), M['walnut'], seg=12)
# Lámpara de pie
cyl(0.15, 0.15, 0.015, (9.0, 6.5, 0.008), M['brass'], seg=48, bv=0.004)
cyl(0.009, 0.009, 1.5, (9.0, 6.5, 0.76), M['brass'], seg=16)
cyl(0.2, 0.14, 0.28, (9.0, 6.5, 1.58), M['shade'], seg=48)
# Muro de listones tras el sofá
box((4.2, 0.02, 2.6), (7.2, 6.985, 1.4), M['felt'], 0)
bm = bmesh.new()
for i in range(70):
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation((5.13 + i * 0.06, 6.955, 1.4)) @ Matrix.Diagonal((0.032, 0.04, 2.6, 1)))
bevel(obj('listones', bm, M['oak'], smooth=True), 0.003)
# Aparador
box((2.8, 0.42, 0.46), (7, 0.31, 0.5), M['oak'], 0.006)
for i in range(4):
    box((0.688, 0.016, 0.44), (5.95 + i * 0.7, 0.527, 0.5), M['oak'], 0.004)
    cyl(0.012, 0.012, 0.012, (5.95 + i * 0.7 + (0.28 if i % 2 == 0 else -0.28), 0.54, 0.6), M['brass'], RX, 20)
for x in (5.75, 8.25):
    for y in (0.16, 0.46):
        cyl(0.012, 0.018, 0.27, (x, y, 0.135), M['metal'], seg=12)
lathe(VASE, (6.1, 0.3, 0.731), M['ceramic'], 0.75)
cyl(0.16, 0.11, 0.2, (6.1, 0.3, 1.08), M['shade'], seg=48)
box((0.3, 0.22, 0.04), (7.6, 0.3, 0.75), M['green'], 0.005)
box((0.27, 0.2, 0.035), (7.6, 0.3, 0.787), M['paper'], 0.005, (0, 0, 0.15))
ball(0.085, (8.05, 0.3, 0.815), M['brass'])
# Cuadro
box((1.7, 0.035, 1.06), (7.3, 0.02, 1.68), M['walnut'], 0.005)
box((1.6, 0.01, 0.96), (7.3, 0.04, 1.68), M['paper'], 0)
cyl(0.3, 0.3, 0.004, (7.3, 0.047, 1.56), M['ochre'], RX, 64)
box((1.0, 0.008, 0.34), (7.3, 0.05, 1.39), M['paper'], 0)
box((0.9, 0.006, 0.012), (7.3, 0.05, 1.555), M['felt'], 0)
# Planta
cyl(0.24, 0.17, 0.44, (9.35, 0.75, 0.22), M['pot'], seg=48, bv=0.01)
for i in range(3):
    cyl(0.012, 0.02, 1.2, (9.35 + (i - 1) * 0.05, 0.75, 1.0), M['walnut'], ((i - 1) * 0.12, (i - 1) * 0.1, 0), 12)
foliage((9.35, 0.75, 1.75), 0.52, 110, M['leaf'], (0.3, 0.13), 0.9)


# ------------------------------------------------------------------ ala privada
Y0, Y1 = 7.2, 11.6
box((10.4, Y1 - Y0 + 0.2, 0.2), (5, (Y0 + Y1) / 2 + 0.1, -0.1), M['floor'], 0)
box((10.6, Y1 - Y0 + 0.4, 0.2), (5, (Y0 + Y1) / 2 + 0.1, 2.9), M['ceil'], 0)
wall('x', -0.1, Y0, Y1 + 0.2, 0.2, h=2.9)
wall('y', Y1 + 0.1, -0.2, 10.2, 0.2, [(0.8, 1.6, 1.5, 2.2), (3.2, 5.2, 0.9, 2.3)], h=2.9)
wall('x', 10.0, Y0, Y1 + 0.2, 0.2, [(8.7, 11.3, 0.0, 2.3)], h=2.9)
wall('y', 8.35, 0.0, 7.0, 0.1, [(0.85, 1.75, 0, 2.1), (2.65, 3.55, 0, 2.1)])
wall('x', 2.45, 8.4, Y1, 0.1)
wall('x', 5.95, 8.4, Y1, 0.1)
wall('x', 7.0, Y0, 8.3, 0.1, [(7.3, 8.2, 0, 2.1)])
casing('y', 8.35, 0.85, 1.75)
casing('y', 8.35, 2.65, 3.55)
casing('x', 7.0, 7.3, 8.2)
# Hojas de puerta abiertas
box((0.04, 0.86, 2.06), (1.72, 8.84, 1.03), M['walnut'], 0.004)
box((0.04, 0.86, 2.06), (2.68, 8.84, 1.03), M['walnut'], 0.004)
box((0.86, 0.04, 2.06), (7.5, 7.32, 1.03), M['walnut'], 0.004)
for loc, rot in (((1.67, 9.2, 1.02), RY), ((2.73, 9.2, 1.02), RY), ((7.86, 7.37, 1.02), RX)):
    cyl(0.009, 0.009, 0.12, loc, M['brass'], rot, 16)

# --- Pasillo
box((5.6, 0.75, 0.01), (3.6, 7.75, 0.005), M['rug'], 0.003)
spots([(1.3, 7.75), (3.1, 7.75), (4.9, 7.75), (6.3, 7.75)])
for x, c in ((2.2, 'ochre'), (4.4, 'green'), (5.6, 'terra')):
    box((0.5, 0.03, 0.7), (x, 7.215, 1.55), M['walnut'], 0.004)
    box((0.42, 0.01, 0.62), (x, 7.234, 1.55), M['paper'], 0)
    cyl(0.11, 0.11, 0.004, (x, 7.241, 1.5), M[c], RX, 48)
warm((3.6, 7.75, 2.4), 30)

# --- Baño (x 0..2.4, y 8.4..11.6)
box((2.4, 3.2, 0.012), (1.2, 10.0, 0.006), M['slab'], 0)
box((2.4, 0.012, 2.8), (1.2, 11.594, 1.4), M['slab'], 0)
box((0.012, 1.25, 2.8), (0.006, 10.97, 1.4), M['slab'], 0)
box((0.012, 1.25, 2.8), (2.394, 10.97, 1.4), M['slab'], 0)
pane((1.5, 0.012, 2.1), (1.64, 10.35, 1.05))
box((1.5, 0.03, 0.03), (1.64, 10.35, 2.11), M['metal'], 0.003)
box((2.36, 1.2, 0.02), (1.2, 10.98, 0.012), M['felt'], 0)
cyl(0.012, 0.012, 0.42, (1.2, 11.38, 2.25), M['brass'], RX, 16)
cyl(0.14, 0.14, 0.012, (1.2, 11.17, 2.24), M['brass'], seg=48)
cyl(0.03, 0.03, 0.02, (1.2, 11.58, 1.15), M['brass'], RX, 24)
cyl(0.03, 0.03, 0.02, (1.36, 11.58, 1.15), M['brass'], RX, 24)
box((0.6, 0.1, 0.3), (0.5, 11.55, 1.25), M['wall'], 0.004)
for x, h in ((0.36, 0.18), (0.48, 0.14), (0.6, 0.2)):
    cyl(0.03, 0.03, h, (x, 11.46, 1.41 + h / 2), M['ceramic'], seg=20, bv=0.004)
pane((0.8, 0.012, 0.7), (1.2, 11.7, 1.85), M['frost'])
# Tocador flotante
box((0.5, 1.3, 0.3), (0.26, 9.3, 0.7), M['oak'], 0.006)
box((0.54, 1.36, 0.035), (0.27, 9.3, 0.87), M['stone'], 0.005)
cyl(0.2, 0.15, 0.13, (0.29, 9.3, 0.953), M['ceramic'], seg=48, bv=0.008)
cyl(0.012, 0.012, 0.2, (0.1, 9.3, 1.16), M['brass'], RY, 16)
cyl(0.02, 0.02, 0.012, (0.012, 9.3, 1.16), M['brass'], RY, 24)
cyl(0.43, 0.43, 0.008, (0.014, 9.3, 1.62), M['led'], RY, 64)
cyl(0.4, 0.4, 0.012, (0.02, 9.3, 1.62), M['mirror'], RY, 64)
cyl(0.035, 0.03, 0.12, (0.2, 8.85, 0.95), M['ceramic'], seg=20, bv=0.004)
for i in range(3):
    box((0.3, 0.2, 0.03), (0.28, 9.75, 0.905 + i * 0.031), M['towel'], 0.008)
# Sanitario suspendido
tb = cyl(0.19, 0.15, 0.36, (2.02, 9.35, 0.38), M['ceramic'], seg=64, bv=0.012)
tb.scale = (1.4, 1, 1)
box((0.16, 0.36, 0.36), (2.31, 9.35, 0.38), M['ceramic'], 0.015)
tl = cyl(0.195, 0.195, 0.022, (2.02, 9.35, 0.575), M['ceramic'], seg=64, bv=0.006)
tl.scale = (1.4, 1, 1)
box((0.012, 0.24, 0.16), (2.394, 9.35, 1.05), M['steel'], 0.004)
# Toallero
cyl(0.008, 0.008, 0.6, (2.36, 8.85, 1.25), M['brass'], RX, 12)
soft((0.05, 0.42, 0.6), (2.34, 8.85, 0.97), M['towel'])
cyl(0.11, 0.08, 0.2, (2.2, 10.1, 0.11), M['pot'], seg=32, bv=0.006)
foliage((2.2, 10.1, 0.55), 0.26, 34, M['leaf'], (0.26, 0.1), 1.2)
spots([(1.2, 9.2), (1.2, 10.95)])
warm((1.2, 9.4, 2.3), 44)
warm((1.2, 10.9, 2.3), 22)

# --- Alcoba 2 (x 2.5..5.9, y 8.4..11.6)
box((2.6, 2.3, 0.012), (4.5, 10.0, 0.006), M['rug'], 0.004)
bed(5.9, 10.0, 1.4, 1.95, -1, M['boucle'], M['terra'])
nightstand(5.62, 9.02)
nightstand(5.62, 10.98, False)
lathe(VASE, (5.62, 10.98, 0.541), M['ceramic'], 0.55)
box((0.62, 1.5, 2.4), (2.81, 10.3, 1.2), M['oak'], 0.004)
for y in (9.93, 10.67):
    box((0.02, 0.72, 2.36), (3.125, y, 1.2), M['oak'], 0.004)
    box((0.012, 0.012, 0.3), (3.14, 10.3 + (0.06 if y > 10.3 else -0.06), 1.1), M['brass'], 0.003)
box((1.3, 0.55, 0.035), (3.9, 11.3, 0.74), M['oak'], 0.006)
for x in (3.3, 4.5):
    for y in (11.08, 11.52):
        cyl(0.014, 0.014, 0.72, (x, y, 0.36), M['metal'], seg=12)
soft((0.44, 0.44, 0.07), (3.9, 10.82, 0.46), M['green'])
soft((0.42, 0.06, 0.34), (3.9, 10.62, 0.7), M['green'], (0.1, 0, 0))
for dx in (-0.18, 0.18):
    for dy in (-0.18, 0.18):
        cyl(0.012, 0.016, 0.44, (3.9 + dx, 10.82 + dy, 0.22), M['walnut'], seg=12)
box((0.3, 0.2, 0.02), (3.75, 11.3, 0.77), M['metal'], 0.004)
cyl(0.05, 0.06, 0.02, (4.35, 11.38, 0.77), M['brass'], seg=32)
cyl(0.006, 0.006, 0.36, (4.35, 11.38, 0.95), M['brass'], seg=12)
cyl(0.09, 0.05, 0.1, (4.35, 11.38, 1.16), M['brass'], seg=32)
box((1.0, 0.03, 0.7), (5.0, 8.42, 1.6), M['walnut'], 0.004)
box((0.92, 0.01, 0.62), (5.0, 8.44, 1.6), M['paper'], 0)
cyl(0.18, 0.18, 0.004, (5.0, 8.447, 1.55), M['terra'], RX, 48)
pane((2.0, 0.012, 1.4), (4.2, 11.7, 1.6))
for x in (3.2, 4.2, 5.2):
    box((0.04, 0.05, 1.4), (x, 11.7, 1.6), M['metal'], 0.003)
for z in (0.92, 2.28):
    box((2.04, 0.05, 0.04), (4.2, 11.7, z), M['metal'], 0.003)
box((2.1, 0.22, 0.03), (4.2, 11.62, 0.89), M['stone'], 0.004)
box((2.1, 0.02, 0.3), (4.2, 11.62, 2.2), M['linen'], 0)
spots([(3.6, 9.4), (4.8, 10.6)])
warm((4.3, 10.0, 2.3), 26)

# --- Alcoba principal (x 6..10, y 8.4..11.6) + vestier (x 7..10, y 7.2..8.3)
box((3.2, 2.9, 0.012), (7.9, 10.0, 0.006), M['rug'], 0.004)
bed(6.0, 10.0, 1.8, 2.05, 1, M['velvet'], M['green'])
for y in (8.82, 11.18):
    nightstand(6.3, y, False)
    cyl(0.003, 0.003, 1.5, (6.3, y, 2.05), M['metal'], seg=8)
    cyl(0.11, 0.03, 0.16, (6.3, y, 1.24), M['brass'], seg=48)
    ball(0.03, (6.3, y, 1.19), M['bulb'])
soft((0.45, 1.5, 0.3), (8.45, 10.0, 0.3), M['boucle'])
for dy in (-0.6, 0.6):
    for dx in (-0.16, 0.16):
        cyl(0.014, 0.014, 0.16, (8.45 + dx, 10.0 + dy, 0.08), M['walnut'], seg=12)
box((1.2, 0.03, 0.8), (6.02, 10.0, 1.75), M['walnut'], 0.004, (0, 0, PI / 2))
box((1.12, 0.01, 0.72), (6.04, 10.0, 1.75), M['paper'], 0, (0, 0, PI / 2))
cyl(0.2, 0.2, 0.004, (6.047, 10.0, 1.68), M['ochre'], RY, 48)
# Rincón de lectura junto al ventanal
soft((0.7, 0.7, 0.22), (9.2, 11.0, 0.36), M['sofa'], (0, 0, -0.6))
soft((0.7, 0.2, 0.5), (9.39, 11.27, 0.58), M['sofa'], (0.15, 0, -0.6))
cyl(0.22, 0.22, 0.025, (8.55, 11.15, 0.5), M['stone'], seg=48, bv=0.006)
cyl(0.02, 0.1, 0.5, (8.55, 11.15, 0.25), M['metal'], seg=32)
# Ventanal oriental
for y in (8.7, 10.0, 11.3):
    box((0.06, 0.05, 2.32), (10, y, 1.16), M['metal'], 0.003)
box((0.06, 2.6, 0.05), (10, 10.0, 2.3), M['metal'], 0.003)
box((0.06, 2.6, 0.03), (10, 10.0, 0.015), M['metal'], 0.003)
for y in (9.35, 10.65):
    pane((0.012, 1.25, 2.26), (10, y, 1.15))
curtain(9.86, 8.72, 0.6, 2.3, M['linen'])
curtain(9.86, 10.68, 0.6, 2.3, M['linen'])
# Vestier
box((2.0, 0.6, 2.5), (8.98, 7.52, 1.25), M['oak'], 0.004)
for i in range(4):
    x = 8.23 + i * 0.5
    box((0.492, 0.02, 2.44), (x, 7.83, 1.25), M['oak'], 0.004)
    box((0.012, 0.012, 0.3), (x + (0.2 if i % 2 == 0 else -0.2), 7.846, 1.1), M['brass'], 0.003)
box((0.9, 0.03, 1.7), (6.5, 8.42, 1.05), M['walnut'], 0.004)
box((0.82, 0.012, 1.62), (6.5, 8.44, 1.05), M['mirror'], 0)
spots([(7.6, 7.75), (9.0, 8.1), (7.4, 9.4), (8.6, 10.6)])
warm((8.0, 10.0, 2.3), 30)
warm((8.4, 7.9, 2.3), 16)


# ------------------------------------------------------------------ detalle
# Isla acanalada
slats(1.79, 45, 0.05, 2.49, 0.49, 0.76, M['oak'])
slats(1.79, 45, 0.05, 1.61, 0.49, 0.76, M['oak'])
# Luz lineal en techo de la zona social
box((9.4, 0.03, 0.008), (5, 0.3, 2.796), M['led'], 0)
box((4.4, 0.03, 0.008), (3.3, 6.7, 2.796), M['led'], 0)
# Biblioteca abierta junto a la entrada
for z in (0.06, 0.52, 0.98, 1.44, 1.9):
    box((0.3, 1.9, 0.03), (0.16, 3.2, z), M['oak'], 0.003)
for y in (2.26, 3.2, 4.14):
    box((0.3, 0.03, 1.87), (0.16, y, 0.98), M['oak'], 0.003)
box((0.012, 1.9, 1.87), (0.012, 3.2, 0.98), M['felt'], 0)
for z in (0.075, 0.535, 0.995, 1.455):
    books(0.17, 2.3, 3.16, z)
    books(0.17, 3.24, 4.1, z)
cyl(0.06, 0.08, 0.2, (0.17, 2.7, 2.015), M['ceramic'], seg=32, bv=0.006)
ball(0.08, (0.17, 3.7, 2.0), M['brass'])
# Interruptores y tomas
for loc, ax in (((1.55, 6.994, 1.15), 'y'), ((0.006, 5.1, 1.15), 'x'), ((5.2, 0.006, 0.3), 'y'), ((8.9, 0.006, 0.3), 'y'),
                ((2.05, 8.396, 1.15), 'y'), ((3.85, 8.396, 1.15), 'y'), ((6.006, 8.75, 0.75), 'x'), ((5.944, 9.0, 0.75), 'x'),
                ((7.056, 7.26, 1.15), 'x'), ((2.394, 8.6, 1.15), 'x')):
    plate(loc, ax)
# Juntas de porcelanato en el baño
for x in (0.6, 1.2, 1.8):
    box((0.004, 0.004, 2.8), (x, 11.586, 1.4), M['felt'], 0)
    box((0.004, 3.2, 0.002), (x, 10.0, 0.0125), M['felt'], 0)
for y in (9.0, 9.6, 10.2):
    box((2.4, 0.004, 0.002), (1.2, y, 0.0125), M['felt'], 0)
for z in (0.93, 1.87):
    box((2.4, 0.004, 0.004), (1.2, 11.586, z), M['felt'], 0)
    for x in (0.014, 2.386):
        box((0.004, 1.25, 0.004), (x, 10.97, z), M['felt'], 0)
# Manta sobre el sofá y bandeja en la cama
box((0.5, 0.9, 0.025), (8.3, 6.02, 0.565), M['green'], 0.01)
box((0.5, 0.03, 0.4), (8.3, 5.585, 0.37), M['green'], 0.01)
box((0.45, 0.3, 0.02), (7.4, 10.35, 0.63), M['oak'], 0.006)
cyl(0.04, 0.03, 0.08, (7.3, 10.35, 0.68), M['ceramic'], seg=24, bv=0.004)
box((0.2, 0.14, 0.02), (7.5, 10.33, 0.65), BOOKS[3], 0.003, (0, 0, 0.2))
# Plantita y libros en el escritorio
cyl(0.05, 0.04, 0.09, (3.4, 11.4, 0.803), M['pot'], seg=24, bv=0.004)
foliage((3.4, 11.4, 0.95), 0.12, 20, M['leaf'], (0.13, 0.06), 1.1)
for i, t in enumerate((0.03, 0.025, 0.035)):
    box((0.2, 0.15, t), (4.05, 11.25, 0.775 + i * 0.033), BOOKS[i + 1], 0.003, (0, 0, 0.1 * i))

# ------------------------------------------------------------------ exterior
GROUND = -46
ground = pmat('suelo', 0x7f8f6c, 0.95)
nt, b, new, link = nodes(ground)
add_haze(ground, ramp(nt, noise_tex(nt, coords(nt, (0.01, 0.01, 0.01)), 3, 6), [(0.35, 0x45603a), (0.6, 0x6c7358)]))
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=2, y_segments=2, size=4000)
obj('suelo', bm, ground, (1500, 0, GROUND), smooth=False)

# Edificios con ventanas (textura en coordenadas reales)
city = pmat('ciudad', 0xd8d0c2, 0.85)
nt, b, new, link = nodes(city)
tc = new('ShaderNodeTexCoord')
sep = new('ShaderNodeSeparateXYZ')
link(tc.outputs['Object'], sep.inputs[0])
add = new('ShaderNodeMath')
link(sep.outputs[0], add.inputs[0])
link(sep.outputs[1], add.inputs[1])
comb = new('ShaderNodeCombineXYZ')
link(add.outputs[0], comb.inputs[0])
link(sep.outputs[2], comb.inputs[1])
br = new('ShaderNodeTexBrick')
br.offset = 0.0
br.inputs['Scale'].default_value = 1
br.inputs['Brick Width'].default_value = 2.6
br.inputs['Row Height'].default_value = 3.1
br.inputs['Mortar Size'].default_value = 0.55
br.inputs['Color1'].default_value = (*hexc(0x27313a), 1)
br.inputs['Color2'].default_value = (*hexc(0x3d4a55), 1)
link(comb.outputs[0], br.inputs['Vector'])
tone = ramp(nt, noise_tex(nt, coords(nt, (0.05, 0.05, 0.0)), 1.0, 0),
            [(0.25, 0xe4ddd0), (0.4, 0xcdb9a0), (0.52, 0xa9684b), (0.64, 0xd9d5cd), (0.78, 0x9b8f84)])
link(tone, br.inputs['Mortar'])
geo = new('ShaderNodeNewGeometry')
sn = new('ShaderNodeSeparateXYZ')
link(geo.outputs['Normal'], sn.inputs[0])
gt = new('ShaderNodeMath')
gt.operation = 'GREATER_THAN'
gt.inputs[1].default_value = 0.5
link(sn.outputs[2], gt.inputs[0])
add_haze(city, mix(nt, br.outputs['Color'], (*hexc(0xb8ada0), 1), gt.outputs[0]))
class Batch:
    """Acumula copias transformadas de una malla base y crea un solo objeto (rápido)."""
    def __init__(self, base_verts, base_faces):
        self.bv, self.bf, self.v, self.f = base_verts, base_faces, [], []

    def add(self, mtx):
        o = len(self.v)
        self.v += [tuple(mtx @ v) for v in self.bv]
        self.f += [tuple(i + o for i in f) for f in self.bf]

    def build(self, name, mat, smooth=False):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        if smooth:
            for p in me.polygons:
                p.use_smooth = True
        me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        COL.objects.link(ob)
        return ob


def base_mesh(make):
    bm = bmesh.new()
    make(bm)
    v = [vt.co.copy() for vt in bm.verts]
    f = [[vt.index for vt in fc.verts] for fc in bm.faces]
    bm.free()
    return v, f


CUBE = base_mesh(lambda bm: bmesh.ops.create_cube(bm, size=1))
ICO = base_mesh(lambda bm: bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1))
ROT = Matrix.Rotation(0.38, 4, 'Z')
PITCH, STREET = 74, 14
city_b = Batch(*CUBE)
tree_spots = []
for gx in range(-9, 22):
    for gy in range(-17, 19):
        for lx in range(3):
            for ly in range(3):
                cx = gx * PITCH + STREET / 2 + 10 + lx * 20
                cy = gy * PITCH + STREET / 2 + 10 + ly * 20
                w = ROT @ Vector((cx, cy, 0))
                if abs(w.x - 5) < 75 and abs(w.y - 6) < 75:
                    continue
                if random.random() < 0.16:
                    tree_spots.append((cx, cy))
                    continue
                tower = random.random() < 0.035 and (w.x > 220 or w.y > 240)
                h = random.uniform(28, 62) if tower else 4 + random.random() ** 1.8 * 13
                sx, sy = random.uniform(13, 18), random.uniform(13, 18)
                city_b.add(ROT @ Matrix.Translation((cx, cy, GROUND + h / 2)) @ Matrix.Diagonal((sx, sy, h, 1)))
                if random.random() < 0.5:
                    city_b.add(ROT @ Matrix.Translation((cx + random.uniform(-3, 3), cy + random.uniform(-3, 3), GROUND + h + 1)) @ Matrix.Diagonal((random.uniform(2.5, 5), random.uniform(2.5, 5), 2, 1)))
city_b.build('ciudad', city)
add_haze(ASPHALT)
st_b = Batch(*CUBE)
for g in range(-9, 23):
    st_b.add(ROT @ Matrix.Translation((g * PITCH, 60, GROUND + 0.1)) @ Matrix.Diagonal((STREET * 0.7, 2800, 0.2, 1)))
for g in range(-17, 20):
    st_b.add(ROT @ Matrix.Translation((480, g * PITCH, GROUND + 0.1)) @ Matrix.Diagonal((2400, STREET * 0.7, 0.2, 1)))
st_b.build('calles', ASPHALT)

trees = pmat('arboles', 0x3f5f3a, 0.9)
add_haze(trees)
tr_b = Batch(*ICO)
for (cx, cy) in tree_spots:
    for _ in range(random.randint(2, 5)):
        r = random.uniform(2.2, 4.2)
        tr_b.add(ROT @ Matrix.Translation((cx + random.uniform(-7, 7), cy + random.uniform(-7, 7), GROUND + r * 0.9)) @ Matrix.Diagonal((r, r, r * 0.9, 1)))
tr_b.build('arboles', trees, True)

# Cordillera
mount = pmat('cordillera', 0x4f6b4a, 0.95)
nt, b, new, link = nodes(mount)
add_haze(mount, ramp(nt, noise_tex(nt, coords(nt, (0.004, 0.004, 0.004)), 2, 8), [(0.3, 0x3f5c40), (0.7, 0x6f8563)]), 600, 3800, 0.93)
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=150, y_segments=220, size=1)
for v in bm.verts:
    x, y = 1300 + (v.co.x + 1) * 1400, v.co.y * 3200
    rise = min(1, max(0, (x - 1300) / 900))
    rise = rise * rise * (3 - 2 * rise)
    f = noise.fractal(Vector((x * 0.0011, y * 0.0011, 3.1)), 1.0, 2.1, 6)
    ridge = 1 - abs(noise.noise(Vector((x * 0.0006, y * 0.0006, 9.0))))
    v.co = Vector((x, y, GROUND + rise * (260 + 420 * ridge + 240 * f)))
obj('cordillera', bm, mount)

# ------------------------------------------------------------------ luz
SUN_DIR = Vector((-1.0, -0.34, -0.44)).normalized()   # entra por el ventanal
sun_data = bpy.data.lights.new('sol', 'SUN')
sun_data.energy = 3.7
sun_data.angle = math.radians(1.2)
sun_data.color = (1.0, 0.9, 0.76)
sun = bpy.data.objects.new('sol', sun_data)
sun.rotation_euler = SUN_DIR.to_track_quat('-Z', 'Y').to_euler()
COL.objects.link(sun)
for loc, e in (((2.9, 2.05, 1.7), 26), ((3.4, 5.1, 1.75), 22), ((9.0, 6.5, 1.5), 16), ((6.1, 0.3, 1.0), 9)):
    ld = bpy.data.lights.new('calida', 'POINT')
    ld.energy, ld.color, ld.shadow_soft_size = e, (1.0, 0.82, 0.62), 0.1
    lo = bpy.data.objects.new('calida', ld)
    lo.location = loc
    COL.objects.link(lo)

world = bpy.data.worlds.new('cielo')
scene.world = world
world.use_nodes = True
wnt = world.node_tree
sky = wnt.nodes.new('ShaderNodeTexSky')
for k, v in (('sky_type', 'MULTIPLE_SCATTERING'), ('sun_disc', False), ('sun_elevation', math.radians(24)),
             ('sun_rotation', math.radians(-70)), ('altitude', 1400), ('air_density', 1.0),
             ('aerosol_density', 1.4), ('dust_density', 1.4), ('ozone_density', 1.0)):
    try:
        setattr(sky, k, v)
    except Exception as ex:
        print('sky attr', k, ex)
bg = wnt.nodes['Background']
bg.inputs['Strength'].default_value = 0.5
wnt.links.new(sky.outputs[0], bg.inputs['Color'])

# ------------------------------------------------------------------ cámara y recorrido
cam_data = bpy.data.cameras.new('cam')
cam_data.lens, cam_data.sensor_width = 19, 36
cam_data.clip_start, cam_data.clip_end = 0.05, 9000
cam = bpy.data.objects.new('cam', cam_data)
COL.objects.link(cam)
scene.camera = cam

# Recorrido continuo, sin cortes: una persona entra, recorre la zona social, se asoma al balcón,
# vuelve, toma el pasillo, entra y sale del baño y de la alcoba 2, y termina en la principal.
# Cada punto: (posición x, y) → (hacia dónde mira x, y, z) y, si cambia de espacio, su rótulo.
EYE = 1.55
WAY = [
    ((0.70, 5.80), (5.0, 4.5, 1.3), ('Sala comedor', 'Sala, comedor y cocina en un solo espacio.')),
    ((1.60, 4.30), (3.0, 1.6, 1.0), None),
    ((1.90, 3.40), (3.0, 1.2, 1.0), ('Cocina', 'Isla acanalada en roble, mesón en piedra.')),
    ((4.60, 3.50), (7.5, 5.6, 0.9), None),
    ((6.20, 3.20), (8.6, 5.6, 0.9), ('Sala', 'Abierta al balcón, luz de oriente.')),
    ((8.60, 3.40), (30.0, 3.5, 2.0), None),
    ((9.30, 3.50), (300.0, 3.5, 30.0), ('Balcón', 'La cordillera completa al amanecer.')),
    ((8.60, 3.60), (5.0, 5.6, 1.2), None),                      # media vuelta
    ((6.00, 3.40), (1.5, 6.0, 1.3), None),
    ((4.00, 3.50), (0.9, 6.5, 1.4), ('Hacia las alcobas', 'El pasillo separa lo social de lo privado.')),
    ((1.50, 4.60), (0.8, 7.5, 1.4), None),
    ((0.85, 6.30), (0.8, 8.0, 1.4), None),
    ((0.80, 7.40), (3.5, 7.75, 1.4), ('Pasillo', 'Baño, alcoba 2 y alcoba principal.')),
    ((1.10, 7.75), (1.3, 9.5, 1.2), None),
    ((1.25, 8.60), (0.3, 9.4, 1.15), ('Baño', 'Porcelanato gran formato, ducha en vidrio.')),
    ((1.30, 9.20), (1.6, 11.2, 1.1), None),
    ((1.30, 9.10), (1.3, 7.6, 1.4), None),                      # media vuelta y sale
    ((1.35, 7.90), (3.2, 7.8, 1.4), ('Pasillo', 'Siguiente puerta: alcoba 2.')),
    ((2.60, 7.75), (3.1, 9.5, 1.1), None),
    ((3.10, 8.50), (4.8, 10.3, 0.8), ('Alcoba 2', 'Ventana al norte, clóset y escritorio.')),
    ((3.50, 9.30), (4.6, 11.6, 1.2), None),
    ((3.50, 9.20), (3.1, 7.6, 1.4), None),                      # media vuelta y sale
    ((3.10, 7.95), (5.5, 7.75, 1.4), ('Pasillo', 'Al fondo, la alcoba principal.')),
    ((5.60, 7.75), (8.5, 7.8, 1.3), None),
    ((7.60, 7.85), (9.4, 8.6, 1.1), ('Vestier', 'Paso directo hacia la alcoba principal.')),
    ((8.70, 8.60), (6.6, 10.2, 0.7), ('Alcoba principal', 'Ventanal de piso a techo hacia la cordillera.')),
    ((9.00, 9.90), (7.2, 10.6, 0.8), None),
    ((9.35, 10.0), (400.0, 10.0, 40.0), None),
]
SEGMENTS = [('tour', 'Recorrido', int(arg(7, 380)), WAY)]


def spline(pts, t):
    n = len(pts) - 1
    f = min(max(t, 0), 1) * n
    i = min(int(f), n - 1)
    u = f - i
    p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)


# La mirada se interpola como ángulos (giro y cabeceo), no como puntos:
# así una media vuelta es un giro suave y nunca un salto.
POS = [Vector((w[0][0], w[0][1], EYE)) for w in WAY]
YAW, PITCH = [], []
for (px, py), (tx, ty, tz), _ in WAY:
    yaw = math.atan2(ty - py, tx - px)
    if YAW:                                  # por el camino más corto respecto al punto anterior
        while yaw - YAW[-1] > math.pi:
            yaw -= 2 * math.pi
        while yaw - YAW[-1] < -math.pi:
            yaw += 2 * math.pi
    YAW.append(yaw)
    PITCH.append(math.atan2(tz - EYE, math.hypot(tx - px, ty - py)))


def look_dir(u):
    y, pt = spline(YAW, u), spline(PITCH, u)
    return Vector((math.cos(pt) * math.cos(y), math.cos(pt) * math.sin(y), math.sin(pt)))


# Tabla distancia→parámetro: cuenta lo que se camina y lo que se gira, para un ritmo parejo.
ARC = [0.0]
_pp, _pd = spline(POS, 0), look_dir(0)
NARC = 1200
for _i in range(1, NARC + 1):
    _u = _i / NARC
    _p, _d = spline(POS, _u), look_dir(_u)
    ARC.append(ARC[-1] + (_p - _pp).length + 1.5 * _pd.angle(_d, 0.0))
    _pp, _pd = _p, _d


def param(t):
    t = t * t * (3 - 2 * t) * 0.3 + t * 0.7          # arranque y llegada suaves
    want = t * ARC[-1]
    lo, hi = 0, NARC
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if ARC[mid] < want:
            lo = mid
        else:
            hi = mid
    span = ARC[hi] - ARC[lo]
    return (lo + (0.0 if span < 1e-9 else (want - ARC[lo]) / span)) / NARC


def pose(seg, t):
    u = param(t)
    cam.location = spline(POS, u)
    cam.rotation_euler = look_dir(u).to_track_quat('-Z', 'Y').to_euler()


def tour_marks(frames):
    """Cuadro en el que empieza cada rótulo."""
    us = [param(k / (frames - 1)) for k in range(frames)]
    marks, n = [], len(WAY) - 1
    for i, w in enumerate(WAY):
        if w[2]:
            k = next((k for k, u in enumerate(us) if u >= i / n - 1e-6), frames - 1)
            marks.append({'frame': k, 'title': w[2][0], 'text': w[2][1]})
    return marks


# ------------------------------------------------------------------ render
r = scene.render
r.resolution_x, r.resolution_y, r.resolution_percentage = W, int(W * 9 / 16), 100
r.use_persistent_data = True
try:
    r.engine = ENGINE
except Exception as ex:
    print('engine', ex)
if r.engine == 'CYCLES':
    c = scene.cycles
    gpu = False
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'OPTIX'
            gpu = gpu or d.use
    except Exception as ex:
        print('gpu', ex)
    print('GPU', gpu)
    c.samples, c.use_denoising, c.device = SAMPLES, True, 'GPU' if gpu else 'CPU'
    try:
        c.denoiser = 'OPTIX' if gpu else 'OPENIMAGEDENOISE'
    except Exception as ex:
        print('denoiser', ex)
    c.use_adaptive_sampling, c.adaptive_threshold = True, 0.02
    c.max_bounces, c.diffuse_bounces, c.glossy_bounces, c.transmission_bounces = 8, 5, 4, 8
    c.sample_clamp_indirect = 8
    c.caustics_reflective = c.caustics_refractive = False
vs = scene.view_settings
for k, v in (('view_transform', 'AgX'), ('look', 'AgX - Medium High Contrast'), ('exposure', 0.55)):
    try:
        setattr(vs, k, v)
    except Exception as ex:
        print('view attr', k, ex)
im = r.image_settings
try:
    im.media_type = 'IMAGE'
except Exception:
    pass
os.makedirs(OUT, exist_ok=True)

if MODE.startswith('ink'):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import tinta
    tinta.run(MODE, SEGMENTS, pose, cam, W, SAMPLES, OUT, int(arg(6, 0)))
    if MODE == 'ink':
        import json
        mpath = os.path.join(OUT, 'tour.json')
        with open(mpath, encoding='utf-8') as fh:
            man = json.load(fh)
        man['marks'] = tour_marks(man['frames'])
        path = []
        for k in range(man['frames']):
            u = param(k / (man['frames'] - 1))
            pos = spline(POS, u)
            path.append([round(pos.x, 2), round(pos.y, 2), round(spline(YAW, u), 3)])
        man['path'] = path
        with open(mpath, 'w', encoding='utf-8') as fh:
            json.dump(man, fh, ensure_ascii=False)
elif MODE == 'still':
    im.file_format, im.quality = 'JPEG', 88
    k = 0
    for seg in SEGMENTS:
        for t in ((0.25, 0.6, 1.0) if seg[0] == 'social' else (0.45, 1.0)):
            pose(seg, t)
            r.filepath = os.path.join(OUT, f'still_{k}_{seg[0]}.jpg')
            t0 = time.time()
            bpy.ops.render.render(write_still=True)
            print(f'STILL {k} {seg[0]} t={t} {time.time() - t0:.1f}s', flush=True)
            k += 1
elif MODE == 'anim':
    import json
    im.file_format, im.quality = 'WEBP', 80
    start = int(arg(6, 0))
    manifest, k = [], 0
    for seg in SEGMENTS:
        manifest.append({'id': seg[0], 'label': seg[1], 'start': k, 'end': k + seg[2] - 1})
        k += seg[2]
    with open(os.path.join(OUT, 'tour.json'), 'w', encoding='utf-8') as fh:
        json.dump({'frames': k, 'segments': manifest}, fh, ensure_ascii=False)
    k = 0
    for seg in SEGMENTS:
        for i in range(seg[2]):
            if k >= start:
                pose(seg, i / (seg[2] - 1))
                r.filepath = os.path.join(OUT, f'f_{k:03d}.webp')
                t0 = time.time()
                bpy.ops.render.render(write_still=True)
                print(f'FRAME {k} {seg[0]} {time.time() - t0:.1f}s', flush=True)
            k += 1
print('DONE')

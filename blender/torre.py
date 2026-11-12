# Torre Otún — exterior detallado para la demo en tiempo real.
# Genera tres piezas y las exporta a glTF: piso tipo (se repite 14 veces), podio y corona.
# Uso: blender --background --factory-startup --python torre.py -- <carpeta de salida>
# Ejes Blender: X ancho (24 m), Y fondo (16 m), Z altura. En three.js: (x, z, -y).
import bpy, bmesh, sys, os, math, random
from mathutils import Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models')
os.makedirs(OUT, exist_ok=True)
random.seed(3)
bpy.ops.wm.read_factory_settings(use_empty=True)
COL = bpy.context.scene.collection


def base_mesh(make):
    bm = bmesh.new()
    make(bm)
    v = [vt.co.copy() for vt in bm.verts]
    f = [[vt.index for vt in fc.verts] for fc in bm.faces]
    bm.free()
    return v, f


CUBE = base_mesh(lambda bm: bmesh.ops.create_cube(bm, size=1))
ICO = base_mesh(lambda bm: bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1))
# Techo a dos aguas: prisma triangular de base 1x1 y altura 1, cumbrera a lo largo de X
from mathutils import Vector
GABLE = ([Vector(p) for p in ((-.5, -.5, 0), (.5, -.5, 0), (.5, .5, 0), (-.5, .5, 0), (-.5, 0, 1), (.5, 0, 1))],
         [(0, 3, 2, 1), (0, 1, 5, 4), (2, 3, 4, 5), (1, 2, 5), (3, 0, 4)])

COLORS = {'conc': (0.95, 0.95, 0.94), 'glass': (0.04, 0.055, 0.07), 'frame': (0.012, 0.012, 0.012),
          'wood': (0.42, 0.26, 0.11), 'green': (0.11, 0.2, 0.09), 'rail': (0.7, 0.76, 0.8),
          'roof': (0.45, 0.14, 0.06), 'road': (0.5, 0.5, 0.5)}
MATS = {}
for name, c in COLORS.items():
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*c, 1)
    b.inputs['Roughness'].default_value = 0.8
    MATS[name] = m

PARTS = {}   # pieza -> material -> [verts, faces]


def add(part, mat, base, mtx):
    v, f = PARTS.setdefault(part, {}).setdefault(mat, ([], []))
    o = len(v)
    v += [tuple(mtx @ p) for p in base[0]]
    f += [tuple(i + o for i in face) for face in base[1]]


def box(part, mat, size, loc, rz=0.0):
    add(part, mat, CUBE, Matrix.Translation(loc) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Diagonal((*size, 1)))


def ico(part, mat, r, loc, sz=1.0):
    add(part, mat, ICO, Matrix.Translation(loc) @ Matrix.Rotation(random.random() * 3, 4, 'Z') @ Matrix.Diagonal((r, r, r * sz, 1)))


def tree(part, x, y, z, h=3.2):
    box(part, 'wood', (0.16, 0.16, h * 0.55), (x, y, z + h * 0.27))
    for _ in range(4):
        ico(part, 'green', random.uniform(0.75, 1.1), (x + random.uniform(-0.5, 0.5), y + random.uniform(-0.5, 0.5), z + h * random.uniform(0.6, 0.9)), 0.85)


def gable(part, mat, size, loc, rz=0.0):
    add(part, mat, GABLE, Matrix.Translation(loc) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Diagonal((*size, 1)))


def person(part, x, y, z, rz=0.0):
    """Silueta a escala humana (1.7 m)."""
    h = random.uniform(1.55, 1.8)
    box(part, 'frame', (0.42, 0.26, h * 0.52), (x, y, z + h * 0.62), rz)      # torso
    box(part, 'frame', (0.16, 0.2, h * 0.38), (x - 0.11 * math.cos(rz), y - 0.11 * math.sin(rz), z + h * 0.19), rz)
    box(part, 'frame', (0.16, 0.2, h * 0.38), (x + 0.11 * math.cos(rz), y + 0.11 * math.sin(rz), z + h * 0.19), rz)
    ico(part, 'frame', 0.13, (x, y, z + h * 0.95))


# ============================================================ PISO TIPO (z 0..3.2)
P = 'piso'
box(P, 'conc', (24.8, 16.8, 0.3), (0, 0, 0.15))                  # losa
box(P, 'glass', (23.4, 15.4, 2.6), (0, 0, 1.75))                 # vidrio de fondo
box(P, 'conc', (23.9, 15.9, 0.55), (0, 0, 0.575))                # antepecho
box(P, 'conc', (24.2, 16.2, 0.35), (0, 0, 3.025))                # dintel
for i in range(9):                                                # machones fachadas largas
    for y in (-7.9, 7.9):
        box(P, 'conc', (0.55, 0.5, 2.9), (-12 + i * 3, y, 1.75))
for j in range(1, 4):                                             # machones fachadas cortas
    for x in (-11.9, 11.9):
        box(P, 'conc', (0.5, 0.55, 2.9), (x, -8 + j * 4, 1.75))
for i in range(8):                                                # carpintería
    xc = -10.5 + i * 3
    for y in (-7.74, 7.74):
        box(P, 'frame', (0.07, 0.07, 2.0), (xc, y, 1.85))
        box(P, 'frame', (2.5, 0.07, 0.07), (xc, y, 2.32))
for j in range(4):
    yc = -6 + j * 4
    for x in (-11.74, 11.74):
        box(P, 'frame', (0.07, 0.07, 2.0), (x, yc, 1.85))
        box(P, 'frame', (0.07, 3.5, 0.07), (x, yc, 2.32))
for sy in (-1, 1):                                                # balcones, uno por apartamento
    for cx in (-6, 6):
        y0 = sy * 8
        box(P, 'conc', (5.8, 1.5, 0.22), (cx, y0 + sy * 0.75, 0.2))
        box(P, 'glass', (5.0, 0.1, 2.25), (cx, y0 - sy * 0.22, 1.42))          # puerta-ventana
        box(P, 'frame', (0.08, 0.12, 2.25), (cx, y0 - sy * 0.2, 1.42))
        box(P, 'frame', (5.8, 0.06, 0.06), (cx, y0 + sy * 1.47, 1.3))          # pasamanos
        box(P, 'rail', (5.7, 0.03, 0.95), (cx, y0 + sy * 1.47, 0.8))           # antepecho de vidrio
        for dx in (-2.88, 2.88):
            box(P, 'frame', (0.06, 1.5, 0.06), (cx + dx, y0 + sy * 0.75, 1.3))
            box(P, 'rail', (0.03, 1.45, 0.95), (cx + dx, y0 + sy * 0.75, 0.8))
        for dx in (-2.88, -0.96, 0.96, 2.88):
            box(P, 'frame', (0.07, 0.07, 1.0), (cx + dx, y0 + sy * 1.47, 0.8))
        px = cx + (1.9 if cx < 0 else -1.9)                                    # jardinera
        box(P, 'frame', (1.7, 0.42, 0.46), (px, y0 + sy * 1.12, 0.54))
        for k in range(4):
            ico(P, 'green', 0.34, (px - 0.6 + k * 0.4, y0 + sy * 1.12, 0.98), 0.9)
        sx = cx + (-2.7 if cx < 0 else 2.7)                                    # celosía de madera
        for k in range(6):
            box(P, 'wood', (0.09, 0.2, 2.65), (sx, y0 + sy * (0.16 + k * 0.24), 1.63))
for sx in (-1, 1):                                                # quiebrasoles en fachadas cortas
    for k in range(18):
        box(P, 'wood', (0.34, 0.08, 2.72), (sx * 12.3, -3.4 + k * 0.4, 1.8))

# ============================================================ PODIO (30 x 22 x 8)
D = 'podio'
box(D, 'conc', (30.6, 22.6, 0.4), (0, 0, 0.2))
box(D, 'glass', (29.0, 21.0, 7.2), (0, 0, 4.0))
box(D, 'conc', (30.4, 22.4, 0.9), (0, 0, 7.55))
box(D, 'conc', (30.2, 22.2, 0.35), (0, 0, 4.0))
for i in range(9):
    x = -15 + i * 3.75
    for y in (-10.9, 10.9):
        box(D, 'conc', (0.7, 0.7, 7.4), (x, y, 3.9))
        if i < 8:
            for z in (2.2, 5.9):
                box(D, 'frame', (0.07, 0.07, 3.2), (x + 1.875, y * 0.975, z))
for j in range(1, 6):
    y = -11 + j * 3.667
    for x in (-14.9, 14.9):
        box(D, 'conc', (0.7, 0.7, 7.4), (x, y, 3.9))
for j in range(6):
    y = -9.17 + j * 3.667
    for x in (-14.55, 14.55):
        for z in (2.2, 5.9):
            box(D, 'frame', (0.07, 0.07, 3.2), (x, y, z))
# Acceso (fachada principal: y negativo)
box(D, 'frame', (9.0, 3.4, 0.28), (0, -12.6, 3.7))               # marquesina
box(D, 'wood', (8.6, 3.0, 0.1), (0, -12.6, 3.52))
for x in (-4.2, 4.2):
    box(D, 'frame', (0.22, 0.22, 3.5), (x, -14.0, 1.75))
box(D, 'wood', (6.4, 0.2, 3.3), (0, -11.25, 1.85))               # portal en madera
box(D, 'glass', (3.6, 0.24, 2.7), (0, -11.3, 1.55))
box(D, 'frame', (0.08, 0.3, 2.7), (0, -11.3, 1.55))
for k in range(3):
    box(D, 'conc', (10 - k * 0.8, 1.0, 0.14), (0, -13.3 + k * 0.5, 0.07 + k * 0.14))
for x in (-9.5, -6.5, 6.5, 9.5):
    box(D, 'frame', (2.2, 1.0, 0.7), (x, -12.3, 0.35))
    for k in range(4):
        ico(D, 'green', 0.5, (x - 0.75 + k * 0.5, -12.3, 0.95), 0.9)
for x in (-12.5, 12.5):
    tree(D, x, -13.2, 0, 4.2)
# Terraza sobre el podio
for (sx, sy, w, d) in ((0, -11.1, 30.2, 0.06), (0, 11.1, 30.2, 0.06), (-15.1, 0, 0.06, 22.2), (15.1, 0, 0.06, 22.2)):
    box(D, 'frame', (w, d, 0.06), (sx, sy, 9.05))
    box(D, 'rail', (w, d * 0.6, 0.95), (sx, sy, 8.52))
for x in (-13.6, 13.6):                                           # pérgolas laterales
    for y in (-8, -4, 0, 4, 8):
        box(D, 'wood', (0.16, 0.16, 2.6), (x, y, 9.3))
    box(D, 'wood', (0.2, 16.6, 0.2), (x, 0, 10.6))
    for y in range(-8, 9):
        box(D, 'wood', (2.6, 0.09, 0.16), (x * 0.955, y, 10.75))
for (x, y) in ((-13.2, -9.6), (13.2, -9.6), (-13.2, 9.6), (13.2, 9.6), (-13.4, 0), (13.4, 0)):
    box(D, 'frame', (1.3, 1.3, 0.6), (x, y, 8.3))
    tree(D, x, y, 8.5, 2.6)

for (x, y, rz) in ((-1.2, -14.6, 0.3), (0.4, -15.2, 2.6), (2.8, -13.9, 1.2), (-6.0, -15.6, 0.0), (-6.6, -15.3, 3.1),
                   (9.0, -15.4, 1.6), (13.5, -14.8, 0.4), (-12.0, -15.0, 2.0), (4.6, -16.2, 4.0)):
    person(D, x, y, 0.0, rz)
for (x, y, rz) in ((-11.0, -6.0, 0.5), (-10.4, -5.4, 3.4), (11.2, 3.0, 1.0), (10.0, -8.2, 2.2), (-9.5, 7.8, 0.0)):
    person(D, x, y, 8.0, rz)

# ============================================================ CORONA (origen en la azotea)
C = 'corona'
TIERS = ((21.0, 14.0, 3.0, 1.5), (15.5, 10.4, 3.0, 4.5), (10.0, 6.8, 3.6, 7.8), (5.0, 3.6, 3.0, 11.1))
for (w, d, h, z) in TIERS:
    box(C, 'conc', (w, d, h), (0, 0, z))
    box(C, 'glass', (w * 0.82, d + 0.06, h * 0.5), (0, 0, z + h * 0.05))
    box(C, 'glass', (w + 0.06, d * 0.72, h * 0.5), (0, 0, z + h * 0.05))
    box(C, 'conc', (w + 0.5, d + 0.5, 0.22), (0, 0, z + h / 2))            # cornisa
    n = max(4, int(w / 1.6))
    for i in range(n + 1):                                                # aletas déco
        x = -w / 2 + i * w / n
        for y in (-d / 2 - 0.12, d / 2 + 0.12):
            box(C, 'conc', (0.2, 0.3, h), (x, y, z))
box(C, 'conc', (24.2, 16.2, 0.25), (0, 0, 0.12))
for (sx, sy, w, d) in ((0, -8.0, 24.0, 0.06), (0, 8.0, 24.0, 0.06), (-12.0, 0, 0.06, 16.0), (12.0, 0, 0.06, 16.0)):   # baranda de azotea
    box(C, 'frame', (w, d, 0.06), (sx, sy, 1.25))
    box(C, 'rail', (w, d * 0.6, 0.95), (sx, sy, 0.75))
for x in (-11.2, 11.2):                                           # pérgolas de azotea
    for y in (-6, -2, 2, 6):
        box(C, 'wood', (0.14, 0.14, 2.4), (x, y, 1.45))
    for y in range(-6, 7):
        box(C, 'wood', (1.6, 0.08, 0.14), (x, y, 2.7))
for (x, y) in ((-11.2, -7.2), (11.2, -7.2), (-11.2, 7.2), (11.2, 7.2)):
    tree(C, x, y, 0.25, 2.2)
box(C, 'frame', (0.5, 0.5, 13.0), (0, 0, 19.1))                  # aguja
for a in range(4):
    box(C, 'wood', (0.12, 2.0, 5.0), (math.cos(a * math.pi / 2) * 0.9, math.sin(a * math.pi / 2) * 0.9, 14.6), a * math.pi / 2 + math.pi / 2)
box(C, 'conc', (2.2, 2.2, 0.5), (0, 0, 12.85))

# ============================================================ ENTORNO (barrio alrededor)
E = 'entorno'
PITCH, STREET, LOT = 46.0, 10.0, 12.0
ROT = Matrix.Rotation(0.3, 4, 'Z')


def at(x, y, z=0.0):
    v = ROT @ Vector((x, y, z))
    return (v.x, v.y, v.z)


def house(cx, cy, turn):
    floors_ = random.choice((1, 1, 2))
    w, d, h = random.uniform(6.5, 8.5), random.uniform(7.5, 9.5), 2.9 * floors_
    rz = 0.3 + turn * math.pi / 2
    box(E, 'conc', (w, d, h), at(cx, cy, h / 2), rz)
    gable(E, 'roof', (w + 0.8, d + 0.8, random.uniform(1.6, 2.4)), at(cx, cy, h), rz)
    c, sn = math.cos(turn * math.pi / 2), math.sin(turn * math.pi / 2)
    fx, fy = -sn * (d / 2 + 0.06), c * (d / 2 + 0.06)                 # frente de la casa
    box(E, 'frame', (1.0, 0.12, 2.1), at(cx + fx - c * 1.6, cy + fy - sn * 1.6, 1.05), rz)
    for k in range(floors_):
        box(E, 'glass', (1.5, 0.12, 1.2), at(cx + fx + c * 1.3, cy + fy + sn * 1.3, 1.5 + k * 2.9), rz)
        box(E, 'glass', (1.5, 0.12, 1.2), at(cx - fx + c * 0.2, cy - fy + sn * 0.2, 1.5 + k * 2.9), rz)
    if random.random() < 0.5:                                         # antejardín con árbol
        tree(E, *at(cx + fx * 1.9, cy + fy * 1.9), 2.4)


def block(cx, cy, floors_):
    w, d, h = random.uniform(9.5, 11), random.uniform(9.5, 11), 3.0 * floors_
    box(E, 'conc', (w, d, h), at(cx, cy, h / 2), 0.3)
    box(E, 'conc', (w + 0.3, d + 0.3, 0.5), at(cx, cy, h + 0.25), 0.3)                  # antepecho
    for k in range(floors_):
        z = 1.7 + k * 3.0
        if k == 0 and random.random() < 0.6:                                             # local con toldo
            box(E, 'roof', (w * 0.8, 1.2, 0.18), at(cx, cy - d / 2 - 0.5, 2.7), 0.3)
            box(E, 'glass', (w * 0.8, 0.12, 2.2), at(cx, cy - d / 2 - 0.02, 1.3), 0.3)
        else:
            box(E, 'glass', (w * 0.82, 0.12, 1.3), at(cx, cy - d / 2 - 0.02, z), 0.3)
        box(E, 'glass', (w * 0.82, 0.12, 1.3), at(cx, cy + d / 2 + 0.02, z), 0.3)
        box(E, 'glass', (0.12, d * 0.82, 1.3), at(cx - w / 2 - 0.02, cy, z), 0.3)
        box(E, 'glass', (0.12, d * 0.82, 1.3), at(cx + w / 2 + 0.02, cy, z), 0.3)
    box(E, 'frame', (2.0, 2.0, 1.4), at(cx + random.uniform(-2, 2), cy + random.uniform(-2, 2), h + 1.2), 0.3)   # tanque


G = 5
for gx in range(-G, G + 1):
    for gy in range(-G, G + 1):
        bx, by = gx * PITCH, gy * PITCH
        for lx in (-1, 0, 1):
            for ly in (-1, 0, 1):
                cx, cy = bx + lx * LOT, by + ly * LOT
                wx, wy, _ = at(cx, cy)
                dist = math.hypot(wx, wy)
                if dist < 58 or dist > 215:
                    continue
                r = random.random()
                far = dist > 120
                if r < 0.14:
                    tree(E, wx + random.uniform(-2, 2), wy + random.uniform(-2, 2), 0, random.uniform(3, 5))
                    if random.random() < 0.6:
                        tree(E, wx + random.uniform(-4, 4), wy + random.uniform(-4, 4), 0, random.uniform(3, 4.5))
                elif r < 0.2:
                    continue                                                             # patio vacío
                elif r < (0.5 if far else 0.36):
                    block(cx, cy, random.choice((3, 4, 4, 5, 6) if far else (3, 3, 4)))
                elif r < 0.53 and far:
                    block(cx, cy, random.choice((8, 9, 11)))
                else:
                    house(cx, cy, random.randint(0, 3))
for g in range(-G, G + 2):                                                               # calles
    off = g * PITCH - PITCH / 2
    box(E, 'road', (STREET * 0.72, 2 * 225, 0.06), at(off, 0, 0.03), 0.3)
    box(E, 'road', (2 * 225, STREET * 0.72, 0.06), at(0, off, 0.03), 0.3)
for _ in range(46):                                                                      # gente en las calles cercanas
    g = random.randint(-2, 2) * PITCH - PITCH / 2 + random.choice((-4.4, 4.4))
    t = random.uniform(-95, 95)
    x, y = (g, t) if random.random() < 0.5 else (t, g)
    wx, wy, _ = at(x, y)
    if 24 < math.hypot(wx, wy) < 110:
        person(E, wx, wy, 0.06, random.uniform(0, 6.28))

# ============================================================ exportar
for part, mats in PARTS.items():
    objs, tris = [], 0
    for name, (v, f) in mats.items():
        me = bpy.data.meshes.new(f'{part}_{name}')
        me.from_pydata(v, [], f)
        me.materials.append(MATS[name])
        ob = bpy.data.objects.new(f'{part}_{name}', me)
        COL.objects.link(ob)
        objs.append(ob)
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT, part + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True)
    print(f'EXPORT {part} {tris} tris {os.path.getsize(path) // 1024} KB', flush=True)
    for ob in objs:
        ob.hide_set(True)
print('DONE')

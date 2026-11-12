# Pase de tinta para Blender: convierte cada cuadro del recorrido en un grabado a pluma.
# Lo ejecuta apartamento.py cuando el modo es `ink` (secuencia) o `inkstill` (pruebas).
#
# Por cuadro se hacen tres renders rápidos y se combinan con numpy:
#   tone  la escena iluminada, a media resolución            → decide el achurado (solo luz)
#   alb   color propio de cada material, sin luz              → decide dónde va el ocre
#   aux   normales + profundidad inversa, resolución completa → contornos
#   det   trazos propios de cada material (vetas, juntas, tejido), pegados a la superficie
# Los renders se hacen por tandas (todos los "tone", luego todos los "alb"...) porque cambiar
# de configuración entre cuadros obliga a Cycles a recargar la escena y es mucho más lento.
import bpy, os, time, json
import numpy as np

F = np.float32
PAPER = np.array([0.965, 0.961, 0.945], F)
INK = np.array([0.065, 0.062, 0.058], F)
OCHRE = np.array([0.61, 0.545, 0.37], F)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def hashn(x, y):
    v = np.sin(x * 127.1 + y * 311.7) * 43758.5453
    return v - np.floor(v)


def vnoise(x, y):
    xi, yi = np.floor(x), np.floor(y)
    xf, yf = x - xi, y - yi
    xf, yf = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf)
    a = hashn(xi, yi) * (1 - xf) + hashn(xi + 1, yi) * xf
    b = hashn(xi, yi + 1) * (1 - xf) + hashn(xi + 1, yi + 1) * xf
    return a * (1 - yf) + b * yf


def hatch(px, py, ang, sp, w):
    """Trazos paralelos: 0 = tinta, 1 = papel. w = medio grosor (0..0.5) por píxel."""
    c = (px * np.cos(ang) + py * np.sin(ang)) / sp
    f = np.abs(c - np.floor(c) - 0.5)
    aa = 0.6 / sp
    line = smooth(w - aa, w + aa, f)
    return line


def sh(a, dy, dx):
    return np.roll(np.roll(a, dy, 0), dx, 1)


def ink_frame(tone, alb, aux, det, seed):
    H, W = aux.shape[:2]
    Y, X = np.mgrid[0:H, 0:W].astype(np.float64)   # doble precisión: el ruido usa senos de números grandes
    # Pulso de mano: se desplaza la lectura con ruido suave
    wx = (vnoise(X * 0.015 + seed, Y * 0.015) - 0.5) * 2.0
    wy = (vnoise(X * 0.015 + 31.7, Y * 0.015 - seed) - 0.5) * 2.0
    Xs = np.clip(np.rint(X + wx), 0, W - 1).astype(np.intp)
    Ys = np.clip(np.rint(Y + wy), 0, H - 1).astype(np.intp)
    A = aux[Ys, Xs]
    n, q = A[..., :2], A[..., 2]

    # Contornos: laplaciano de profundidad inversa (planos = 0) y salto de normal
    lap = np.abs(sh(q, 1, 1) + sh(q, -1, -1) - 2 * q) + np.abs(sh(q, 1, -1) + sh(q, -1, 1) - 2 * q)
    dd = lap / (q + 0.002)
    nd = np.sqrt(((sh(n, 1, 1) - sh(n, -1, -1)) ** 2).sum(-1)) + np.sqrt(((sh(n, 1, -1) - sh(n, -1, 1)) ** 2).sum(-1))
    ed = smooth(0.035, 0.12, dd)
    ed = np.maximum.reduce([ed, sh(ed, 1, 0), sh(ed, 0, 1), sh(ed, -1, 0), sh(ed, 0, -1)])   # silueta gruesa
    en = smooth(0.26, 0.58, nd)
    dist = 0.25 / np.maximum(q, 1e-6)
    edge = np.maximum(ed, en) * (1 - 0.7 * smooth(150, 900, dist))

    def up(a):
        a = np.repeat(np.repeat(a, 2, 0), 2, 1)[:H, :W]
        return (a + sh(a, 1, 0) + sh(a, 0, 1) + sh(a, 1, 1)) / 4

    t = np.clip(up(tone) @ np.array([0.299, 0.587, 0.114], F), 0, 1)   # solo luz, sin color
    c = up(alb)
    mx, mn = c.max(-1), c.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    warm = (c[..., 0] > c[..., 2] * 1.15) & (c[..., 0] > c[..., 1] * 0.9)
    spot = smooth(0.3, 0.45, sat) * warm * smooth(0.08, 0.2, mx)
    th = t * (1 - spot) + (t * 1.15 + 0.16) * spot

    # Sombreado de cómic: sombra plana de borde nítido (dos tonos), trama fina en penumbra,
    # trama doble en lo oscuro y negro pleno al fondo.
    shade = smooth(0.52, 0.49, th)
    h1 = smooth(0.44, 0.40, th)
    h2 = smooth(0.27, 0.22, th)
    px, py = X + wx, Y + wy
    inkv = np.where(h1 > 0.001, hatch(px, py, 0.7, 12.0, 0.035 * h1), 1.0)
    inkv = inkv * np.where(h2 > 0.001, hatch(px + 6.0 / np.cos(0.7), py, 0.7, 12.0, 0.06 * h2), 1.0)
    inkv = inkv * smooth(0.05, 0.1, th)

    # Trazos de material: se leen con el mismo pulso y se apagan con la distancia
    d = det[Ys, Xs][..., 0]
    inkv = inkv * (1 - (1 - d) * 0.85 * (1 - smooth(7.0, 26.0, dist)))
    inkv = (inkv * (1 - edge)).astype(F)

    spot = spot.astype(F)[..., None]
    base = PAPER * (1 - spot) + OCHRE * spot
    base = base * (1 - (0.11 + 0.11 * spot[..., 0]) * shade).astype(F)[..., None]
    grain = ((hashn(X, Y) - 0.5) * 0.012 + (vnoise(X * 0.008, Y * 0.008) - 0.5) * 0.02).astype(F)
    out = INK * (1 - inkv[..., None]) + base * inkv[..., None] + grain[..., None]
    return np.clip(out, 0, 1)


def run(MODE, SEGMENTS, pose, cam, W, SAMPLES, OUT, start=0):
    scene = bpy.context.scene
    r, vs, im, c = scene.render, scene.view_settings, scene.render.image_settings, scene.cycles
    H = int(W * 9 / 16)
    tmp = os.path.join(OUT, '_tmp')
    os.makedirs(tmp, exist_ok=True)

    # Material auxiliar: R,G = normal en espacio de cámara; B = 0.25 / distancia
    aux = bpy.data.materials.new('aux')
    aux.use_nodes = True
    nt = aux.node_tree
    nt.nodes.clear()
    new, link = nt.nodes.new, nt.links.new
    out, em, geo = new('ShaderNodeOutputMaterial'), new('ShaderNodeEmission'), new('ShaderNodeNewGeometry')
    vt = new('ShaderNodeVectorTransform')
    vt.vector_type, vt.convert_from, vt.convert_to = 'NORMAL', 'WORLD', 'CAMERA'
    link(geo.outputs['Normal'], vt.inputs[0])
    ma = new('ShaderNodeVectorMath')
    ma.operation = 'MULTIPLY_ADD'
    ma.inputs[1].default_value = (0.5, 0.5, 0.5)
    ma.inputs[2].default_value = (0.5, 0.5, 0.5)
    link(vt.outputs[0], ma.inputs[0])
    sep = new('ShaderNodeSeparateXYZ')
    link(ma.outputs[0], sep.inputs[0])
    cd = new('ShaderNodeCameraData')
    dv = new('ShaderNodeMath')
    dv.operation, dv.use_clamp = 'DIVIDE', True
    dv.inputs[0].default_value = 0.25
    link(cd.outputs['View Distance'], dv.inputs[1])
    comb = new('ShaderNodeCombineXYZ')
    link(sep.outputs[0], comb.inputs[0])
    link(sep.outputs[1], comb.inputs[1])
    link(dv.outputs[0], comb.inputs[2])
    link(comb.outputs[0], em.inputs['Color'])
    link(em.outputs[0], out.inputs['Surface'])

    w_main = scene.world
    w_aux = bpy.data.worlds.new('aux')
    w_aux.use_nodes = True
    w_aux.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.5, 0.0, 1)
    w_flat = bpy.data.worlds.new('plano')
    w_flat.use_nodes = True
    w_flat.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    switch = bpy.data.node_groups['SW'].nodes['Value'].outputs[0]
    switch2 = bpy.data.node_groups['SW2'].nodes['Value'].outputs[0]
    glass = [o for o in scene.objects if o.type == 'MESH' and o.data.materials and o.data.materials[0]
             and o.data.materials[0].name in ('vidrio', 'esmerilado')]
    vl = bpy.context.view_layer
    try:
        im.media_type = 'IMAGE'
    except Exception:
        pass
    im.file_format, im.color_mode = 'PNG', 'RGB'

    def setup(kind):
        vl.material_override = aux if kind == 'aux' else None
        scene.world = {'tone': w_main, 'alb': w_flat, 'aux': w_aux, 'det': w_flat}[kind]
        switch.default_value = 1.0 if kind == 'alb' else 0.0
        switch2.default_value = 1.0 if kind == 'det' else 0.0
        for o in glass:
            o.visible_camera = False   # el vidrio enturbia el dibujo: se omite en todas las tandas
        full = kind in ('aux', 'det')
        r.resolution_x, r.resolution_y = (W, H) if full else (W // 2, H // 2)
        c.samples = {'tone': SAMPLES, 'alb': 4, 'aux': 8, 'det': 8}[kind]
        c.use_denoising = kind == 'tone'
        vs.view_transform = 'Raw' if kind == 'aux' else 'Standard'
        vs.exposure = 0.95 if kind == 'tone' else 0.0
        try:
            vs.look = 'None'
        except Exception:
            pass
        im.color_depth = '16' if kind == 'aux' else '8'

    def load(path):
        img = bpy.data.images.load(path, check_existing=False)
        img.colorspace_settings.name = 'Non-Color'
        w, h = img.size
        a = np.empty(w * h * 4, F)
        img.pixels.foreach_get(a)
        bpy.data.images.remove(img)
        return a.reshape(h, w, 4)[..., :3]

    def save(arr, path, fmt):
        h, w = arr.shape[:2]
        img = bpy.data.images.new('salida', w, h, alpha=False)
        rgba = np.ones((h, w, 4), F)
        rgba[..., :3] = arr
        img.pixels.foreach_set(rgba.ravel())
        img.filepath_raw = path
        img.file_format = fmt
        img.save()
        bpy.data.images.remove(img)

    # Lista de cuadros: (número, tramo, avance 0..1)
    jobs, manifest, k = [], [], 0
    if MODE == 'inkstill':
        for seg in SEGMENTS:
            for t in (0.03, 0.16, 0.3, 0.42, 0.52, 0.6, 0.7, 0.8, 0.9, 0.97, 0.36, 0.56):
                jobs.append((k, seg, t))
                k += 1
    else:
        for seg in SEGMENTS:
            manifest.append({'id': seg[0], 'label': seg[1], 'start': k, 'end': k + seg[2] - 1})
            for i in range(seg[2]):
                if k >= start:
                    jobs.append((k, seg, i / (seg[2] - 1)))
                k += 1
        with open(os.path.join(OUT, 'tour.json'), 'w', encoding='utf-8') as fh:
            json.dump({'frames': k, 'segments': manifest}, fh, ensure_ascii=False)

    for kind in ('tone', 'alb', 'aux', 'det'):
        setup(kind)
        t0 = time.time()
        for (k, seg, t) in jobs:
            pose(seg, t)
            r.filepath = os.path.join(tmp, f'{kind}_{k:03d}.png')
            bpy.ops.render.render(write_still=True)
        print(f'PASS {kind} {len(jobs)} cuadros {time.time() - t0:.0f}s', flush=True)

    for (k, seg, t) in jobs:
        t0 = time.time()
        paths = [os.path.join(tmp, f'{kind}_{k:03d}.png') for kind in ('tone', 'alb', 'aux', 'det')]
        frame = ink_frame(*[load(p) for p in paths], 1.0 + (k // 3) * 0.37)
        if MODE == 'inkstill':
            save(frame, os.path.join(OUT, f'ink_{k}_{seg[0]}.jpg'), 'JPEG')
        else:
            save(frame, os.path.join(OUT, f'f_{k:03d}.webp'), 'WEBP')
        for p in paths:
            os.remove(p)
        print(f'FRAME {k} {seg[0]} {time.time() - t0:.1f}s', flush=True)

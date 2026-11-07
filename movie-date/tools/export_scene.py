"""Bake the theater scene into web assets for the WebGL camera move.

Inputs (from the generation step): plate.png (empty-seat theater), couple.png + couple.json
(soft-matted couple and its crop box), plate-disp.npy and master-disp.npy (Depth Anything V2).

Outputs into <site>/scene/:
  theater.webp / theater.jpg   the plate, colour graded lightly, ceiling kept dark
  couple.webp  / couple.png    the couple cut-out (RGBA)
  theater-depth.png            mesh depth for the plate: R,G = 16-bit disparity, B = emissive mask
  couple-depth.png             mesh depth for the couple (same packing)
  scene.json                   geometry: screen rectangle, couple box, calibration, sconces
"""
import sys, json, os
import numpy as np, cv2
from PIL import Image

gen, site = sys.argv[1], sys.argv[2]
out = os.path.join(site, "scene"); os.makedirs(out, exist_ok=True)

plate = np.asarray(Image.open(f"{gen}/plate-1.png").convert("RGB"), np.float32)
H, W = plate.shape[:2]

# Paint out the blank exit sign and two dust specks baked onto the stage: in motion they would
# ride with the wall like dirt on the lens.
rng = np.random.default_rng(7)
for (x0, y0, x1, y1) in [(1339, 1014, 1374, 1049), (750, 1464, 776, 1510)]:
    m = np.zeros((H, W), np.uint8); m[y0:y1, x0:x1] = 255
    ring = cv2.dilate(m, np.ones((17, 17), np.uint8)) - m
    lum = plate.mean(-1)
    sel = (ring > 0) & (lum > np.percentile(lum[ring > 0], 35))     # the surface, not the dark edge below
    fill = np.median(plate[sel], axis=0)
    soft = cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), 2.5)[..., None]
    patch = fill + rng.normal(0, 2.2, plate.shape).astype(np.float32)
    plate = plate * (1 - soft) + patch * soft
dp = np.load(f"{gen}/plate-disp.npy"); dm = np.load(f"{gen}/master-disp.npy")
cbox = json.load(open(f"{gen}/couple.json"))

# --- light grade: deepen the ceiling a touch more, keep everything else as shot
yy = np.linspace(0, 1, H)[:, None, None]
ceiling = np.clip((0.21 - yy) / 0.21, 0, 1) ** 1.5          # top 21% of the frame
plate_g = plate * (1 - 0.35 * ceiling)
plate_g = np.clip(plate_g, 0, 255).astype(np.uint8)
Image.fromarray(plate_g).save(f"{out}/theater.webp", quality=84, method=6)
Image.fromarray(plate_g).save(f"{out}/theater.jpg", quality=86, optimize=True, progressive=True)

couple = Image.open(f"{gen}/couple.png")
couple.save(f"{out}/couple.webp", quality=88, method=6)
couple.save(f"{out}/couple.png", optimize=True)

# A flat still of the whole shot (plate + couple) for reduced motion, no-WebGL and link previews.
cbox0 = json.load(open(f"{gen}/couple.json"))
still = Image.fromarray(plate_g)
still.paste(couple.convert("RGB"), (cbox0["x"], cbox0["y"]), couple)
still.save(f"{out}/still.webp", quality=82, method=6)
still.save(f"{out}/still.jpg", quality=84, optimize=True, progressive=True)

# The screen is a flat plane: give its whole rectangle (and its black masking) one depth, so the
# camera can be aimed to fill the frame with it exactly.
Lp = plate.mean(-1)
mm = (Lp > 160).astype(np.uint8)
n_, lab_, st_, _ = cv2.connectedComponentsWithStats(mm, 8)
i_ = 1 + np.argmax(st_[1:, cv2.CC_STAT_AREA]); sx_, sy_, sw_, sh_, _ = st_[i_]
d_screen_flat = float(np.median(dp[sy_ + 20:sy_ + sh_ - 20, sx_ + 20:sx_ + sw_ - 20]))
dp = dp.copy()
dp[sy_ - 30:sy_ + sh_ + 30, sx_ - 30:sx_ + sw_ + 30] = d_screen_flat

# --- depth for meshes: foreground-biased downsample (edges ride with the nearer surface) and
# kept crisp, so a depth edge is one mesh cell wide and the gap it opens can be shaded as shadow.
def clean(disp):
    """Edge-preserving smoothing in log-disparity: small *relative* wobble (noise on the dark,
    featureless walls and ceiling) is flattened, real steps between rows (30%+ jumps) survive."""
    L = np.log(np.maximum(disp, 1e-3)).astype(np.float32)
    for _ in range(3):
        L = cv2.bilateralFilter(L, 0, 0.10, 7)
    return np.exp(L).astype(np.float32)

def pack(disp, gw, gh, dmin, dmax, emissive=None):
    fg = cv2.dilate(clean(disp), np.ones((5, 5), np.uint8))    # max filter: nearer wins at edges
    small = cv2.resize(fg, (gw, gh), interpolation=cv2.INTER_NEAREST)
    v = np.clip((small - dmin) / (dmax - dmin), 0, 1)
    q = np.round(v * 65535).astype(np.uint32)
    rgb = np.zeros((gh, gw, 3), np.uint8)
    rgb[..., 0] = q >> 8; rgb[..., 1] = q & 255
    if emissive is not None:
        rgb[..., 2] = np.clip(cv2.resize(emissive, (gw, gh), interpolation=cv2.INTER_AREA) * 255, 0, 255).astype(np.uint8)
    return rgb

dmin, dmax = float(min(dp.min(), dm.min())), float(max(dp.max(), dm.max()))

# Emissive mask (light sources that stay lit with the house lights down): the two sconces.
em = np.zeros((H, W), np.float32)
sconces = [(35, 970), (1504, 970)]
for (sx, sy) in sconces:
    yy2, xx2 = np.ogrid[:H, :W]
    r = np.sqrt((xx2 - sx) ** 2 + (yy2 - sy) ** 2)
    em = np.maximum(em, np.clip(1 - (r - 40) / 120, 0, 1) ** 2)

GW, GH = 384, int(round(384 * H / W))
Image.fromarray(pack(dp, GW, GH, dmin, dmax, em)).save(f"{out}/theater-depth.png", optimize=True)

# Couple depth: master disparity inside the crop, pushed outward past the matte so edge vertices
# carry the couple's depth rather than the seats behind.
x, y, w, h = cbox["x"], cbox["y"], cbox["w"], cbox["h"]
cd = dm[y:y + h, x:x + w].copy()
alpha = np.asarray(couple, np.float32)[..., 3] / 255
inside = alpha > 0.5
fill = np.where(inside, cd, 0).astype(np.float32)
for _ in range(40):                                          # grow the inside values outward
    grown = cv2.dilate(fill, np.ones((5, 5), np.uint8))
    fill = np.where(fill > 0, fill, grown)
fill = np.where(fill > 0, fill, np.median(cd[inside]))
CGW, CGH = 96, int(round(96 * h / w))
Image.fromarray(pack(fill, CGW, CGH, dmin, dmax)).save(f"{out}/couple-depth.png", optimize=True)

# Screen rectangle (bright, fronto-parallel) measured on the plate.
L = plate.mean(-1)
m = (L > 160).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
i = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]); sx, sy, sw, sh, _ = st[i]

scene = {
    "image": {"w": W, "h": H},
    "screen": {"x": int(sx), "y": int(sy), "w": int(sw), "h": int(sh)},
    "couple": {"x": x, "y": y, "w": w, "h": h},
    "depth": {"min": dmin, "max": dmax, "theater": [GW, GH], "couple": [CGW, CGH]},
    # disparity -> depth: Z = a / (disp - b); anchors: couple's seat backs Z=1, screen Z=9
    "calibration": None,
    "sconces": sconces,
}
d_seat = cbox.get("seatDisparity", 10.95)
d_screen = float(np.median(dp[sy + 20:sy + sh - 20, sx + 20:sx + sw - 20]))
Zs = 9.0
a = (d_seat - d_screen) / (1 - 1 / Zs)
b = d_seat - a
scene["calibration"] = {"a": a, "b": b, "screenDisparity": d_screen, "seatDisparity": d_seat}
json.dump(scene, open(f"{out}/scene.json", "w"), indent=1)
print(json.dumps(scene, indent=1))
for f in sorted(os.listdir(out)):
    print(f"{f:22s} {os.path.getsize(os.path.join(out, f)) / 1024:8.1f} KB")

"""Cut the couple out of the master, using the empty-seat plate and both depth maps.

1. The couple's own seat backs are the nearest surfaces in this part of the plate; their top
   contour (found column by column from the plate's depth) is the lower limit of the people,
   except in the gap between the two seats where the clasped hands are.
2. Above that contour, the colour difference master-vs-plate is the person (hair against seats);
   where the master is also much nearer than the plate, it is solidly the person.
3. The matte ends exactly on that contour: the 3D layer moves with its seats and is drawn on top.

Usage: python couple_matte.py master.png plate.png master-disp.npy plate-disp.npy out_dir
"""
import sys, json
import numpy as np, cv2
from PIL import Image

master_p, plate_p, mdisp_p, pdisp_p, out = sys.argv[1:6]
M = np.asarray(Image.open(master_p).convert("RGB"), np.float32)
P = np.asarray(Image.open(plate_p).convert("RGB"), np.float32)
DM = np.load(mdisp_p); DP = np.load(pdisp_p)
H, W = M.shape[:2]
x0, y0, x1, y1 = 400, 1330, 1180, 2200
m, p = M[y0:y1, x0:x1], P[y0:y1, x0:x1]
dm, dp = DM[y0:y1, x0:x1], DP[y0:y1, x0:x1]
h, w = dm.shape

# 1. top contour of the couple's own seat backs (plate disparity above SEAT)
SEAT = 8.0
near = cv2.morphologyEx((dp > SEAT).astype(np.uint8), cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
contour = np.full(w, h, np.int32)
for x in range(w):
    ys = np.nonzero(near[:, x])[0]
    if ys.size: contour[x] = ys[0]
contour = cv2.medianBlur(contour.astype(np.float32).reshape(1, -1), 5).ravel().astype(np.int32)
TUCK = 0                                         # end exactly on the seat-back edge (the layer is drawn on top)
allowed = (np.arange(h)[:, None] < (contour[None, :] + TUCK)).astype(np.uint8)

# 2. colour difference and depth difference
lm = cv2.cvtColor(cv2.GaussianBlur(m, (0, 0), 1.2).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
lp = cv2.cvtColor(cv2.GaussianBlur(p, (0, 0), 1.2).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
cd = np.sqrt(((lm - lp) ** 2 * np.array([1.0, 1.4, 1.4])).sum(-1))
dd = dm - dp

hard = ((cd > 14) | (dd > 1.5)).astype(np.uint8) & allowed
hard = cv2.morphologyEx(hard, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
n, lab, stats, _ = cv2.connectedComponentsWithStats(hard, 8)
keep = np.zeros_like(hard)
for i in range(1, n):
    if stats[i, cv2.CC_STAT_AREA] > 2500:
        keep[lab == i] = 1
keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))) & allowed
ff = keep.copy(); fm = np.zeros((h + 2, w + 2), np.uint8)
cv2.floodFill(ff, fm, (0, 0), 1)
keep = (keep | (1 - ff)) & allowed

inner = cv2.erode(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
band = (cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) - inner) & allowed
soft = np.clip((cd - 6) / 18, 0, 1)
alpha = np.where(inner > 0, 1.0, np.where(band > 0, np.maximum(soft, 0.0), 0.0)).astype(np.float32)
alpha = np.maximum(alpha, cv2.GaussianBlur(inner.astype(np.float32), (0, 0), 1.5) * allowed)
alpha = cv2.GaussianBlur(alpha, (0, 0), 0.6)
alpha = np.clip(alpha, 0, 1)

ys, xs = np.where(alpha > 0.02)
by0, by1 = max(ys.min() - 6, 0), min(ys.max() + 6, h)
bx0, bx1 = max(xs.min() - 6, 0), min(xs.max() + 6, w)
rgba = np.dstack([m, alpha[..., None] * 255]).astype(np.uint8)[by0:by1, bx0:bx1]
Image.fromarray(rgba, "RGBA").save(f"{out}/couple.png")
core_disp = float(np.median(dm[(inner > 0)]))
seat_disp = float(np.median(dp[near > 0]))
box = {"x": int(x0 + bx0), "y": int(y0 + by0), "w": int(bx1 - bx0), "h": int(by1 - by0),
       "imageW": W, "imageH": H, "disparity": core_disp, "seatDisparity": seat_disp}
json.dump(box, open(f"{out}/couple.json", "w"))
print("couple box", box)

Image.fromarray((alpha * 255).astype(np.uint8)).save(f"{out}/matte-debug.png")
comp = P.copy()
comp[y0:y1, x0:x1] = m * alpha[..., None] + p * (1 - alpha[..., None])
Image.fromarray(comp.astype(np.uint8)).save(f"{out}/composite.png")
side = np.concatenate([M[1250:2250, 300:1236], np.zeros((1000, 12, 3)), comp[1250:2250, 300:1236]], 1)
Image.fromarray(side.astype(np.uint8)).resize((942, 500)).save(f"{out}/composite-debug.jpg", quality=88)

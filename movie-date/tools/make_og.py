"""Link-preview poster (og.jpg, 1200×630): the screen between the curtains, with the projected words.

Usage: python make_og.py <site_dir>
"""
import sys, io, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from fontTools.ttLib import TTFont

site = sys.argv[1]
still = Image.open(os.path.join(site, "scene/still.webp")).convert("RGB")
W, H = still.size                                  # 1536 × 2752
sx, sy, sw, sh = 369, 661, 800, 517                # the screen rectangle
# 1.905:1 crop centred a little below the screen's middle so the stage edge shows
cw = W; ch = round(cw / (1200 / 630))
cy = sy + sh // 2 + 40
top = max(0, min(H - ch, cy - ch // 2))
poster = still.crop((0, top, cw, top + ch)).resize((1200, 630), Image.LANCZOS)
k = 1200 / cw
# warm the lamp a touch, as in the film
arr = np.asarray(poster, np.float32)
x0, y0 = round(sx * k), round((sy - top) * k)
x1, y1 = round((sx + sw) * k), round((sy + sh - top) * k)
arr[y0:y1, x0:x1] *= np.array([1.0, 0.955, 0.88])
poster = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

# the projected words, in the site's face, as light withheld from the screen
f = TTFont(os.path.join(site, "fonts/newsreader-roman.woff2")); f.flavor = None
buf = io.BytesIO(); f.save(buf); buf.seek(0)
font = ImageFont.truetype(buf, size=round((x1 - x0) * 0.071))
try:
    font.set_variation_by_axes([300, 72])           # weight 300, display optical size
except Exception:
    pass
text = "Loading a movie date…"
layer = Image.new("L", poster.size, 0)
d = ImageDraw.Draw(layer)
tw = d.textlength(text, font=font)
asc, desc = font.getmetrics()
tx = (x0 + x1) / 2 - tw / 2
ty = y0 + (y1 - y0) * 0.53 - asc
d.text((tx, ty), text, font=font, fill=255)
layer = layer.filter(ImageFilter.GaussianBlur(0.6))
a = np.asarray(layer, np.float32)[..., None] / 255 * 0.8
out = np.asarray(poster, np.float32) * (1 - a)
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(os.path.join(site, "og.jpg"), quality=86, optimize=True, progressive=True)
print("og.jpg", os.path.getsize(os.path.join(site, "og.jpg")) // 1024, "KB")

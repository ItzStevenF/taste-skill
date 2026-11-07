"""Estimate relative depth (disparity) for an image with Depth Anything V2 (ONNX).

Usage: python depth.py <model.onnx> <image> <out.npy> [--size 518]
Writes a float32 disparity map (larger = nearer) at the image's full resolution.
"""
import sys, argparse
import numpy as np
from PIL import Image
import onnxruntime as ort

ap = argparse.ArgumentParser()
ap.add_argument("model"); ap.add_argument("image"); ap.add_argument("out")
ap.add_argument("--size", type=int, default=770, help="short side fed to the network (multiple of 14)")
a = ap.parse_args()

im = Image.open(a.image).convert("RGB")
W, H = im.size
short = a.size
if W < H:
    w = short; h = int(round(H * short / W / 14)) * 14
else:
    h = short; w = int(round(W * short / H / 14)) * 14
x = np.asarray(im.resize((w, h), Image.BICUBIC), dtype=np.float32) / 255.0
mean = np.array([0.485, 0.456, 0.406], np.float32); std = np.array([0.229, 0.224, 0.225], np.float32)
x = ((x - mean) / std).transpose(2, 0, 1)[None]
sess = ort.InferenceSession(a.model, providers=["CPUExecutionProvider"])
name = sess.get_inputs()[0].name
out = sess.run(None, {name: x})[0]
d = np.squeeze(out).astype(np.float32)
d = np.asarray(Image.fromarray(d).resize((W, H), Image.BICUBIC), dtype=np.float32)
np.save(a.out, d)
print(f"{a.image}: net {w}x{h} -> {W}x{H}, disparity range {d.min():.3f}..{d.max():.3f}")

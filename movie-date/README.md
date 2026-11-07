# Loading a movie date…

A one-link, mobile-first website that asks one question. It opens on a dark private screening —
a couple seen from behind, holding hands — and the camera travels through the room into the
screen, where the question appears as a film's title card. Any answer makes the projector
"fail" on cue and shows the same message.

- `site/` — the website (static files, no build step, no dependencies). Deploy this folder.
- `tools/` — how the opening shot was made, and the QA scripts.
- `BRIEF.md` — the creative brief and the review decisions.

## How the opening shot works

One generated photograph of the theater (and an edit of it with the couple removed) is turned
into 3D: a depth map (Depth Anything V2) becomes a mesh, the couple is cut out by differencing
the two images, and a WebGL perspective camera rises over them and travels to the screen. The
projected words are drawn onto the screen surface; a focus pass racks from the couple to the
screen. Without WebGL, or with *Reduce Motion* on, the same shot plays as a still.

## Run locally

```bash
npx --yes serve site
```

## Deploy (Cloudflare, no account needed to start)

```bash
npm exec --yes wrangler@latest -- deploy ./site --name movie-date --temporary --compatibility-date 2026-11-07
```

The temporary deployment must be claimed within 60 minutes (the command prints the claim link).

## Rebuild the scene assets

```bash
python tools/depth.py <model.onnx> plate.png plate-disp.npy
python tools/depth.py <model.onnx> master.png master-disp.npy
python tools/couple_matte.py master.png plate.png master-disp.npy plate-disp.npy <gen_dir>
python tools/export_scene.py <gen_dir> site
python tools/make_og.py site
```

## QA

```bash
node tools/qa/film.js <out> 390 844 yes     # frame-by-frame film of the whole experience
node tools/qa/sweep.js <out>                # seven viewports, geometry + console checks
node tools/qa/sweep.js <out> --reduced      # reduced motion
node tools/qa/sweep.js <out> --nowebgl      # still fallback
node tools/qa/sound-nojs.js <out>           # sound opt-in, and the no-JavaScript path
```

Font: Newsreader (SIL Open Font License, `site/fonts/OFL.txt`).

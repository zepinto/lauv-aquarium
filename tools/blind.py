#!/usr/bin/env python3
"""Make blind A/B pairs for a critic.
usage: blind.py OUTDIR SECRET.json ours1.png:bar1.jpg [ours2.png:bar2.jpg ...]
Each pair gets cropped to 16:9, resized to 1280x720, randomly assigned to A/B.
The mapping goes to SECRET.json (outside the critic's folder)."""
import sys, os, json, random
from PIL import Image
out, secret, *pairs = sys.argv[1:]
os.makedirs(out, exist_ok=True)
ASPECT = float(os.environ.get('BLIND_ASPECT', 16 / 9))
# NOTE: crop ours and the bar the same way (both with or both without the horizon).
def norm(p):
    # path or path@x0,y0,x1,y1 (fractions): optional crop before the aspect crop
    box = None
    if '@' in p: p, b = p.split('@'); box = [float(v) for v in b.split(',')]
    im = Image.open(p).convert('RGB'); W, H = im.size
    if box: im = im.crop((int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H))); W, H = im.size
    if W / H > ASPECT: w = int(H * ASPECT); im = im.crop(((W - w) // 2, 0, (W - w) // 2 + w, H))
    else: h = int(W / ASPECT); im = im.crop((0, (H - h) // 2, W, (H - h) // 2 + h))
    return im.resize((1280, int(1280 / ASPECT)), Image.LANCZOS)
mapping = {}
for i, pr in enumerate(pairs, 1):
    ours, bar = pr.split(':')
    flip = random.random() < 0.5
    a, b = (bar, ours) if flip else (ours, bar)
    norm(a).save(f'{out}/pair{i}_A.jpg', quality=92)
    norm(b).save(f'{out}/pair{i}_B.jpg', quality=92)
    mapping[f'pair{i}'] = {'ours': 'B' if flip else 'A', 'ours_src': ours, 'bar_src': bar}
os.makedirs(os.path.dirname(os.path.abspath(secret)), exist_ok=True)
json.dump(mapping, open(secret, 'w'), indent=1)
print('wrote', len(pairs), 'pairs to', out)

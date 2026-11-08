"""緑背景のスプライトシートを切り分けて、透明PNGのシートとJSONを作る。

使い方: python3 tools/make_sprites.py
入力:  assets/sprites/raw/hoplite_sheet_chatgpt.png（6ポーズ横並び、背景 #00FF00）
出力:  assets/sprites/hoplite.png, assets/sprites/hoplite.json
"""
from collections import deque
import json, sys
import numpy as np
from PIL import Image

SRC = 'assets/sprites/raw/hoplite_sheet_chatgpt.png'
OUT_PNG = 'assets/sprites/hoplite.png'
OUT_JSON = 'assets/sprites/hoplite.json'
CUTS = [340]  # 元画像のx座標。くっついているポーズを切り離す位置
NAMES = ['guard', 'windup', 'thrust', 'hit', 'collapse', 'fallen']

def chroma(rgb):
    r, g, b = [rgb[..., k].astype(np.float32) for k in range(3)]
    m = np.maximum(r, b)
    # 緑っぽさ 0..1（1 = 完全に背景）
    greenness = np.clip((g - m - 40) / 80, 0, 1)
    alpha = 1 - greenness
    # 縁の緑かぶりを取る
    g2 = np.where(g > m, m + (g - m) * 0.15, g)
    out = np.stack([r, g2, b], -1)
    return out, alpha

def label(mask):
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32); n = 0; comps = []
    for y0 in range(h):
        row = mask[y0]
        for x0 in np.nonzero(row & (lab[y0] == 0))[0]:
            if lab[y0, x0]: continue
            n += 1; q = deque([(y0, x0)]); lab[y0, x0] = n
            xs = []; ys = []
            while q:
                y, x = q.popleft(); xs.append(x); ys.append(y)
                for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                    yy, xx = y+dy, x+dx
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = n; q.append((yy, xx))
            comps.append(dict(id=n, size=len(xs), cx=float(np.mean(xs)), x0=min(xs), x1=max(xs), y0=min(ys), y1=max(ys)))
    return lab, comps

def main():
    im = np.asarray(Image.open(SRC).convert('RGB'))
    H, W = im.shape[:2]
    rgb, alpha = chroma(im)
    # 半分の解像度でラベル付け（速さのため）
    small = alpha[::2, ::2] > 0.5
    # 1枚目の槍先が2枚目のこぶしに触れているので、縦に切り離す
    for cut in CUTS: small[:, cut // 2] = False
    lab, comps = label(small)
    comps = [c for c in comps if c['size'] > 30]
    centers = [c * W / 2000 / 2 for c in (130, 440, 760, 1110, 1430, 1780)]  # 半解像度での各ポーズ中心
    frames = [[] for _ in NAMES]
    for c in comps:
        k = int(np.argmin([abs(c['cx'] - x) for x in centers]))
        frames[k].append(c)
    for k, fr in enumerate(frames):
        print(NAMES[k], [(c['size'], c['x0']*2, c['x1']*2) for c in sorted(fr, key=lambda c: -c['size'])[:4]], file=sys.stderr)

    # 各フレームの切り出し（元の縦位置を保つ＝足元の高さがそろったまま）
    labf = np.kron(lab, np.ones((2, 2), np.int32))[:H, :W]
    pad = 6
    cells = []
    for k, fr in enumerate(frames):
        ids = [c['id'] for c in fr]
        m = np.isin(labf, ids)
        # 縁のぼかし分を拾うため、マスクを少し太らせる
        mm = m.copy()
        for s in range(1, 3):
            mm[s:] |= m[:-s]; mm[:-s] |= m[s:]; mm[:, s:] |= m[:, :-s]; mm[:, :-s] |= m[:, s:]
        a = np.where(mm, alpha, 0)
        ys, xs = np.nonzero(a > 0.02)
        x0, x1, y0, y1 = xs.min() - pad, xs.max() + pad, ys.min() - pad, ys.max() + pad
        x0, y0 = max(0, x0), max(0, y0)
        cells.append(dict(name=NAMES[k], x0=int(x0), x1=int(x1), y0=int(y0), y1=int(y1), a=a))

    # 共通の基準線（立ちポーズの足元のいちばん下）
    base = max(c['y1'] for c in cells[:4]) - pad
    top = min(c['y0'] for c in cells)
    bottom = max(c['y1'] for c in cells)
    cellH = bottom - top
    sheetW = sum(c['x1'] - c['x0'] for c in cells)
    sheet = np.zeros((cellH, sheetW, 4), np.float32)
    meta = dict(image='hoplite.png', baseline=int(base - top), frames={})
    ox = 0
    for c in cells:
        w = c['x1'] - c['x0']
        sl = (slice(top, bottom), slice(c['x0'], c['x1']))
        sheet[:, ox:ox+w, :3] = rgb[sl]
        sheet[:, ox:ox+w, 3] = c['a'][sl] * 255
        # 足元の位置（基準線付近の不透明ピクセルの左端＝後ろ足）
        band = c['a'][base-40:base+1, c['x0']:c['x1']] > 0.5
        cols = np.nonzero(band.any(0))[0]
        foot = int(cols.min()) if len(cols) else w // 2
        meta['frames'][c['name']] = dict(x=ox, y=0, w=int(w), h=int(cellH), srcX=int(c['x0']), backFoot=foot)
        ox += w
    Image.fromarray(np.clip(sheet, 0, 255).astype(np.uint8), 'RGBA').save(OUT_PNG, optimize=True)
    json.dump(meta, open(OUT_JSON, 'w'), indent=1, ensure_ascii=False)
    print(json.dumps(meta, indent=1), file=sys.stderr)

main()

"""緑背景のスプライトシートを切り分けて、透明PNGのシートとJSONを作る。

使い方: python3 tools/make_sprites.py            # すべて作る
        python3 tools/make_sprites.py persian    # 指定したものだけ

入力: assets/sprites/raw/ の緑背景（#00FF00）のシート
出力: assets/sprites/<name>.png と <name>.json

JSON の各フレーム:
  x, y, w, h   … 出力シート内の位置
  baseline     … フレームの上端から足元の基準線までの高さ
  anchor       … フレーム左端から「立ち位置」までの距離（後ろ足、または指定値）
シート全体:
  height       … 立ちポーズの身長（px）。描くときの大きさをそろえるのに使う
  facing       … 'right' / 'left'
"""
from collections import deque
import json, sys
import numpy as np
from PIL import Image

SHEETS = {
    'hoplite': dict(
        src='assets/sprites/raw/hoplite_sheet_chatgpt.png',
        facing='right',
        # 各ポーズのおおよその中心（元画像の座標）。部品はいちばん近い中心のポーズに入る
        frames=[('guard', 141, 380), ('windup', 478, 380), ('thrust', 825, 380),
                ('hit', 1205, 380), ('collapse', 1553, 450), ('fallen', 1933, 500)],
        standing=['guard', 'windup', 'thrust', 'hit'],
        cuts=[340],  # くっついているポーズを縦に切り離すx
        # 切り離したあとに他のポーズの破片が残る場所（フレーム名, x0, x1, y0, y1）
        erase_dark=[('guard', 326, 342, 252, 269)],    # 暗い画素（槍の柄・こぶし）だけ消す
        erase_steel=[('windup', 334, 356, 262, 274)],  # 明るい灰色（槍先）だけ消す
        anchor={'collapse': 70, 'fallen': 320},
    ),
    'persian': dict(
        src='assets/sprites/raw/persian_sheet_chatgpt.png',
        facing='left',
        frames=[('guard', 175, 250), ('windup', 560, 250), ('strike', 900, 260), ('recover', 1320, 260),
                ('hit', 200, 750), ('collapse', 660, 790), ('fallen', 1230, 850)],
        standing=['guard', 'windup', 'strike', 'recover', 'hit'],
        cuts=[], erase_dark=[], erase_steel=[],
        anchor={'collapse': 330, 'fallen': 300},
    ),
}


def chroma(rgb):
    r, g, b = [rgb[..., k].astype(np.float32) for k in range(3)]
    m = np.maximum(r, b)
    greenness = np.clip((g - m - 40) / 80, 0, 1)   # 1 = 完全に背景
    alpha = 1 - greenness
    g2 = np.where(g > m, m + (g - m) * 0.15, g)     # 縁の緑かぶりを取る
    return np.stack([r, g2, b], -1), alpha


def label(mask):
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32); n = 0; comps = []
    for y0 in range(h):
        for x0 in np.nonzero(mask[y0] & (lab[y0] == 0))[0]:
            if lab[y0, x0]: continue
            n += 1; q = deque([(y0, x0)]); lab[y0, x0] = n
            xs = []; ys = []
            while q:
                y, x = q.popleft(); xs.append(x); ys.append(y)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = n; q.append((yy, xx))
            comps.append(dict(id=n, size=len(xs), cx=float(np.mean(xs)), cy=float(np.mean(ys))))
    return lab, comps


def build(name, cfg):
    im = np.asarray(Image.open(cfg['src']).convert('RGB'))
    H, W = im.shape[:2]
    rgb, alpha = chroma(im)

    small = alpha[::2, ::2] > 0.5   # 半分の解像度でラベル付け（速さのため）
    for cut in cfg['cuts']: small[:, cut // 2] = False
    lab, comps = label(small)
    comps = [c for c in comps if c['size'] > 30]
    names = [f[0] for f in cfg['frames']]
    centers = [(f[1] / 2, f[2] / 2) for f in cfg['frames']]
    groups = [[] for _ in names]
    for c in comps:
        k = int(np.argmin([(c['cx'] - x) ** 2 + (c['cy'] - y) ** 2 for x, y in centers]))
        groups[k].append(c['id'])
    labf = np.kron(lab, np.ones((2, 2), np.int32))[:H, :W]

    pad = 6
    cells = []
    for k, ids in enumerate(groups):
        m = np.isin(labf, ids)
        mm = m.copy()   # 縁のぼかし分を拾うため、マスクを少し太らせる
        for s in range(1, 3):
            mm[s:] |= m[:-s]; mm[:-s] |= m[s:]; mm[:, s:] |= m[:, :-s]; mm[:, :-s] |= m[:, s:]
        a = np.where(mm, alpha, 0)
        for fname, ex0, ex1, ey0, ey1 in cfg['erase_dark']:
            if fname == names[k]:
                lum = im[ey0:ey1, ex0:ex1].astype(np.float32).mean(-1)
                a[ey0:ey1, ex0:ex1] = np.where(lum < 120, 0, a[ey0:ey1, ex0:ex1])
        for fname, ex0, ex1, ey0, ey1 in cfg['erase_steel']:
            if fname == names[k]:
                px = im[ey0:ey1, ex0:ex1].astype(np.float32)
                steel = (px[..., 0] > 80) & (px[..., 2] > 80) & (np.abs(px[..., 0] - px[..., 2]) < 40)
                a[ey0:ey1, ex0:ex1] = np.where(steel, 0, a[ey0:ey1, ex0:ex1])
        ys, xs = np.nonzero(a > 0.02)
        cells.append(dict(name=names[k], a=a, x0=max(0, xs.min() - pad), x1=min(W, xs.max() + pad),
                          y0=max(0, ys.min() - pad), y1=min(H, ys.max() + pad), cy=cfg['frames'][k][2]))

    # 足元の基準線：同じ段（y が近い）の立ちポーズのいちばん下
    for c in cells:
        row = [d for d in cells if d['name'] in cfg['standing'] and abs(d['cy'] - c['cy']) < H * 0.25]
        if not row: row = [d for d in cells if d['name'] in cfg['standing']]
        c['base'] = max(d['y1'] for d in row) - pad
    heights = [c['base'] - c['y0'] - pad for c in cells if c['name'] in cfg['standing']]

    # 出力：横一列に並べる
    sheetW = sum(c['x1'] - c['x0'] for c in cells)
    sheetH = max(max(c['y1'], c['base'] + pad) - c['y0'] for c in cells)
    sheet = np.zeros((sheetH, sheetW, 4), np.float32)
    meta = dict(image=f'{name}.png', facing=cfg['facing'], height=int(np.median(heights)), frames={})
    ox = 0
    for c in cells:
        w, h = c['x1'] - c['x0'], c['y1'] - c['y0']
        sl = (slice(c['y0'], c['y1']), slice(c['x0'], c['x1']))
        sheet[:h, ox:ox + w, :3] = rgb[sl]
        sheet[:h, ox:ox + w, 3] = c['a'][sl] * 255
        # 後ろ足：基準線付近の不透明ピクセルの端（右向きなら左端、左向きなら右端）
        band = c['a'][c['base'] - 40:c['base'] + 1, c['x0']:c['x1']] > 0.5
        cols = np.nonzero(band.any(0))[0]
        foot = (int(cols.min()) if cfg['facing'] == 'right' else int(cols.max())) if len(cols) else w // 2
        meta['frames'][c['name']] = dict(x=int(ox), y=0, w=int(w), h=int(h), baseline=int(c['base'] - c['y0']),
                                         anchor=int(cfg['anchor'].get(c['name'], foot)))
        ox += w
    Image.fromarray(np.clip(sheet, 0, 255).astype(np.uint8), 'RGBA').save(f'assets/sprites/{name}.png', optimize=True)
    json.dump(meta, open(f'assets/sprites/{name}.json', 'w'), indent=1, ensure_ascii=False)
    print(name, json.dumps(meta['frames']), 'height', meta['height'], file=sys.stderr)


if __name__ == '__main__':
    for n in (sys.argv[1:] or SHEETS):
        build(n, SHEETS[n])

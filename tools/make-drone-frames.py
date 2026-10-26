"""펫 '드론에 매달려 날기' 소품 그림 만들기
수확팡 드론(app/pang/img/item_drone.png)에 줄 두 가닥 + 손잡이 막대를 달고,
원래 프로펠러 날개를 지운 뒤 도는 원판 + 각도가 다른 날개를 그려 4장으로 저장.
Usage: python3 tools/make-drone-frames.py   →  app/renderer/img/drone_bar_0~3.png (304×285)
pet.js의 DRONE_W·DRONE_H·DRONE_BAR가 이 크기·막대 높이에 맞춰져 있음
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
out_dir = root / "app" / "renderer" / "img"

# 1) 드론 + 줄 + 막대 (256 폭). 막대는 두 주먹 바깥까지 삐져나오게 길게 (쥔 것처럼 보이게)
d = Image.open(root / "app" / "pang" / "img" / "item_drone.png").convert("RGBA")
d = d.crop(d.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox())
W0 = 256
d = d.resize((W0, round(d.height * W0 / d.width)))
H0 = d.height + 110
src = Image.new("RGBA", (W0, H0), (0, 0, 0, 0))
g = ImageDraw.Draw(src)
tank_y, bar_y = int(d.height * 0.78), H0 - 14
for x0, x1 in [(112, 40), (144, 216)]:
    g.line([(x0, tank_y), (x1, bar_y)], fill=(90, 96, 100, 255), width=4)
src.alpha_composite(d, (0, 0))
g.rounded_rectangle([24, bar_y - 7, 232, bar_y + 7], radius=7, fill=(94, 196, 165, 255), outline=(43, 80, 70, 255), width=2)

# 2) 프로펠러가 원판 밖으로 잘리지 않게 여백
PADX, PADT = 24, 14
base = Image.new("RGBA", (W0 + PADX * 2, H0 + PADT), (0, 0, 0, 0))
base.alpha_composite(src, (PADX, PADT))
W, H = base.size
px = base.load()
gray = lambda p: max(p[:3]) - min(p[:3]) < 30
isdark = lambda p: p[3] > 120 and max(p[:3]) < 135 and gray(p)
hubs = [(x + PADX, y + PADT) for x, y in [(78, 17), (221, 29), (30, 77), (191, 92)]]   # 모터 덮개 중심
TANK = (PADX + 100, PADX + 160)    # 약통 가로 범위: 지우지 않음
R, CAP = 47, 8

# 3) 원래 날개 지우기 (민트 몸체 위였던 자리는 위아래 색으로 메움), 모터 덮개는 따로 떼어 맨 위에 다시 얹음
clean = base.copy()
cp = clean.load()
cap_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
kp = cap_layer.load()
for hx, hy in hubs:
    for x in range(int(hx - R - 4), int(hx + R + 5)):
        for y in range(int(hy - R * 0.6), int(hy + R * 0.6)):
            if not (0 <= x < W and 0 <= y < H):
                continue
            p = px[x, y]
            if p[3] < 10 or not gray(p) or max(p[:3]) > 175:
                continue
            if math.hypot(x - hx, (y - hy) / 0.45) > R + 4:     # 날개가 도는 납작한 원 밖은 손대지 않음
                continue
            if TANK[0] <= x <= TANK[1] and y > hy:
                continue
            if math.hypot(x - hx, (y - hy) / 0.6) <= CAP and isdark(p):
                kp[x, y] = p
                continue
            if y > hy + CAP + 2 and abs(x - hx) < 12:            # 모터 몸통
                continue
            up, dn = px[x, max(0, y - 8)], px[x, min(H - 1, y + 8)]
            if up[3] > 200 and dn[3] > 200 and not gray(up) and not gray(dn):
                cp[x, y] = tuple((up[i] + dn[i]) // 2 for i in range(4))
            else:
                cp[x, y] = (0, 0, 0, 0)

# 4) 4장: 도는 원판(잔상) + 45°씩 돌아간 2날 프로펠러 (대각선끼리 같은 방향으로)
for f in range(4):
    fr = clean.copy()
    g = ImageDraw.Draw(fr, "RGBA")
    for i, (hx, hy) in enumerate(hubs):
        g.ellipse([hx - R, hy - R * 0.3, hx + R, hy + R * 0.3], fill=(150, 155, 160, 55))
        th = (f * 45 + i * 30) * (1 if i in (0, 3) else -1)
        for k in (0, 180):
            a = math.radians(th + k)
            tx, ty = hx + math.cos(a) * R * 0.95, hy + math.sin(a) * R * 0.3
            nx, ny = -math.sin(a) * 5, math.cos(a) * 5 * 0.3
            g.polygon([(hx + nx * 0.6, hy + ny * 0.6 + 1.5), (tx + nx, ty + ny + 2.5),
                       (tx - nx, ty - ny - 2.5), (hx - nx * 0.6, hy - ny * 0.6 - 1.5)], fill=(88, 94, 100, 235))
    fr.alpha_composite(cap_layer)
    fr.save(out_dir / f"drone_bar_{f}.png")
print(f"saved drone_bar_0~3.png ({W}x{H}), bar y = {bar_y + PADT}")

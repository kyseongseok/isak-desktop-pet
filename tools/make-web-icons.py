# 휴대폰 웹앱 아이콘 만들기: 하늘→풀밭 배경 위에 손 흔드는 이삭이 (app/renderer/img/hello.png)
# 결과는 web/icons/ 에 저장 (한 번 만들어 두면 됨, 빌드가 그대로 복사)
# 사용: python3 tools/make-web-icons.py
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'app' / 'renderer' / 'img' / 'hello.png'
OUT = ROOT / 'web' / 'icons'
TOP, BOTTOM = (159, 217, 255), (215, 240, 180)   # 게임 창 배경(#9fd9ff) → 연한 풀빛


def make(size, fill):
    """fill: 이삭이 키가 아이콘의 몇 할을 차지할지 (maskable은 가장자리가 잘려서 작게)"""
    bg = Image.new('RGB', (size, size))
    for y in range(size):
        t = y / (size - 1)
        bg.paste(tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)), (0, y, size, y + 1))
    isak = Image.open(SRC).convert('RGBA')
    isak = isak.crop(isak.getbbox())   # 투명한 가장자리 빼고
    h = round(size * fill)
    w = round(isak.width * h / isak.height)
    isak = isak.resize((w, h), Image.LANCZOS)
    bg.paste(isak, ((size - w) // 2, (size - h) // 2 + round(size * 0.02)), isak)
    return bg


OUT.mkdir(parents=True, exist_ok=True)
make(512, 0.84).save(OUT / 'icon-512.png', optimize=True)
make(192, 0.84).save(OUT / 'icon-192.png', optimize=True)
make(180, 0.84).save(OUT / 'apple-touch-icon.png', optimize=True)   # 아이폰 홈 화면 (모서리는 아이폰이 둥글게 깎음)
make(512, 0.62).save(OUT / 'icon-maskable-512.png', optimize=True)   # 안드로이드가 동그라미 등으로 잘라도 이삭이가 다 보이게
print('web/icons/ 완성')

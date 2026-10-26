"""손수레 밀기: 화면 쪽 손(몸통 앞 주먹)만 원본 그대로 떼어 push_fist.png로 저장
펫이 수레(이삭이 앞)를 그린 뒤 이 주먹을 맨 위에 한 번 더 겹쳐서, 손이 손잡이를 가리며 쥔 모양이 되게 함
(앞으로 뻗은 반대쪽 주먹은 앞에 놓인 수레에 가려짐)
(덧칠·흐림 없이 원본 픽셀을 그대로 씀. 가장자리만 1px 부드럽게)
Usage: python3 tools/make-push-fist.py
"""
from pathlib import Path

from PIL import Image, ImageFilter

img_dir = Path(__file__).resolve().parent.parent / "app" / "renderer" / "img"
im = Image.open(img_dir / "push.png").convert("RGBA")
W = im.width
px = im.load()
white = lambda p: p[3] > 40 and min(p[:3]) > 185

# 몸통 앞 주먹: 얼굴(턱)과 맞닿아 있어서 턱선(0.688) 아래, x 0.42~0.52 범위의 흰 부분만
mask = Image.new("L", im.size, 0)
mp = mask.load()
for x in range(int(0.42 * W), int(0.52 * W)):
    for y in range(int(0.688 * W), int(0.80 * W)):
        if white(px[x, y]):
            mp[x, y] = 255
# 주먹 주름(회색)·외곽선까지 덮이게 조금 넓히고 메운 뒤, 가장자리만 살짝 부드럽게
mask = mask.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
fist = Image.new("RGBA", im.size, (0, 0, 0, 0))
fist.paste(im, (0, 0), mask)
fist.save(img_dir / "push_fist.png")
print("saved push_fist.png", mask.getbbox())

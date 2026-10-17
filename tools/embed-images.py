"""Embed preview/img/*.png into preview/index.html as data URIs (WebP),
so the page works even when opened without its img/ folder.
Usage: python3 tools/embed-images.py
"""
import base64
import io
import json
import re
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
html_path = root / "preview" / "index.html"
img_dir = root / "preview" / "img"

data = {}
for png in sorted(img_dir.glob("*.png")):
    buf = io.BytesIO()
    Image.open(png).convert("RGBA").resize((384, 384), Image.LANCZOS).save(buf, "WEBP", quality=88, method=6)
    data[png.stem] = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()

block = "<!-- IMG_DATA_START --><script>window.IMG_DATA = " + json.dumps(data) + ";</script><!-- IMG_DATA_END -->"
html = html_path.read_text(encoding="utf-8")
html, n = re.subn(r"<!-- IMG_DATA_START -->.*?<!-- IMG_DATA_END -->", lambda _: block, html, flags=re.S)
if n != 1:
    raise SystemExit("marker not found in index.html")
html_path.write_text(html, encoding="utf-8")
print(f"embedded {len(data)} images, html size {html_path.stat().st_size / 1024:.0f} KB")

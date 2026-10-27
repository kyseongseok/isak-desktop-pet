#!/bin/sh
# 휴대폰 웹앱 올리기: dist-web/을 빌드해서 gh-pages 브랜치에 커밋 하나로 올림 → GitHub Pages가 1~2분 뒤 반영
# 공개 주소: https://kyseongseok.github.io/isak-desktop-pet/
# 지금 작업 중인 브랜치·색인은 건드리지 않음 (임시 색인으로 dist-web만 담음)
# 사용: sh tools/deploy-web.sh
set -e
cd "$(dirname "$0")/.."
node tools/build-web.mjs

INDEX=$(mktemp)
rm -f "$INDEX"
GIT_INDEX_FILE="$INDEX" git --work-tree=dist-web add -A -f .
TREE=$(GIT_INDEX_FILE="$INDEX" git write-tree)
rm -f "$INDEX"

git fetch -q origin gh-pages
PARENT=$(git rev-parse origin/gh-pages)
if [ "$(git rev-parse "$PARENT^{tree}")" = "$TREE" ]; then echo '바뀐 게 없어서 올리지 않음'; exit 0; fi
COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "휴대폰 웹앱 빌드 ($(git rev-parse --abbrev-ref HEAD) $(git rev-parse --short HEAD))")
git push origin "$COMMIT:refs/heads/gh-pages"
echo '올림: https://kyseongseok.github.io/isak-desktop-pet/ (1~2분 뒤 반영, 휴대폰은 새 버전을 받으면 고르는 화면이 저절로 새로 고침)'

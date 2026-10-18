# 이삭이 데스크톱 펫

농촌진흥청 캐릭터 이삭이가 바탕화면에 상주하며 초과근무 근무확인 시간을 알려 주는 Electron 앱.

## 폴더

| 경로 | 내용 |
|---|---|
| `app/main.js` | 메인 프로세스: 투명 창, 트레이 메뉴, 상태 저장, 자리 비움 감지, 알림, 코인 |
| `app/renderer/pet.js` | 펫 물리(말랑·던지기·걷기), 말풍선, 우클릭 메뉴, 초과근무 알람 로직 |
| `app/holidays.js` | 공휴일 목록 (해마다 갱신) |
| `preview/index.html` | 브라우저용 프로토타입 (시뮬레이션 시계로 알람 흐름 시험) |
| `assets/source-3d` · `assets/cutout` | Gemini로 만든 3D 이미지 원본 · 배경 제거본 |
| `tools/` | 배경 제거(`remove-bg.swift`), 미리보기 이미지 내장(`embed-images.py`) |

## 실행 (개발)

```bash
npm install
```

```bash
npm start
```

npm 11 이상은 설치 스크립트를 막아 Electron 바이너리가 안 받아질 수 있어요. 그때는:

```bash
node node_modules/electron/install.js
```

## 윈도우 exe 만들기

- **GitHub Actions**: 저장소에 올린 뒤 Actions → build-win → Run workflow. 결과물은 Artifacts의 `이삭이-설치-x.y.z.exe` (사용자 단위 설치본, 관리자 권한 불필요).
- **윈도우 PC/VM에서 직접**: `npm install` 후 `npm run build:win` → `dist/` 폴더.

## 저장되는 상태

`%APPDATA%\이삭이\state.json` (Mac: `~/Library/Application Support/이삭이/state.json`)
크기, 위치, 모니터, 자동 행동, 자동 실행, 코인, 오늘의 초과근무 상태.

## 아직 안 된 것 (다음 단계)

- 윈도우 전용: 창을 바탕화면 바로 위에 고정(Win+D 대응), 바탕화면 아이콘 좌표 읽어 뛰어넘기·튕기기, 전체화면 앱 중 케어 메시지 보류
- 미니게임(타자, 똥 피하기, 새총)과 코인 사용
- 파츠 분리 걷기 애니메이션

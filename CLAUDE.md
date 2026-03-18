# Indian Poker - CLAUDE.md

## 프로젝트 개요
- WebRTC(PeerJS) 기반 1:1 인디언 포커 게임
- 순수 HTML/CSS/JS (프레임워크 없음)
- GitHub Pages로 배포 (자동)

## 버전 관리 (절대 규칙) ⭐️⭐️⭐️

**모든 커밋 시 반드시 버전을 올려야 한다.**

### 버전 위치 (3곳 동시 수정 필수)
1. `index.html` - `<p class="version-info">vX.Y.Z</p>` (화면 표시)
2. `index.html` - CSS/JS 캐시 버스팅 쿼리: `?v=X.Y.Z`
   - `css/style.css?v=X.Y.Z`
   - `js/connection.js?v=X.Y.Z`
   - `js/game.js?v=X.Y.Z`
   - `js/app.js?v=X.Y.Z`

### 버전 증가 규칙
- **patch (Z)**: 버그 수정, 스타일 수정, 작은 변경 → `1.4.1` → `1.4.2`
- **minor (Y)**: 새 기능 추가 → `1.4.2` → `1.5.0`
- **major (X)**: 대규모 변경, 호환성 깨짐 → `1.5.0` → `2.0.0`

### 왜 필요한가
- GitHub Pages는 강력한 캐시를 사용
- 쿼리 파라미터(`?v=`)가 변경되지 않으면 브라우저가 이전 CSS/JS를 계속 사용
- 버전업 누락 = 배포해도 사용자에게 반영되지 않음

## 파일 구조
- `index.html` - 메인 HTML (모든 화면 포함)
- `css/style.css` - 전체 스타일
- `js/app.js` - UI 로직, 이벤트 핸들러
- `js/game.js` - 게임 로직 (베팅, 라운드, 승패)
- `js/connection.js` - WebRTC 연결 관리
- `sw.js` - Service Worker
- `manifest.json` - PWA 매니페스트

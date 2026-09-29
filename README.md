# POE2 Market

Python + React로 만든 개인용 PoE2 시세 대시보드입니다. 기본 시세는 [poe.ninja의 공개 경제 API](https://poe.ninja/docs/api)에서 받으며, 브라우저는 로컬 Python 서버에만 요청합니다.

## 실행

Python 3.10+와 Node.js 20.19+가 필요합니다.

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:POE_NINJA_USER_AGENT = "Poe2MinuteChart/0.1 (contact: your-email@example.com)"
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

다른 터미널에서:

```powershell
cd frontend
npm install
npm run dev
```

브라우저에서 `http://127.0.0.1:5173`을 엽니다. 연락 가능한 주소로 `POE_NINJA_USER_AGENT`의 예시 이메일을 바꿔주세요.

## 데이터 의미

- 시작 시 현재 리그의 공개 경제 시세를 가져옵니다. 다른 리그를 선택하면 해당 리그도 가져옵니다.
- 전체 분류는 기본 15분마다, 화면에서 선택한 아이템이 속한 분류는 1분마다 poe.ninja에 확인합니다. 해당 API가 분류 단위 개요를 제공하므로 선택 아이템 하나만 요청하는 방식은 아닙니다. 원천 가격이 바뀌지 않았다면 1분 차트에도 같은 값이 기록됩니다.
- 일반 요청은 ETag/Last-Modified를 사용하며, 429 응답의 `Retry-After` 동안 해당 호스트 요청을 중단합니다. 수동 새로고침은 로컬 갱신 간격과 조건부 요청을 무시하지만 원천 서버의 요청 제한은 지킵니다.
- 서버는 **전체 아이템의 가격을 15분마다** SQLite `market_snapshots`에 저장합니다. 원천 API에서 확인에 성공한 분류만 기록합니다. 화면에서 열어 본 아이템은 최근 24시간 동안 추가로 1분 관측값을 저장합니다. 1분 화면은 관측 가격 선 그래프이고, 5분 이상은 관측값의 OHLC 캔들입니다. 실제 거래 체결봉이 아닙니다.
- 서버가 실행 중인 동안 기록은 계속 누적되며 자동 삭제하지 않습니다. 서버가 중지된 시간의 가격은 채우지 않습니다. DB 용량을 정기적으로 확인하고 백업하세요.
- 요일·시간대 분석은 한국 시간 기준 각 날짜의 가격 중앙값과 비교한 상대 차이를 표시합니다. 최소 3주, 같은 요일·시간대의 관측 3일 이상이 쌓여야 가장 낮았던 시간을 제시합니다. 과거 관측 패턴이며 미래 최저가를 보장하지 않습니다.
- 시세와 차트의 기본 단위는 엑잘티드 오브입니다. 신성/엑잘 가격은 관측 시점의 리그 환율과 함께 저장하므로 과거 봉을 현재 환율로 다시 계산하지 않습니다.
- `최근 변동`은 poe.ninja의 sparkline 요약값입니다. 특정 24시간 수익률로 해석하지 마세요.
- 관심 목록은 브라우저 localStorage에 저장됩니다.
- 아이템명과 베이스 타입은 PoE2 GGPK에서 추출한 한국어 표시명 사전으로 표시합니다. 앱 시작 시 `data/item_names_kr.json`과 `data/unique_names_kr.json`에 캐시하며, 한국어 명칭이 없는 새 항목만 원문으로 남깁니다.
- 화폐 교환 아이템을 선택하면 POE2Scout의 기존 가격 이력을 별도 참고 카드로 보여줍니다. 이는 1분봉에 섞지 않습니다.
- 선택적으로 Trade2 매물 호가를 조회할 수 있습니다. Trade2는 GGG의 지원 대상 개발자 API가 아닌 거래 웹사이트 내부 경로입니다. `POE_TRADE2_LIVE=1`로 명시적으로 켠 경우에만 주요 통화의 매물 중앙값을 별도 출처로 표시하고, 그 관측 기록은 `live_observations`에 분리해 저장합니다. 매물 호가는 체결가가 아니며, 이 기능은 웹사이트 변경이나 요청 제한으로 중단될 수 있습니다.

설정: `POE_DEFAULT_LEAGUE`로 시작 리그, `POE_MARKET_POLL_SECONDS`로 전체 시세 요청 간격(기본 900초), `POE_HISTORY_SNAPSHOT_SECONDS`로 전체 시세 저장 간격(기본 900초), `POE_SELECTED_POLL_SECONDS`로 선택 분류 요청 간격(기본 60초), `POE_TRACKED_ACTIVE_SECONDS`로 열어 본 아이템의 추가 1분 기록 기간(기본 24시간), `POE_DB_PATH`로 SQLite 경로를 변경할 수 있습니다.

## Ubuntu에서 계속 수집

`solty@192.168.0.50`에서는 sudo 권한 없이 사용자 crontab이 1분마다 수집기 실행 상태를 확인합니다. `flock`으로 중복 실행을 막고 백엔드는 서버 내부 `127.0.0.1:18080`에 바인딩합니다. DB는 Git에서 제외한 `~/POE2-Exchange/data/prices.sqlite3`에 누적됩니다.

```bash
git clone https://github.com/soltyspring/POE2-Exchange.git ~/POE2-Exchange
cd ~/POE2-Exchange/backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
chmod +x ../deploy/run_collector.sh
chmod +x ../deploy/install_user_cron.sh
../deploy/install_user_cron.sh
curl http://127.0.0.1:18080/api/health
```

cron 등록 후 최대 1분 이내에 수집기가 시작됩니다. 코드 갱신은 `git pull`과 의존성 설치 후 수집기 프로세스를 재시작합니다. 과거 가격은 `cd backend && .venv/bin/python backfill_scout.py --league 'Forbidden Rites'`로 별도 출처 테이블에 가져옵니다. `backend/verify_data.py`는 누적 건수와 시각을 읽기 전용으로 확인합니다. POE2Scout 응답은 체결 건별 로그가 아닌 과거 가격 관측값이며, 데이터가 충분한 화폐에 한해 요일·시간대 분석에 사용합니다.

로컬 화면을 우분투 데이터에 연결하려면 SSH 터널을 연 뒤 프런트엔드를 다시 실행합니다. 서버 주소와 키 경로는 본인 환경에 맞게 바꿉니다.

```powershell
ssh -N -L 18000:127.0.0.1:18080 -i C:\Users\aghose\.ssh\ssh-key-2025-09-27.key solty@192.168.0.50
```

다른 터미널에서:

```powershell
$env:POE_API_PROXY_TARGET = "http://127.0.0.1:18000"
cd frontend
npm run dev
```

## API

- `GET /api/leagues`
- `GET /api/markets?league=Forbidden%20Rites`
- `GET /api/candles/exchange:Currency:exalted?league=Forbidden%20Rites&interval=1m`
- `GET /api/health`
- `GET /api/seasonality/exchange:Currency:divine?league=Forbidden%20Rites&days=56&unit=exalted`
- `GET /api/scout/exchange:Currency:divine?league=Forbidden%20Rites`
- `POST /api/refresh?league=Forbidden%20Rites&market_id=exchange:Currency:divine&scope=selected`
- `GET /api/live/exchange:Currency:divine?league=Forbidden%20Rites` (`POE_TRADE2_LIVE=1`일 때)

화폐·에센스·혈통 보조젬·룬·영혼핵·징조·촉매·액상 감정과 주요 고유 장비 분류를 수집합니다. API 사용량을 줄이기 위해 분류별 요청은 최대 3개씩 처리합니다. 실패한 분류는 상태를 표시하고 이전 시세를 유지합니다.

## 구현 참고

차트별 비교와 적용 근거는 [CHART_RESEARCH.md](CHART_RESEARCH.md)에 정리했습니다.

- [POE2Scout](https://github.com/poe2scout/poe2scout): 화폐 교환 스냅샷은 공식 과거 집계를 기반으로 시간 단위로 생성합니다. API의 `Currencies/{apiId}` 가격 로그를 참고 가격 카드에 연결했습니다.
- [poe2-currency-exchange-check](https://github.com/iheanyi/poe2-currency-exchange-check): 스냅샷 조회의 60초 캐시, 요청 합치기, 호스트별 제한 방식을 검토했습니다. 이 앱은 브라우저 요청을 Python 서버로 모으고, poe.ninja 요청은 최소 10분 간격으로 캐시합니다.
- [MaxOverlay-POE2](https://github.com/MaxDistroyer/MaxOverlay-POE2): 아이템 단건 가격 조회와 캐시 구조를 확인했습니다. 화면 OCR과 거래 사이트 조회 기능은 이 시세 차트의 범위에 포함되지 않습니다.

한국어 아이템 표시는 [seominugi/poe-game-data](https://github.com/seominugi/poe-game-data)의 PoE2 `kr` 표시명 사전과 유니크 아이템 데이터(`v2026.09.17.2`)를 사용합니다. 영어 문자열을 임의로 번역하지 않고 게임 데이터의 한국어 표기를 우선하며, 데이터에 없는 문자열만 원문을 유지합니다.

세 프로젝트 모두 MIT 라이선스지만 코드 자체를 복사하지 않았습니다. POE2Scout의 가격 로그도 실제 1분 체결 내역이 아니며, 화면에서 별도 출처로 구분합니다.

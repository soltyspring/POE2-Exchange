# PoE2 공개 프로젝트의 시세 차트 방식

2026-09-28 기준으로 공개 저장소의 실제 화면 코드를 확인했다. GitHub 전체를 망라한 목록은 아니며, 차트 구현이 있거나 PoE2 가격 이력을 다루는 관련 프로젝트를 비교했다.

| 프로젝트 | 화면 구현 | 데이터와 해석 | 이 앱에 적용한 판단 |
| --- | --- | --- | --- |
| [POE2Scout 가격 로그](https://github.com/poe2scout/poe2scout/blob/main/web/app/features/economy/components/item-history-raw-chart.tsx) | `lightweight-charts` 선 그래프와 별도 축의 거래량 막대. 마우스 위치의 가격·거래량·시각 표시 | 가격 로그 원본과 수량 이력 | 관측값은 선으로 표시. 우리 분당 거래량 원본은 없으므로 거래량 막대는 추가하지 않음 |
| [POE2Scout 일별 통계](https://github.com/poe2scout/poe2scout/blob/main/web/app/features/economy/components/item-history-daily-chart.tsx) | 캔들, 거래량 막대, OHLC 범례 | 하루에 여러 기록을 집계한 값 | 5분 이상 구간의 관측값 OHLC에 캔들 적용. 체결봉이라고 부르지 않음 |
| [POE2Scout 교환쌍](https://github.com/poe2scout/poe2scout/blob/main/web/app/features/exchange/components/pair-history-chart.tsx) | 선·거래량의 이중 축, 과거 데이터 추가 로딩, 마우스 범례 | 거래소 과거 집계. 1분 체결 피드는 아님 | 차트 객체를 유지한 채 데이터만 갱신해 확대 위치를 보존하고, 마우스 범례 추가 |
| [POE2Scout 목록 스파크라인](https://github.com/poe2scout/poe2scout/blob/main/web/app/features/economy/components/price-history-cell.tsx) | 작은 SVG 면적·곡선과 변동률. 값이 부족하면 `No data` | 짧은 목록 미리보기 | 목록용 작은 차트에는 적합하지만 상세 시세 차트에는 시간축이 필요 |
| [poe2-tracker](https://github.com/traad1/poe2-tracker/blob/main/app/pages_/trends.py) | Streamlit 선 그래프, 24시간 변화·7일 변동성, 원본 스냅샷 표 | 저장된 시세 스냅샷. 2개 미만이면 차트 대신 안내 | 데이터 부족 상태와 원본 관측 개수 명시 |
| [exile-terminal](https://github.com/aurph/exile-terminal/blob/main/src/components/charts/TrendChart.tsx) | 라이브러리 없는 SVG 면적 스파크라인 | 요약 추세 | 상세 차트보다는 카드·표 미리보기에 적합 |
| [poe2fuzzymarket](https://github.com/sschott20/poe2fuzzymarket/blob/main/src/poe2market/static/app.js) | Chart.js 누적 선, 일별 막대, 통화별 도넛 | 개인 판매 기록. 전체 시장 가격 이력은 아님 | 가격 시계열과 성격이 달라 차트 형태를 그대로 옮기지 않음 |
| [MaxOverlay-POE2](https://github.com/MaxDistroyer/MaxOverlay-POE2/blob/main/maxoverlay.py) | 최근 가격 로그 6개를 날짜·가격·수량 텍스트 행으로 표시 | POE2Scout 참고 가격 | 차트의 출처가 다른 참고 이력은 별도 카드로 유지 |

`poe2-currency-exchange-check`는 교환 경로 비교 중심이며 시계열 차트 구현은 확인되지 않았다. `poe2-dashboard`는 차익 경로와 표 중심이다. 따라서 1분 시세 시각화에 직접 참고할 만한 핵심 구현은 POE2Scout의 원본 선 그래프와 집계 캔들 구분이다.

## 이 앱에 적용한 방식

- 1분: 한 시점에 보통 관측값 하나이므로 선 그래프. 서버가 중단되어 관측이 비어 있는 구간은 선을 끊는다.
- 5분·1시간·1일: 해당 구간의 관측값으로 OHLC 캔들을 계산한다. 범례에 시가·고가·저가·종가와 관측 횟수를 보여준다.
- 1분마다 새 데이터가 와도 차트를 다시 생성하지 않는다. 사용자가 확대하거나 이동한 위치를 유지한다.
- 거래량 막대는 표시하지 않는다. 현재 수집하는 거래 규모는 원천 API의 요약값으로, 분당 체결량이 아니다.

이 앱의 1분 선과 집계 캔들은 **우리 서버가 관측한 시세 이력**이다. 1분마다 실제로 거래된 주문의 체결봉과 구별해야 한다.

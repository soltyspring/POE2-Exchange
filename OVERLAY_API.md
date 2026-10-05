# 오버레이 일괄 시세 API

`POST /api/overlay/prices`는 미리 수집한 시세만 조회한다. 아이템별 공식 거래 검색은 호출하지 않는다.

```json
{
  "league": "Forbidden Rites",
  "items": [
    {"key": "drop-1", "name": "엑잘티드 오브", "kind": "currency"},
    {"key": "drop-2", "name": "슬픔의 발 사이렌 장갑", "baseType": "사이렌 장갑", "kind": "rare"}
  ]
}
```

- 최대 500개. `key`는 필수이며 화면의 개별 아이템 식별에 사용한다. 중복 key는 첫 항목만 반환한다.
- `id` 또는 정확한 `name`으로 매칭한다. 전체 이름과 `baseType`은 응답에도 별도로 보존한다.
- 지원 kind: `currency`, `consumable`, `unique` 및 `화폐`, `소모품`, `고유`.
- 서판은 `tablet` 또는 `서판`을 사용한다. 선대 서판은 `variant`에 `Normal`, `Magic`, `Rare`를 전달하거나 정확한 id로 조회한다. 희귀 서판 시세는 종류별 참고가이며 실제 옵션별 평가가 아니다. 고유 서판과 고유 유물은 `unique`로 조회한다.
- 고유 이름이 여러 변형과 매칭되어 확정되지 않으면 `missing`이다. 가능하면 markets의 정확한 id를 전달한다.
- 희귀 베이스, 등급별 경로석, 레벨별 젬 스냅샷은 아직 없다. 해당 종류 및 tier/level을 지정한 요청은 `missing`이다. 고유 시세로 대체하지 않는다.
- 이름의 앞부분을 실제 옵션으로 추정하지 않는다. 옵션 복사 후 기존 상세 조회 흐름을 사용한다.

응답 `items`는 key별 객체이며 `name`, `baseType`, `kind`, `priceExalted`, `priceDivine`, `priceKind`, `observedAt`, `source`, `sampleCount`, `state`를 포함한다. `sampleCount`는 원본의 listing_count이며 실거래 건수가 아니다. 원본에 없으면 null이다.

`snapshotVersion`과 `rates.exaltedPerDivine`을 함께 반환한다. 관측 후 30분이 지났으면 `stale`이며 가격은 null이다. 환율만 오래된 경우 신선한 디바인 가격은 남지만 엑잘 환산은 null이다. 오버레이는 priceExalted가 있는 항목만 가격 정렬에 사용해야 한다.

스냅샷은 60초 동안 메모리에 보관하고 동시 로딩을 공유한다. 수집 데이터 변경 시 무효화하며 수집 완료 시 새 스냅샷을 미리 로딩한다. gzip은 기존 미들웨어로 지원한다. ETag와 If-None-Match를 지원하며 동일한 응답은 304이다. Server-Timing은 db/serialize/cache 밀리초를 제공한다. 메모리 인덱스 구축과 전체 HTTP 시간은 별도로 측정해야 한다.

DB가 비어 있는 markets/overlay 요청은 중복을 공유하는 백그라운드 수집을 시작하고 `collecting`을 반환한다. 기존 markets 응답 필드는 유지한다. 리그는 마지막 유효 메모리 목록을 먼저 반환하고 만료되었으면 백그라운드 갱신한다. 프로세스에 리그 목록이 전혀 없을 때는 최초 외부 조회가 필요하다.

## 로컬 검증 (2026-10-05)

`python -m unittest discover -s backend -p 'test_*.py'`: 17개 통과.

`python backend/benchmark_overlay.py`: 외부 HTTP 없이 로컬 DB와 ASGI 경로를 측정하고 종류별 observed_at 및 SQLite 실행 계획을 출력한다.

30개 요청, 캐시 반복 100회: p50 0.888ms, p95 1.043ms. 최초 요청 19.399ms 중 DB 8.433ms. 응답 7,275바이트, gzip 본문 452바이트. 현재 로컬 데이터가 오래되어 가격이 null인 응답 기준이며 실제 배포 네트워크 성능이나 신선한 가격 응답 크기를 의미하지 않는다.

현재 SQL은 league로 한 번 읽고 종류/이름/id는 메모리 인덱스로 조회한다. 실행 계획은 기존 `(league,id)` 기본키 인덱스를 사용한다. 아직 없는 kind/tier/level SQL 조회용 복합 인덱스를 임의로 추가하지 않았다.

로컬 DB에서 고유 장신구·부적·플라스크의 observed_at가 화폐보다 약 32시간 이전이었다. HTTP 304 처리에서는 fetch_state.fetched_at만 갱신하고 markets.observed_at는 유지하는 현재 수집 동작도 확인했다. 이번 API는 요청 시 오래된 관측 시각을 새 시각으로 바꾸지 않는다. 실제 소스 갱신 실패 여부는 fetch_state 및 수집 로그와 함께 확인해야 한다.

이번 변경은 웹 백엔드와 검증 도구에 한정한다. 별도 오버레이 클라이언트 연결, 희귀/젬/경로석 신규 수집기, 배포, Brotli는 포함하지 않는다.

## poe.ninja 데이터 종류 확대

2026-10-05 poe.ninja PoE2 공개 economy 페이지의 분류 목록을 확인하여 기존 20종에 `UniqueSanctumRelics`(고유 유물), `UniqueTablets`(고유 서판), `PrecursorTablets`(선대 서판)를 추가했다. 현재 공개 분류 23종 전체를 기존 주기 수집에 포함한다.

원본: https://poe.ninja/poe2/economy/forbiddenrites/currency

선대 서판의 Normal/Magic/Rare 변형, detailsId, 요구 레벨, 타락 여부를 별도 market_metadata 테이블에 저장한다. 기존 markets 테이블과 id 형식은 유지한다. 웹 목록에 변형 정보를 표시하며 공개 분류 23종이 웹 목록에 포함된다.

Forbidden Rites의 23종을 실제 새로 수집했고 종류별 수집 오류는 없었다. 서판 및 유물 추가 데이터는 고유 유물 5개, 고유 서판 9개, 선대 서판 23개다. 종류와 항목 수는 원본에 따라 변동된다. poe.ninja에서 제공하지 않는 임의 희귀 옵션 조합 시세를 만들어 내지는 않는다.

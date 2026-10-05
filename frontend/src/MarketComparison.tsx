import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, Clock3, Search, Star, X } from 'lucide-react'
import './MarketComparison.css'
import {
  MarketLiquidityBadge,
  MarketPrice,
  assessMarketLiquidity,
  type MarketPriceMode,
  type MarketReferenceRates,
} from './marketDisplay'

export type ComparisonMarket = {
  league: string
  id: string
  category: string
  category_label: string
  name: string
  icon: string | null
  base_type: string | null
  price_divine: number
  volume_divine: number | null
  listing_count: number | null
  trend_percent: number | null
  source_kind: string
  observed_at: number
  changed_at: number
  display_order?: number
  variant?: string | null
}

type SparklinePoint = {time: number; price_divine: number; samples: number}
type SparklineMarket = {
  market_id: string
  points: SparklinePoint[]
  point_count: number
  sample_count: number
  first_at: number | null
  last_at: number | null
}
type SparklineResponse = {markets: SparklineMarket[]}
type ExchangeSection = 'general' | 'equipment'
type ExchangeSort = 'game' | 'name' | 'price' | 'change' | 'liquidity'

const GENERAL_CATEGORIES = [
  'Currency', 'Fragments', 'Abyss', 'UncutGems', 'LineageSupportGems', 'Essences',
  'SoulCores', 'Idols', 'Runes', 'Ritual', 'Expedition', 'Delirium', 'Breach', 'Verisium',
  'PrecursorTablets',
]
const EQUIPMENT_CATEGORIES = [
  'UniqueWeapons', 'UniqueArmours', 'UniqueAccessories', 'UniqueFlasks', 'UniqueCharms', 'UniqueJewels',
  'UniqueSanctumRelics', 'UniqueTablets',
]
const CURRENCY_GAME_ORDER = [
  'transmute', 'greater-orb-of-transmutation', 'perfect-orb-of-transmutation',
  'aug', 'greater-orb-of-augmentation', 'perfect-orb-of-augmentation',
  'regal', 'greater-regal-orb', 'perfect-regal-orb',
  'exalted', 'greater-exalted-orb', 'perfect-exalted-orb',
  'chaos', 'greater-chaos-orb', 'perfect-chaos-orb', 'vaal', 'alch', 'divine',
  'chance', 'annul', 'fracturing-orb', 'mirror', 'hinekoras-lock', 'crystallised-corruption',
  'lesser-jewellers-orb', 'greater-jewellers-orb', 'perfect-jewellers-orb',
  'chance-shard', 'artificers-shard', 'whetstone', 'scrap', 'gcp', 'bauble',
]
const PAGE_SIZE = 60
const VARIANT_LABELS: Record<string, string> = {Normal: '일반', Magic: '마법', Rare: '희귀'}

const compactNumber = (value: number) => new Intl.NumberFormat('ko-KR', {
  notation: Math.abs(value) >= 1000 ? 'compact' : 'standard',
  maximumFractionDigits: 1,
}).format(value)

const categoryKeys = (section: ExchangeSection) => section === 'general' ? GENERAL_CATEGORIES : EQUIPMENT_CATEGORIES

function gameOrder(market: ComparisonMarket, sectionKeys: string[]) {
  const categoryOrder = sectionKeys.indexOf(market.category)
  if (market.category === 'Currency') {
    const shortId = market.id.replace('exchange:Currency:', '')
    const explicit = CURRENCY_GAME_ORDER.indexOf(shortId)
    if (explicit >= 0) return categoryOrder * 1_000_000 + explicit
  }
  return categoryOrder * 1_000_000 + (market.display_order ?? 999_999)
}

function liquiditySortValue(market: ComparisonMarket) {
  const assessment = assessMarketLiquidity(market)
  const quality = assessment.quality === 'good' ? 3 : assessment.quality === 'limited' ? 2 : 1
  return quality * 1_000_000_000 + (assessment.value ?? 0)
}

function MarketSparkline({history, trend}: {history?: SparklineMarket; trend: number | null}) {
  const points = history?.points || []
  const values = points.map(point => point.price_divine)
  const low = values.length ? Math.min(...values) : 0
  const high = values.length ? Math.max(...values) : 0
  const span = high - low || 1
  const polyline = points.map((point, index) => {
    const x = points.length === 1 ? 56 : 3 + index * 106 / (points.length - 1)
    const y = high === low ? 18 : 31 - (point.price_divine - low) / span * 25
    return x.toFixed(1) + ',' + y.toFixed(1)
  }).join(' ')
  const trendClass = trend == null ? 'flat' : trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat'
  const trendText = trend == null
    ? '변동 정보 없음'
    : (trend > 0 ? '+' : '') + new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 2}).format(trend) + '%'
  const historyLabel = points.length > 1
    ? (history?.sample_count || points.length).toLocaleString('ko-KR') + '회 저장 관측'
    : '저장 이력 부족'
  return <div className={'comparison-trend ' + trendClass} aria-label={'7일 변화 ' + trendText + '. ' + historyLabel}>
    <svg viewBox="0 0 112 36" role="img" aria-hidden="true">
      <path d="M3 18 H109" className="comparison-sparkline-axis"/>
      {points.length > 1 ? <polyline points={polyline} className="comparison-sparkline-line"/> : <path d="M22 18 H90" className="comparison-sparkline-empty"/>}
    </svg>
    <span><strong>{trendText}</strong><small>{historyLabel}</small></span>
  </div>
}

function MarketActivity({market}: {market: ComparisonMarket}) {
  const isListing = market.source_kind === 'stash'
  const value = isListing ? market.listing_count : market.volume_divine
  const label = isListing ? '현재 매물' : '거래 규모'
  const unit = isListing ? '개' : ' 신성'
  return <div className="comparison-activity">
    <span>{label}</span>
    <strong>{value == null ? '정보 없음' : compactNumber(value) + unit}</strong>
    {!isListing && value != null && <small>poe.ninja 정규화 값</small>}
  </div>
}

type Props = {
  league: string
  markets: ComparisonMarket[]
  categories: Record<string, string>
  referenceRates: MarketReferenceRates
  selectedId: string
  favorites: string[]
  lastFetched: number
  nextRefresh: number
  refreshMinutes: number
  icon: (market: ComparisonMarket) => ReactNode
  onSelect: (id: string) => void
  onToggleFavorite: (id: string) => void
  onAnalyze: (id: string) => void
  onClose: () => void
}

export function MarketComparison({
  league, markets, categories, referenceRates, selectedId, favorites,
  lastFetched, nextRefresh, refreshMinutes, icon,
  onSelect, onToggleFavorite, onAnalyze, onClose,
}: Props) {
  const [section, setSection] = useState<ExchangeSection>('general')
  const [category, setCategory] = useState('Currency')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ExchangeSort>('game')
  const [descending, setDescending] = useState(false)
  const [priceMode, setPriceMode] = useState<MarketPriceMode>('adaptive')
  const [hideLowLiquidity, setHideLowLiquidity] = useState(false)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [histories, setHistories] = useState<Record<string, SparklineMarket>>({})
  const [historyLoading, setHistoryLoading] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)

  useEffect(() => {
    searchRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOrTrap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); searchRef.current?.focus(); return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, [href], [tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.hasAttribute('hidden') && element.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', closeOrTrap)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOrTrap)
      returnFocusRef.current?.focus()
    }
  }, [onClose])

  const sectionKeys = categoryKeys(section)
  const sectionMarkets = useMemo(
    () => markets.filter(market => sectionKeys.includes(market.category)),
    [markets, sectionKeys],
  )
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR')
    return sectionMarkets.filter(market =>
      (category === 'all' || market.category === category) &&
      (!normalizedQuery || (market.name + ' ' + (market.base_type || '') + ' ' + market.category_label).toLocaleLowerCase('ko-KR').includes(normalizedQuery)) &&
      (!hideLowLiquidity || assessMarketLiquidity(market).quality !== 'low')
    )
  }, [sectionMarkets, category, query, hideLowLiquidity])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let comparison = 0
    if (sort === 'game') comparison = gameOrder(a, sectionKeys) - gameOrder(b, sectionKeys)
    else if (sort === 'name') comparison = a.name.localeCompare(b.name, 'ko-KR') || (a.base_type || '').localeCompare(b.base_type || '', 'ko-KR')
    else if (sort === 'price') comparison = a.price_divine - b.price_divine
    else if (sort === 'change') comparison = (a.trend_percent ?? Number.NEGATIVE_INFINITY) - (b.trend_percent ?? Number.NEGATIVE_INFINITY)
    else comparison = liquiditySortValue(a) - liquiditySortValue(b)
    return comparison * (descending ? -1 : 1) || a.name.localeCompare(b.name, 'ko-KR')
  }), [filtered, sort, descending, sectionKeys])

  const visible = sorted.slice(0, limit)
  const visibleIds = visible.map(market => market.id)
  const visibleIdsKey = visibleIds.join('|')

  useEffect(() => { setLimit(PAGE_SIZE) }, [section, category, query, sort, descending, hideLowLiquidity])
  useEffect(() => {
    if (!league || !visibleIds.length) { setHistories({}); setHistoryLoading(false); return }
    let active = true
    setHistoryLoading(true)
    const batches = Array.from({length: Math.ceil(visibleIds.length / 60)}, (_, index) => visibleIds.slice(index * 60, index * 60 + 60))
    Promise.all(batches.map(async ids => {
      const params = new URLSearchParams({league, market_ids: ids.join(','), days: '7', points: '14'})
      const response = await fetch('/api/market-sparklines?' + params.toString())
      if (!response.ok) throw Error('가격 이력을 불러오지 못했습니다.')
      return response.json() as Promise<SparklineResponse>
    })).then(results => {
      if (!active) return
      const next: Record<string, SparklineMarket> = {}
      results.flatMap(result => result.markets).forEach(history => { next[history.market_id] = history })
      setHistories(next)
    }).catch(() => { if (active) setHistories({}) }).finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [league, visibleIdsKey])

  const changeSection = (next: ExchangeSection) => {
    setSection(next)
    setCategory(next === 'general' ? 'Currency' : 'UniqueWeapons')
  }
  const changeSort = (next: ExchangeSort) => {
    if (sort === next) setDescending(value => !value)
    else { setSort(next); setDescending(next !== 'game' && next !== 'name') }
  }
  const sortState = (key: ExchangeSort): 'ascending' | 'descending' | 'none' => sort !== key ? 'none' : descending ? 'descending' : 'ascending'
  const resetFilters = () => {
    setQuery('')
    setCategory(section === 'general' ? 'Currency' : 'UniqueWeapons')
    setSort('game')
    setDescending(false)
    setHideLowLiquidity(false)
    setPriceMode('adaptive')
  }
  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query) { event.stopPropagation(); setQuery('') }
  }
  const selectedMarket = markets.find(market => market.id === selectedId)
  const generalCount = markets.filter(market => GENERAL_CATEGORIES.includes(market.category)).length
  const equipmentCount = markets.filter(market => EQUIPMENT_CATEGORIES.includes(market.category)).length

  return <div className="market-browser-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="market-browser" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="market-browser-title" aria-describedby="market-browser-description">
      <header className="market-browser-head">
        <div><span className="market-browser-eyebrow">POE2 ECONOMY</span><h2 id="market-browser-title">아이템 거래소 시세표</h2><p id="market-browser-description">가격, 7일 변화, 시장 활동과 신뢰도를 한 행에서 비교하세요.</p></div>
        <div className="market-browser-freshness"><Clock3 size={16}/><span><strong>{lastFetched ? new Date(lastFetched * 1000).toLocaleString('ko-KR', {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}) : '수집 중'}</strong><small>{refreshMinutes + '분 주기' + (nextRefresh ? ' · 다음 ' + new Date(nextRefresh * 1000).toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit'}) : '')}</small></span></div>
        <button className="market-browser-close" onClick={onClose} aria-label="거래소 시세표 닫기"><X size={22}/></button>
      </header>

      <div className="market-browser-toolbar">
        <div className="market-browser-sections" role="tablist" aria-label="시장 구분"><button role="tab" aria-selected={section === 'general'} className={section === 'general' ? 'active' : ''} onClick={() => changeSection('general')}>일반 교환품 <span>{generalCount.toLocaleString('ko-KR')}</span></button><button role="tab" aria-selected={section === 'equipment'} className={section === 'equipment' ? 'active' : ''} onClick={() => changeSection('equipment')}>고유 장비 <span>{equipmentCount.toLocaleString('ko-KR')}</span></button></div>
        <label className="market-browser-search"><Search size={17}/><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onSearchKeyDown} placeholder="아이템 또는 베이스 타입 검색" aria-label="거래소 아이템 검색"/><kbd>Ctrl K</kbd>{query && <button onClick={() => setQuery('')} aria-label="검색어 지우기"><X size={15}/></button>}</label>
        <label className="market-browser-unit"><span>가격 단위</span><select value={priceMode} onChange={event => setPriceMode(event.target.value as MarketPriceMode)}><option value="adaptive">자동</option><option value="divine">신성</option><option value="chaos">카오스</option><option value="exalted">엑잘</option></select><ChevronDown size={14}/></label>
        <label className="market-browser-reliable"><input type="checkbox" checked={hideLowLiquidity} onChange={event => setHideLowLiquidity(event.target.checked)}/><span>저유동 제외</span></label>
        <button className="market-browser-reset" onClick={resetFilters}>필터 초기화</button>
        <span className="market-browser-count" aria-live="polite"><strong>{sorted.length.toLocaleString('ko-KR')}</strong>개</span>
      </div>

      <div className="market-browser-body">
        <nav className="market-browser-categories" aria-label="아이템 분류">
          <div className="market-browser-category-title"><strong>{section === 'general' ? '일반 교환품' : '고유 장비'}</strong><small>분류별 시세</small></div>
          <button className={category === 'all' ? 'active' : ''} aria-current={category === 'all' ? 'page' : undefined} onClick={() => setCategory('all')}><span>전체</span><small>{sectionMarkets.length.toLocaleString('ko-KR')}</small></button>
          {sectionKeys.filter(key => categories[key]).map(key => <button key={key} className={category === key ? 'active' : ''} aria-current={category === key ? 'page' : undefined} onClick={() => setCategory(key)}><span>{categories[key]}</span><small>{sectionMarkets.filter(market => market.category === key).length.toLocaleString('ko-KR')}</small></button>)}
        </nav>

        <main className="market-browser-results">
          <div className="market-browser-context"><div><strong>{category === 'all' ? (section === 'general' ? '일반 교환품 전체' : '고유 장비 전체') : categories[category]}</strong><span>{query ? ' · “' + query + '” 검색 결과' : ''}</span></div><small>{historyLoading ? '7일 관측 추이 불러오는 중' : '7일 변화는 poe.ninja 기준 · 선은 서버에 저장된 관측 기록'}</small></div>
          <div className="market-comparison-table" role="table" aria-label="시장 비교표" aria-rowcount={sorted.length}>
            <div className="market-comparison-head" role="row">
              <span role="columnheader" aria-label="관심 목록"/>
              <button role="columnheader" aria-sort={sortState('name')} onClick={() => changeSort('name')}>아이템 {sort === 'name' ? descending ? '↓' : '↑' : ''}</button>
              <button role="columnheader" aria-sort={sortState('price')} onClick={() => changeSort('price')}>현재가 {sort === 'price' ? descending ? '↓' : '↑' : ''}</button>
              <button role="columnheader" aria-sort={sortState('change')} onClick={() => changeSort('change')}>7일 변화 {sort === 'change' ? descending ? '↓' : '↑' : ''}</button>
              <button role="columnheader" aria-sort={sortState('liquidity')} onClick={() => changeSort('liquidity')}>시장 활동 {sort === 'liquidity' ? descending ? '↓' : '↑' : ''}</button>
              <span role="columnheader">신뢰도</span><span role="columnheader">상세</span>
            </div>
            <button className={sort === 'game' ? 'market-game-order active' : 'market-game-order'} aria-pressed={sort === 'game'} onClick={() => changeSort('game')}>게임 기본 순서 {sort === 'game' ? descending ? '↓' : '↑' : ''}</button>
            <div className="market-comparison-rows" role="rowgroup">
              {visible.map(market => <div key={market.id} className={market.id === selectedId ? 'market-comparison-row selected' : 'market-comparison-row'} role="row" aria-selected={market.id === selectedId} tabIndex={0} onClick={() => onSelect(market.id)} onKeyDown={event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); onSelect(market.id)}}}>
                <button className={favorites.includes(market.id) ? 'comparison-favorite saved' : 'comparison-favorite'} aria-label={market.name + (favorites.includes(market.id) ? ' 관심 해제' : ' 관심 등록')} onClick={event => {event.stopPropagation(); onToggleFavorite(market.id)}}><Star size={16} fill={favorites.includes(market.id) ? 'currentColor' : 'none'}/></button>
                <div className="comparison-item" role="cell">{icon(market)}<span><strong>{market.name}</strong><small>{market.category_label + (market.base_type ? ' · ' + market.base_type : '') + (market.variant ? ' · ' + (VARIANT_LABELS[market.variant] || market.variant) : '')}</small></span></div>
                <div className="comparison-price" role="cell"><MarketPrice market={market} rates={referenceRates} mode={priceMode}/>{priceMode === 'adaptive' && <small>자동 환산</small>}</div>
                <div role="cell"><MarketSparkline history={histories[market.id]} trend={market.trend_percent}/></div>
                <div role="cell"><MarketActivity market={market}/></div>
                <div className="comparison-liquidity-cell" role="cell"><MarketLiquidityBadge market={market}/></div>
                <div className="comparison-action-cell" role="cell"><button onClick={event => {event.stopPropagation(); onAnalyze(market.id)}}>분석 보기</button></div>
              </div>)}
              {!visible.length && <div className="market-comparison-empty"><Search size={24}/><strong>조건에 맞는 아이템이 없습니다.</strong><span>검색어나 유동성 필터를 바꿔 보세요.</span><button onClick={resetFilters}>필터 초기화</button></div>}
            </div>
            {visible.length < sorted.length && <button className="market-comparison-more" onClick={() => setLimit(value => value + PAGE_SIZE)}>더 보기 <span>{visible.length.toLocaleString('ko-KR') + ' / ' + sorted.length.toLocaleString('ko-KR')}</span></button>}
          </div>
        </main>
      </div>

      <footer className="market-browser-foot"><span>{selectedMarket ? <><strong>{selectedMarket.name}</strong> 선택됨 · 행을 누르면 비교 선택, 분석 보기는 메인 차트로 이동</> : '비교할 아이템을 선택하세요.'}</span><small>가격은 관측 기반 추정치이며 실제 체결 가격과 다를 수 있습니다.</small><button disabled={!selectedMarket} onClick={() => selectedMarket && onAnalyze(selectedMarket.id)}>선택 종목 분석 보기</button></footer>
    </section>
  </div>
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CandlestickSeries, ColorType, LineSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { Activity, ChevronDown, Clock3, Coins, ExternalLink, Gift, LayoutDashboard, RefreshCw, Search, ShieldCheck, Star, TrendingUp, TriangleAlert, X } from 'lucide-react'
import { assessMarketLiquidity } from './marketDisplay'
import { ExchangeItemGrid } from './ExchangeItemGrid'

type Market = {
  league: string; id: string; category: string; category_label: string; name: string;
  icon: string | null; base_type: string | null; price_divine: number;
  volume_divine: number | null; listing_count: number | null;
  trend_percent: number | null; source_kind: string;
  observed_at: number; changed_at: number;
  display_order?: number;
}
type SourceStatus = {
  category: string; fetched_at: number; attempted_at: number; next_refresh_at: number;
  cache_age_seconds: number | null; cache_state: 'fresh' | 'stale' | 'error';
  conditional_cache: boolean; error: string | null;
}
type State = {
  markets: Market[]; categories: Record<string, string>; exalted_per_divine: number | null;
  source_status: SourceStatus[]; sample_interval_seconds: number; upstream_poll_seconds: number;
  selected_poll_seconds: number; scout_poll_seconds: number; league_cache_seconds: number;
  trade2_live_enabled?: boolean; trade2_live_seconds?: number;
}
type Candle = {time: number; open: number; high: number; low: number; close: number; samples: number}
type Scout = {source: string; name: string; current_price_exalted: number; logs: {time: string; price_exalted: number; quantity: number}[]}
type LiveQuote = {source: string; price_exalted: number; price_divine: number | null; best: number; median: number; count: number | null; observed_at: number; cache_seconds: number}
type League = {id: string; name: string}
type MarketSort = 'name' | 'price' | 'change'
type MarketScope = 'all' | 'favorites' | 'recent'
type SeasonalityCell = {weekday: number; hour: number; relative_percent: number; days: number}
type OfficialVolumeCell = {weekday: number; hour: number; median_volume_item: number; hours: number}
type OfficialVolume = {supported: boolean; source: string; sample_count: number; first_hour: number | null; last_hour: number | null; total_volume_item: number; cells: OfficialVolumeCell[]}
type Seasonality = {timezone: string; lookback_days: number; sample_count: number; observed_days: number; first_sample_at: number | null; last_sample_at: number | null; source: 'poe.ninja' | 'poe2scout'; cells: SeasonalityCell[]; best_slot: SeasonalityCell | null; official_volume: OfficialVolume}
type MarketSummary = {summary: string; generated_by: 'ai' | 'statistics'; confidence: string; model?: string}
const weekdays = ['월', '화', '수', '목', '금', '토', '일']
const exchangeCategories = ['Currency', 'Essences', 'Ritual', 'Runes', 'SoulCores', 'Abyss', 'Fragments', 'Breach', 'Delirium', 'Idols', 'Expedition', 'UncutGems', 'LineageSupportGems', 'Verisium']
const currencyGroups = [
  {label: '화폐', ids: ['transmute', 'greater-orb-of-transmutation', 'perfect-orb-of-transmutation', 'aug', 'greater-orb-of-augmentation', 'perfect-orb-of-augmentation', 'regal', 'greater-regal-orb', 'perfect-regal-orb', 'exalted', 'greater-exalted-orb', 'perfect-exalted-orb', 'chaos', 'greater-chaos-orb', 'perfect-chaos-orb', 'vaal', 'alch', 'divine', 'chance', 'annul', 'fracturing-orb', 'mirror', 'hinekoras-lock', 'crystallised-corruption']},
  {label: '쥬얼러의 화폐', ids: ['lesser-jewellers-orb', 'greater-jewellers-orb', 'perfect-jewellers-orb']},
  {label: '화폐 파편', ids: ['chance-shard', 'artificers-shard']},
  {label: '퀄리티 화폐', ids: ['whetstone', 'scrap', 'gcp', 'bauble']},
]
const intervals = ['1m', '5m', '1h', '1d'] as const
const rewardContents = [
  {id: 'ritual', name: '의식', hint: '징조 · 우상', categories: ['Ritual', 'Idols']},
  {id: 'breach', name: '균열', hint: '촉매와 균열 보상', categories: ['Breach']},
  {id: 'delirium', name: '환영', hint: '액상 감정', categories: ['Delirium']},
  {id: 'abyss', name: '심연', hint: '심연 전용 보상', categories: ['Abyss']},
  {id: 'expedition', name: '탐험', hint: '탐험 화폐와 보상', categories: ['Expedition']},
  {id: 'runes', name: '룬·베리시움', hint: '룬과 베리시움 보상', categories: ['Runes', 'Verisium']},
  {id: 'soulcores', name: '영혼핵', hint: '영혼핵 보상', categories: ['SoulCores']},
  {id: 'fragments', name: '보스·열쇠', hint: '조각과 성유물 열쇠', categories: ['Fragments']},
  {id: 'lineage', name: '혈통 보조젬', hint: '고가 특수 보조젬', categories: ['LineageSupportGems']},
] as const
type RewardContentId = typeof rewardContents[number]['id']
type Interval = typeof intervals[number]
const labels: Record<Interval, string> = {'1m': '1분', '5m': '5분', '1h': '1시간', '1d': '1일'}
const initialFavorites = (): string[] => {
  try { return JSON.parse(localStorage.getItem('poe2-favorites') || '[]') } catch { return [] }
}
const initialRecent = (): string[] => {
  try { return JSON.parse(localStorage.getItem('poe2-recent-markets') || '[]') } catch { return [] }
}
const nfmt = (n: number, max = 2) => new Intl.NumberFormat('ko-KR', {maximumFractionDigits: max}).format(n)
const price = (n: number) => n > 0 && n < .001 ? '<0.001' : nfmt(n, 3)
const compactPrice = (n: number) => n >= 100 ? nfmt(n, 1) : n >= 1 ? nfmt(n, 3) : n > 0 && n < .001 ? '<0.001' : nfmt(n, 3)
function MainChartPrice({value}: {value: string}) {
  if (value.startsWith('<') || value === '—') return <span className="main-price-whole">{value}</span>
  const numeric = Number(value.replaceAll(',', ''))
  if (!Number.isFinite(numeric)) return <span className="main-price-whole">{value}</span>
  const digits = numeric >= 100 ? 1 : numeric >= 10 ? 2 : 3
  const formatted = numeric.toLocaleString('ko-KR', {minimumFractionDigits: digits, maximumFractionDigits: digits})
  const decimalAt = formatted.indexOf('.')
  if (decimalAt < 0) return <span className="main-price-whole">{formatted}</span>
  return <><span className="main-price-whole">{formatted.slice(0, decimalAt)}</span><span className="main-price-fraction">{formatted.slice(decimalAt)}</span></>
}
function ExchangeCardPrice({value}: {value: string}) {
  const numeric = Number(value.replaceAll(',', ''))
  if (value.startsWith('<') || value === '—' || (Number.isFinite(numeric) && numeric < 1)) {
    return <span className="main-price-whole">{value}</span>
  }
  return <MainChartPrice value={value}/>
}
const clock = (seconds: number) => new Date(seconds * 1000).toLocaleString('ko-KR', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
const timeAgo = (seconds: number) => {
  const minutes = Math.max(0, Math.floor((Date.now() / 1000 - seconds) / 60))
  return minutes < 1 ? '방금' : minutes < 60 ? `${minutes}분 전` : `${Math.floor(minutes / 60)}시간 전`
}
const changeClass = (n: number | null) => n == null ? '' : n > 0 ? 'up' : n < 0 ? 'down' : ''
const changeText = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${nfmt(n, 2)}%`
const cleanSummary = (value: string | undefined) => (value || '').replace(/^#{1,6}\s*/gm, '').replace(/\*\*/g, '').replace(/`/g, '').trim()
const chartTimeLabel = (value: unknown, interval: Interval) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const date = new Date(value * 1000)
  if (interval === '1d') return date.toLocaleDateString('ko-KR', {month:'2-digit', day:'2-digit'})
  if (interval === '1h') {
    date.setMinutes(0, 0, 0)
    return date.toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit', hour12:false})
  }
  if (interval === '5m') {
    date.setMinutes(Math.floor(date.getMinutes() / 5) * 5, 0, 0)
  } else {
    date.setSeconds(0, 0)
  }
  return date.toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit', hour12:false})
}

function PriceChart({candles, loading, interval, seriesKey}: {candles: Candle[]; loading: boolean; interval: Interval; seriesKey: string}) {
  const box = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lineSeries = useRef<ISeriesApi<'Line'> | null>(null)
  const fitted = useRef(false)
  const [hovered, setHovered] = useState<Candle | null>(null)
  useEffect(() => {
    if (!box.current) return
    const api = createChart(box.current, {
      width: box.current.clientWidth, height: 390,
      layout: {background: {type: ColorType.Solid, color: '#ffffff'}, textColor: '#526980', fontFamily: 'Pretendard Variable, Pretendard, system-ui, sans-serif', fontSize: 12},
      grid: {vertLines: {color: '#f2f5f9'}, horzLines: {color: '#edf1f6'}},
      crosshair: {vertLine: {color: '#9aabc2', labelBackgroundColor: '#3767ba'}, horzLine: {color: '#9aabc2', labelBackgroundColor: '#3767ba'}},
      rightPriceScale: {borderColor: '#e7ecf2', scaleMargins: {top: .12, bottom: .12}},
      timeScale: {borderColor: '#e7ecf2', timeVisible: true, secondsVisible: false, rightOffset: 9, barSpacing: 14, tickMarkFormatter: (time: unknown) => chartTimeLabel(time, interval)},
      localization: {locale: 'ko-KR', timeFormatter: (time: unknown) => chartTimeLabel(time, interval)},
    })
    const series = api.addSeries(CandlestickSeries, {
      upColor: '#d63651', downColor: '#2868c7', borderUpColor: '#d63651', borderDownColor: '#2868c7',
      wickUpColor: '#d63651', wickDownColor: '#2868c7', visible: false,
    })
    const closeLine = api.addSeries(LineSeries, {color: '#3575ca', lineWidth: 2, priceLineVisible: true, crosshairMarkerVisible: true})
    const resize = new ResizeObserver(() => api.applyOptions({width: box.current?.clientWidth || 600}))
    resize.observe(box.current)
    chart.current = api
    candleSeries.current = series
    lineSeries.current = closeLine
    return () => { resize.disconnect(); api.remove(); chart.current = null; candleSeries.current = null; lineSeries.current = null }
  }, [])
  useEffect(() => {
    chart.current?.applyOptions({
      timeScale: {tickMarkFormatter: (time: unknown) => chartTimeLabel(time, interval)},
      localization: {locale: 'ko-KR', timeFormatter: (time: unknown) => chartTimeLabel(time, interval)},
    })
  }, [interval])
  useEffect(() => { fitted.current = false }, [seriesKey])
  useEffect(() => {
    const api = chart.current
    const series = candleSeries.current
    const closeLine = lineSeries.current
    if (!api || !series || !closeLine) return
    const values = candles.flatMap(c => [c.low, c.high])
    const minimum = values.length ? Math.min(...values) : 0
    const maximum = values.length ? Math.max(...values) : 1
    const padding = Math.max((maximum - minimum) * .15, Math.abs(maximum) * .015, .000001)
    const precision = 3
    const priceFormat = {type: 'price' as const, precision, minMove: 10 ** -precision}
    const autoscaleInfoProvider = () => ({priceRange: {minValue: Math.max(0, minimum - padding), maxValue: maximum + padding}})
    series.applyOptions({priceFormat, autoscaleInfoProvider, visible: interval !== '1m'})
    closeLine.applyOptions({priceFormat, autoscaleInfoProvider, visible: interval === '1m'})
    const nearLatest = api.timeScale().scrollPosition() < 2
    series.setData(candles.map(c => ({time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close})))
    const lineData: ({time: UTCTimestamp; value: number} | {time: UTCTimestamp})[] = []
    candles.forEach((c, index) => {
      if (index > 0 && c.time - candles[index - 1].time > 60) lineData.push({time: (candles[index - 1].time + 60) as UTCTimestamp})
      lineData.push({time: c.time as UTCTimestamp, value: c.close})
    })
    closeLine.setData(lineData)
    if (candles.length && !fitted.current) { api.timeScale().fitContent(); fitted.current = true }
    else if (candles.length && nearLatest) api.timeScale().scrollToRealTime()
    setHovered(candles.at(-1) || null)
    const onCrosshairMove = (param: {time?: unknown}) => {
      if (typeof param.time !== 'number') {setHovered(candles.at(-1) || null); return}
      setHovered(candles.find(c => c.time === param.time) || null)
    }
    api.subscribeCrosshairMove(onCrosshairMove)
    return () => api.unsubscribeCrosshairMove(onCrosshairMove)
  }, [candles, interval])
  return <div className="chart-wrap"><div ref={box} />{hovered && <div className="chart-legend"><span>{clock(hovered.time)}</span>{interval === '1m' ? <strong>{price(hovered.close)} · 관측 {hovered.samples}회</strong> : <strong>시 {price(hovered.open)}　고 {price(hovered.high)}　저 {price(hovered.low)}　종 {price(hovered.close)} <small>· 관측 {hovered.samples}회</small></strong>}</div>}{candles.length < 2 && <div className="chart-empty"><Activity size={25}/><strong>{loading ? '차트 조회 중' : '관측 데이터를 모으는 중'}</strong><span>{loading ? '선택한 아이템의 가격 기록을 불러오고 있습니다.' : '서버 실행 후 1분마다 가격 스냅샷이 쌓입니다.'}</span>{!loading && <span>원천 시세는 대략 1시간마다 갱신됩니다.</span>}</div>}</div>
}

function MarketIcon({market, size = 'normal', eager = false}: {market: Market; size?: 'normal' | 'large'; eager?: boolean}) {
  const [failed, setFailed] = useState(false)
  const iconUrl = `/api/market-icon/${market.id.split('/').map(encodeURIComponent).join('/')}?league=${encodeURIComponent(market.league)}`
  useEffect(() => setFailed(false), [iconUrl])
  const showImage = !failed
  return <span className={`market-icon ${size} ${showImage ? 'has-image' : 'fallback'}`}>
    {showImage
      ? <img src={iconUrl} alt="" loading={size === 'large' || eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} />
      : <Coins size={size === 'large' ? 24 : 18} aria-hidden="true"/>}
  </span>
}

function MarketLiquidityWarning({market}: {market: Market}) {
  const assessment = assessMarketLiquidity(market)
  if (assessment.quality !== 'low') return null
  const lowListings = assessment.metric === 'listing_count'
  const detail = assessment.detail + ' · 표시 가격의 오차가 클 수 있습니다.'
  return <span className="liquidity-warning" tabIndex={0} aria-label={detail}>
    <TriangleAlert size={14} fill="currentColor"/>
    <span className="liquidity-tooltip" role="tooltip"><strong>{lowListings ? '매물 수 주의' : '거래량 주의'}</strong><span>{detail}</span></span>
  </span>
}

function ScoutReference({data}: {data: Scout}) {
  const ordered = [...data.logs].reverse()
  const values = ordered.map(item => item.price_exalted)
  const low = Math.min(...values), high = Math.max(...values)
  const span = high - low || 1
  const points = values.map((value, index) => `${10 + index * 180 / Math.max(1, values.length - 1)},${48 - (value - low) / span * 38}`).join(' ')
  return <div className="scout-reference"><div><span>POE2SCOUT 참고 가격</span><strong>{price(data.current_price_exalted)} <em>엑잘</em></strong><small>기존 가격 이력 · 최근 샘플 {data.logs[0] ? new Date(data.logs[0].time).toLocaleString('ko-KR') : '—'}</small></div><svg viewBox="0 0 200 60" role="img" aria-label="POE2Scout 기존 가격 추이"><path d="M 0 55 H 200" stroke="#e7edf5" strokeWidth="1"/><polyline points={points} fill="none" stroke="#4182d9" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
}

export default function App() {
  const [leagues, setLeagues] = useState<League[]>([])
  const [league, setLeague] = useState('')
  const [data, setData] = useState<State | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [interval, setInterval] = useState<Interval>('1m')
  const [candles, setCandles] = useState<Candle[]>([])
  const [candlesKey, setCandlesKey] = useState('')
  const [chartLoading, setChartLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [exchangeCategory, setExchangeCategory] = useState('Currency')
  const [exchangeQuery, setExchangeQuery] = useState('')
  const [exchangeSort, setExchangeSort] = useState<'game' | 'price'>('game')
  const [exchangeUnit, setExchangeUnit] = useState<'exalted' | 'divine'>('exalted')
  const [exchangeOpen, setExchangeOpen] = useState(false)
  const [rewardsOpen, setRewardsOpen] = useState(false)
  const [rewardContent, setRewardContent] = useState<RewardContentId>('ritual')
  const [rewardSort, setRewardSort] = useState<'game' | 'price'>('game')
  const [rewardUnit, setRewardUnit] = useState<'exalted' | 'divine'>('exalted')
  const [rewardCategory, setRewardCategory] = useState('all')
  const [rewardCategoryOpen, setRewardCategoryOpen] = useState(false)
  const [rewardQuery, setRewardQuery] = useState('')
  const [marketScope, setMarketScope] = useState<MarketScope>('all')
  const [marketSort, setMarketSort] = useState<MarketSort>('price')
  const [sortDescending, setSortDescending] = useState(true)
  const [marketLimit, setMarketLimit] = useState(160)
  const [historyDays, setHistoryDays] = useState<28 | 56 | 84>(56)
  const [seasonalityData, setSeasonalityData] = useState<Seasonality | null>(null)
  const [seasonalityLoading, setSeasonalityLoading] = useState(false)
  const [marketSummary, setMarketSummary] = useState<MarketSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [heatMetric, setHeatMetric] = useState<'price' | 'volume'>('price')
  const [favorites, setFavorites] = useState<string[]>(initialFavorites)
  const [recentIds, setRecentIds] = useState<string[]>(initialRecent)
  const [unit, setUnit] = useState<'divine'|'exalted'>('exalted')
  const [marketListUnit, setMarketListUnit] = useState<'divine'|'exalted'>('exalted')
  const [scout, setScout] = useState<Scout | null>(null)
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null)
  const [chartKind, setChartKind] = useState<'observed_snapshots' | 'live_listings'>('observed_snapshots')
  const [, setSelectedSourceStatus] = useState<SourceStatus | null>(null)
  const [updated, setUpdated] = useState(0)
  const exchangeSearchRef = useRef<HTMLInputElement>(null)
  const [refreshing, setRefreshing] = useState(false)
  const exaltedReference = selectedId === 'exchange:Currency:exalted'
  const divineReference = selectedId === 'exchange:Currency:divine'
  const chaosReference = exaltedReference || divineReference
  const chartUnit = exaltedReference ? (unit === 'divine' ? 'divine' : 'chaos') : divineReference && unit === 'divine' ? 'chaos' : unit
  const chartKey = `${selectedId}:${league}:${interval}:${chartUnit}`

  useEffect(() => { localStorage.setItem('poe2-favorites', JSON.stringify(favorites)) }, [favorites])
  useEffect(() => { localStorage.setItem('poe2-recent-markets', JSON.stringify(recentIds)) }, [recentIds])
  useEffect(() => {
    if (!selectedId) return
    setRecentIds(items => [selectedId, ...items.filter(id => id !== selectedId)].slice(0, 12))
  }, [selectedId])
  useEffect(() => {
    if (!exchangeOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExchangeOpen(false) }
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        exchangeSearchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('keydown', focusSearch)
    window.setTimeout(() => exchangeSearchRef.current?.focus(), 0)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('keydown', focusSearch)
      document.body.style.overflow = previousOverflow
    }
  }, [exchangeOpen])
  useEffect(() => {
    fetch('/api/leagues').then(r => {if (!r.ok) throw Error('리그 목록을 불러오지 못했습니다.'); return r.json()})
      .then((items: League[]) => {setLeagues(items); setLeague(items[0]?.id || '')})
      .catch(e => {setError(e.message); setLoading(false)})
  }, [])
  const fetchMarkets = useCallback(async (showLoading = false) => {
    if (!league) return
    if (showLoading) setLoading(true)
    try {
      const response = await fetch(`/api/markets?league=${encodeURIComponent(league)}`)
      if (!response.ok) throw Error('시세를 불러오지 못했습니다. Python 서버 상태를 확인하세요.')
      const next: State = await response.json()
      setData(next); setUpdated(Date.now()); setError('')
      setSelectedId(current => next.markets.some(m => m.id === current) ? current : next.markets.find(m => m.id === 'exchange:Currency:divine')?.id || next.markets.find(m => m.id === 'exchange:Currency:exalted')?.id || next.markets[0]?.id || '')
    } catch (e) { setError(e instanceof Error ? e.message : '시세 오류') }
    finally {setLoading(false)}
  }, [league])
  useEffect(() => {
    void fetchMarkets(true)
    const seconds = data?.upstream_poll_seconds || 900
    const timer = window.setInterval(() => void fetchMarkets(), seconds * 1000)
    return () => clearInterval(timer)
  }, [fetchMarkets, data?.upstream_poll_seconds])
  useEffect(() => {
    if (!selectedId || !league) return
    setSelectedSourceStatus(null)
    let active = true
    const load = async () => {
      setChartLoading(true)
      try {
        const response = await fetch(`/api/candles/${encodeURIComponent(selectedId)}?league=${encodeURIComponent(league)}&interval=${interval}&unit=${chartUnit}&limit=500`)
        if (!response.ok) throw Error('차트 데이터 오류')
        const result = await response.json()
        if (active) {
          setCandles(result.candles)
          setCandlesKey(chartKey)
          setChartKind(result.kind === 'live_listings' ? 'live_listings' : 'observed_snapshots')
          setLiveQuote(result.live_quote || null)
          setSelectedSourceStatus(result.source_status || null)
          if (result.market) {
            setData(current => current ? {
              ...current,
              exalted_per_divine: result.exalted_per_divine ?? current.exalted_per_divine,
              markets: current.markets.map(m => m.id === result.market.id ? result.market : m),
            } : current)
          }
        }
      } catch {if (active) { setCandles([]); setCandlesKey(chartKey); setChartKind('observed_snapshots'); setLiveQuote(null) }}
      finally {if (active) setChartLoading(false)}
    }
    void load(); const timer = window.setInterval(load, (data?.selected_poll_seconds || 60) * 1000)
    return () => {active = false; clearInterval(timer)}
  }, [selectedId, league, interval, chartUnit, chartKey, data?.selected_poll_seconds])
  useEffect(() => {
    setScout(null)
    if (!selectedId.startsWith('exchange:') || !league) return
    let active = true
    const load = () => {
      fetch(`/api/scout/${encodeURIComponent(selectedId)}?league=${encodeURIComponent(league)}`)
        .then(r => {if (!r.ok) throw Error('No scout history'); return r.json()})
        .then((result: Scout) => {if (active) setScout(result)})
        .catch(() => {})
    }
    load()
    const timer = window.setInterval(load, (data?.scout_poll_seconds || 60) * 1000)
    return () => {active = false; clearInterval(timer)}
  }, [selectedId, league, data?.scout_poll_seconds])

  useEffect(() => {
    setLiveQuote(null)
    if (!league || !selectedId.startsWith('exchange:Currency:') || data?.trade2_live_enabled !== true) return
    let active = true
    const load = async () => {
      try {
        const response = await fetch(`/api/live/${encodeURIComponent(selectedId)}?league=${encodeURIComponent(league)}`)
        if (!response.ok) { if (active) setLiveQuote(null); return }
        const result: LiveQuote = await response.json()
        if (active) setLiveQuote(result)
      } catch { if (active) setLiveQuote(null) }
    }
    void load()
    const timer = window.setInterval(load, (data?.trade2_live_seconds || 30) * 1000)
    return () => { active = false; clearInterval(timer) }
  }, [selectedId, league, data?.trade2_live_enabled, data?.trade2_live_seconds])

  useEffect(() => {
    if (!league || !selectedId) { setSeasonalityData(null); return }
    let active = true
    setSeasonalityLoading(true)
    fetch(`/api/seasonality/${encodeURIComponent(selectedId)}?league=${encodeURIComponent(league)}&days=${historyDays}&unit=${chartUnit}`)
      .then(response => { if (!response.ok) throw Error('분석 데이터를 불러오지 못했습니다.'); return response.json() })
      .then((result: Seasonality) => { if (active) setSeasonalityData(result) })
      .catch(() => { if (active) setSeasonalityData(null) })
      .finally(() => { if (active) setSeasonalityLoading(false) })
    return () => { active = false }
  }, [selectedId, league, historyDays, chartUnit, updated])

  useEffect(() => {
    if (!league || !selectedId) { setMarketSummary(null); return }
    let active = true
    setSummaryLoading(true)
    fetch(`/api/market-summary/${encodeURIComponent(selectedId)}?league=${encodeURIComponent(league)}&days=${historyDays}&unit=${chartUnit}`)
      .then(response => { if (!response.ok) throw Error("요약 오류"); return response.json() })
      .then((result: MarketSummary) => { if (active) setMarketSummary(result) })
      .catch(() => { if (active) setMarketSummary(null) })
      .finally(() => { if (active) setSummaryLoading(false) })
    return () => { active = false }
  }, [selectedId, league, historyDays, chartUnit, updated])

  const forceRefreshSelected = useCallback(async () => {
    if (!league || !selectedId || refreshing) return
    setRefreshing(true)
    try {
      const params = new URLSearchParams({ league, market_id: selectedId, scope: 'selected' })
      const response = await fetch(`/api/refresh?${params}`, { method: 'POST' })
      if (!response.ok) throw Error('강제 갱신에 실패했습니다.')
      await fetchMarkets()
      if (selectedId.startsWith('exchange:')) {
        const scoutResponse = await fetch(`/api/scout/${encodeURIComponent(selectedId)}?league=${encodeURIComponent(league)}`)
        setScout(scoutResponse.ok ? await scoutResponse.json() : null)
      }
      const candleResponse = await fetch(`/api/candles/${encodeURIComponent(selectedId)}?league=${encodeURIComponent(league)}&interval=${interval}&unit=${chartUnit}&limit=500`)
      if (candleResponse.ok) {
        const result = await candleResponse.json()
        setCandles(result.candles || [])
        setCandlesKey(chartKey)
        setChartKind(result.kind === 'live_listings' ? 'live_listings' : 'observed_snapshots')
        setLiveQuote(result.live_quote || null)
        setSelectedSourceStatus(result.source_status || null)
        if (result.market) {
          setData(current => current ? {
            ...current,
            exalted_per_divine: result.exalted_per_divine ?? current.exalted_per_divine,
            markets: current.markets.map(m => m.id === result.market.id ? result.market : m),
          } : current)
        }
      }
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '강제 갱신 오류')
    } finally {
      setRefreshing(false)
    }
  }, [league, selectedId, refreshing, fetchMarkets, interval, chartUnit, chartKey])

  const selected = data?.markets.find(m => m.id === selectedId)
  const marketMap = useMemo(() => new Map(data?.markets.map(m => [m.id, m]) || []), [data])
  const watchlist = favorites.map(id => marketMap.get(id)).filter((m): m is Market => !!m)
  const marketInScope = (market: Market) => marketScope === 'all' || (marketScope === 'favorites' ? favorites.includes(market.id) : recentIds.includes(market.id))
  const filtered = useMemo(() => (data?.markets || []).filter(m =>
    (category === 'all' || m.category === category) && marketInScope(m) &&
    (!query.trim() || `${m.name} ${m.base_type || ''} ${m.category_label}`.toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR')))
  ), [data, category, marketScope, favorites, recentIds, query])
  const sortedMarkets = useMemo(() => {
    if (marketScope === 'recent') return [...filtered].sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id))
    return [...filtered].sort((a, b) => {
    if (marketSort === 'name') return a.name.localeCompare(b.name, 'ko-KR') * (sortDescending ? -1 : 1)
    const aValue = marketSort === 'price' ? a.price_divine : a.trend_percent
    const bValue = marketSort === 'price' ? b.price_divine : b.trend_percent
    if (aValue == null) return bValue == null ? a.name.localeCompare(b.name, 'ko-KR') : 1
    if (bValue == null) return -1
    return (aValue - bValue) * (sortDescending ? -1 : 1) || a.name.localeCompare(b.name, 'ko-KR')
    })
  }, [filtered, marketSort, sortDescending, marketScope, recentIds])
  const visibleMarkets = sortedMarkets.slice(0, marketLimit)
  useEffect(() => { setMarketLimit(160) }, [query, category, marketScope, marketSort, sortDescending])
  const changeSort = (next: MarketSort) => {
    if (marketSort === next) setSortDescending(value => !value)
    else { setMarketSort(next); setSortDescending(next !== 'name') }
  }
  const displayPrice = (value: number) => price(unit === 'exalted' ? value * (data?.exalted_per_divine || 0) : value)
  const unitLabel = unit === 'divine' ? '신성' : '엑잘'
  const chaosMarket = data?.markets.find(m => m.id === 'exchange:Currency:chaos')
  const exaltedMarket = data?.markets.find(m => m.id === 'exchange:Currency:exalted')
  const marketRowPrice = (market: Market) => compactPrice(marketListUnit === 'exalted' ? market.price_divine * (data?.exalted_per_divine || 0) : market.price_divine)
  const selectedCategoryLabel = category === 'all' ? '전체 분류' : data?.categories[category] || category
  const summaryExalted = (market: Market) => exaltedMarket?.price_divine ? price(market.price_divine / exaltedMarket.price_divine) : '—'
  const summaryChaos = (market: Market) => chaosMarket?.price_divine ? price(market.price_divine / chaosMarket.price_divine) : '—'
  const currencyPairText = (market: Market) => {
    if (market.id === 'exchange:Currency:exalted') return `카오스 ${summaryChaos(market)} · 신성 ${price(market.price_divine)}`
    if (market.id === 'exchange:Currency:chaos') return `엑잘 ${summaryExalted(market)} · 신성 ${price(market.price_divine)}`
    return `엑잘 ${summaryExalted(market)} · 카오스 ${summaryChaos(market)}`
  }
  const showChaosPrice = selected && ((exaltedReference && unit === 'exalted') || (divineReference && unit === 'divine'))
  const selectedPriceText = showChaosPrice ? (chaosMarket?.price_divine ? price(selected!.price_divine / chaosMarket.price_divine) : '—') : selected ? (liveQuote
    ? price(unit === 'exalted' ? liveQuote.price_exalted : (liveQuote.price_divine ?? selected.price_divine))
    : displayPrice(selected.price_divine)) : '—'
  const toggleFavorite = (id: string) => setFavorites(items => items.includes(id) ? items.filter(x => x !== id) : [...items, id])
  const lastFetched = Math.max(0, ...(data?.source_status.map(s => s.fetched_at) || []))
  const sourceErrors = data?.source_status.filter(s => s.error) || []
  const nextRefreshValues = data?.source_status.filter(s => Number.isFinite(s.next_refresh_at) && s.next_refresh_at > 0).map(s => s.next_refresh_at) || []
  const nextMarketRefresh = nextRefreshValues.length ? Math.min(...nextRefreshValues) : 0
  const selectedCadence = Math.max(1, Math.round((data?.selected_poll_seconds || 60) / 60))
  const marketCadence = Math.max(1, Math.round((data?.upstream_poll_seconds || 900) / 60))
  const currencyMarkets = data?.markets.filter(m => ['exchange:Currency:divine', 'exchange:Currency:exalted', 'exchange:Currency:chaos'].includes(m.id)) || []
  const exchangeQuote = (market: Market) => {
    if (exchangeUnit === 'divine') return {value: price(market.price_divine), unit: '신성'}
    return {value: exaltedMarket?.price_divine ? price(market.price_divine / exaltedMarket.price_divine) : '—', unit: '엑잘'}
  }
  const exchangeMarkets = (data?.markets || []).filter(m =>
    exchangeCategories.includes(m.category) &&
    (exchangeCategory === 'all' || m.category === exchangeCategory) &&
    (!exchangeQuery.trim() || `${m.name} ${m.base_type || ''}`.toLocaleLowerCase('ko-KR').includes(exchangeQuery.trim().toLocaleLowerCase('ko-KR')))
  )
  const exchangePrice = (market: Market) => exchangeUnit === 'divine' ? market.price_divine : exaltedMarket?.price_divine ? market.price_divine / exaltedMarket.price_divine : market.price_divine
  const sortExchangeMarkets = (markets: Market[]) => exchangeSort === 'price' ? [...markets].sort((a, b) => exchangePrice(b) - exchangePrice(a)) : markets
  const groupedExchangeMarkets = exchangeSort === 'game' && exchangeCategory === 'Currency' && !exchangeQuery.trim() ? [
    ...currencyGroups.map(group => ({label: group.label, markets: group.ids.map(id => exchangeMarkets.find(m => m.id === `exchange:Currency:${id}`)).filter((m): m is Market => !!m)})),
    {label: '기타 화폐', markets: exchangeMarkets.filter(m => !currencyGroups.some(group => group.ids.includes(m.id.replace('exchange:Currency:', ''))))},
  ].filter(group => group.markets.length) : exchangeCategory === 'all'
    ? exchangeCategories.map(key => ({label: data?.categories[key] || key, markets: sortExchangeMarkets(exchangeMarkets.filter(m => m.category === key))})).filter(group => group.markets.length)
    : [{label: exchangeSort === 'price' ? `${data?.categories[exchangeCategory] || exchangeCategory} · 비싼 순` : data?.categories[exchangeCategory] || exchangeCategory, markets: sortExchangeMarkets(exchangeMarkets)}]
  const heatCells = new Map(seasonalityData?.cells.map(cell => [`${cell.weekday}:${cell.hour}`, cell]) || [])
  const activeRewardContent = rewardContents.find(item => item.id === rewardContent) || rewardContents[0]
  const rewardCategoryOptions = activeRewardContent.categories.map(key => ({key, label: data?.categories[key] || key}))
  const rewardCategoryLabel = rewardCategory === 'all' ? '전체 분류' : rewardCategoryOptions.find(item => item.key === rewardCategory)?.label || '전체 분류'
  const rewardCategoryOrder = [...activeRewardContent.categories] as string[]
  const rewardMarkets = (data?.markets || []).filter(m => activeRewardContent.categories.some(categoryKey => categoryKey === m.category) && (rewardCategory === 'all' || m.category === rewardCategory) && (!rewardQuery.trim() || `${m.name} ${m.base_type || ''} ${m.category_label}`.toLocaleLowerCase('ko-KR').includes(rewardQuery.trim().toLocaleLowerCase('ko-KR')))).sort((a, b) => rewardSort === 'price' ? b.price_divine - a.price_divine : rewardCategoryOrder.indexOf(a.category) - rewardCategoryOrder.indexOf(b.category) || (a.display_order ?? 999999) - (b.display_order ?? 999999) || a.name.localeCompare(b.name, 'ko-KR'))
  const rewardPrice = (market: Market) => rewardUnit === 'divine' ? market.price_divine : market.price_divine * (data?.exalted_per_divine || 0)
  const rewardUnitLabel = rewardUnit === 'divine' ? '신성' : '엑잘'
  const heatScale = Math.max(0.5, ...((seasonalityData?.cells || []).map(cell => Math.abs(cell.relative_percent))))
  const volumeCells = new Map(seasonalityData?.official_volume.cells.map(cell => [`${cell.weekday}:${cell.hour}`, cell]) || [])
  const volumeScale = Math.max(1, ...((seasonalityData?.official_volume.cells || []).map(cell => cell.median_volume_item)))
  const showVolume = heatMetric === 'volume' && !!seasonalityData?.official_volume.supported
  const pricePatternReady = (seasonalityData?.observed_days || 0) >= 3 && heatCells.size > 0
  const hasHeatmapData = showVolume ? volumeCells.size > 0 : pricePatternReady
  const analysisProgress = Math.min(100, ((seasonalityData?.observed_days || 0) / 21) * 100)

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><TrendingUp size={22} strokeWidth={2.8}/></div><div><strong>POE2 <span>시세</span></strong></div></div>
      <div className="side-section-label">메뉴</div>
      <button aria-current={marketScope === 'all' ? 'page' : undefined} className={`side-link ${marketScope === 'all' ? 'active' : ''}`} onClick={() => {setMarketScope('all'); setCategory('all')}}><LayoutDashboard size={18}/>시세 대시보드</button>
      <button aria-current={marketScope === 'favorites' ? 'page' : undefined} className={`side-link ${marketScope === 'favorites' ? 'active' : ''}`} onClick={() => {setMarketScope('favorites'); setCategory('all')}}><Star size={18}/>관심 목록 <span className="side-count">{watchlist.length}</span></button>
      <div className="side-quick"><span>빠른 분류</span><div>{Object.entries(data?.categories || {}).slice(0, 8).map(([key, label]) => <button key={key} className={category === key ? 'active' : ''} onClick={() => {setCategory(key); setMarketScope('all')}}>{label}</button>)}</div></div>
      <div className="sidebar-bottom"><div className="source-badge"><ShieldCheck size={16}/>시세 출처</div><p>poe.ninja 기준 시세{data?.trade2_live_enabled ? ' · 주요 통화 Trade2 매물 호가' : ''}</p></div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb"><b>시세 대시보드</b></div><div className="top-actions"><button className="reward-launch" onClick={() => setRewardsOpen(true)}><Gift size={16}/>콘텐츠 보상</button><button className="exchange-launch" onClick={() => setExchangeOpen(true)}><Coins size={16}/>거래소 시세표</button><span className="live-pill" aria-live="polite"><i/> {lastFetched ? `${timeAgo(lastFetched)} 갱신` : '데이터 연결'}</span><button className={`icon-button ${refreshing ? 'spinning' : ''}`} title="선택 아이템 강제 갱신 · 캐시 무시" disabled={!selectedId || refreshing} onClick={() => void forceRefreshSelected()}><RefreshCw size={17}/></button><div className="avatar">P2</div></div></header>
      <div className="content">
        <div className="page-heading"><div><h1>시세 대시보드</h1><p>아이템을 찾고, 가격 흐름과 저렴했던 시간을 한 화면에서 확인하세요.</p></div><label className="league-select"><span>거래 리그</span><select value={league} onChange={e => {setLeague(e.target.value); setData(null); setSelectedId('')}}>{leagues.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select><ChevronDown size={15}/></label></div>
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => void fetchMarkets(true)}>다시 시도</button></div>}
        <div className="market-ticker" aria-label="주요 통화 환율">
          {currencyMarkets.map(m => <button key={m.id} className={m.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(m.id)}><MarketIcon market={m}/><span><strong>{m.name}</strong><small>{currencyPairText(m)}</small></span><em className={changeClass(m.trend_percent)}>{changeText(m.trend_percent)}</em></button>)}
        </div>
        <div className="main-grid">
          <section className="panel chart-panel"><div className="panel-head chart-head"><div className="selected-title">{selected ? <MarketIcon market={selected} size="large"/> : <span className="market-icon large"><Coins/></span>}<div><div className="selected-sub">{selected?.category_label || 'MARKET'} {selected?.base_type ? `· ${selected.base_type}` : ''}</div><h2 className="selected-name-line"><span>{selected?.name || (loading ? '시세를 불러오는 중...' : '아이템을 선택하세요')}</span>{selected && <MarketLiquidityWarning market={selected}/>}</h2></div></div><button className={`favorite-button ${selected && favorites.includes(selected.id) ? 'saved' : ''}`} title="관심 목록" disabled={!selected} onClick={() => selected && toggleFavorite(selected.id)}><Star size={19} fill={selected && favorites.includes(selected.id) ? 'currentColor' : 'none'}/></button></div>
            <div className="price-line"><strong><MainChartPrice value={selectedPriceText}/> <em>{exaltedReference ? (unit === 'divine' ? '신성 / 1 엑잘' : '카오스 / 1 엑잘') : divineReference ? (unit === 'divine' ? '카오스 / 1 신성' : '엑잘 / 1 신성') : unitLabel}</em></strong> <small>최근 7일간</small> <span className={`price-change ${changeClass(selected?.trend_percent ?? null)}`}>{changeText(selected?.trend_percent ?? null)} </span></div>
            {liveQuote && !chaosReference && <div className="live-source">Trade2 매물 호가 · 중앙값 {price(liveQuote.price_exalted)} 엑잘{liveQuote.count != null ? ` · ${liveQuote.count}개 매물` : ''} · {timeAgo(liveQuote.observed_at)}</div>}<div className="chart-toolbar"><div className="intervals">{intervals.map(item => <button key={item} className={interval === item ? 'active' : ''} onClick={() => setInterval(item)}>{labels[item]}</button>)}</div><div className="units">{exaltedReference ? <><button className={unit === 'exalted' ? 'active' : ''} onClick={() => setUnit('exalted')}>카오스</button><button className={unit === 'divine' ? 'active' : ''} onClick={() => setUnit('divine')}>신성</button></> : divineReference ? <><button className={unit === 'exalted' ? 'active' : ''} onClick={() => setUnit('exalted')}>엑잘</button><button className={unit === 'divine' ? 'active' : ''} onClick={() => setUnit('divine')}>카오스</button></> : <><button className={unit === 'exalted' ? 'active' : ''} onClick={() => setUnit('exalted')}>엑잘</button><button className={unit === 'divine' ? 'active' : ''} onClick={() => setUnit('divine')}>신성</button></>}</div></div>
            <PriceChart candles={candlesKey === chartKey ? candles : []} loading={chartLoading || candlesKey !== chartKey} interval={interval} seriesKey={chartKey}/>
            <div className="chart-caption"><span><span className="caption-dot"/> {interval === '1m' ? '1분 간격 가격 관측값' : `${labels[interval]} 구간의 관측값 OHLC`}</span><span>{chartKind === 'live_listings' ? `Trade2 매물 호가 관측 · ${Math.round((data?.trade2_live_seconds || 30))}초 확인 · 체결가 아님` : `poe.ninja 시세 관측 · 선택 ${selectedCadence}분 확인 · 체결가 아님`}</span></div>
            {scout && <ScoutReference data={scout}/>}
          </section>
          <section className="panel market-panel" aria-label="아이템 종목 선택">
            <div className="market-panel-title"><div><h2>아이템 종목</h2></div><span>{nfmt(filtered.length)}개</span></div>
            <div className="market-tabs" role="tablist" aria-label="종목 목록">
              <button role="tab" aria-selected={marketScope === 'all'} className={marketScope === 'all' ? 'active' : ''} onClick={() => {setMarketScope('all'); setCategory('all')}}>전체 <span>{nfmt(data?.markets.length || 0)}</span></button>
              <button role="tab" aria-selected={marketScope === 'favorites'} className={marketScope === 'favorites' ? 'active' : ''} onClick={() => {setMarketScope('favorites'); setCategory('all')}}>관심 <span>{nfmt(watchlist.length)}</span></button>
              <button role="tab" aria-selected={marketScope === 'recent'} className={marketScope === 'recent' ? 'active' : ''} onClick={() => {setMarketScope('recent'); setCategory('all')}}>최근 본 <span>{nfmt(recentIds.length)}</span></button>
            </div>
            <div className="market-filters">
              <label className="market-search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="아이템 이름 검색" aria-label="아이템 이름 검색"/>{query && <button type="button" title="검색어 지우기" onClick={() => setQuery('')}><X size={14}/></button>}</label>
              <div className={`market-category-menu ${categoryOpen ? 'open' : ''}`}><button className="market-category-trigger" aria-haspopup="listbox" aria-expanded={categoryOpen} onClick={() => setCategoryOpen(open => !open)}><span>{selectedCategoryLabel}</span><ChevronDown size={15}/></button>{categoryOpen && <div className="market-category-options" role="listbox" aria-label="아이템 분류"><button role="option" aria-selected={category === 'all'} className={category === 'all' ? 'selected' : ''} onClick={() => {setCategory('all'); setCategoryOpen(false)}}>전체 분류</button>{Object.entries(data?.categories || {}).map(([key, label]) => <button key={key} role="option" aria-selected={category === key} className={category === key ? 'selected' : ''} onClick={() => {setCategory(key); setCategoryOpen(false)}}>{label}</button>)}</div>}</div>
              <div className="market-list-units" aria-label="아이템 목록 가격 단위"><button className={marketListUnit === 'exalted' ? 'active' : ''} onClick={() => setMarketListUnit('exalted')}>엑잘</button><button className={marketListUnit === 'divine' ? 'active' : ''} onClick={() => setMarketListUnit('divine')}>신성</button></div>
            </div>
            <div className="market-list-head">
              <span aria-hidden="true"/>
              <button className={marketSort === 'name' ? 'active' : ''} onClick={() => changeSort('name')}>종목명 <span>{marketSort === 'name' ? sortDescending ? '↓' : '↑' : '↕'}</span></button>
              <button className={marketSort === 'price' ? 'active' : ''} onClick={() => changeSort('price')}>현재가 <small>({marketListUnit === 'divine' ? '신성' : '엑잘'})</small> <span>{marketSort === 'price' ? sortDescending ? '↓' : '↑' : '↕'}</span></button>
              <button className={marketSort === 'change' ? 'active' : ''} onClick={() => changeSort('change')}>최근 변동 <span>{marketSort === 'change' ? sortDescending ? '↓' : '↑' : '↕'}</span></button>
            </div>
            <div className="market-list" aria-label="아이템 종목">
              {visibleMarkets.map(m => <div className={`market-row ${m.id === selectedId ? 'selected' : ''}`} key={m.id}>
                <button className={`market-row-star ${favorites.includes(m.id) ? 'saved' : ''}`} title={favorites.includes(m.id) ? '관심 해제' : '관심 등록'} aria-label={`${m.name} ${favorites.includes(m.id) ? '관심 해제' : '관심 등록'}`} onClick={() => toggleFavorite(m.id)}><Star size={15} fill={favorites.includes(m.id) ? 'currentColor' : 'none'}/></button>
                <button aria-current={m.id === selectedId ? 'true' : undefined} className="market-row-select" onClick={() => setSelectedId(m.id)} title={m.name}>
                  <span className="market-row-name"><MarketIcon market={m}/><span><span className="market-name-line"><strong>{m.name}</strong><MarketLiquidityWarning market={m}/></span><small>{m.category_label}{m.base_type ? ` · ${m.base_type}` : ''}</small></span></span>
                  <span className="market-row-price">{marketRowPrice(m)} <small>{marketListUnit === 'divine' ? '신성' : '엑잘'}</small></span>
                  <span className={`market-row-change ${changeClass(m.trend_percent)}`}>{changeText(m.trend_percent)}</span>
                </button>
              </div>)}
              {!sortedMarkets.length && <div className="market-list-empty"><Search size={21}/><strong>{loading ? '시세를 불러오는 중입니다' : marketScope === 'favorites' && !watchlist.length ? '관심 아이템이 없습니다' : marketScope === 'recent' ? '최근 본 아이템이 없습니다' : '검색 결과가 없습니다'}</strong><span>{marketScope === 'favorites' && !watchlist.length ? '종목의 별표를 눌러 추가하세요.' : marketScope === 'recent' ? '아이템을 선택하면 여기에 자동으로 기록됩니다.' : '검색어 또는 분류를 변경해 보세요.'}</span></div>}
              {visibleMarkets.length < sortedMarkets.length && <button className="market-load-more" onClick={() => setMarketLimit(limit => limit + 160)}>더 보기 <span>{nfmt(visibleMarkets.length)} / {nfmt(sortedMarkets.length)}</span></button>}
            </div>
            <div className="market-panel-foot"><span>종목 선택 시 차트가 변경됩니다</span><span>시세 {marketCadence}분 확인</span></div>
          </section>
        </div>
        {rewardsOpen && <aside className="reward-drawer" role="dialog" aria-modal="false" aria-label="콘텐츠별 주요 보상"><div className="reward-head"><div><h2>콘텐츠별 주요 보상</h2><p>게임 중 가치 있는 드롭을 빠르게 확인하세요.</p></div><label className="reward-search"><Search size={17}/><input value={rewardQuery} onChange={event => setRewardQuery(event.target.value)} placeholder="보상 아이템 검색" aria-label="보상 아이템 검색"/>{rewardQuery && <button type="button" onClick={() => setRewardQuery('')} aria-label="보상 검색어 지우기"><X size={15}/></button>}</label><button onClick={() => setRewardsOpen(false)} aria-label="콘텐츠 보상 닫기"><X size={20}/></button></div><div className="reward-tabs exchange-nav">{rewardContents.map(content => <button key={content.id} className={rewardContent === content.id ? 'active' : ''} onClick={() => {setRewardContent(content.id); setRewardCategory('all'); setRewardCategoryOpen(false)}}><strong>{content.name}</strong><small>{content.hint}</small></button>)}</div><div className="reward-summary"><span>{activeRewardContent.name}</span><div className="reward-summary-actions"><div className="exchange-unit reward-unit" role="group" aria-label="보상 가격 단위"><button aria-pressed={rewardUnit === 'exalted'} className={rewardUnit === 'exalted' ? 'active' : ''} onClick={() => setRewardUnit('exalted')}>엑잘</button><button aria-pressed={rewardUnit === 'divine'} className={rewardUnit === 'divine' ? 'active' : ''} onClick={() => setRewardUnit('divine')}>신성</button></div><div className="exchange-sort reward-sort" role="group" aria-label="보상 정렬"><button aria-pressed={rewardSort === 'game'} className={rewardSort === 'game' ? 'active' : ''} onClick={() => setRewardSort('game')}>기본</button><button aria-pressed={rewardSort === 'price'} className={rewardSort === 'price' ? 'active' : ''} onClick={() => setRewardSort('price')}>비싼 순</button></div><div className={`market-category-menu reward-category-menu ${rewardCategoryOpen ? 'open' : ''}`}><button className="market-category-trigger" aria-haspopup="listbox" aria-expanded={rewardCategoryOpen} onClick={() => setRewardCategoryOpen(open => !open)}><span>{rewardCategoryLabel}</span><ChevronDown size={15}/></button>{rewardCategoryOpen && <div className="market-category-options" role="listbox" aria-label="보상 아이템 분류"><button role="option" aria-selected={rewardCategory === 'all'} className={rewardCategory === 'all' ? 'selected' : ''} onClick={() => {setRewardCategory('all'); setRewardCategoryOpen(false)}}>전체 분류</button>{rewardCategoryOptions.map(item => <button key={item.key} role="option" aria-selected={rewardCategory === item.key} className={rewardCategory === item.key ? 'selected' : ''} onClick={() => {setRewardCategory(item.key); setRewardCategoryOpen(false)}}>{item.label}</button>)}</div>}</div><strong>{rewardSort === 'price' ? '비싼 순' : '기본 순서'} · {rewardMarkets.length}개</strong></div><small>현재 시세 기준, 1개당 {rewardUnitLabel} 환산</small></div><div className="reward-list"><ExchangeItemGrid groups={[{label: activeRewardContent.name, markets: rewardMarkets}]} selectedId={selectedId} onSelect={setSelectedId} quote={market => ({value: price(rewardPrice(market)), unit: rewardUnitLabel})} renderIcon={market => <MarketIcon market={market} eager/>} renderWarning={market => <MarketLiquidityWarning market={market}/>} renderPrice={value => <ExchangeCardPrice value={value}/>}/>{!rewardMarkets.length && <div className="reward-empty">{rewardQuery.trim() ? '검색 결과가 없습니다.' : '시세 데이터를 불러오는 중입니다.'}</div>}</div><div className="reward-foot"><span>poe.ninja 관측 시세 · 체결가와 다를 수 있음</span><button onClick={() => {setRewardsOpen(false); if (rewardMarkets[0]) setSelectedId(rewardMarkets[0].id)}}>1위 차트 보기</button></div></aside>}
        {exchangeOpen && <div className="exchange-overlay" onMouseDown={event => {if (event.target === event.currentTarget) setExchangeOpen(false)}}><section className="exchange-panel" role="dialog" aria-modal="true" aria-label="게임 거래소 형태의 아이템 시세표">
          <div className="exchange-heading"><div><h2>아이템 거래소 시세표</h2><p>게임의 아이템 선택 화면처럼 분류별로 살펴보고, 원하는 단위로 환산 시세를 확인하세요.</p></div><div className="exchange-tools"><div className="exchange-unit" role="group" aria-label="가격 단위"><button aria-pressed={exchangeUnit === 'exalted'} className={exchangeUnit === 'exalted' ? 'active' : ''} onClick={() => setExchangeUnit('exalted')}>엑잘</button><button aria-pressed={exchangeUnit === 'divine'} className={exchangeUnit === 'divine' ? 'active' : ''} onClick={() => setExchangeUnit('divine')}>신성</button></div><div className="exchange-sort" role="group" aria-label="아이템 정렬"><button aria-pressed={exchangeSort === 'game'} className={exchangeSort === 'game' ? 'active' : ''} onClick={() => setExchangeSort('game')}>기본</button><button aria-pressed={exchangeSort === 'price'} className={exchangeSort === 'price' ? 'active' : ''} onClick={() => setExchangeSort('price')}>비싼 순</button></div><label className="exchange-search"><Search size={16}/><input ref={exchangeSearchRef} value={exchangeQuery} onChange={e => setExchangeQuery(e.target.value)} placeholder="아이템 이름 검색" aria-label="거래소 아이템 검색"/><kbd>Ctrl K</kbd>{exchangeQuery && <button onClick={() => setExchangeQuery('')} title="검색어 지우기"><X size={15}/></button>}</label><span className="exchange-result-count" aria-live="polite">{exchangeMarkets.length}개</span></div><button className="exchange-close" onClick={() => setExchangeOpen(false)} aria-label="거래소 시세표 닫기"><X size={20}/></button></div>
          <div className="exchange-body"><nav className="exchange-nav" aria-label="거래소 아이템 분류"><div className="exchange-nav-label">아이템 분류</div><button className={exchangeCategory === 'all' ? 'active' : ''} onClick={() => {setExchangeCategory('all'); setExchangeQuery('')}}><span>모두</span><small>{data?.markets.filter(m => exchangeCategories.includes(m.category)).length || 0}</small></button>{exchangeCategories.filter(key => data?.categories[key]).map(key => <button key={key} className={exchangeCategory === key ? 'active' : ''} onClick={() => {setExchangeCategory(key); setExchangeQuery('')}}><span>{data?.categories[key]}</span><small>{data?.markets.filter(m => m.category === key).length}</small></button>)}</nav><div className="exchange-items"><ExchangeItemGrid groups={groupedExchangeMarkets} selectedId={selectedId} onSelect={setSelectedId} quote={exchangeQuote} renderIcon={market => <MarketIcon market={market} eager/>} renderWarning={market => <MarketLiquidityWarning market={market}/>} renderPrice={value => <ExchangeCardPrice value={value}/>}/>{!exchangeMarkets.length && <div className="exchange-no-results">표시할 아이템이 없습니다.</div>}</div></div>
          <div className="exchange-foot"><span>{selected ? <><strong>{selected.name}</strong> 선택 · {exchangeQuote(selected).value} {exchangeQuote(selected).unit}</> : '아이템을 선택하세요'}<small>poe.ninja 관측 시세 · 실제 체결 가격과 다를 수 있습니다</small></span><button disabled={!selected} onClick={() => setExchangeOpen(false)}>선택 종목 차트 보기</button></div>
        </section></div>}
        <section id="buying-window" className="panel seasonality-panel" aria-label="요일별 매수 시간 분석">
          <div className="seasonality-heading"><div><h2>요일·시간대 가격 패턴</h2><p>{selected?.name || '아이템'}의 가격과 공식 교환 거래량을 한국 시간 기준으로 봅니다.</p></div><div className="seasonality-controls"><div className="seasonality-period" aria-label="분석 자료"><button className={!showVolume ? 'active' : ''} onClick={() => setHeatMetric('price')}>가격 편차</button>{seasonalityData?.official_volume.supported && <button className={showVolume ? 'active' : ''} onClick={() => setHeatMetric('volume')}>공식 거래량</button>}</div><div className="seasonality-period" aria-label="분석 기간">{([28, 56, 84] as const).map(days => <button key={days} className={historyDays === days ? 'active' : ''} onClick={() => setHistoryDays(days)}>{days / 7}주</button>)}</div></div></div>
          <div className="seasonality-summary"><div><span>{seasonalityData?.source === 'poe2scout' ? 'POE2Scout 과거 가격 기록' : '저장된 전체 시장 관측'}</span><strong>{seasonalityData ? `${nfmt(seasonalityData.sample_count)}회 · ${seasonalityData.observed_days}일` : seasonalityLoading ? '불러오는 중' : '—'}</strong></div><div><span>상대적으로 저렴했던 시간</span><strong>{seasonalityData?.best_slot ? `${weekdays[seasonalityData.best_slot.weekday]}요일 ${String(seasonalityData.best_slot.hour).padStart(2, '0')}시 · ${changeText(seasonalityData.best_slot.relative_percent)}` : '분석을 위한 기록 누적 중'}</strong></div><div><span>{seasonalityData?.official_volume.supported ? 'GGG 공식 교환량 · 선택 기간' : '분석 조건'}</span><strong>{seasonalityData?.official_volume.supported ? `${nfmt(seasonalityData.official_volume.total_volume_item)}개 · ${seasonalityData.official_volume.sample_count}시간` : '3주 이상 · 시간대별 3일 이상'}</strong></div></div>
          <div className="ai-market-summary"><div className="ai-summary-mark">{marketSummary?.generated_by === 'ai' ? 'AI' : '요약'}</div><div><div className="ai-summary-title"><strong>시세 경향 요약</strong><span>{marketSummary?.generated_by === 'ai' ? `${marketSummary.model || 'AI'} 분석` : '통계 분석'}</span></div><p>{summaryLoading ? '요일·시간대 시세 경향을 분석하고 있습니다.' : cleanSummary(marketSummary?.summary) || '분석 가능한 시세 기록을 모으고 있습니다.'}</p></div></div>
          {hasHeatmapData ? <div className="heatmap-scroll"><div className="heatmap-grid"><div className="heatmap-corner">시각</div>{weekdays.map(day => <div key={day} className="heatmap-day">{day}요일</div>)}{Array.from({length: 24}, (_, hour) => <div className="heatmap-hour-row" key={hour}><div className="heatmap-hour">{String(hour).padStart(2, '0')}:00</div>{weekdays.map((day, weekday) => {
            const cell = heatCells.get(`${weekday}:${hour}`)
            const volume = volumeCells.get(`${weekday}:${hour}`)
            const strength = cell ? Math.min(0.78, 0.08 + Math.abs(cell.relative_percent) / heatScale * 0.62) : 0
            const volumeStrength = volume ? Math.min(0.85, 0.12 + Math.sqrt(volume.median_volume_item / volumeScale) * 0.68) : 0
            return showVolume
              ? <div key={`${day}:${hour}`} className={`heatmap-cell ${volume ? '' : 'empty'}`} title={volume ? `${day}요일 ${hour}시 · 공식 교환량 중간값 ${nfmt(volume.median_volume_item)}개 · ${volume.hours}시간 관측` : `${day}요일 ${hour}시 · 공식 기록 없음`} style={volume ? {backgroundColor: `rgba(43, 105, 198, ${volumeStrength})`} : undefined}>{volume ? nfmt(volume.median_volume_item) : '—'}</div>
              : <div key={`${day}:${hour}`} className={`heatmap-cell ${cell ? '' : 'empty'}`} title={cell ? `${day}요일 ${hour}시 · 일별 중앙값 대비 ${changeText(cell.relative_percent)} · ${cell.days}일 관측${volume ? ` · 공식 교환량 중간값 ${nfmt(volume.median_volume_item)}개` : ''}` : `${day}요일 ${hour}시 · 기록 없음`} style={cell ? {backgroundColor: cell.relative_percent < 0 ? `rgba(43, 105, 198, ${strength})` : `rgba(215, 68, 93, ${strength})`} : undefined}>{cell ? changeText(cell.relative_percent) : '—'}</div>
          })}</div>)}</div></div> : <div className="analysis-empty"><div className="analysis-progress"><span style={{width: `${analysisProgress}%`}}/></div><strong>{seasonalityLoading ? '분석 데이터를 불러오는 중입니다' : '요일·시간 패턴을 만들고 있습니다'}</strong><p>현재 {seasonalityData?.observed_days || 0}일 · 안정적인 분석 기준 21일</p><small>가격 관측은 우분투 서버에서 계속 누적됩니다.</small></div>}
          <div className="seasonality-note"><span>{showVolume ? 'GGG 공식 시간별 교환량의 요일·시간 중간값 · 아이템 개수 기준' : <><i className="heatmap-low"/>저렴 <i className="heatmap-high"/>비쌈 · 숫자는 해당 날짜 중앙값 대비 차이</>}</span><span>{showVolume ? `공식 기록 최근 시간 ${seasonalityData?.official_volume.last_hour ? new Date(seasonalityData.official_volume.last_hour * 1000).toLocaleString('ko-KR') : '없음'} · 개별 체결 건수는 제공되지 않습니다` : `${seasonalityData?.source === 'poe2scout' ? 'POE2Scout 과거 가격 기록' : '15분 관측 시세'} · 최근 기록 ${seasonalityData?.last_sample_at ? new Date(seasonalityData.last_sample_at * 1000).toLocaleString('ko-KR') : '없음'} · 체결 시각이 아니며 미래 가격을 보장하지 않습니다`}</span></div>
        </section>
        <div className="footer-status-grid"><div className="tracked-market-total"><span className="tracked-market-icon"><Coins size={19}/></span><span>등록된 시세</span><strong>{loading && !data ? '—' : nfmt(data?.markets.length || 0)}</strong><small>개 아이템 추적 중</small></div><div className="tracked-market-total cache-total"><span className="tracked-market-icon"><Clock3 size={18}/></span><span>전체 시장 캐시</span><strong>{lastFetched ? timeAgo(lastFetched) : '수집 중'}</strong><small>{lastFetched ? `${marketCadence}분 주기 · 다음 ${nextMarketRefresh > 0 ? clock(nextMarketRefresh) : '대기'}` : '공개 API 연결 중'}</small></div></div>
        <footer><span>전체 {marketCadence}분 / 선택 {selectedCadence}분 / 차트 1분 저장 {updated > 0 && `· 화면 확인 ${new Date(updated).toLocaleTimeString('ko-KR')}`}</span><span>데이터: <a href="https://poe.ninja/docs/api" target="_blank" rel="noreferrer">poe.ninja 공개 경제 API <ExternalLink size={12}/></a> · <a href="https://poe2scout.com" target="_blank" rel="noreferrer">POE2Scout 참고 가격 <ExternalLink size={12}/></a>{data?.trade2_live_enabled ? ' · 주요 통화 Trade2 매물 호가' : ''}</span>{sourceErrors.length > 0 && <span className="source-warning">{sourceErrors.length}개 분류 수집 오류 · 이전 데이터 표시 중</span>}</footer>
      </div>
      <nav className="mobile-dock" aria-label="모바일 빠른 메뉴"><button onClick={() => {setMarketScope('all'); document.querySelector('.market-panel')?.scrollIntoView({behavior: 'smooth'})}}><Search size={19}/><span>아이템</span></button><button onClick={() => document.querySelector('.chart-panel')?.scrollIntoView({behavior: 'smooth'})}><TrendingUp size={19}/><span>차트</span></button><button onClick={() => setRewardsOpen(true)}><Gift size={19}/><span>보상</span></button><button onClick={() => setExchangeOpen(true)}><Coins size={19}/><span>거래소</span></button></nav>
    </main>
  </div>
}

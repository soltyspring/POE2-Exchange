export const MARKET_PRICE_UNIT_LABELS = {
  divine: '신성',
  exalted: '엑잘',
  chaos: '카오스',
} as const

export type MarketPriceUnit = keyof typeof MARKET_PRICE_UNIT_LABELS
export type MarketPriceMode = MarketPriceUnit | 'adaptive'
export type CompactPriceSuffix = '' | 'K' | 'M' | 'B'

/** The price fields shared by rows returned from the market API. */
export interface MarketPriceLike {
  price_divine: number
}

/** Reference rates used to convert the canonical divine price. */
export interface MarketReferenceRates {
  exalted_per_divine?: number | null
  chaos_per_divine?: number | null
  /** The chaos market row's price_divine, accepted as an inverse rate. */
  chaos_price_divine?: number | null
}

export type MarketPriceUnavailableReason = 'invalid_price' | 'missing_reference'

export interface ResolvedMarketPrice {
  requestedMode: MarketPriceMode
  unit: MarketPriceUnit
  unitLabel: (typeof MARKET_PRICE_UNIT_LABELS)[MarketPriceUnit]
  value: number | null
  available: boolean
  unavailableReason: MarketPriceUnavailableReason | null
}

export interface FormattedMarketPrice extends ResolvedMarketPrice {
  integer: string
  fraction: string
  compactSuffix: CompactPriceSuffix
  compactText: string
  displayText: string
  /** Unabridged value and unit, suitable for title and accessible text. */
  fullText: string
}

const COMPACT_SCALES: ReadonlyArray<{divisor: number; suffix: CompactPriceSuffix}> = [
  {divisor: 1, suffix: ''},
  {divisor: 1_000, suffix: 'K'},
  {divisor: 1_000_000, suffix: 'M'},
  {divisor: 1_000_000_000, suffix: 'B'},
]

const numberPartFormatter = (maximumFractionDigits: number) => new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits,
  minimumFractionDigits: 0,
  useGrouping: true,
})

const fullNumberFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 20,
  useGrouping: true,
})

function positiveFinite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Returns chaos per divine from either the direct or inverse reference shape. */
export function resolveChaosPerDivine(rates: MarketReferenceRates): number | null {
  const directRate = positiveFinite(rates.chaos_per_divine)
  if (directRate != null) return directRate

  const chaosPriceDivine = positiveFinite(rates.chaos_price_divine)
  return chaosPriceDivine == null ? null : 1 / chaosPriceDivine
}

function convertedValue(
  priceDivine: number,
  unit: MarketPriceUnit,
  rates: MarketReferenceRates,
): number | null {
  if (unit === 'divine') return priceDivine

  const rate = unit === 'exalted'
    ? positiveFinite(rates.exalted_per_divine)
    : resolveChaosPerDivine(rates)

  return rate == null ? null : priceDivine * rate
}

/**
 * Resolves a canonical divine price into the requested display unit. Adaptive
 * mode uses divine at 1+, then chaos at 1+, then exalted. If a reference rate
 * is missing, it falls back to the next unit that can be calculated.
 */
export function resolveMarketPrice(
  market: MarketPriceLike,
  rates: MarketReferenceRates = {},
  mode: MarketPriceMode = 'adaptive',
): ResolvedMarketPrice {
  const priceDivine = market.price_divine
  const validPrice = Number.isFinite(priceDivine) && priceDivine >= 0

  if (!validPrice) {
    const unit = mode === 'adaptive' ? 'divine' : mode
    return {
      requestedMode: mode,
      unit,
      unitLabel: MARKET_PRICE_UNIT_LABELS[unit],
      value: null,
      available: false,
      unavailableReason: 'invalid_price',
    }
  }

  if (mode !== 'adaptive') {
    const value = convertedValue(priceDivine, mode, rates)
    return {
      requestedMode: mode,
      unit: mode,
      unitLabel: MARKET_PRICE_UNIT_LABELS[mode],
      value,
      available: value != null,
      unavailableReason: value == null ? 'missing_reference' : null,
    }
  }

  if (priceDivine >= 1) {
    return availablePrice(mode, 'divine', priceDivine)
  }

  const chaosValue = convertedValue(priceDivine, 'chaos', rates)
  if (chaosValue != null && chaosValue >= 1) {
    return availablePrice(mode, 'chaos', chaosValue)
  }

  const exaltedValue = convertedValue(priceDivine, 'exalted', rates)
  if (exaltedValue != null) {
    return availablePrice(mode, 'exalted', exaltedValue)
  }

  if (chaosValue != null) {
    return availablePrice(mode, 'chaos', chaosValue)
  }

  return availablePrice(mode, 'divine', priceDivine)
}

function availablePrice(
  requestedMode: MarketPriceMode,
  unit: MarketPriceUnit,
  value: number,
): ResolvedMarketPrice {
  return {
    requestedMode,
    unit,
    unitLabel: MARKET_PRICE_UNIT_LABELS[unit],
    value,
    available: true,
    unavailableReason: null,
  }
}

function fractionDigitsFor(value: number, significantDigits: number): number {
  if (value === 0) return 0
  const integerMagnitude = Math.floor(Math.log10(Math.abs(value)))
  return Math.min(12, Math.max(0, significantDigits - integerMagnitude - 1))
}

function roundedForDisplay(value: number, fractionDigits: number): number {
  const factor = 10 ** fractionDigits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function compactScale(value: number, significantDigits: number) {
  const magnitude = Math.abs(value)
  let scaleIndex = magnitude >= 1_000_000_000
    ? 3
    : magnitude >= 1_000_000
      ? 2
      : magnitude >= 1_000
        ? 1
        : 0

  while (scaleIndex < COMPACT_SCALES.length - 1) {
    const scaled = value / COMPACT_SCALES[scaleIndex].divisor
    const fractionDigits = fractionDigitsFor(scaled, significantDigits)
    if (Math.abs(roundedForDisplay(scaled, fractionDigits)) < 1_000) break
    scaleIndex += 1
  }

  return COMPACT_SCALES[scaleIndex]
}

function splitNumber(value: number, maximumFractionDigits: number) {
  const parts = numberPartFormatter(maximumFractionDigits).formatToParts(value)
  const integer = parts
    .filter(part => part.type !== 'decimal' && part.type !== 'fraction')
    .map(part => part.value)
    .join('')
  const decimal = parts.find(part => part.type === 'decimal')?.value ?? ''
  const fractionValue = parts.find(part => part.type === 'fraction')?.value ?? ''
  return {integer, fraction: fractionValue ? decimal + fractionValue : ''}
}

/** Formats a resolved price with K/M/B compaction and unabridged fallback text. */
export function formatResolvedMarketPrice(
  resolved: ResolvedMarketPrice,
  significantDigits = 3,
): FormattedMarketPrice {
  if (!resolved.available || resolved.value == null) {
    const missingReference = resolved.unavailableReason === 'missing_reference'
    const fullText = missingReference
      ? resolved.unitLabel + ' 환산 기준 없음'
      : '가격 정보 없음'
    return {
      ...resolved,
      integer: '—',
      fraction: '',
      compactSuffix: '',
      compactText: '—',
      displayText: '—',
      fullText,
    }
  }

  const safeSignificantDigits = Math.min(6, Math.max(2, Math.round(significantDigits)))
  const scale = compactScale(resolved.value, safeSignificantDigits)
  const scaledValue = resolved.value / scale.divisor
  const maximumFractionDigits = fractionDigitsFor(scaledValue, safeSignificantDigits)
  const parts = splitNumber(scaledValue, maximumFractionDigits)
  const compactText = parts.integer + parts.fraction + scale.suffix

  return {
    ...resolved,
    integer: parts.integer,
    fraction: parts.fraction,
    compactSuffix: scale.suffix,
    compactText,
    displayText: compactText + ' ' + resolved.unitLabel,
    fullText: fullNumberFormatter.format(resolved.value) + ' ' + resolved.unitLabel,
  }
}

/** Resolves and formats a market price in one call. */
export function formatMarketPrice(
  market: MarketPriceLike,
  rates: MarketReferenceRates = {},
  mode: MarketPriceMode = 'adaptive',
  significantDigits = 3,
): FormattedMarketPrice {
  return formatResolvedMarketPrice(resolveMarketPrice(market, rates, mode), significantDigits)
}

export interface MarketPriceProps {
  market: MarketPriceLike
  rates?: MarketReferenceRates
  mode?: MarketPriceMode
  significantDigits?: number
  showUnit?: boolean
  className?: string
}

/** Compact price with full text in its title and accessible name. */
export function MarketPrice({
  market,
  rates = {},
  mode = 'adaptive',
  significantDigits = 3,
  showUnit = true,
  className = '',
}: MarketPriceProps) {
  const formatted = formatMarketPrice(market, rates, mode, significantDigits)
  const rootClassName = ['market-price', className].filter(Boolean).join(' ')

  return (
    <span
      className={rootClassName}
      data-price-mode={mode}
      data-price-unit={formatted.unit}
      title={formatted.fullText}
      aria-label={formatted.fullText}
    >
      <span className="market-price-visible" aria-hidden="true">
        <span className="market-price-integer">{formatted.integer}</span>
        {formatted.fraction && (
          <span
            className="market-price-fraction"
            style={{color: formatted.value != null && formatted.value < 1 ? 'inherit' : 'var(--market-price-fraction-color, #7b8798)'}}
          >
            {formatted.fraction}
          </span>
        )}
        {formatted.compactSuffix && (
          <span className="market-price-compact-suffix">{formatted.compactSuffix}</span>
        )}
        {showUnit && formatted.available && (
          <span className="market-price-unit"> {formatted.unitLabel}</span>
        )}
      </span>
    </span>
  )
}

export type LiquidityQuality = 'good' | 'limited' | 'low'
export type LiquidityMetric = 'listing_count' | 'volume_divine' | 'missing'

export const LIQUIDITY_QUALITY_LABELS: Record<LiquidityQuality, string> = {
  good: '유동성 충분',
  limited: '유동성 제한적',
  low: '유동성 낮음',
}

export const LIQUIDITY_THRESHOLDS = {
  listingCount: {limited: 20, good: 50},
  volumeDivine: {limited: 10, good: 100},
  estimatedUnits: {limited: 20, good: 100},
} as const

export interface MarketLiquidityLike {
  source_kind: string
  listing_count: number | null
  volume_divine: number | null
  price_divine?: number | null
}

export interface MarketLiquidityAssessment {
  quality: LiquidityQuality
  label: string
  metric: LiquidityMetric
  value: number | null
  detail: string
}

function qualityFromThresholds(value: number, limited: number, good: number): LiquidityQuality {
  if (value >= good) return 'good'
  if (value >= limited) return 'limited'
  return 'low'
}

/**
 * Stash rows use listing count. Exchange/reference rows use divine volume.
 * Unknown source kinds use listing count when present, then volume.
 */
export function assessMarketLiquidity(market: MarketLiquidityLike): MarketLiquidityAssessment {
  const sourceKind = market.source_kind.toLowerCase()
  const hasListingCount = market.listing_count != null && Number.isFinite(market.listing_count)
  const hasVolume = market.volume_divine != null && Number.isFinite(market.volume_divine)
  const knownVolumeSource = sourceKind === 'exchange' || sourceKind === 'reference'
  const useListingCount = sourceKind === 'stash' || (!knownVolumeSource && hasListingCount)

  if (useListingCount && hasListingCount) {
    const value = Math.max(0, market.listing_count as number)
    const quality = qualityFromThresholds(
      value,
      LIQUIDITY_THRESHOLDS.listingCount.limited,
      LIQUIDITY_THRESHOLDS.listingCount.good,
    )
    return {
      quality,
      label: LIQUIDITY_QUALITY_LABELS[quality],
      metric: 'listing_count',
      value,
      detail: '현재 매물 ' + numberPartFormatter(0).format(value) + '개 · ' + LIQUIDITY_QUALITY_LABELS[quality],
    }
  }

  if (!useListingCount && hasVolume) {
    const value = Math.max(0, market.volume_divine as number)
    const estimatedUnits = market.price_divine != null && market.price_divine > 0
      ? value / market.price_divine
      : null
    const volumeQuality = qualityFromThresholds(value, LIQUIDITY_THRESHOLDS.volumeDivine.limited, LIQUIDITY_THRESHOLDS.volumeDivine.good)
    const unitQuality = estimatedUnits == null ? 'low' : qualityFromThresholds(estimatedUnits, LIQUIDITY_THRESHOLDS.estimatedUnits.limited, LIQUIDITY_THRESHOLDS.estimatedUnits.good)
    const rank = {low: 1, limited: 2, good: 3} as const
    const quality = rank[volumeQuality] >= rank[unitQuality] ? volumeQuality : unitQuality
    return {
      quality,
      label: LIQUIDITY_QUALITY_LABELS[quality],
      metric: 'volume_divine',
      value,
      detail: '거래 규모 ' + fullNumberFormatter.format(value) + ' 신성' + (estimatedUnits == null ? '' : ' · 추정 거래량 ' + numberPartFormatter(0).format(estimatedUnits) + '개') + ' · ' + LIQUIDITY_QUALITY_LABELS[quality],
    }
  }

  return {
    quality: 'limited',
    label: LIQUIDITY_QUALITY_LABELS.limited,
    metric: 'missing',
    value: null,
    detail: '유동성 자료 없음 · 가격을 다른 출처와 함께 확인하세요.',
  }
}

export function getLiquidityQuality(market: MarketLiquidityLike): LiquidityQuality {
  return assessMarketLiquidity(market).quality
}

export interface MarketLiquidityBadgeProps {
  market: MarketLiquidityLike
  className?: string
  showMetric?: boolean
}

/** Small Korean liquidity label with a complete accessible description. */
export function MarketLiquidityBadge({
  market,
  className = '',
  showMetric = false,
}: MarketLiquidityBadgeProps) {
  const assessment = assessMarketLiquidity(market)
  const rootClassName = ['market-liquidity', 'is-' + assessment.quality, className]
    .filter(Boolean)
    .join(' ')
  let metricText = ''
  if (assessment.metric === 'listing_count' && assessment.value != null) {
    metricText = ' · ' + numberPartFormatter(0).format(assessment.value) + '개'
  } else if (assessment.metric === 'volume_divine' && assessment.value != null) {
    metricText = ' · ' + fullNumberFormatter.format(assessment.value) + ' 신성'
  }

  return (
    <span
      className={rootClassName}
      data-liquidity-quality={assessment.quality}
      title={assessment.detail}
      aria-label={assessment.detail}
    >
      <span aria-hidden="true">
        {assessment.label}{showMetric ? metricText : ''}
      </span>
    </span>
  )
}

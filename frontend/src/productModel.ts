export type SnapshotStatus = {category: string; fetched_at: number; next_refresh_at: number; cache_state: string; error: string | null}

export function readStoredIds(key: string, storage?: Pick<Storage, 'getItem'>): string[] {
  try {
    const source = storage ?? localStorage
    const value: unknown = JSON.parse(source.getItem(key) || '[]')
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length < 300))].slice(0, 500) : []
  } catch { return [] }
}

export function savePreference(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Private browsing or a full quota must not break the market. */ }
}

export function quoteTotal(price: number | null, quantity: string): number | null {
  if (price == null || !Number.isFinite(price) || price < 0 || !/^\d+$/.test(quantity)) return null
  const count = Number(quantity)
  if (!Number.isSafeInteger(count) || count < 1 || count > 1_000_000) return null
  const result = price * count
  return Number.isFinite(result) ? result : null
}

export function snapshotHealth(states: SnapshotStatus[], category?: string, now = Date.now() / 1000) {
  const relevant = category ? states.filter(s => s.category === category) : states
  const lastSuccess = relevant.length ? Math.min(...relevant.map(s => s.fetched_at || 0)) : 0
  const failed = relevant.filter(s => s.error || s.cache_state === 'error').length
  const delayed = relevant.filter(s => s.cache_state === 'stale' || now - s.fetched_at > 1800).length
  const next = relevant.map(s => s.next_refresh_at).filter(t => Number.isFinite(t) && t > now)
  const quality = !lastSuccess ? 'unknown' : failed ? 'error' : delayed ? 'stale' : 'fresh'
  return {quality, lastSuccess, failed, delayed, total: relevant.length, nextRefresh: next.length ? Math.min(...next) : 0,
    label: quality === 'fresh' ? '정상 갱신' : quality === 'stale' ? '갱신 지연' : quality === 'error' ? '일부 수집 오류' : '연결 확인 중'}
}

export function csvCell(value: string | number) {
  const text = String(value)
  // Imported CSV must not execute spreadsheet formulas from upstream names.
  const safe = /^[=+@\-\t\r]/.test(text) ? "'" + text : text
  return '"' + safe.replaceAll('"', '""') + '"'
}

export function observationCsv(rows: {time: number; open: number; high: number; low: number; close: number; samples: number}[], name: string, unit: string) {
  return '\uFEFF' + [['아이템', '단위', '관측 시각 (UTC)', '시가', '고가', '저가', '종가', '관측 수'],
    ...rows.map(row => [name, unit, new Date(row.time * 1000).toISOString(), row.open, row.high, row.low, row.close, row.samples])]
    .map(row => row.map(csvCell).join(',')).join('\r\n')
}

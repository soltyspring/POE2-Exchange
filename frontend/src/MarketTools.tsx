import { useEffect, useState } from 'react'
import { ArrowDownToLine, BookOpen, Calculator, Check, Clock3, Link2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { observationCsv, quoteTotal, snapshotHealth, type SnapshotStatus } from './productModel'

const number = (value: number) => new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 3}).format(value)
const stamp = (value: number) => value ? new Date(value * 1000).toLocaleString('ko-KR', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}) : '확인 중'

export function DataHealth({states, preview}: {states: SnapshotStatus[]; preview: boolean}) {
  const [now, setNow] = useState(Date.now() / 1000)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now() / 1000), 30_000); return () => clearInterval(timer) }, [])
  const health = snapshotHealth(states, undefined, now)
  return <div className={`data-health ${health.quality}`} role="status">
    {health.quality === 'fresh' ? <ShieldCheck size={17}/> : <TriangleAlert size={17}/>}
    <strong>{preview ? '로컬 데이터 미리보기' : health.label}</strong>
    <span>{preview ? '저장된 DB를 읽기 전용으로 표시합니다.' : `${health.total}개 분류 · 가장 오래된 성공 갱신 ${stamp(health.lastSuccess)}`}</span>
    <a href="/methodology.html">시세 기준 알아보기 <BookOpen size={13}/></a>
  </div>
}

export function QuoteTools({id, name, league, value, unit, divinePrice, observedAt, candles, interval}: {
  id: string; name: string; league: string; value: number | null; unit: string; divinePrice: number;
  observedAt: number; candles: {time: number; open: number; high: number; low: number; close: number; samples: number}[]; interval: string;
}) {
  const [quantity, setQuantity] = useState('1')
  const [message, setMessage] = useState('')
  useEffect(() => { setMessage(''); setQuantity('1') }, [id])
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(''), 3500); return () => clearTimeout(timer) }, [message])
  const total = quoteTotal(value, quantity)
  const divineTotal = quoteTotal(divinePrice, quantity)
  const share = async () => {
    const url = new URL(window.location.href)
    url.search = new URLSearchParams({league, item: id}).toString()
    url.hash = ''
    try { await navigator.clipboard.writeText(url.toString()); setMessage('아이템 링크를 복사했습니다.') }
    catch { setMessage('주소 복사가 지원되지 않습니다. 브라우저 주소를 복사해 주세요.') }
  }
  const download = () => {
    const blob = new Blob([observationCsv(candles, name, unit)], {type: 'text/csv;charset=utf-8'})
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href; anchor.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}-${interval}-observations.csv`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
    setMessage('관측 시세를 CSV로 저장했습니다.')
  }
  return <div className="quote-tools">
    <div className="quote-calculator"><Calculator size={17}/><label htmlFor="quote-quantity">수량</label><input id="quote-quantity" type="number" inputMode="numeric" min="1" max="1000000" step="1" value={quantity} aria-invalid={total == null} onChange={e => setQuantity(e.target.value)}/><span>개</span><div className="quote-total" aria-live="polite"><strong>{total == null ? '수량 확인' : number(total)} <small>{unit}</small></strong>{unit !== '신성' && divineTotal != null && <span>≈ {number(divineTotal)} 신성</span>}</div></div>
    <div className="quote-actions"><button onClick={() => void share()}><Link2 size={15}/>링크 복사</button><button onClick={download} disabled={!candles.length} title="현재 차트에 표시된 관측값을 저장합니다"><ArrowDownToLine size={15}/>CSV</button></div>
    <div className="quote-tools-note"><Clock3 size={13}/><span>관측 {stamp(observedAt)} · 수량 환산은 참고값입니다.</span></div>
    {message && <div className="action-toast" role="status"><Check size={15}/>{message}</div>}
  </div>
}

export function GettingStarted() {
  return <section className="learning-panel" aria-labelledby="learning-title"><div className="learning-title"><BookOpen size={21}/><div><span>처음 이용한다면</span><h2 id="learning-title">가격을 보는 데서, 판단하는 데까지.</h2></div><a href="/guide/index.html">가이드 전체 보기 →</a></div><div className="learning-links">
    <a href="/guide/read-prices.html"><span>01 · 시세 읽기</span><strong>표시 가격을 얼마까지 믿어도 될까?</strong><p>관측 시세, 거래량, 매물 수를 함께 확인하는 방법.</p></a>
    <a href="/guide/buying-time.html"><span>02 · 구매 시점</span><strong>요일·시간대 패턴 제대로 읽기</strong><p>저렴했던 시간과 표본이 충분한 시간을 구분하세요.</p></a>
    <a href="/guide/farming-value.html"><span>03 · 보상 비교</span><strong>드롭 가격과 파밍 수익은 다릅니다</strong><p>보상 목록을 사용해 내 플레이의 가치를 비교하는 방법.</p></a>
  </div></section>
}

export function ServiceFooter() {
  return <div className="service-footer"><div><strong>POE2 <span>MARKET</span></strong><p>게임 아이템의 가격과 시간을 이해하는 도구.<br/>Grinding Gear Games와 제휴하지 않은 커뮤니티 서비스입니다.</p></div><nav aria-label="서비스 안내"><a href="/build-import.html">빌드 가져오기</a><a href="/guide/index.html">사용 가이드</a><a href="/methodology.html">데이터·산정 방식</a><a href="/about.html">서비스 소개</a><a href="/contact.html">문의·오류 제보</a><a href="/privacy.html">개인정보 처리방침</a><a href="/terms.html">이용 안내</a></nav><small>시세는 실제 체결가와 다를 수 있습니다. 아이템 이미지와 게임 명칭의 권리는 각 권리자에게 있습니다.</small></div>
}

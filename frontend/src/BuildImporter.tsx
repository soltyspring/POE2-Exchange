import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, Check, ExternalLink, FileJson, Layers3, Link2, LoaderCircle, ShieldCheck, X } from 'lucide-react'
import { SiteHeader, UiButton } from './ui'
import { request } from './apiClient'
import { BuildPresentation } from './BuildPresentation'
import { buildFilename, buildMarkdown, EXAMPLE_BUILD, isBuildLink, lastVariantBuild, type ImportedBuild } from './buildExport'

export function BuildImporter() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportedBuild | null>(null)
  const [toast, setToast] = useState('')
  const pending = useRef<AbortController | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLElement>(null)
  const variant = result?.analysis.variants.at(-1)
  useEffect(() => () => pending.current?.abort(), [])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer) }, [toast])
  const cancel = () => { pending.current?.abort(); pending.current = null; setLoading(false) }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    setError(''); setToast(''); setResult(null)
    if (!isBuildLink(url)) { setError('Mobalytics의 POE2 빌드 공유 링크를 입력해 주세요.'); requestAnimationFrame(() => errorRef.current?.focus()); return }
    const controller = new AbortController()
    pending.current = controller; setLoading(true); setResult(null)
    try {
      const response = await request('/api/builds/mobalytics', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url: url.trim()}), signal: controller.signal}, 40_000)
      const body = await response.json()
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : '빌드를 가져오지 못했습니다. 링크를 확인해 주세요.')
      if (controller.signal.aborted) return
      const build = lastVariantBuild(body as ImportedBuild)
      setResult(build)
      requestAnimationFrame(() => resultRef.current?.focus())
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : '빌드를 가져오지 못했습니다.')
        requestAnimationFrame(() => errorRef.current?.focus())
      }
    } finally { if (pending.current === controller) { pending.current = null; setLoading(false) } }
  }
  const download = (kind: 'build' | 'analysis' | 'markdown') => {
    if (!result || (kind === 'markdown' && !variant)) return
    const contents = kind === 'markdown' ? buildMarkdown(result, variant!) : JSON.stringify(kind === 'build' ? result.document :
      {source_url: result.source_url, fetched_at: result.fetched_at, ...result.analysis}, null, 2)
    const blob = new Blob([contents], {type: kind === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8'})
    const href = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = href; anchor.download = buildFilename(`${result.analysis.name}-${kind}${kind === 'markdown' ? '-' + variant!.id.slice(0, 8) : ''}`, result.build_id, kind === 'markdown' ? 'md' : 'json'); anchor.click()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
    setToast(kind === 'build' ? '빌드 JSON을 다운로드했습니다.' : kind === 'analysis' ? '분석 JSON을 다운로드했습니다.' : '마지막 구성의 요약을 다운로드했습니다.')
  }
  return <div className="build-page"><a className="build-skip" href="#build-main">본문으로 건너뛰기</a>
    <SiteHeader/>
    <main id="build-main"><div className="build-intro"><span className="build-eyebrow">BUILD IMPORT</span><h1>공유 빌드를 내 파일로.</h1><p>Mobalytics 링크 하나로 장비·젬·패시브를 확인하고,<br/>다시 읽거나 분석할 수 있는 파일로 저장하세요.</p></div>
      <form className="build-form" onSubmit={event => void submit(event)} aria-busy={loading}>
        <label htmlFor="build-url">Mobalytics POE2 빌드 공유 링크</label><div className="build-input-row"><Link2 size={19}/><input id="build-url" type="url" value={url} onChange={event => setUrl(event.target.value)} disabled={loading} placeholder="https://mobalytics.gg/poe-2/profile/…/builds/…" autoComplete="off" required aria-describedby="build-input-help"/><UiButton className="build-primary" type="submit" disabled={loading}>{loading ? <LoaderCircle size={17} className="build-spinner"/> : <Layers3 size={17}/>} {loading ? '가져오는 중' : '빌드 분석'}</UiButton></div>
        <div className="build-input-help" id="build-input-help"><span>공개 POE2 빌드만 지원합니다. 분석 시 빌드 ID를 Mobalytics로 보내 조회합니다.</span><UiButton type="button" disabled={loading} onClick={() => {setUrl(EXAMPLE_BUILD); setError('')}}>예시 링크 넣기</UiButton></div>
        {loading && <div className="build-progress" role="status"><span>장비·젬·패시브를 가져와 정리하고 있습니다.</span><UiButton type="button" onClick={cancel}><X size={14}/>취소</UiButton></div>}
        {error && <div className="build-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
      </form>
      {!result && !loading && <div className="build-how"><div><FileJson size={22}/><h2>빌드 JSON</h2><p>장비 옵션, 젬 연결, 패시브 노드 등 조회된 구조 데이터를 저장합니다.</p></div><div><Layers3 size={22}/><h2>마지막 구성 확인</h2><p>공유 빌드의 구성 목록에서 마지막 버전만 가져와 표시합니다.</p></div><div><ArrowDownToLine size={22}/><h2>분석 요약</h2><p>마지막 구성의 데이터를 JSON과 읽기 쉬운 Markdown 파일로 저장합니다.</p></div></div>}
      {result && <section className="build-result planner-result" aria-label="빌드 분석 결과" tabIndex={-1} ref={resultRef}>
        <div className="planner-layout"><div className="planner-main-column"><div className="planner-hero"><span className="build-eyebrow">POE2 · BUILD</span><h2>{result.analysis.name}</h2><div className="planner-hero-tags"><span>마지막 구성</span>{variant && <span>{variant.name}</span>}<span>{variant?.counts.skills || 0}개 스킬</span></div><p>작성자 <strong>{result.analysis.author}</strong><a href={result.source_url} target="_blank" rel="noopener noreferrer">Mobalytics 원문 <ExternalLink size={13}/></a></p><div className="planner-hero-foot"><ShieldCheck size={15}/><span>조회 {new Date(result.fetched_at).toLocaleString('ko-KR')} · {result.cached ? '5분 캐시 사용' : 'Mobalytics에서 조회'}</span></div></div>
          {variant ? <BuildPresentation key={variant.id} variant={variant}/> : <p className="build-empty">저장된 빌드 구성이 없습니다.</p>}
          <details id="build-notes" className="build-notes"><summary>분석 범위와 다운로드 안내</summary><ul>{result.analysis.notes.map(note => <li key={note}>{note}</li>)}</ul><p>마지막 구성의 장비·젬·노드 데이터를 파일로 저장합니다. DPS 계산과 게임으로 직접 가져오는 기능은 아닙니다.</p></details>
        </div><aside className="planner-sidebar" aria-label="빌드 도구"><section className="planner-panel planner-export"><header><h2>빌드 내보내기</h2></header><p>마지막 구성만 파일로 저장합니다.</p><div className="build-downloads"><UiButton className="build-primary" onClick={() => download('build')}><FileJson size={16}/>빌드 JSON 다운로드</UiButton><UiButton disabled={!variant} onClick={() => download('markdown')}><ArrowDownToLine size={16}/>마지막 구성 요약</UiButton><UiButton onClick={() => download('analysis')}>분석 JSON</UiButton></div><small>추가 분석용 JSON · 읽기용 Markdown</small></section>
          <nav className="planner-panel planner-toc" aria-label="빌드 목차"><header><h2>목차</h2></header><a href="#build-equipment">01 <span>장비</span></a><a href="#build-skills">02 <span>젬·스킬</span></a><a href="#build-passives">03 <span>패시브·주얼</span></a><a href="#build-atlas">04 <span>아틀라스</span></a><a href="#build-notes">05 <span>분석 범위</span></a><a className="planner-back-top" href="#build-main">맨 위로 ↑</a></nav>
          <div className="planner-panel planner-quick-summary"><header><h2>마지막 구성 요약</h2></header>{variant && <dl><div><dt>장비 <small>무기 세트 포함</small></dt><dd>{variant.counts.equipment}</dd></div><div><dt>고유 장비</dt><dd>{variant.counts.unique}</dd></div><div><dt>스킬</dt><dd>{variant.counts.skills}</dd></div><div><dt>보조·하위 스킬</dt><dd>{variant.counts.supports}</dd></div><div><dt>기본 노드</dt><dd>{variant.counts.passives}</dd></div><div><dt>전직 노드</dt><dd>{variant.counts.ascendancy}</dd></div></dl>}<p>아이템을 눌러 옵션을 확인하세요. 무기 세트를 바꿔 다른 무기를 비교할 수 있습니다.</p></div>
        </aside></div>
      </section>}
      <footer className="build-footer"><a href="/">시세 대시보드</a><a href="/privacy.html">개인정보 처리방침</a><span>Mobalytics·Grinding Gear Games와 제휴하지 않은 도구입니다.</span></footer>
    </main>{toast && <div className="build-toast" role="status"><Check size={16}/>{toast}</div>}
  </div>
}

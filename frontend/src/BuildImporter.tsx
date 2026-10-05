import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowLeft, Check, ExternalLink, FileJson, Layers3, Link2, LoaderCircle, ShieldCheck, X } from 'lucide-react'
import { request } from './apiClient'
import { buildFilename, buildMarkdown, EXAMPLE_BUILD, isBuildLink, lastVariantBuild, type ImportedBuild } from './buildExport'

const treeLabels: Record<string, string> = {mainTree: '기본 패시브', set1Tree: '무기 세트 1', set2Tree: '무기 세트 2', ascendancyTree: '전직',
  breachTree: '균열', expeditionTree: '탐험', deliriumTree: '환영', ritualTree: '의식', bossTree: '보스', pinnacleBossTree: '최종 보스', abyssalTree: '심연'}

export function BuildImporter() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportedBuild | null>(null)
  const [section, setSection] = useState<'equipment' | 'skills' | 'passives' | 'atlas'>('equipment')
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
      setResult(build); setSection('equipment')
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
    <header className="build-header"><a className="build-brand" href="/">POE2 <span>MARKET</span></a><a href="/"><ArrowLeft size={15}/>시세 대시보드</a></header>
    <main id="build-main"><div className="build-intro"><span className="build-eyebrow">BUILD IMPORT</span><h1>공유 빌드를 내 파일로.</h1><p>Mobalytics 링크 하나로 장비·젬·패시브를 확인하고,<br/>다시 읽거나 분석할 수 있는 파일로 저장하세요.</p></div>
      <form className="build-form" onSubmit={event => void submit(event)} aria-busy={loading}>
        <label htmlFor="build-url">Mobalytics POE2 빌드 공유 링크</label><div className="build-input-row"><Link2 size={19}/><input id="build-url" type="url" value={url} onChange={event => setUrl(event.target.value)} disabled={loading} placeholder="https://mobalytics.gg/poe-2/profile/…/builds/…" autoComplete="off" required aria-describedby="build-input-help"/><button className="build-primary" type="submit" disabled={loading}>{loading ? <LoaderCircle size={17} className="build-spinner"/> : <Layers3 size={17}/>} {loading ? '가져오는 중' : '빌드 분석'}</button></div>
        <div className="build-input-help" id="build-input-help"><span>공개 POE2 빌드만 지원합니다. 분석 시 빌드 ID를 Mobalytics로 보내 조회합니다.</span><button type="button" disabled={loading} onClick={() => {setUrl(EXAMPLE_BUILD); setError('')}}>예시 링크 넣기</button></div>
        {loading && <div className="build-progress" role="status"><span>장비·젬·패시브를 가져와 정리하고 있습니다.</span><button type="button" onClick={cancel}><X size={14}/>취소</button></div>}
        {error && <div className="build-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
      </form>
      {!result && !loading && <div className="build-how"><div><FileJson size={22}/><h2>빌드 JSON</h2><p>장비 옵션, 젬 연결, 패시브 노드 등 조회된 구조 데이터를 저장합니다.</p></div><div><Layers3 size={22}/><h2>마지막 구성 확인</h2><p>공유 빌드의 구성 목록에서 마지막 버전만 가져와 표시합니다.</p></div><div><ArrowDownToLine size={22}/><h2>분석 요약</h2><p>마지막 구성의 데이터를 JSON과 읽기 쉬운 Markdown 파일로 저장합니다.</p></div></div>}
      {result && <section className="build-result" aria-label="빌드 분석 결과" tabIndex={-1} ref={resultRef}><div className="build-result-head"><div><span className="build-eyebrow">가져오기 완료</span><h2>{result.analysis.name}</h2><p>{result.analysis.author} · 마지막 구성 <a href={result.source_url} target="_blank" rel="noopener noreferrer">원문 보기 <ExternalLink size={13}/></a></p></div><div className="build-downloads"><button className="build-primary" onClick={() => download('build')}><FileJson size={16}/>빌드 JSON</button><button disabled={!variant} onClick={() => download('markdown')}><ArrowDownToLine size={16}/>마지막 구성 요약</button><button onClick={() => download('analysis')}>분석 JSON</button></div></div>
        <div className="build-source"><ShieldCheck size={15}/><span>조회 {new Date(result.fetched_at).toLocaleString('ko-KR')} · {result.cached ? '5분 캐시 사용' : 'Mobalytics에서 조회'} · 시세 DB에 저장하지 않습니다.</span></div>
        {variant && <div className="build-variant">마지막 구성 <strong>{variant.name}</strong><span>공유 페이지의 마지막 버전 기준</span></div>}
        {variant ? <><div className="build-counts">{([['장비', variant.counts.equipment], ['고유 장비', variant.counts.unique], ['주요 스킬', variant.counts.skills], ['보조·하위 스킬', variant.counts.supports], ['기본 노드', variant.counts.passives], ['전직 노드', variant.counts.ascendancy]] as const).map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
          <nav className="build-sections" aria-label="빌드 세부 정보">{([['equipment','장비'],['skills','젬·스킬'],['passives','패시브·주얼'],['atlas','아틀라스']] as const).map(([id,label]) => <button key={id} aria-pressed={section === id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>{label}</button>)}</nav>
          {!variant.populated && <p className="build-empty">이 구성에는 저장된 장비·젬·노드가 없습니다. 공유 페이지의 마지막 구성 내용을 확인해 주세요.</p>}
          {section === 'equipment' && <div className="build-cards">{variant.equipment.map(item => <article key={item.slot} className="build-card"><div className="build-card-label"><span>{item.slot_label}</span>{item.unique && <small>고유</small>}</div><h3>{item.name}</h3>{item.item_class && <p className="build-slug">{item.item_class}</p>}<ul>{item.implicit.map((mod,index) => <li className="build-implicit" key={`i${index}`}>{mod.description}</li>)}{item.explicit.map((mod,index) => <li key={`e${index}`}>{mod.description}{mod.mustHave && <small> · 필수 옵션</small>}</li>)}</ul>{!item.explicit.length && !item.implicit.length && <p className="build-muted">옵션 설명 미제공</p>}{item.runes.length > 0 && <p className="build-muted">룬 · {item.runes.map(rune => rune.slug).join(', ')}</p>}{item.anointment && <p className="build-muted">주입 · {item.anointment}</p>}<details><summary>능력치·요구사항</summary><ul>{[...item.stats,...item.requirements].map((stat,index) => <li key={index}>{stat.name}: {stat.value}</li>)}</ul></details></article>)}</div>}
          {section === 'skills' && <><p className="build-muted">젬 요구 능력치: {variant.gem_requirements ? `힘 ${variant.gem_requirements.str} · 민첩 ${variant.gem_requirements.dex} · 지능 ${variant.gem_requirements.int}` : '미제공'}</p><div className="build-cards">{variant.skills.map((skill,index) => <article className="build-card" key={`${skill.slug}:${index}`}><h3>{skill.name}</h3><p className="build-muted">{skill.level != null ? `Lv.${skill.level}` : '레벨 미제공'}{skill.weapon_set ? ` · ${skill.weapon_set}` : ''}</p><ul>{skill.supports.map((support,i) => <li key={i}>{support.gemSlug}{support.gemType && <small> · {support.gemType}</small>}</li>)}</ul>{!skill.supports.length && <p className="build-muted">연결된 보조·하위 스킬 없음</p>}</article>)}</div></>}
          {section === 'passives' && <div className="build-trees">{Object.entries(variant.passives).map(([key,nodes]) => <details key={key} open={key === 'ascendancyTree'}><summary>{treeLabels[key] || key} <span>{nodes.length}개</span></summary>{nodes.length ? <ul className="build-node-list">{nodes.map(node => <li key={node}>{node}</li>)}</ul> : <p className="build-muted">저장된 노드 없음</p>}</details>)}<details open><summary>주얼 <span>{variant.jewels.length}개</span></summary>{variant.jewels.length ? <ul>{variant.jewels.map((jewel,index) => <li key={index}>{jewel.jewelSlug} · 위치 {jewel.nodeSlug}</li>)}</ul> : <p className="build-muted">저장된 주얼 없음</p>}</details></div>}
          {section === 'atlas' && <div className="build-trees">{Object.entries(variant.atlas).filter(([,nodes]) => nodes.length).map(([key,nodes]) => <details open key={key}><summary>{treeLabels[key] || key} <span>{nodes.length}개</span></summary><ul className="build-node-list">{nodes.map(node => <li key={node}>{node}</li>)}</ul></details>)}{!variant.counts.atlas && <p className="build-empty">이 구성에는 아틀라스 노드가 저장되어 있지 않습니다.</p>}</div>}
        </> : <p className="build-empty">선택 가능한 빌드 구성이 없습니다. 조회된 JSON은 다운로드할 수 있습니다.</p>}
        <div className="build-notes"><strong>분석 범위</strong><ul>{result.analysis.notes.map(note => <li key={note}>{note}</li>)}</ul><p>빌드 JSON에는 마지막 구성과 {result.analysis.has_pob ? '저장된 PoB 코드' : '장비·젬·패시브 데이터'}가 포함됩니다. ChatGPT에 첨부해 추가 분석할 수 있습니다.</p></div>
      </section>}
      <footer className="build-footer"><a href="/">시세 대시보드</a><a href="/privacy.html">개인정보 처리방침</a><span>Mobalytics·Grinding Gear Games와 제휴하지 않은 도구입니다.</span></footer>
    </main>{toast && <div className="build-toast" role="status"><Check size={16}/>{toast}</div>}
  </div>
}

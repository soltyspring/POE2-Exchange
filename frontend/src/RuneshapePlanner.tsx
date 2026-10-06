import { useCallback, useMemo, useRef, useState } from 'react'
import { X, Undo2, RotateCcw } from 'lucide-react'
import data from './runeshapes.json'
import { matchRuneInventory, compareRuneCandidates, runeSelectionLimit, hasExcludedRune } from './runeshapeModel'
import { useMarketDialog } from './useMarketDialog'
import { UiButton } from './ui'
import './RuneshapePlanner.css'

type Quote = {name: string; price_divine: number; observed_at: number}
const byId = new Map(data.runes.map(r=>[r.id,r]))
const runeLimits=new Map(data.runes.map(r=>[r.id,runeSelectionLimit(data.recipes,r.id)]))
function Rune({id}: {id:string}) { const rune=byId.get(id); return <span className="rune-chip"><img src={rune?.icon} alt="" loading="lazy"/>{rune?.name || id}</span> }
export function RuneshapePlanner({onClose,markets}: {onClose:()=>void; markets: Quote[]}) {
  const ref=useRef<HTMLElement>(null)
  useMarketDialog(true,onClose,ref)
  const [excluded,setExcluded]=useState<string[]>(()=>{try{const stored=JSON.parse(sessionStorage.getItem('runeshape-excluded')||'[]');return Array.isArray(stored)?[...new Set(stored.filter((id:unknown)=>typeof id==='string'&&byId.has(id)))] as string[]:[]}catch{return []}})
  const [excludeMode,setExcludeMode]=useState(false)
  const [entered,setEntered]=useState<string[]>(()=>{try {const stored=JSON.parse(sessionStorage.getItem('runeshape-entered') || '[]'); return Array.isArray(stored) ? stored.filter((r:unknown,i:number,all:unknown[])=>typeof r==='string'&&byId.has(r)&&!excluded.includes(r)&&all.slice(0,i+1).filter(value=>value===r).length<=(runeLimits.get(r)||0)) : []}catch{return []}})
  const [query,setQuery]=useState(''), [reward,setReward]=useState('')
  const [slots,setSlots]=useState(''), [sort,setSort]=useState('recommended')
  const [selectionError,setSelectionError]=useState('')
  const [visibleCount,setVisibleCount]=useState(30)
  const change=useCallback((values:string[])=>{setSelectionError('');setEntered(values);try{sessionStorage.setItem('runeshape-entered',JSON.stringify(values))}catch{/* Storage may be unavailable */}},[])
  const changeExcluded=useCallback((values:string[])=>{setExcluded(values);setVisibleCount(30);try{sessionStorage.setItem('runeshape-excluded',JSON.stringify(values))}catch{/* Storage may be unavailable */}},[])
  const toggleExcluded=(id:string)=>{
    if(excluded.includes(id)){changeExcluded(excluded.filter(rune=>rune!==id));return}
    change(entered.filter(rune=>rune!==id));changeExcluded([...excluded,id])
  }
  const add=(id:string)=>{
    const limit=runeLimits.get(id)||0
    if(entered.filter(rune=>rune===id).length>=limit){
      setSelectionError(`${byId.get(id)?.name}: ${limit===1?'중복 선택할 수 없습니다. 조합표에 같은 룬을 두 번 사용하는 조합이 없습니다.':`최대 ${limit}개까지 선택할 수 있습니다.`}`)
      return
    }
    changeExcluded(excluded.filter(rune=>rune!==id));change([...entered,id]);setQuery('');setVisibleCount(30)
  }
  const quotes=useMemo(()=>{
    const unique=new Map<string,Quote>(), ambiguous=new Set<string>()
    for(const quote of markets){if(unique.has(quote.name))ambiguous.add(quote.name);unique.set(quote.name,quote)}
    for(const name of ambiguous)unique.delete(name)
    return unique
  },[markets])
  const matches=useMemo(()=>data.recipes.flatMap(recipe=>{
    const {remaining,available,matched}=matchRuneInventory(recipe.runes,entered)
    if(hasExcludedRune(recipe.runes,excluded) || (entered.length>0 && matched===0) || (slots && recipe.runes.length!==+slots) || !recipe.name.includes(reward.trim()))return []
    const quote=quotes.get(recipe.name), price=quote?.price_divine != null ? quote.price_divine*recipe.quantity : null
    return [{...recipe,remaining,available,matched,quote,price}]
  }).sort((a,b)=>sort==='price' ? (b.price ?? -1)-(a.price ?? -1) || a.remaining.length-b.remaining.length : compareRuneCandidates(a,b)),[entered,excluded,slots,reward,quotes,sort])
  const ranked=[...matches].sort(compareRuneCandidates)
  const complete=ranked.filter(recipe=>recipe.remaining.length===0)
  const recommended=entered.length ? [...complete.slice(0,1),...ranked.filter(recipe=>recipe.remaining.length>0).slice(0,complete.length?2:3)] : []
  const visible=matches.slice(0,visibleCount)
  const choices=data.runes.filter(r=>r.name.includes(query.trim()) || r.id.toLowerCase().includes(query.toLowerCase().trim()))
  return <section ref={ref} tabIndex={-1} className="runeshape-planner" role="dialog" aria-modal="true" aria-label="탐험 룬 조합">
    <header><div><h2>탐험 룬 조합</h2><p>발견한 룬을 기록하고, 지금 가능한 보상과 다음 목표를 비교하세요.</p></div><UiButton aria-label="탐험 룬 조합 닫기" onClick={onClose}><X size={20}/></UiButton></header>
    <div className="runeshape-layout"><aside>
      <label>룬 이름 검색<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="예: 화염, 지혜, 권능" onKeyDown={e=>{if(e.key==='Enter'&&choices.length===1){e.preventDefault();excludeMode?toggleExcluded(choices[0].id):add(choices[0].id)}}}/></label>
      <UiButton className="rune-exclude-mode" aria-pressed={excludeMode} onClick={()=>setExcludeMode(value=>!value)}>{excludeMode?'제외 선택 중 · 클릭하면 제외':'제외 선택 모드'}</UiButton>
      <div className="rune-options">{choices.map(r=><UiButton key={r.id} className={excluded.includes(r.id)?"is-excluded":""} title={`${r.name} · 클릭: ${excludeMode?'제외 전환':'보유 추가'} · 우클릭: 제외 전환`} onClick={()=>excludeMode?toggleExcluded(r.id):add(r.id)} onContextMenu={event=>{event.preventDefault();toggleExcluded(r.id)}}><Rune id={r.id}/></UiButton>)}{!choices.length&&<p>일치하는 룬이 없습니다.</p>}</div>
      <p className="rune-help">클릭은 보유 추가, 우클릭은 제외·해제입니다. 제외 모드에서는 클릭으로 제외할 수 있습니다. 선택한 룬 중 일부만 쓰는 조합도 추천합니다. 중복은 조합표의 최대 개수까지 허용합니다.</p>
      <a href={data.source} target="_blank" rel="noreferrer">PoE2DB 조합 원문 ↗</a><p className="rune-help">조합표 확인 {data.checkedAt} · {data.recipes.length}개 조합</p>
    </aside><div className="runeshape-content">
      <div className="rune-entry-head"><h3>보유한 룬 <small>{entered.length}개</small></h3><UiButton disabled={!entered.length} onClick={()=>change(entered.slice(0,-1))}><Undo2 size={14}/>되돌리기</UiButton><UiButton disabled={!entered.length&&!excluded.length} onClick={()=>{change([]);changeExcluded([])}}><RotateCcw size={14}/>새 맵</UiButton></div>
      {selectionError&&<p className="rune-selection-error" role="alert">{selectionError}</p>}
      <div className="rune-entered">{entered.map((id,i)=><button key={i} onClick={()=>change(entered.filter((_,j)=>j!==i))} aria-label={`${i+1}번째 ${byId.get(id)?.name} 제거`}><Rune id={id}/><X size={12}/></button>)}{!entered.length&&<p>왼쪽에서 첫 번째 룬을 선택하세요. 입력한 룬은 이 브라우저 탭에 저장됩니다.</p>}</div>
      <section className="rune-excluded" aria-label="제외한 룬"><div><h3>제외한 룬 <small>{excluded.length}개</small></h3>{excluded.length>0&&<UiButton onClick={()=>changeExcluded([])}>제외 모두 해제</UiButton>}</div><div>{excluded.map(id=><button key={id} aria-label={`${byId.get(id)?.name} 제외 해제`} onClick={()=>changeExcluded(excluded.filter(rune=>rune!==id))}><Rune id={id}/><X size={12}/></button>)}{!excluded.length&&<p>왼쪽 룬을 우클릭하면 여기에 표시됩니다. 이 룬이 필요한 조합은 숨깁니다.</p>}</div></section>
      <div className="rune-filters"><label>총 슬롯<select value={slots} onChange={e=>setSlots(e.target.value)}><option value="">전체</option>{Array.from({length:9},(_,i)=>i+2).map(n=><option key={n}>{n}</option>)}</select></label><label>정렬<select value={sort} onChange={e=>setSort(e.target.value)}><option value="recommended">추천 순 · 완성 가까운 순</option><option value="price">보상 시세 높은 순</option></select></label><label>보상 검색<input type="search" placeholder="신성한 오브 등" value={reward} onChange={e=>setReward(e.target.value)}/></label></div>
      <div className="rune-results-head"><strong aria-live="polite">관련 조합 {matches.length}개 · 룬 충족 {complete.length}개</strong><span>남는 룬은 무시합니다. 각 조합은 개별 후보이며 동시에 모두 만들 수 있다는 뜻은 아닙니다.</span></div>
      {recommended.length>0&&<section className="rune-recommendations" aria-label="추천 보상 패턴"><h3>지금 눈여겨볼 보상</h3><p>지금 룬을 충족한 최고 시세 보상과, 완성에 가까운 다음 목표를 보여줍니다. 필요한 룬 수가 같으면 시세가 높은 조합을 우선합니다.</p><div>{recommended.map((recipe,index)=><article key={recipe.id}><small>추천 {index+1} · {recipe.remaining.length?`룬 ${recipe.remaining.length}개 더 필요`:'보유 룬으로 조건 충족'}</small><strong>{recipe.name}{recipe.quantity>1&&` ×${recipe.quantity}`}</strong><span>{recipe.price!=null?`${recipe.price.toLocaleString('ko-KR',{maximumFractionDigits:3})} 신성`:'시세 미확인'} · {recipe.matched}/{recipe.runes.length}개 보유</span><div>{recipe.remaining.length?recipe.remaining.map((id,i)=><Rune key={i} id={id}/>):<span>지역·해금 조건을 확인하고 보상을 선택하세요.</span>}</div></article>)}</div></section>}
      <div className="rune-results">{visible.map(recipe=><article key={recipe.id}><div className="rune-reward"><div><a href={recipe.url} target="_blank" rel="noreferrer"><strong>{recipe.name}{recipe.quantity>1&&` ×${recipe.quantity}`} ↗</strong></a><small>{recipe.level} · {recipe.runes.length}슬롯</small></div><div><strong>{recipe.price!=null ? `${recipe.price.toLocaleString('ko-KR',{maximumFractionDigits:3})} 신성` : '시세 미확인'}</strong><small>{recipe.quote?`보상 총액 · ${new Date(recipe.quote.observed_at*1000).toLocaleString('ko-KR')}`:'정확히 일치하는 시세 없음'}</small></div></div><div className="rune-recipe">{recipe.runes.map((id,i)=><span key={i} className={recipe.available[i]?"rune-have":"rune-need"}><small>{recipe.available[i]?"✓":i+1}</small><Rune id={id}/></span>)}</div><div className="rune-missing"><strong>{recipe.remaining.length?`완성까지 필요한 룬 ${recipe.remaining.length}개`:'보유 룬으로 조건 충족'}</strong>{recipe.remaining.map((id,i)=><Rune key={i} id={id}/>)}</div></article>)}{!matches.length&&<div className="rune-empty"><h3>일치하는 조합이 없습니다</h3><p>보유·제외 룬, 총 슬롯·보상 검색 조건을 확인하세요.</p></div>}</div>
      {visibleCount<matches.length&&<UiButton className="rune-show-more" onClick={()=>setVisibleCount(count=>count+30)}>조합 더 보기 · {visible.length}/{matches.length}</UiButton>}
      <p className="rune-help">조합 일치는 보상 획득을 보장하지 않습니다. 게임 내 해금·지역 조건·전투 조건을 확인하세요. 시세는 거래 체결가가 아니며, 무작위 보상에는 가격을 추정하지 않습니다.</p>
    </div></div>
  </section>
}

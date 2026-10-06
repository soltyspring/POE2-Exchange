import { useCallback, useMemo, useRef, useState } from 'react'
import { X, Undo2, RotateCcw } from 'lucide-react'
import data from './runeshapes.json'
import { remainingRunes } from './runeshapeModel'
import { useMarketDialog } from './useMarketDialog'
import { UiButton } from './ui'
import './RuneshapePlanner.css'

type Quote = {name: string; price_divine: number; observed_at: number}
const byId = new Map(data.runes.map(r=>[r.id,r]))
function Rune({id}: {id:string}) { const rune=byId.get(id); return <span className="rune-chip"><img src={rune?.icon} alt="" loading="lazy"/>{rune?.name || id}</span> }
export function RuneshapePlanner({onClose,markets}: {onClose:()=>void; markets: Quote[]}) {
  const ref=useRef<HTMLElement>(null)
  useMarketDialog(true,onClose,ref)
  const [entered,setEntered]=useState<string[]>(()=>{try {const stored=JSON.parse(sessionStorage.getItem('runeshape-entered') || '[]'); return Array.isArray(stored) ? stored.filter((r:unknown)=>typeof r==='string'&&byId.has(r)).slice(0,10) : []}catch{return []}})
  const [query,setQuery]=useState(''), [reward,setReward]=useState(''), [mode,setMode]=useState<'sequence'|'contains'>('sequence')
  const [level,setLevel]=useState(''), [slots,setSlots]=useState(''), [sort,setSort]=useState('remaining')
  const change=useCallback((values:string[])=>{setEntered(values);try{sessionStorage.setItem('runeshape-entered',JSON.stringify(values))}catch{/* Storage may be unavailable */}},[])
  const add=(id:string)=>{if(entered.length<10){change([...entered,id]);setQuery('')}}
  const quotes=useMemo(()=>{
    const unique=new Map<string,Quote>(), ambiguous=new Set<string>()
    for(const quote of markets){if(unique.has(quote.name))ambiguous.add(quote.name);unique.set(quote.name,quote)}
    for(const name of ambiguous)unique.delete(name)
    return unique
  },[markets])
  const matches=useMemo(()=>data.recipes.flatMap(recipe=>{
    const remaining=remainingRunes(recipe.runes,entered,mode)
    if(!remaining || (level && (+level<recipe.minLevel || +level>recipe.maxLevel)) || (slots && recipe.runes.length!==+slots) || !recipe.name.includes(reward.trim()))return []
    const quote=quotes.get(recipe.name), price=quote?.price_divine != null ? quote.price_divine*recipe.quantity : null
    return [{...recipe,remaining,quote,price}]
  }).sort((a,b)=>sort==='price' ? (b.price ?? -1)-(a.price ?? -1) || a.remaining.length-b.remaining.length : a.remaining.length-b.remaining.length || (b.price ?? -1)-(a.price ?? -1)),[entered,mode,level,slots,reward,quotes,sort])
  const choices=data.runes.filter(r=>r.name.includes(query.trim()) || r.id.toLowerCase().includes(query.toLowerCase().trim()))
  return <section ref={ref} tabIndex={-1} className="runeshape-planner" role="dialog" aria-modal="true" aria-label="탐험 룬 조합">
    <header><div><h2>탐험 룬 조합</h2><p>게임의 룬 이름을 입력하거나 눌러 보상 후보를 좁히세요.</p></div><UiButton aria-label="탐험 룬 조합 닫기" onClick={onClose}><X size={20}/></UiButton></header>
    <div className="runeshape-layout"><aside>
      <label>룬 이름 검색<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="예: 화염, 지혜, 권능" onKeyDown={e=>{if(e.key==='Enter'&&choices.length===1){e.preventDefault();add(choices[0].id)}}}/></label>
      <div className="rune-options">{choices.map(r=><UiButton key={r.id} disabled={entered.length>=10} onClick={()=>add(r.id)}><Rune id={r.id}/></UiButton>)}{!choices.length&&<p>일치하는 룬이 없습니다.</p>}</div>
      <p className="rune-help">같은 룬을 다시 누르면 중복 개수가 반영됩니다. 최대 10개까지 입력합니다.</p>
      <a href={data.source} target="_blank" rel="noreferrer">PoE2DB 조합 원문 ↗</a><p className="rune-help">조합표 확인 {data.checkedAt} · {data.recipes.length}개 조합</p>
    </aside><div className="runeshape-content">
      <div className="rune-entry-head"><h3>입력한 룬 <small>{entered.length}/10</small></h3><UiButton disabled={!entered.length} onClick={()=>change(entered.slice(0,-1))}><Undo2 size={14}/>되돌리기</UiButton><UiButton disabled={!entered.length} onClick={()=>change([])}><RotateCcw size={14}/>새 맵</UiButton></div>
      <div className="rune-entered">{entered.map((id,i)=><button key={i} onClick={()=>change(entered.filter((_,j)=>j!==i))} aria-label={`${i+1}번째 ${byId.get(id)?.name} 제거`}><small>{i+1}</small><Rune id={id}/><X size={12}/></button>)}{!entered.length&&<p>왼쪽에서 첫 번째 룬을 선택하세요. 입력한 룬은 이 브라우저 탭에 저장됩니다.</p>}</div>
      <div className="rune-filters"><label>비교 방식<select value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="sequence">입력 순서 일치</option><option value="contains">보유 룬 포함 · 순서 무시</option></select></label><label>지역 레벨<input type="number" min="1" max="100" placeholder="전체" value={level} onChange={e=>setLevel(e.target.value)}/></label><label>총 슬롯<select value={slots} onChange={e=>setSlots(e.target.value)}><option value="">전체</option>{Array.from({length:9},(_,i)=>i+2).map(n=><option key={n}>{n}</option>)}</select></label><label>정렬<select value={sort} onChange={e=>setSort(e.target.value)}><option value="remaining">남은 룬 적은 순</option><option value="price">보상 시세 높은 순</option></select></label><label>보상 검색<input type="search" placeholder="신성한 오브 등" value={reward} onChange={e=>setReward(e.target.value)}/></label></div>
      <div className="rune-results-head"><strong aria-live="polite">가능한 조합 {matches.length}개</strong><span>{mode==='sequence'?'입력한 룬이 조합의 앞부분과 일치하는 후보':'입력한 룬의 종류와 개수를 모두 포함하는 후보'}</span></div>
      <div className="rune-results">{matches.map(recipe=><article key={recipe.id}><div className="rune-reward"><div><a href={recipe.url} target="_blank" rel="noreferrer"><strong>{recipe.name}{recipe.quantity>1&&` ×${recipe.quantity}`} ↗</strong></a><small>{recipe.level} · {recipe.runes.length}슬롯</small></div><div><strong>{recipe.price!=null ? `${recipe.price.toLocaleString('ko-KR',{maximumFractionDigits:3})} 신성` : '시세 미확인'}</strong><small>{recipe.quote?`보상 총액 · ${new Date(recipe.quote.observed_at*1000).toLocaleString('ko-KR')}`:'정확히 일치하는 시세 없음'}</small></div></div><div className="rune-recipe">{recipe.runes.map((id,i)=><span key={i}><small>{i+1}</small><Rune id={id}/></span>)}</div><div className="rune-missing"><strong>{recipe.remaining.length?`추가 ${recipe.remaining.length}개`:'입력 조건 충족'}</strong>{recipe.remaining.map((id,i)=><Rune key={i} id={id}/>)}</div></article>)}{!matches.length&&<div className="rune-empty"><h3>일치하는 조합이 없습니다</h3><p>입력 순서·중복 개수·지역 레벨·슬롯 조건을 확인하세요. 보유 룬을 비교하려면 순서 무시를 선택하세요.</p></div>}</div>
      <p className="rune-help">조합 일치는 보상 획득을 보장하지 않습니다. 게임 내 해금·지역 조건·전투 조건을 확인하세요. 시세는 거래 체결가가 아니며, 무작위 보상에는 가격을 추정하지 않습니다.</p>
    </div></div>
  </section>
}

import {useCallback,useEffect,useRef,useState} from 'react'
import {X} from 'lucide-react'
import {UiButton} from './ui'
import {useMarketDialog} from './useMarketDialog'
import './RitualTracker.css'
type Item={id:string;name:string;category:string;price_divine:number;icon:string|null}
type Entry={key:string;name:string;quantity:number;status:'seen'|'kept'|'deferred';price:number|null}
type Round={id:string;name:string;entries:Entry[];time:string}
const key='poe2-ritual-rounds-v1'
const empty=():Round=>({id:crypto.randomUUID(),name:'',entries:[],time:new Date().toISOString()})
function read(storageKey:string):Round[]{try{const value=JSON.parse(localStorage.getItem(storageKey)||'null');if(Array.isArray(value)&&value.length&&value.every(r=>typeof r.id==='string'&&Array.isArray(r.entries)&&r.entries.every((e:Entry)=>typeof e.name==='string'&&Number.isFinite(e.quantity)&&['seen','kept','deferred'].includes(e.status))))return value}catch{}return [empty()]}
export function RitualTracker({onClose,markets,league}:{onClose:()=>void;markets:Item[];league:string}){
 const ref=useRef<HTMLElement>(null),[rounds,setRounds]=useState(()=>read(key+league)),[active,setActive]=useState(rounds[0].id),[query,setQuery]=useState(''),[all,setAll]=useState(false),[unit,setUnit]=useState<'divine'|'exalted'>('divine'),[error,setError]=useState('')
 useMarketDialog(true,onClose,ref)
 useEffect(()=>{try{localStorage.setItem(key+league,JSON.stringify(rounds));setError('')}catch{setError('브라우저 저장에 실패했습니다. 기록을 다운로드해 주세요.')}},[rounds,league])
 const current=rounds.find(r=>r.id===active)||rounds[0]
 const update=useCallback((entries:Entry[])=>setRounds(rs=>rs.map(r=>r.id===current.id?{...r,entries}:r)),[current.id])
 const rate=markets.find(m=>m.id==='exchange:Currency:exalted')?.price_divine
 const price=(n:number|null)=>n===null?'시세 없음':unit==='exalted'&&!(rate&&rate>0)?'환율 없음':`${(unit==='exalted'?n/rate!:n).toLocaleString('ko-KR',{maximumFractionDigits:3})} ${unit==='exalted'?'엑잘':'신성'}`
 const add=(item?:Item)=>{const name=item?.name||query.trim();if(!name)return;update([...current.entries,{key:crypto.randomUUID(),name,quantity:1,status:'seen',price:item&&Number.isFinite(item.price_divine)?item.price_divine:null}]);setQuery('')}
 const choices=markets.filter(m=>(all||m.category==='Ritual')&&(!query||m.name.toLowerCase().includes(query.trim().toLowerCase()))).slice(0,90)
 const kept=current.entries.filter(e=>e.status==='kept'),total=kept.reduce((n,e)=>n+(e.price??0)*e.quantity,0)
 const download=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({league,exportedAt:new Date().toISOString(),rounds},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ritual-records.json';a.click();URL.revokeObjectURL(url)}
 return <section ref={ref} tabIndex={-1} className="ritual-tracker" role="dialog" aria-modal="true" aria-label="의식 보상 기록">
 <header><div><h2>의식 보상 기록</h2><p>이번 판에서 본 보상, 킵한 보상, 공물 연기한 보상을 기록하세요.</p></div><UiButton aria-label="의식 기록 닫기" onClick={onClose}><X/></UiButton></header>
 <div className="ritual-layout"><aside><label>보상 이름 검색<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="징조·화폐·장비 이름"/></label><label className="ritual-toggle"><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/>모든 아이템에서 찾기</label><div className="ritual-options">{choices.map(m=><UiButton key={m.id} onClick={()=>add(m)}>{m.icon&&<img src={m.icon} alt="" loading="lazy"/>}<span>{m.name}<small>{price(m.price_divine)}</small></span><b>＋</b></UiButton>)}</div>{!choices.length&&<p>검색 결과가 없습니다.</p>}{query.trim()&&<UiButton onClick={()=>add()}>“{query.trim()}” 직접 기록 · 시세 없음</UiButton>}<p>아이템을 누르면 이번 판에 추가됩니다. 희귀 장비는 이름을 직접 입력하세요.</p></aside>
 <main><div className="ritual-toolbar"><select aria-label="기록한 판" value={current.id} onChange={e=>setActive(e.target.value)}>{rounds.map((r,i)=><option key={r.id} value={r.id}>{r.name||`${rounds.length-i}번째 판`} · {new Date(r.time).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</option>)}</select><UiButton onClick={()=>{const r=empty();setRounds(rs=>[r,...rs]);setActive(r.id)}}>다음 판 시작</UiButton><UiButton onClick={download}>기록 다운로드</UiButton></div>
 <input aria-label="판 이름" placeholder="맵 이름·메모 입력" value={current.name} onChange={e=>setRounds(rs=>rs.map(r=>r.id===current.id?{...r,name:e.target.value}:r))}/>
 <div className="ritual-summary"><div><small>이번 판 킵</small><strong>{kept.reduce((n,e)=>n+e.quantity,0)}개 · {price(total)}</strong><small>시세 없는 보상 {kept.filter(e=>e.price===null).length}종은 합계에서 제외</small></div><div><UiButton aria-pressed={unit==='exalted'} onClick={()=>setUnit('exalted')}>엑잘</UiButton><UiButton aria-pressed={unit==='divine'} onClick={()=>setUnit('divine')}>신성</UiButton></div></div>
 {error&&<p role="alert">{error}</p>}
 {!current.entries.length?<div className="ritual-empty">왼쪽에서 이번 판에 나온 보상을 선택하세요.<br/>추가한 뒤 ‘킵’ 또는 ‘공물 연기’를 선택할 수 있습니다.</div>:current.entries.map(e=><article className="ritual-entry" key={e.key}><div><strong>{e.name}</strong><small>{price(e.price===null?null:e.price*e.quantity)} · 추가 당시 참고 시세</small></div><input type="number" min="1" max="999999" aria-label={`${e.name} 수량`} value={e.quantity} onChange={event=>{const quantity=Number(event.target.value);if(Number.isInteger(quantity)&&quantity>=1&&quantity<=999999)update(current.entries.map(x=>x.key===e.key?{...x,quantity}:x))}}/><div className="ritual-status">{(['seen','kept','deferred'] as const).map((s,i)=><UiButton key={s} aria-pressed={e.status===s} onClick={()=>update(current.entries.map(x=>x.key===e.key?{...x,status:s}:x))}>{['나옴','킵','공물 연기'][i]}</UiButton>)}</div><UiButton aria-label={`${e.name} 기록 삭제`} onClick={()=>update(current.entries.filter(x=>x.key!==e.key))}><X size={16}/></UiButton></article>)}
 <p className="ritual-note">기록은 이 기기 브라우저에 저장됩니다. 공물 연기는 실제 획득 합계에 포함되지 않습니다. 시세 합계는 참고 가치이며 공물 비용·실제 판매 수익을 계산하지 않습니다.</p>
 </main></div></section>
}


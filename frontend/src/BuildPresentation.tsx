import { useEffect, useState } from 'react'
import { Shield, Sparkles, Swords } from 'lucide-react'
import { UiButton } from './ui'
import type { BuildVariant, Equipment } from './buildExport'

function BuildIcon({url, label}: {url?: string | null; label: string}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  let safe = false
  try { const parsed = new URL(url || ''); safe = parsed.protocol === 'https:' && parsed.hostname === 'cdn.mobalytics.gg' } catch { /* No remote image */ }
  return safe && !failed ? <img src={url!} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : <span className="planner-icon-fallback" aria-label={label}><Shield size={23}/></span>
}

const layout = [
  ['mainHand', '주무기'], ['helmet','투구'], ['offHand','보조무기'], ['amulet','목걸이'], ['leftRing','왼쪽 반지'],
  ['body','갑옷'], ['rightRing','오른쪽 반지'], ['gloves','장갑'], ['belt','허리띠'], ['boots','장화'],
  ['flask1','생명력 플라스크'], ['charm1','부적 1'], ['charm2','부적 2'], ['charm3','부적 3'], ['flask2','마나 플라스크'],
] as const
const trees: Record<string,string> = {mainTree:'기본 패시브',set1Tree:'무기 세트 1',set2Tree:'무기 세트 2',ascendancyTree:'전직',
  breachTree:'균열',expeditionTree:'탐험',deliriumTree:'환영',ritualTree:'의식',bossTree:'보스',pinnacleBossTree:'최종 보스',abyssalTree:'심연'}

function ItemDetails({item}: {item: Equipment | undefined}) {
  return <article className="planner-item-detail" aria-live="polite">{item ? <>
    <div className="planner-item-title"><BuildIcon url={item.icon} label={item.name}/><div><span>{item.slot_label}</span><h3 className={item.unique ? 'unique' : ''}>{item.name}</h3><small>{item.unique ? '고유 장비' : item.item_class}</small></div></div>
    {item.stats.some(stat => stat.name && stat.value != null) && <div className="planner-item-stats">{item.stats.filter(stat => stat.name && stat.value != null).map((stat,index) => <span key={index}>{stat.name}: <strong>{stat.value}</strong></span>)}</div>}
    <ul>{item.implicit.map((mod,index) => <li className="implicit" key={`i${index}`}>{mod.description}</li>)}{item.explicit.map((mod,index) => <li key={`e${index}`}>{mod.description}{mod.mustHave && <small> · 필수 옵션</small>}</li>)}</ul>
    {item.requirements.some(stat => stat.name && stat.value != null) && <p className="planner-requirements">요구사항 · {item.requirements.filter(stat => stat.name && stat.value != null).map(stat => `${stat.name} ${stat.value}`).join(' · ')}</p>}
    {item.runes.length > 0 && <p className="build-muted">룬 · {item.runes.map(rune=>rune.slug).join(', ')}</p>}{item.anointment && <p className="build-muted">주입 · {item.anointment}</p>}
  </> : <div className="planner-detail-empty"><Shield size={28}/><h3>아이템을 선택하세요</h3><p>장비 아이콘을 누르면 옵션을 확인할 수 있습니다.</p></div>}</article>
}

export function BuildPresentation({variant}: {variant: BuildVariant}) {
  const [weaponSet,setWeaponSet] = useState(1)
  const [selectedSlot,setSelectedSlot] = useState('helmet')
  const selected = variant.equipment.find(item=>item.slot===selectedSlot)
  const switchSet = (set: number) => {setWeaponSet(set); if (selectedSlot.startsWith('mainHand.') || selectedSlot.startsWith('offHand.')) setSelectedSlot(selectedSlot.replace(/set[12]$/,`set${set}`))}
  return <div className="planner-sections">
    <section id="build-equipment" className="planner-panel"><header><h2><Swords size={19}/>장비</h2><span>아이콘을 눌러 옵션 확인</span></header>
      <div className="planner-equipment"><div className="planner-equipment-stage"><div className="planner-weapon-sets" role="group" aria-label="무기 세트"><UiButton aria-pressed={weaponSet===1} className={weaponSet===1?'active':''} onClick={()=>switchSet(1)}>세트 1</UiButton><UiButton aria-pressed={weaponSet===2} className={weaponSet===2?'active':''} onClick={()=>switchSet(2)}>세트 2</UiButton></div>
        <div className="planner-paperdoll">{layout.map(([slot,label])=>{
          const id = ['mainHand','offHand'].includes(slot) ? `${slot}.set${weaponSet}` : slot
          const item = variant.equipment.find(value=>value.slot===id)
          return <UiButton key={slot} className={`planner-slot slot-${slot} ${item?.unique?'unique':item?'rare':'empty'} ${selectedSlot===id?'selected':''}`} aria-pressed={selectedSlot===id} aria-label={item ? `${label} · ${item.name}` : `${label} · 장착 정보 없음`} title={item?.name || label} disabled={!item} onClick={()=>setSelectedSlot(id)}>
            {item ? <BuildIcon url={item.icon} label={item.name}/> : <Shield size={22}/>}
            <span className="planner-slot-label">{label}</span>{item?.runes.length ? <span className="planner-socket-count">{item.runes.length}</span> : null}
          </UiButton>
        })}</div>
        {variant.equipment.filter(item=>item.slot==='extraRing').map(item=><UiButton className="planner-extra-ring" key={item.slot} onClick={()=>setSelectedSlot(item.slot)}><BuildIcon url={item.icon} label={item.name}/>추가 반지</UiButton>)}
        <div className="planner-jewels"><span>주얼 <small>{variant.jewels.length}개</small></span><div>{variant.jewels.map((jewel,index)=><div className={`planner-jewel ${jewel.isUnique?'unique':''}`} key={index} title={`${jewel.jewelSlug} · ${jewel.nodeSlug}`}><BuildIcon url={jewel.iconURL} label={jewel.jewelSlug}/><small>{index+1}</small></div>)}</div></div>
      </div><ItemDetails item={selected}/></div>
    </section>
    <section id="build-skills" className="planner-panel"><header><h2><Sparkles size={19}/>젬·스킬</h2><span>{variant.skills.length}개</span></header><div className="planner-skills">
      <p className="planner-gem-requirements">보조 젬 요구사항 {variant.gem_requirements ? <><span>힘 <strong>{variant.gem_requirements.str}</strong></span><span>민첩 <strong>{variant.gem_requirements.dex}</strong></span><span>지능 <strong>{variant.gem_requirements.int}</strong></span></> : '미제공'}</p>
      {variant.skills.map((skill,index)=><details className="planner-skill" key={`${skill.slug}:${index}`} open><summary><span className="planner-active-icon"><BuildIcon url={skill.icon} label={skill.name}/></span><span><strong>{skill.name}</strong><small>{skill.level != null ? `Lv.${skill.level}` : '무기 제공·레벨 미제공'}{skill.weapon_set ? ` · ${skill.weapon_set}` : ''}</small></span><em>{skill.supports.length}개 연결</em></summary><div className="planner-supports">{skill.supports.map((support,i)=><div key={i} className="planner-support" title={support.name || support.gemSlug}><BuildIcon url={support.iconURL} label={support.name || support.gemSlug}/><span>{support.name || support.gemSlug}<small>{support.gemType || '하위 스킬'}</small></span></div>)}{!skill.supports.length && <span className="build-muted">연결된 보조·하위 스킬 없음</span>}</div></details>)}
      {!variant.skills.length && <p className="build-empty">저장된 스킬이 없습니다.</p>}
    </div></section>
    <section id="build-passives" className="planner-panel"><header><h2>패시브·주얼</h2><span>저장된 선택 노드</span></header><div className="planner-passives"><div className="planner-tree-stats">{Object.entries(variant.passives).map(([key,nodes])=><div key={key}><span>{trees[key]}</span><strong>{nodes.length}</strong></div>)}</div>
      {Object.entries(variant.passive_priority || {}).filter(([,nodes])=>nodes.length).map(([key,nodes])=><div className="planner-node-priority" key={key}><h3>{trees[key]} 주요 노드</h3><div>{nodes.map((node,index)=><div key={`${node.slug}:${index}`} title={node.description}><BuildIcon url={node.iconURL} label={node.name}/><span>{node.name || node.slug}</span></div>)}</div></div>)}
      <p className="build-muted">노드 개수는 소모 포인트와 다를 수 있습니다. 연결·좌표 데이터가 없어 트리 경로는 표시하지 않습니다.</p><div className="build-trees">{Object.entries(variant.passives).map(([key,nodes])=><details key={key}><summary>{trees[key]} · 노드 목록 <span>{nodes.length}개</span></summary><ul className="build-node-list">{nodes.map(node=><li key={node}>{node}</li>)}</ul></details>)}</div>
    </div></section>
    <section id="build-atlas" className="planner-panel"><header><h2>아틀라스</h2><span>{variant.counts.atlas}개 선택</span></header><div className="planner-passives">{Object.entries(variant.atlas).filter(([,nodes])=>nodes.length).map(([key,nodes])=><details key={key}><summary>{trees[key] || key} · {nodes.length}개</summary><ul>{nodes.map(node=><li key={node}>{node}</li>)}</ul></details>)}{!variant.counts.atlas && <p className="build-muted">마지막 구성에 저장된 아틀라스 노드가 없습니다.</p>}</div></section>
  </div>
}

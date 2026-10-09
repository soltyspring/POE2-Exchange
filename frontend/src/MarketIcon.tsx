import {useEffect,useState} from 'react'
import {Coins} from 'lucide-react'
export function MarketIcon({market,size='normal',eager=false}:{market:{id:string;league:string};size?:'normal'|'large';eager?:boolean}){
 const [failed,setFailed]=useState(false)
 const iconUrl=`/api/market-icon/${market.id.split('/').map(encodeURIComponent).join('/')}?league=${encodeURIComponent(market.league)}`
 useEffect(()=>setFailed(false),[iconUrl])
 return <span className={`market-icon ${size} ${failed?'fallback':'has-image'}`}>{failed?<Coins size={size==='large'?24:18} aria-hidden="true"/>:<img src={iconUrl} alt="" loading={size==='large'||eager?'eager':'lazy'} decoding="async" onError={()=>setFailed(true)}/>}</span>
}

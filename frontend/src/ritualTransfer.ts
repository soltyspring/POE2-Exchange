type Entry={key:string;name:string;quantity:number;status:'acquired'|'kept';price:number|null;originRoundId?:string;originEntryKey?:string;keptPrice?:number|null}
type Round={id:string;entries:Entry[]}
export function transferKept<T extends Round>(rounds:T[],sourceId:string,targetId:string,entryKey:string,quantity:number,newKey:string,price:number|null):T[]{
 const sourceIndex=rounds.findIndex(r=>r.id===sourceId),targetIndex=rounds.findIndex(r=>r.id===targetId)
 const entry=rounds[sourceIndex]?.entries.find(e=>e.key===entryKey)
 if(targetIndex<0||sourceIndex<=targetIndex||!entry||entry.status!=='kept'||!Number.isInteger(quantity)||quantity<1||quantity>entry.quantity)return rounds
 const acquired:Entry={...entry,key:newKey,quantity,status:'acquired',price,originRoundId:sourceId,originEntryKey:entryKey,keptPrice:entry.price}
 return rounds.map(r=>r.id===sourceId?{...r,entries:r.entries.flatMap(e=>e.key!==entryKey?[e]:e.quantity===quantity?[]:[{...e,quantity:e.quantity-quantity}])}:r.id===targetId?{...r,entries:[...r.entries,acquired]}:r)
}

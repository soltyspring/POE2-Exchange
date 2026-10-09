export type RitualCost = {divine:number;exalted:number;vaal:number;exaltedRate:number|null;vaalRate:number|null;at:string}
export function costInDivine(cost?:RitualCost):number|null {
 if(!cost)return 0
 if([cost.divine,cost.exalted,cost.vaal].some(n=>!Number.isFinite(n)||n<0))return null
 if(cost.exalted>0&&!(cost.exaltedRate!==null&&Number.isFinite(cost.exaltedRate)&&cost.exaltedRate>0))return null
 if(cost.vaal>0&&!(cost.vaalRate!==null&&Number.isFinite(cost.vaalRate)&&cost.vaalRate>0))return null
 return cost.divine+cost.exalted*(cost.exaltedRate??0)+cost.vaal*(cost.vaalRate??0)
}

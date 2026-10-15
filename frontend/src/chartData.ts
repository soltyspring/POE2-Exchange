type ChartCandle={time:number;open:number;high:number;low:number;close:number;samples:number}
/** A series must have unique, ascending timestamps and finite OHLC values. */
export function normalizeCandles(input:unknown):ChartCandle[]{
 if(!Array.isArray(input))return []
 const rows=new Map<number,ChartCandle>()
 for(const value of input){
  if(!value||typeof value!=='object')continue
  const c=value as ChartCandle
  if(!Number.isInteger(c.time)||c.time<=0||![c.open,c.high,c.low,c.close].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0))continue
  rows.set(c.time,{...c,high:Math.max(c.open,c.high,c.low,c.close),low:Math.min(c.open,c.high,c.low,c.close),samples:Number.isFinite(c.samples)?c.samples:0})
 }
 return [...rows.values()].sort((a,b)=>a.time-b.time)
}

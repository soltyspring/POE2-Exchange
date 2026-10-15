import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const source=await readFile(new URL('../src/chartData.ts',import.meta.url),'utf8')
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {normalizeCandles}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'))
const row=(time,close=2)=>({time,open:2,high:3,low:1,close,samples:1})
test('unsorted duplicate timestamps cannot crash chart setData',()=>{
 const result=normalizeCandles([row(180),row(60),row(180,2.5)])
 assert.deepEqual(result.map(r=>r.time),[60,180]);assert.equal(result[1].close,2.5)
})
test('rejects invalid candles and repairs OHLC bounds',()=>{
 const result=normalizeCandles([null,row(NaN),row(60,Infinity),row(120,5)])
 assert.equal(result.length,1);assert.equal(result[0].high,5)
 assert.deepEqual(normalizeCandles(null),[])
})

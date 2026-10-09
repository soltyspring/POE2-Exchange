import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const source=await readFile(new URL('../src/ritualCost.ts',import.meta.url),'utf8')
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {costInDivine}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'))
const cost={divine:2,exalted:100,vaal:50,exaltedRate:.002,vaalRate:.004,at:''}
test('converts and sums all three currencies',()=>assert.ok(Math.abs(costInDivine(cost)-2.4)<1e-10))
test('missing rates never silently omit spending',()=>assert.equal(costInDivine({...cost,vaalRate:null}),null))
test('zero foreign spending does not require rates',()=>assert.equal(costInDivine({...cost,exalted:0,vaal:0,exaltedRate:null,vaalRate:null}),2))
test('historical saved rates determine cost',()=>{assert.ok(Math.abs(costInDivine(cost)-2.4)<1e-10);assert.equal(cost.vaalRate,.004)})
test('legacy round without cost starts at zero',()=>assert.equal(costInDivine(),0))
test('invalid spending cannot produce a total',()=>assert.equal(costInDivine({...cost,divine:-1}),null))


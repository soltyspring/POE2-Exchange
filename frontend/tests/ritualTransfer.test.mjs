import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const source=await readFile(new URL('../src/ritualTransfer.ts',import.meta.url),'utf8')
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {transferKept}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'))
const rounds=[{id:'new',entries:[]},{id:'old',entries:[{key:'item',name:'징조',quantity:3,status:'kept',price:2}]}]
test('partial transfer subtracts kept copies and links acquired copies',()=>{const result=transferKept(rounds,'old','new','item',2,'received',4);assert.equal(result[1].entries[0].quantity,1);assert.equal(result[0].entries[0].quantity,2);assert.equal(result[0].entries[0].originRoundId,'old');assert.equal(result[0].entries[0].keptPrice,2);assert.equal(result[0].entries[0].price,4);assert.equal(rounds[1].entries[0].quantity,3)})
test('full transfer cannot be applied twice',()=>{const result=transferKept(rounds,'old','new','item',3,'received',null);assert.equal(result[1].entries.length,0);assert.equal(transferKept(result,'old','new','item',3,'duplicate',null),result)})
test('invalid quantity and destination do not mutate data',()=>{for(const q of [0,4,1.5])assert.equal(transferKept(rounds,'old','new','item',q,'received',2),rounds);assert.equal(transferKept(rounds,'old','old','item',1,'received',2),rounds)})

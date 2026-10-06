import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
const source=await readFile(new URL('../src/runeshapeModel.ts',import.meta.url),'utf8')
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {remainingRunes,runeSelectionLimit}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'))
const data=JSON.parse(await readFile(new URL('../src/runeshapes.json',import.meta.url),'utf8'))
test('sequence matching preserves order and rejects extra runes',()=>{
 assert.deepEqual(remainingRunes(['a','b','a'],['a','b'],'sequence'),['a'])
 assert.equal(remainingRunes(['a','b'],['b'],'sequence'),null)
 assert.equal(remainingRunes(['a'],['a','a'],'sequence'),null)
})
test('inventory matching consumes duplicates independently without mutating recipe',()=>{
 const recipe=['a','b','a']
 assert.deepEqual(remainingRunes(recipe,['a','a'],'contains'),['b'])
 assert.equal(remainingRunes(recipe,['a','a','a'],'contains'),null)
 assert.deepEqual(recipe,['a','b','a'])
 assert.deepEqual(remainingRunes(recipe,[],'contains'),recipe)
})
test('source snapshot contains complete valid combinations with unique IDs',()=>{
 assert.equal(data.recipes.length,322)
 assert.equal(new Set(data.recipes.map(r=>r.id)).size,322)
 const ids=new Set(data.runes.map(r=>r.id))
 for(const r of data.recipes){assert.ok(r.runes.length>=2&&r.runes.length<=10);assert.ok(r.runes.every(id=>ids.has(id)));assert.ok(r.minLevel<=r.maxLevel);assert.ok(r.quantity>=1)}
 const mirror=data.recipes.find(r=>r.name==='칼란드라의 거울')
 assert.ok(mirror)
 assert.deepEqual(remainingRunes(mirror.runes,mirror.runes,'sequence'),[])
})

test('duplicate selection limits follow actual recipes, including special ten-rune recipe',()=>{
 assert.equal(runeSelectionLimit(data.recipes,'Fire_Rune'),1)
 assert.equal(runeSelectionLimit(data.recipes,'Rage_Rune'),2)
 const bait=data.runes.find(r=>r.name==='Bait Rune')
 assert.equal(runeSelectionLimit(data.recipes,bait.id),10)
 assert.equal(runeSelectionLimit(data.recipes,'unknown'),0)
})

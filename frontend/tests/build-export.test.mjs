import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/buildExport.ts', import.meta.url), 'utf8')
const output = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022}}).outputText
const {isBuildLink, buildFilename, buildMarkdown, lastVariantBuild, EXAMPLE_BUILD} = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'))

test('last variant is identical across display and exports, without mutating the response', () => {
  const build = {analysis: {variants: [{id: 'first', populated: true}, {id: 'last', populated: false}], default_variant_id: 'first'},
    document: {data: {buildVariants: {values: [{id: 'first'}, {id: 'last'}]}}, content: [
      {__typename: 'NgfDocumentCmWidgetContentVariantsV1', data: {childrenVariants: [{id: 'first'}, {id: 'last'}]}}]}}
  const result = lastVariantBuild(build)
  assert.deepEqual(result.analysis.variants.map(v => v.id), ['last'])
  assert.equal(result.analysis.default_variant_id, 'last')
  assert.deepEqual(result.document.data.buildVariants.values.map(v => v.id), ['last'])
  assert.equal(result.document.content[0].data.childrenVariants.length, 1)
  assert.equal(build.document.data.buildVariants.values.length, 2)
  assert.deepEqual(lastVariantBuild({analysis: {variants: []}, document: {}}).analysis.variants, [])
})

test('build links require exact public host, HTTPS and POE2 build path', () => {
  assert.equal(isBuildLink(EXAMPLE_BUILD + '?utm_source=test'), true)
  for (const value of [EXAMPLE_BUILD.replace('https:', 'http:'), EXAMPLE_BUILD.replace('.gg/', '.gg.attacker/'),
    EXAMPLE_BUILD.replace('https://', 'https://user:secret@'), 'https://mobalytics.gg/poe-2/profile/user', 'javascript:alert(1)']) {
    assert.equal(isBuildLink(value), false)
  }
})
test('download names cannot become file paths and Markdown escapes upstream markup', () => {
  assert.equal(buildFilename('../../bad:name', '12345678-rest', 'json').includes('/'), false)
  const variant = {name: 'Final', equipment: [{slot_label: '투구', name: '<script>bad</script>', unique: false,
    implicit: [], explicit: [{description: 'line1\n# injected'}], runes: [], anointment: null}], skills: [], passives: {mainTree: ['a']}, jewels: [], atlas: {}}
  const build = {source_url: EXAMPLE_BUILD, fetched_at: '2026-10-05T00:00:00Z', analysis: {name: 'Build', author: 'Author', notes: ['Reference only']}}
  const md = buildMarkdown(build, variant)
  assert.equal(md.includes('<script>'), false)
  assert.equal(md.includes('\n# injected'), false)
  assert.ok(md.includes('투구'))
  assert.ok(md.includes(EXAMPLE_BUILD))
})

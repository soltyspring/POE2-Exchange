import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { adEligible, localAdPreview } from '../scripts/ad-policy.mjs'

const loadTs = async file => {
  const source = await readFile(new URL('../src/' + file, import.meta.url), 'utf8')
  const result = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}})
  return import('data:text/javascript;base64,' + Buffer.from(result.outputText).toString('base64'))
}
const model = await loadTs('productModel.ts')
const {request} = await loadTs('apiClient.ts')

test('bad storage cannot break the app or inject non-string favorite IDs', () => {
  const storage = value => ({getItem: () => value})
  assert.deepEqual(model.readStoredIds('key', storage('{broken')), [])
  assert.deepEqual(model.readStoredIds('key', storage('{"id":1}')), [])
  assert.deepEqual(model.readStoredIds('key', storage('[null,12,"a","a","b"]')), ['a', 'b'])
  assert.deepEqual(model.readStoredIds('key', {getItem: () => {throw new Error('blocked')}}), [])
})

test('quantity totals use unrounded prices and reject invalid or unreasonable counts', () => {
  assert.equal(model.quoteTotal(0.0001234, '1000'), 0.1234)
  assert.equal(model.quoteTotal(1.25, '12'), 15)
  for (const input of ['', '0', '-3', '1.5', '1e3', '1000001', 'Infinity']) assert.equal(model.quoteTotal(10, input), null)
  assert.equal(model.quoteTotal(null, '1'), null)
  assert.equal(model.quoteTotal(NaN, '1'), null)
})

test('one fresh category must not hide a stale category or invent a past next refresh', () => {
  const states = [
    {category: 'Currency', fetched_at: 9900, next_refresh_at: 10500, cache_state: 'fresh', error: null},
    {category: 'Ritual', fetched_at: 5000, next_refresh_at: 5900, cache_state: 'fresh', error: null},
  ]
  assert.equal(model.snapshotHealth(states, undefined, 10000).quality, 'stale')
  assert.equal(model.snapshotHealth(states, undefined, 10000).lastSuccess, 5000)
  assert.equal(model.snapshotHealth(states, 'Currency', 10000).quality, 'fresh')
  assert.equal(model.snapshotHealth(states, 'Ritual', 10000).nextRefresh, 0)
  assert.equal(model.snapshotHealth([], undefined, 10000).quality, 'unknown')
  assert.equal(model.snapshotHealth([{...states[0], error: '429'}], undefined, 10000).quality, 'error')
})

test('CSV is BOM-prefixed, escaped, and cannot execute upstream spreadsheet formulas', () => {
  const csv = model.observationCsv([{time: 0, open: 1, high: 2, low: 1, close: 2, samples: 2}], '=HYPERLINK("x")', '엑잘')
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'))
  assert.ok(csv.includes('1970-01-01T00:00:00.000Z'))
})

test('ad eligibility fails closed on unreviewed, loading, error and background screens', () => {
  const ready = {approved: true, reviewed: true, consentReady: true, contentType: 'editorial', hasContent: true}
  assert.equal(adEligible(ready), true)
  for (const change of [{approved:false}, {reviewed:false}, {consentReady:false}, {loading:true}, {error:true}, {overlay:true}, {background:true}, {hasContent:false}, {contentType:'navigation'}]) assert.equal(adEligible({...ready, ...change}), false)
  assert.equal(adEligible({}), false)
  assert.equal(localAdPreview('1', ''), true)
  assert.equal(localAdPreview('1', 'https://production.example'), false)
})

test('request timeout ends loading and aborts a hung request', async () => {
  const previous = globalThis.fetch
  let aborted = false
  globalThis.fetch = (_url, {signal}) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {aborted = true; reject(new DOMException('Aborted', 'AbortError'))})
  })
  try {
    await assert.rejects(request('/api/test', {}, 15), /응답이 늦어지고/)
    assert.equal(aborted, true)
  } finally {globalThis.fetch = previous}
})

test('timeout also protects stalled response bodies after headers arrive', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = (_url, {signal}) => {
    const body = new ReadableStream({start(controller) {signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')))}})
    return Promise.resolve(new Response(body, {status: 200}))
  }
  try {await assert.rejects(request('/api/test', {}, 15), /응답이 늦어지고/)}
  finally {globalThis.fetch = previous}
})

test('each content page exists without ad scripts and its internal links resolve', async () => {
  const pages = JSON.parse(await readFile(new URL('../content/pages.json', import.meta.url), 'utf8'))
  const publicPath = path.resolve(new URL('../public/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  for (const page of pages) {
    const html = await readFile(new URL('../public/' + page.path, import.meta.url), 'utf8')
    assert.ok(html.includes('<html lang="ko">'))
    assert.ok(html.includes('<meta name="description"'))
    assert.ok(!html.includes('pagead2.googlesyndication.com'))
    assert.ok(!html.includes('adsbygoogle'))
    assert.ok(page.sections.length >= 3)
    for (const link of html.matchAll(/href="(\/[^"#]*)"/g)) {
      if (link[1] === '/') continue
      await access(path.join(publicPath, link[1]))
    }
  }
})

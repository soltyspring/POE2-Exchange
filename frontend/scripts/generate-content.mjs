import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { localAdPreview } from './ad-policy.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pages = JSON.parse(await readFile(path.join(root, 'content/pages.json'), 'utf8'))
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const site = process.env.POE_PUBLIC_SITE_URL?.replace(/\/$/, '') || ''
if (site && (!/^https:\/\//.test(site) || new URL(site).pathname !== '/' || new URL(site).username || new URL(site).password || new URL(site).search || new URL(site).hash)) {
  throw new Error('POE_PUBLIC_SITE_URL must be a public HTTPS origin without credentials, a path or query')
}
const preview = localAdPreview(process.env.POE_AD_LAYOUT_PREVIEW, site)
const nav = `<a href="/guide/index.html">사용 가이드</a><a href="/methodology.html">데이터 기준</a><a href="/about.html">서비스 소개</a><a href="/contact.html">문의·제보</a>`
const footer = `<footer><div><a class="brand" href="/">POE2 <span>MARKET</span></a><p>게임의 가격과 시간을 이해하는 커뮤니티 도구.</p></div><nav>${nav}<a href="/privacy.html">개인정보 처리방침</a><a href="/terms.html">이용 안내</a></nav><small>Grinding Gear Games와 제휴하지 않은 서비스입니다. 가격은 실제 체결가와 다를 수 있습니다.</small></footer>`
function shell({title, description, route, body, reviewed = false}) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b121d"><title>${escape(title)} · POE2 MARKET</title><meta name="description" content="${escape(description)}"><meta name="robots" content="${site && reviewed ? 'index,follow' : 'noindex,follow'}">${site ? `<link rel="canonical" href="${escape(site + '/' + route)}">` : ''}<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/design-tokens.css"><link rel="stylesheet" href="/content.css"><link rel="manifest" href="/manifest.webmanifest"></head>
<body><a class="skip-link" href="#content">본문으로 건너뛰기</a><header><a class="brand" href="/">POE2 <span>MARKET</span></a><nav aria-label="주 메뉴">${nav}</nav><a class="dashboard-link" href="/">시세 대시보드 →</a></header><main id="content" tabindex="-1">${body}</main>${footer}</body></html>`
}
for (const page of pages) {
  const contents = page.sections.map((section, i) => `<section id="section-${i + 1}"><h2>${escape(section.heading)}</h2>${section.paragraphs.map(p => `<p>${escape(p)}</p>`).join('')}</section>`).join('')
  const toc = `<nav class="article-toc" aria-label="이 문서의 내용"><strong>이 문서에서</strong>${page.sections.map((section, i) => `<a href="#section-${i + 1}">${escape(section.heading)}</a>`).join('')}</nav>`
  const links = page.links?.length ? `<section><h2>관련 링크</h2><ul>${page.links.map(link => `<li><a href="${escape(link.href)}" target="_blank" rel="noopener noreferrer">${escape(link.label)} ↗</a></li>`).join('')}</ul></section>` : ''
  const related = page.path.startsWith('guide/') ? `<aside class="related"><strong>다음으로 읽기</strong><div>${pages.filter(other => other.path.startsWith('guide/') && other.path !== page.path).map(other => `<a href="/${other.path}"><small>${escape(other.category)}</small><span>${escape(other.title)} →</span></a>`).join('')}</div></aside>` : ''
  const adPreview = preview && page.path.startsWith('guide/') ? '<aside class="ad-layout-preview" aria-label="광고 배치 미리보기"><small>광고 · 로컬 배치 검토</small><span>본문과 분리된 예약 영역 · 실제 광고 요청 없음</span></aside>' : ''
  const body = `<div class="article-header"><a href="/guide/index.html">← 사용 가이드</a><span class="eyebrow">${escape(page.category)}</span><h1>${escape(page.title)}</h1><p class="lede">${escape(page.intro)}</p><div class="article-meta">문서 기준 2026.10.03 · ${page.reviewed ? '운영자 검토 완료' : '공개 전 운영자 검토본'}</div></div><div class="article-layout">${toc}<article>${contents}${links}<div class="article-note">가격 자료는 참고 정보입니다. 실제 거래 전 리그, 단위와 거래 조건을 확인하세요.</div>${related}${adPreview}</article></div>`
  const destination = path.join(root, 'public', page.path)
  await mkdir(path.dirname(destination), {recursive: true})
  await writeFile(destination, shell({title: page.title, description: page.description, route: page.path, body, reviewed: page.reviewed === true}))
}
const guidePages = pages.filter(page => page.path.startsWith('guide/'))
const body = `<div class="guide-heading"><span class="eyebrow">POE2 MARKET · GUIDE</span><h1>시세를 아는 것보다,<br>잘 읽는 것이 중요합니다.</h1><p>처음 찾은 아이템의 가치부터 구매 시간대 비교까지.<br>가격표 옆에 두고 읽는 서비스 사용 가이드입니다.</p></div><section class="guide-cards" aria-label="시세 가이드">${guidePages.map((page, i) => `<a href="/${page.path}"><small>0${i + 1} · ${escape(page.category)}</small><h2>${escape(page.title)}</h2><p>${escape(page.description)}</p><span>가이드 읽기 →</span></a>`).join('')}</section><section class="guide-method"><div><h2>시세의 출처와 한계가 궁금하다면</h2><p>1분 관측, 화폐 환산, 시간대 편차와 공식 거래량을 어떻게 구분하는지 설명합니다.</p></div><a href="/methodology.html">데이터·산정 방식 →</a></section>`
await mkdir(path.join(root, 'public/guide'), {recursive: true})
await writeFile(path.join(root, 'public/guide/index.html'), shell({title: '시세 이용 가이드', description: 'POE2 시세 읽기, 구매 시간대, 콘텐츠 보상과 화폐 단위를 이해하는 사용 가이드.', route: 'guide/index.html', body, reviewed: guidePages.every(page => page.reviewed === true)}))
await writeFile(path.join(root, 'public/robots.txt'), 'User-agent: *\nAllow: /\nDisallow: /api/\n' + (site ? `Sitemap: ${site}/sitemap.xml\n` : ''))
const indexedRoutes = [...(guidePages.every(page => page.reviewed === true) ? ['guide/index.html'] : []), ...pages.filter(page => page.reviewed === true).map(page => page.path)]
await writeFile(path.join(root, 'public/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${site ? indexedRoutes.map(route => `<url><loc>${escape(site + '/' + route)}</loc></url>`).join('') : ''}</urlset>`)
console.log(`Generated ${pages.length + 1} static content pages. Live advertising is disabled.${site ? '' : ' Indexing is disabled until POE_PUBLIC_SITE_URL is configured.'}`)

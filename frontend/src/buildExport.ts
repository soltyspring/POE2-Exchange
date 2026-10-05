export type Equipment = {slot: string; slot_label: string; name: string; unique: boolean; item_class: string | null;
  explicit: {description: string; mustHave?: boolean}[]; implicit: {description: string}[];
  stats: {name: string; value: string | number}[]; requirements: {name: string; value: string | number}[];
  runes: {slug: string}[]; anointment: string | null}
export type Skill = {name: string; slug: string; level: number | null; weapon_set: string | null;
  supports: {gemSlug: string; gemType?: string}[]}
export type BuildVariant = {id: string; name: string; populated: boolean; equipment: Equipment[]; skills: Skill[];
  gem_requirements: {dex: number; str: number; int: number} | null;
  passives: Record<string, string[]>; atlas: Record<string, string[]>;
  jewels: {jewelSlug: string; nodeSlug: string; isUnique: boolean}[];
  counts: {equipment: number; unique: number; skills: number; supports: number; passives: number; ascendancy: number; jewels: number; atlas: number}}
export type ImportedBuild = {build_id: string; fetched_at: string; cached: boolean; cache_seconds: number; source_url: string;
  document: Record<string, unknown>; analysis: {name: string; author: string; updated_at: string | number | null;
  default_variant_id: string | null; has_pob: boolean; has_loot_filter: boolean; notes: string[]; variants: BuildVariant[]}}

export const EXAMPLE_BUILD = 'https://mobalytics.gg/poe-2/profile/iron-key-im2mtp/builds/ceb4700a-5adb-4162-be37-b0593958aff3'

/** Last in the author's published order; do not substitute an earlier nonempty variant. */
export function lastVariantBuild(build: ImportedBuild): ImportedBuild {
  const last = build.analysis.variants.at(-1)
  const document = structuredClone(build.document)
  const data = document.data as Record<string, unknown> | undefined
  if (data?.buildVariants) {
    const variants = data.buildVariants as {values?: {id: string}[]}
    variants.values = (variants.values || []).filter(item => item.id === last?.id)
  }
  if (Array.isArray(document.content)) {
    for (const widget of document.content) {
      if (widget.__typename === 'NgfDocumentCmWidgetContentVariantsV1' && widget.data?.childrenVariants) {
        widget.data.childrenVariants = widget.data.childrenVariants.filter((item: {id: string}) => item.id === last?.id)
      }
    }
  }
  return {...build, document, analysis: {...build.analysis, default_variant_id: last?.id || null, variants: last ? [last] : []}}
}

export function isBuildLink(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && ['mobalytics.gg', 'www.mobalytics.gg'].includes(url.hostname) &&
      !url.username && !url.password && (!url.port || url.port === '443') &&
      /^\/poe-2\/profile\/[A-Za-z0-9_-]+\/builds\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/?$/i.test(url.pathname)
  } catch { return false }
}

export function buildFilename(name: string, id: string, extension: string): string {
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 80) || 'build'
  return `${safe}-${id.slice(0, 8)}.${extension}`
}

// The text export is literal source data, not generated combat-performance advice.
export function buildMarkdown(build: ImportedBuild, variant: BuildVariant): string {
  const text = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/([\\`*_\[\]<>#])/g, '\\$1')
  const lines = [`# ${text(build.analysis.name)}`, '', `작성자: ${text(build.analysis.author)}`,
    `구성: ${text(variant.name)}`, `구성 ID: ${text(variant.id)}`, `출처: ${build.source_url}`, `조회 시각 (UTC): ${build.fetched_at}`, '',
    '## 읽기 기준', ...build.analysis.notes.map(note => `- ${text(note)}`), '', '## 장비']
  if (!variant.equipment.length) lines.push('저장된 장비가 없습니다.')
  for (const item of variant.equipment) {
    lines.push('', `### ${text(item.slot_label)} · ${text(item.name)}${item.unique ? ' (고유)' : ''}`)
    lines.push(...item.implicit.map(mod => `- 고정: ${text(mod.description)}`), ...item.explicit.map(mod => `- ${text(mod.description)}`))
    if (item.runes.length) lines.push(`- 룬: ${item.runes.map(rune => text(rune.slug)).join(', ')}`)
    if (item.anointment) lines.push(`- 주입: ${text(item.anointment)}`)
  }
  lines.push('', '## 젬·스킬')
  if (!variant.skills.length) lines.push('저장된 젬·스킬이 없습니다.')
  for (const skill of variant.skills) lines.push(`- ${text(skill.name)}${skill.level != null ? ` · Lv.${skill.level}` : ''}${skill.weapon_set ? ` · ${text(skill.weapon_set)}` : ''}`,
    ...skill.supports.map(support => `  - ${text(support.gemSlug)}${support.gemType ? ` (${text(support.gemType)})` : ''}`))
  const labels: Record<string, string> = {mainTree: '기본 패시브', set1Tree: '무기 세트 1', set2Tree: '무기 세트 2', ascendancyTree: '전직'}
  lines.push('', '## 패시브')
  for (const [key, nodes] of Object.entries(variant.passives)) lines.push('', `### ${labels[key] || text(key)} · ${nodes.length}개`, ...nodes.map(node => `- ${text(node)}`))
  lines.push('', '## 주얼', ...variant.jewels.map(jewel => `- ${text(jewel.jewelSlug)} · 위치 ${text(jewel.nodeSlug)}`), '', '## 아틀라스')
  for (const [key, nodes] of Object.entries(variant.atlas)) if (nodes.length) lines.push('', `### ${text(key)}`, ...nodes.map(node => `- ${text(node)}`))
  return lines.join('\n') + '\n'
}

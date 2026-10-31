// Converts TibiaWiki wikitext into plain text, keeping infobox data
// (e.g. "hp: 8200", "fireDmgMod: 0%") and section titles.

// Template parameters that only matter for rendering.
const DROP_PARAMS = new Set([
  'list',
  'getvalue',
  'scene',
  'image',
  'article',
  'actualname',
  'plural',
  'sounds',
  'primarytype',
  'secondarytype'
])
const DROP_TEMPLATES = new Set(['scene', 'stub', 'sic', 'clear', 'toc', 'spoiler', 'missing'])

// Infobox fields that only add noise to the indexed text: engine flags and ids. Half the chunks used to be
// flattened infoboxes, whose vectors look alike and match vague questions. The structured tables keep the
// numbers; the text keeps what reads like prose (notes, behaviour, strategy, location) and the core stats.
const NOISE_PARAMS = new Set([
  'name',
  'illusionable',
  'spawntype',
  'pushable',
  'pushobjects',
  'walksaround',
  'walksthrough',
  'paraimmune',
  'senseinvis',
  'healmod',
  'bestiaryname',
  'implemented',
  'race_id',
  'runsat',
  'isarenaboss',
  'usespells',
  'usedelements',
  'mitigation',
  // NPC infoboxes (ship captains): map coordinates and flags.
  'posx',
  'posy',
  'posz',
  'buysell'
])
// Creature loot lists go to the creature block in the chat (TibiaData loot, with rarities).
const CREATURE_ONLY_NOISE = new Set(['loot'])

// Creature infoboxes give "% of damage taken" per element (e.g. holyDmgMod = 112%).
// Small models misread that, so we summarize it as weaknesses/resistances/immunities.
const ELEMENT_NAMES: Record<string, string> = {
  physical: 'physical',
  earth: 'earth',
  fire: 'fire',
  death: 'death',
  energy: 'energy',
  holy: 'holy',
  ice: 'ice',
  hpdrain: 'life drain',
  drown: 'drown'
}

export interface DamageModLabels {
  header: string
  weak: string
  resistant: string
  immune: string
}

// Labels for the stored `damage` column (an internal pt-BR key); the chat re-renders the summary in the
// app language from damageMods.
const PT_DAMAGE_LABELS: DamageModLabels = {
  header: 'dano recebido por elemento (acima de 100% = fraqueza, 0% = imune):',
  weak: 'fraquezas',
  resistant: 'resistências',
  immune: 'imunidades'
}

// The indexed text is English only, like the wiki: mixed languages blur the embeddings.
const EN_DAMAGE_LABELS: DamageModLabels = {
  header: 'damage taken per element (above 100% = weakness, 0% = immune):',
  weak: 'weaknesses',
  resistant: 'resistances',
  immune: 'immunities'
}

export function summarizeDamageMods(params: [string, string][], labels = PT_DAMAGE_LABELS): string[] {
  const weak: string[] = []
  const resistant: string[] = []
  const immune: string[] = []
  for (const [key, val] of params) {
    const m = /^(\w+)DmgMod$/i.exec(key)
    const pct = parseFloat(val)
    if (!m || Number.isNaN(pct)) continue
    const element = ELEMENT_NAMES[m[1].toLowerCase()] ?? m[1]
    if (pct > 100) weak.push(`${element} (${pct}%)`)
    else if (pct === 0) immune.push(element)
    else if (pct < 100) resistant.push(`${element} (${pct}%)`)
  }
  const lines = (
    [
      [labels.weak, weak],
      [labels.resistant, resistant],
      [labels.immune, immune]
    ] as const
  )
    .filter(([, list]) => list.length)
    .map(([label, list]) => `${label}: ${list.join(', ')}`)
  return lines.length ? [labels.header, ...lines] : []
}

function flattenTemplate(inner: string): string {
  const parts = inner.split('|')
  const name = parts[0].trim()
  const lname = name.toLowerCase()
  if (DROP_TEMPLATES.has(lname)) return ''
  const isInfobox = lname.startsWith('infobox')
  const isCreatureBox = isInfobox && /creature|boss/.test(lname)
  const out: string[] = []
  const named: [string, string][] = []
  for (const raw of parts.slice(1)) {
    const p = raw.trim()
    if (!p) continue
    const eq = p.indexOf('=')
    if (eq > 0 && /^[\w\s]+$/.test(p.slice(0, eq))) {
      const key = p.slice(0, eq).trim()
      const val = p.slice(eq + 1).trim()
      if (!val || val === '--' || DROP_PARAMS.has(key.toLowerCase())) continue
      named.push([key, val])
      // In the infobox, the DmgMod values become the summary below instead of loose lines.
      if (isInfobox && /DmgMod$/i.test(key)) continue
      if (isInfobox && NOISE_PARAMS.has(key.toLowerCase())) continue
      if (isCreatureBox && CREATURE_ONLY_NOISE.has(key.toLowerCase())) continue
      out.push(isInfobox ? `${key}: ${val}` : `${key} ${val}`)
    } else {
      out.push(p)
    }
  }
  // The summary goes first so it lands in the same chunk as HP and exp.
  if (isInfobox) return `\n${[...summarizeDamageMods(named, EN_DAMAGE_LABELS), ...out].join('\n')}\n`
  return out.length ? `${name}: ${out.join(', ')}` : ''
}

// Returns the content between the braces of the first {{Name ...}}, honoring nested templates.
export function extractTemplate(src: string, name: string): string | null {
  const re = new RegExp(`\\{\\{\\s*${name.replace(/ /g, '[ _]')}\\s*[|}]`, 'i')
  const m = re.exec(src)
  if (!m) return null
  let depth = 0
  for (let i = m.index; i < src.length - 1; i++) {
    if (src[i] === '{' && src[i + 1] === '{') {
      depth++
      i++
    } else if (src[i] === '}' && src[i + 1] === '}') {
      depth--
      i++
      if (depth === 0) return src.slice(m.index + 2, i - 1)
    }
  }
  return null
}

// Splits a template's parameters on "|" without breaking nested templates and links.
export function splitTopLevel(inner: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2)
    if (two === '{{' || two === '[[') {
      depth++
      i++
    } else if (two === '}}' || two === ']]') {
      depth--
      i++
    } else if (inner[i] === '|' && depth === 0) {
      parts.push(inner.slice(start, i))
      start = i + 1
    }
  }
  parts.push(inner.slice(start))
  return parts
}

// Named parameters of a template, with the values' original wikitext.
export function parseTemplateRaw(src: string, name: string): Map<string, string> | null {
  const inner = extractTemplate(src, name)
  if (inner === null) return null
  const params = new Map<string, string>()
  for (const part of splitTopLevel(inner).slice(1)) {
    const eq = part.indexOf('=')
    if (eq > 0) params.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim())
  }
  return params
}

// Named parameters of an infobox, with the values already converted to plain text.
export function parseInfobox(src: string, name: string): Map<string, string> | null {
  const raw = parseTemplateRaw(src, name)
  if (!raw) return null
  const params = new Map<string, string>()
  for (const [key, rawValue] of raw) {
    const value = wikitextToPlain(rawValue).trim()
    if (value && value !== '--') params.set(key, value)
  }
  return params
}

export function isRedirect(src: string): boolean {
  return /^\s*#redirect/i.test(src)
}

export function wikitextToPlain(src: string): string {
  let s = src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<gallery[\s\S]*?<\/gallery>/gi, '')
    .replace(/\{\{\{[^{}]*\}\}\}/g, '')
    .replace(/__[A-Z]+__/g, '')
    // Links
    .replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/[^\s\]]+\s([^\]]*)\]/g, '$1')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')

  // Flattens templates from the inside out.
  let prev: string
  do {
    prev = s
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, inner: string) => flattenTemplate(inner))
  } while (s !== prev)

  return s
    .replace(/^(={2,6})\s*(.+?)\s*\1\s*$/gm, '\n## $2\n')
    .replace(/'''''|'''|''/g, '')
    // Wiki tables
    .replace(/^\s*(\{\||\|\}|\|-).*$/gm, '')
    .replace(/^\s*[|!]\s*/gm, '')
    .replace(/\s*(\|\||!!)\s*/g, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

// What each category's pages are, for the context line embedded with every chunk ("Hydra (creature) —
// Strategy"). A chunk alone often does not say what it is about; the line places it, as in Anthropic's
// contextual retrieval, without an LLM call.
const CATEGORY_KIND: Record<string, string> = {
  Creatures: 'creature',
  Bosses: 'boss',
  'Hunting Places': 'hunting place',
  'Quest Overview Pages': 'quest',
  Spells: 'spell',
  Achievements: 'achievement',
  Guias: 'game mechanics guide',
  'Ship Captain NPCs': 'ship captain NPC, travel routes'
}

export function chunkContext(title: string, category: string, heading: string): string {
  const kind = CATEGORY_KIND[category]
  return `${title}${kind ? ` (${kind})` : ''} — ${heading}`
}

export interface TextChunk {
  heading: string
  text: string
}

const MAX_CHARS = 1200

// Splits by section and groups paragraphs up to ~MAX_CHARS.
export function chunkText(plain: string): TextChunk[] {
  const chunks: TextChunk[] = []
  const sections = plain.split(/^## /m)
  sections.forEach((section, i) => {
    let heading = 'Overview'
    let body = section
    if (i > 0) {
      const nl = section.indexOf('\n')
      heading = (nl === -1 ? section : section.slice(0, nl)).trim()
      body = nl === -1 ? '' : section.slice(nl + 1)
    }
    let buf = ''
    const flush = (): void => {
      if (buf.trim()) chunks.push({ heading, text: buf.trim() })
      buf = ''
    }
    for (const para of body.split(/\n\n+/)) {
      if (buf.length + para.length > MAX_CHARS) flush()
      if (para.length > MAX_CHARS) {
        for (let k = 0; k < para.length; k += MAX_CHARS) {
          buf = para.slice(k, k + MAX_CHARS)
          flush()
        }
      } else {
        buf += (buf ? '\n\n' : '') + para
      }
    }
    flush()
  })
  return chunks
}

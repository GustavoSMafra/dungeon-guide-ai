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

export function summarizeDamageMods(params: [string, string][]): string[] {
  const groups = { fraquezas: [] as string[], resistências: [] as string[], imunidades: [] as string[] }
  for (const [key, val] of params) {
    const m = /^(\w+)DmgMod$/i.exec(key)
    const pct = parseFloat(val)
    if (!m || Number.isNaN(pct)) continue
    const element = ELEMENT_NAMES[m[1].toLowerCase()] ?? m[1]
    if (pct > 100) groups.fraquezas.push(`${element} (${pct}%)`)
    else if (pct === 0) groups.imunidades.push(element)
    else if (pct < 100) groups.resistências.push(`${element} (${pct}%)`)
  }
  const lines = Object.entries(groups)
    .filter(([, list]) => list.length)
    .map(([label, list]) => `${label}: ${list.join(', ')}`)
  return lines.length
    ? ['dano recebido por elemento (acima de 100% = fraqueza, 0% = imune):', ...lines]
    : []
}

function flattenTemplate(inner: string): string {
  const parts = inner.split('|')
  const name = parts[0].trim()
  const lname = name.toLowerCase()
  if (DROP_TEMPLATES.has(lname)) return ''
  const isInfobox = lname.startsWith('infobox')
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
      out.push(isInfobox ? `${key}: ${val}` : `${key} ${val}`)
    } else {
      out.push(p)
    }
  }
  // The summary goes first so it lands in the same chunk as HP and exp.
  if (isInfobox) return `\n${[...summarizeDamageMods(named), ...out].join('\n')}\n`
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
    let heading = 'Resumo'
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

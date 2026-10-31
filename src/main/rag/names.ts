// Finds known names (items, page titles, creatures) in free text: case-insensitive, whole words, longest
// match first, so "Magic Plate Armor" wins over "Plate Armor" and a name inside a longer match does not
// count. A plural "s"/"es" after a name still matches ("Ancient Scarabs").

export interface NameMatcher {
  find(text: string): string[]
  // Lower-cased forms, longest first (for callers that need their own containment checks).
  entries: { name: string; lower: string }[]
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[a-z0-9]/.test(c)

export function containsWord(outer: string, inner: string): boolean {
  let at = outer.indexOf(inner)
  while (at !== -1) {
    if (!isWordChar(outer[at - 1]) && !isWordChar(outer[at + inner.length])) return true
    at = outer.indexOf(inner, at + 1)
  }
  return false
}

// Ways a page title is written in questions: "The Inquisition Quest" → "Inquisition Quest", "Inquisition";
// "The Djinn War - Efreet Faction" → "The Djinn War", "Djinn War"; "Goroma/Dragon Lairs" → "Goroma";
// "The Market (Object)" → "The Market", "Market". Several titles can share an alias (both Djinn War pages).
export function titleAliases(title: string): string[] {
  const out = new Set<string>([title])
  const add = (s: string): void => {
    const t = s.trim()
    if (!t) return
    out.add(t)
    const noThe = t.replace(/^the\s+/i, '')
    out.add(noThe)
    for (const base of [t, noThe]) {
      const noQuest = base.replace(/\s+quest$/i, '')
      if (noQuest !== base) out.add(noQuest)
    }
  }
  add(title.replace(/\s*\([^)]*\)\s*$/, ''))
  add(title.replace(/\s+-\s+.*$/, ''))
  if (title.includes('/')) add(title.slice(0, title.indexOf('/')))
  return [...out].filter((a) => a.length >= 4)
}

// `aliases` maps each searchable form to the canonical name it stands for; an alias may map to several.
export function createMatcher(aliases: [alias: string, name: string][]): NameMatcher {
  const byAlias = new Map<string, string[]>()
  for (const [alias, name] of aliases) {
    const key = alias.toLowerCase()
    const list = byAlias.get(key) ?? []
    if (!list.includes(name)) list.push(name)
    byAlias.set(key, list)
  }
  const keys = [...byAlias.keys()].sort((a, b) => b.length - a.length)
  return {
    entries: keys.flatMap((lower) => (byAlias.get(lower) ?? []).map((name) => ({ name, lower }))),
    find(text) {
      const lower = text.toLowerCase()
      const taken: [number, number][] = []
      const found: string[] = []
      for (const n of keys) {
        let at = lower.indexOf(n)
        while (at !== -1) {
          let end = at + n.length
          // Plural: "scarabs", "cyclopses" (but not "scarabsomething").
          if (lower.startsWith('es', end) && !isWordChar(lower[end + 2])) end += 2
          else if (lower[end] === 's' && !isWordChar(lower[end + 1])) end += 1
          if (!isWordChar(lower[at - 1]) && !isWordChar(lower[end]) && !taken.some(([s, e]) => at < e && end > s)) {
            taken.push([at, end])
            for (const name of byAlias.get(n) ?? []) if (!found.includes(name)) found.push(name)
          }
          at = lower.indexOf(n, at + 1)
        }
      }
      return found
    }
  }
}

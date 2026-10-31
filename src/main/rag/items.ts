import { getDb, getMeta, setMeta } from '../db'
import { item as fetchItem, itemPage, type ApiItem } from '../tibiadata'
import { containsWord, createMatcher, type NameMatcher } from './names'
import { invalidateKnownNames } from './verify'

// Items are not indexed as wiki pages (6,000+ pages of little text). The app keeps only their names, to
// spot an item in a question, and fetches the item's details (who drops it, NPCs, market) live. That
// gives the model the exact item asked about instead of look-alike excerpts: a question about Magic
// Plate Armor used to get the "Plate Armor Quest", and the model said that quest gives it.

const CONCURRENCY = 6
const STALE_MS = 7 * 24 * 60 * 60 * 1000

let matcher: NameMatcher | null = null

function loadMatcher(): NameMatcher {
  if (matcher) return matcher
  const db = getDb()
  // Names shared with creatures ("Demon", "Hydra"...) would make every creature question an item question.
  const creatures = new Set(
    (db.prepare('SELECT name FROM creatures UNION SELECT name FROM api_creatures').all() as { name: string }[]).map(
      (r) => r.name.toLowerCase()
    )
  )
  const names = (db.prepare('SELECT name FROM api_items').all() as { name: string }[])
    .map((r) => r.name)
    // Disambiguated titles ("Ham (Item)") never appear like that in a question.
    .filter((n) => n.length >= 4 && !n.includes('(') && !creatures.has(n.toLowerCase()))
  matcher = createMatcher(names.map((n) => [n, n]))
  return matcher
}

// Item names in a text, longest match first; a name inside a longer match does not count.
export function findItems(text: string): string[] {
  return loadMatcher().find(text)
}

// Other items whose name contains this one or is contained in it ("Plate Armor" ↔ "Magic Plate Armor").
// They are different items that semantic search and small models mix up. Single words ("Armor") are
// left out: they would match half the item list.
export function similarItems(name: string, max = 5): string[] {
  const n = name.toLowerCase()
  return loadMatcher()
    .entries.filter((i) => i.lower !== n && i.lower.includes(' ') && (containsWord(n, i.lower) || containsWord(i.lower, n)))
    .slice(0, max)
    .map((i) => i.name)
}

// True when a page title is about a similar item but not this one (e.g. "Plate Armor Quest" for
// Magic Plate Armor): such excerpts are dropped from the context.
export function aboutOtherItem(title: string, name: string): boolean {
  const t = title.toLowerCase()
  if (findItems(title).some((i) => i.toLowerCase() === name.toLowerCase())) return false
  return similarItems(name, 50).some((s) => t.includes(s.toLowerCase()))
}

const details = new Map<string, Promise<ApiItem | null>>()

// Live lookup, cached for the session. Null when the API is down or does not know the item.
export function itemDetails(name: string): Promise<ApiItem | null> {
  const key = name.toLowerCase()
  let p = details.get(key)
  if (!p) {
    p = fetchItem(name).catch(() => {
      details.delete(key)
      return null
    })
    details.set(key, p)
  }
  return p
}

export function itemNamesStale(): boolean {
  const synced = getMeta('itemsSyncedAt')
  return !synced || Date.now() - Date.parse(synced) > STALE_MS
}

// Downloads the item name list (100 per page, a few pages in parallel). The table is only replaced
// when every page arrived.
export async function syncItemNames(): Promise<number> {
  const first = await itemPage(1)
  const pages = Math.ceil(first.totalCount / 100)
  const all = [...first.items]
  let next = 2
  const worker = async (): Promise<void> => {
    while (next <= pages) all.push(...(await itemPage(next++)).items)
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM api_items').run()
    const ins = db.prepare('INSERT OR IGNORE INTO api_items (name, category) VALUES (?, ?)')
    for (const i of all) ins.run(i.name, i.categoryName)
  })()
  setMeta('itemsSyncedAt', new Date().toISOString())
  matcher = null
  invalidateKnownNames()
  return all.length
}

// The creature list changes with every index update; the item index filters creature names out.
export function invalidateItemIndex(): void {
  matcher = null
}

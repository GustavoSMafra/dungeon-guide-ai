import { getDb, getMeta, INDEX_SCHEMA, setMeta } from '../db'
import { msg } from '../messages'
import { dataVersion, delta, utc } from '../tibiadata'
import { relevantCreatureNames, syncCreatures } from './creatures-api'
import { embed } from './embeddings'
import { invalidateItemIndex } from './items'
import { invalidateVectorCache } from './search'
import { invalidateKnownNames } from './verify'
import { clearStructured, saveStructured } from './structured'
import { pageUrl } from './urls'
import { chunkContext, chunkText, isRedirect, wikitextToPlain } from './wikitext'
import type { IngestProgress } from '../../shared/types'

const API = 'https://tibia.fandom.com/api.php'
const USER_AGENT = 'DungeonGuideAI/0.1 (Tibia companion app prototype)'
const EMBED_BATCH = 16

// Reference pages that are always indexed, regardless of the selected categories. The game-mechanics
// pages answer general questions ("how do I move faster?") that no category covers; without them
// the search returns unrelated creatures and small models make things up. Canonical titles only:
// redirects are skipped by indexPages.
const EXTRA_PAGES = [
  'Cyclopedia',
  'Access Quests',
  'Speed',
  'Mounts',
  'Stamina',
  'Experience Point',
  'Skills',
  'Training',
  'Exercise Weapons',
  'Regeneration',
  'Food',
  'Soul Point',
  'Death',
  'Blessings',
  'Party',
  'Premium Time',
  'Imbuing',
  'Prey System',
  'Task Board',
  'Forge',
  'Wheel of Destiny',
  'Outfits',
  'House',
  'The Market (Object)',
  // Travel: how boats and carpets work. The routes and prices are on the captains' pages (below).
  'Boat',
  'Travelling',
  'Transportation',
  'Magic Carpet'
]

// Small categories always indexed, whatever the selection: without the ship captains, "how do I get from
// Thais to Liberty Bay?" had nothing to go on and the model made up a route.
const EXTRA_CATEGORIES = ['Ship Captain NPCs']

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function wikiApi<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(API)
  for (const [k, v] of Object.entries({ ...params, format: 'json', formatversion: '2' })) {
    url.searchParams.set(k, v)
  }
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(msg().wikiStatus(res.status))
  await sleep(200) // be polite to Fandom's servers
  return (await res.json()) as T
}

export async function listCategory(category: string, max: number | null): Promise<string[]> {
  const titles: string[] = []
  let cont: string | undefined
  do {
    const body = await wikiApi<{
      continue?: { cmcontinue: string }
      query: { categorymembers: { title: string }[] }
    }>({
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${category}`,
      cmnamespace: '0',
      cmlimit: '500',
      ...(cont ? { cmcontinue: cont } : {})
    })
    titles.push(...body.query.categorymembers.map((m) => m.title))
    cont = body.continue?.cmcontinue
  } while (cont && (max === null || titles.length < max))
  return max === null ? titles : titles.slice(0, max)
}

async function fetchContents(titles: string[]): Promise<{ title: string; content: string }[]> {
  const body = await wikiApi<{
    query: {
      pages: { title: string; missing?: boolean; revisions?: { slots: { main: { content: string } } }[] }[]
    }
  }>({
    action: 'query',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    titles: titles.join('|')
  })
  return body.query.pages
    .filter((p) => !p.missing && p.revisions?.length)
    .map((p) => ({ title: p.title, content: p.revisions![0].slots.main.content }))
}

function savePage(
  title: string,
  category: string,
  src: string,
  chunks: { heading: string; text: string; embedding: Float32Array }[]
): void {
  const db = getDb()
  db.transaction(() => {
    const old = db.prepare('SELECT id FROM pages WHERE title = ?').get(title) as { id: number } | undefined
    if (old) {
      db.prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE page_id = ?)').run(old.id)
      db.prepare('DELETE FROM pages WHERE id = ?').run(old.id)
    }
    const pageId = db
      .prepare('INSERT INTO pages (title, category, url, fetched_at) VALUES (?, ?, ?, ?)')
      .run(title, category, pageUrl(title), new Date().toISOString()).lastInsertRowid
    const insChunk = db.prepare('INSERT INTO chunks (page_id, heading, text, embedding) VALUES (?, ?, ?, ?)')
    const insFts = db.prepare('INSERT INTO chunks_fts (rowid, title, text) VALUES (?, ?, ?)')
    for (const c of chunks) {
      const buf = Buffer.from(c.embedding.buffer, c.embedding.byteOffset, c.embedding.byteLength)
      const id = insChunk.run(pageId, c.heading, c.text, buf).lastInsertRowid
      insFts.run(id, title, c.text)
    }
    saveStructured(db, pageId, title, src)
  })()
}

// Downloads wikitext from Fandom (50 per request), computes embeddings and stores each page.
async function indexPages(
  work: { title: string; category: string }[],
  onProgress: (p: IngestProgress) => void
): Promise<void> {
  let done = 0
  for (let i = 0; i < work.length; i += 50) {
    const batch = work.slice(i, i + 50)
    onProgress({ phase: 'fetching', done, total: work.length, message: msg().downloading(batch[0].title) })
    const pages = await fetchContents(batch.map((b) => b.title))
    const categoryOf = new Map(batch.map((b) => [b.title, b.category]))

    for (const page of pages) {
      done++
      if (isRedirect(page.content)) continue
      const chunks = chunkText(wikitextToPlain(page.content))
      if (!chunks.length) continue
      onProgress({ phase: 'embedding', done, total: work.length, message: msg().indexing(page.title) })
      const embedded: { heading: string; text: string; embedding: Float32Array }[] = []
      for (let k = 0; k < chunks.length; k += EMBED_BATCH) {
        const slice = chunks.slice(k, k + EMBED_BATCH)
        const category = categoryOf.get(page.title) ?? 'Outros'
        const vecs = await embed(
          slice.map((c) => `${chunkContext(page.title, category, c.heading)}\n${c.text}`),
          'passage'
        )
        slice.forEach((c, j) => embedded.push({ ...c, embedding: vecs[j] }))
      }
      savePage(page.title, categoryOf.get(page.title) ?? 'Outros', page.content, embedded)
    }
    done = Math.min(i + batch.length, work.length)
  }
}

// Fills in creature data from the TibiaData API. An API failure does not break
// indexing: the data parsed from wikitext still applies.
async function syncCreaturesStep(names: string[], onProgress: (p: IngestProgress) => void): Promise<string> {
  if (!names.length) return ''
  try {
    const { failed } = await syncCreatures(names, (done, total) =>
      onProgress({ phase: 'fetching', done, total, message: msg().downloadingCreatures })
    )
    return failed ? msg().creaturesMissing(failed) : ''
  } catch (err) {
    return msg().tibiaDataDown((err as Error).message)
  }
}

let running = false

export async function ingest(
  categories: string[],
  maxPagesPerCategory: number | null,
  onProgress: (p: IngestProgress) => void
): Promise<void> {
  if (running) throw new Error(msg().ingestRunning)
  running = true
  try {
    // Watermark for the incremental update: anything changed after this goes into the delta.
    const since = await dataVersion()
      .then((v) => utc(v.latestDataUpdateUtc))
      .catch(() => new Date().toISOString())

    onProgress({ phase: 'listing', done: 0, total: 0, message: msg().listingPages })
    const work: { title: string; category: string }[] = EXTRA_PAGES.map((title) => ({ title, category: 'Guias' }))
    const seen = new Set<string>(EXTRA_PAGES)
    for (const category of [...EXTRA_CATEGORIES, ...categories.filter((c) => !EXTRA_CATEGORIES.includes(c))]) {
      for (const title of await listCategory(category, maxPagesPerCategory)) {
        if (seen.has(title)) continue
        seen.add(title)
        work.push({ title, category })
      }
    }

    await indexPages(work, onProgress)
    const note = await syncCreaturesStep(relevantCreatureNames(), onProgress)

    setMeta('lastIngestAt', new Date().toISOString())
    setMeta('tibiadataSince', since)
    setMeta('indexSchema', INDEX_SCHEMA)
    invalidateVectorCache()

    invalidateItemIndex()
    onProgress({ phase: 'done', done: work.length, total: work.length, message: `${msg().baseUpdated}${note}` })
  } catch (err) {
    invalidateVectorCache()

    invalidateItemIndex()
    onProgress({ phase: 'error', done: 0, total: 0, message: (err as Error).message })
    throw err
  } finally {
    running = false
  }
}

// TibiaData delta resource → wiki category used by the full ingest.
const DELTA_RESOURCES: Record<string, string> = {
  creatures: 'Creatures',
  'hunting-places': 'Hunting Places',
  quests: 'Quest Overview Pages',
  spells: 'Spells',
  achievements: 'Achievements'
}

// Re-indexes only the pages that changed on the wiki since the last update, using TibiaData's
// change feed. New pages are added if their category is already in the base.
export async function updateFromDelta(onProgress: (p: IngestProgress) => void): Promise<void> {
  if (running) throw new Error(msg().ingestRunning)
  const since = getMeta('tibiadataSince') ?? getMeta('lastIngestAt')
  if (!since) throw new Error(msg().fullIngestFirst)
  running = true
  try {
    onProgress({ phase: 'listing', done: 0, total: 0, message: msg().fetchingChanges })
    const feed = await delta(since, Object.keys(DELTA_RESOURCES))
    if (feed.hasMore) {
      throw new Error(msg().tooManyChanges)
    }

    const db = getDb()
    const categoryOf = db.prepare('SELECT category FROM pages WHERE title = ?')
    const indexed = new Set(
      (db.prepare('SELECT DISTINCT category FROM pages').all() as { category: string }[]).map((r) => r.category)
    )
    const work: { title: string; category: string }[] = []
    const seen = new Set<string>()
    const changedCreatures: string[] = []
    for (const c of feed.changes) {
      if (c.changeType !== 'upsert' || seen.has(c.identifier)) continue
      seen.add(c.identifier)
      const existing = (categoryOf.get(c.identifier) as { category: string } | undefined)?.category
      const category = existing ?? DELTA_RESOURCES[c.resource]
      if (existing || indexed.has(category)) work.push({ title: c.identifier, category })
      if (c.resource === 'creatures') changedCreatures.push(c.identifier)
    }
    // Reference pages and categories added to EXTRA_PAGES / EXTRA_CATEGORIES after the base was built.
    for (const title of EXTRA_PAGES) {
      if (!seen.has(title) && !categoryOf.get(title)) work.push({ title, category: 'Guias' })
    }
    for (const category of EXTRA_CATEGORIES) {
      for (const title of await listCategory(category, null)) {
        if (!seen.has(title) && !categoryOf.get(title)) work.push({ title, category })
      }
    }

    await indexPages(work, onProgress)
    // Creatures that changed and those not yet fetched from the API (bases indexed before it existed).
    const relevant = relevantCreatureNames()
    const relevantSet = new Set(relevant.map((n) => n.toLowerCase()))
    const fromApi = new Set(
      (db.prepare('SELECT name FROM api_creatures').all() as { name: string }[]).map((r) => r.name.toLowerCase())
    )
    const note = await syncCreaturesStep(
      [
        ...new Set([
          ...changedCreatures.filter((n) => relevantSet.has(n.toLowerCase())),
          ...relevant.filter((n) => !fromApi.has(n.toLowerCase()))
        ])
      ],
      onProgress
    )

    setMeta('lastIngestAt', new Date().toISOString())
    if (feed.latestChangeUtc) setMeta('tibiadataSince', utc(feed.latestChangeUtc))
    invalidateVectorCache()

    invalidateItemIndex()
    onProgress({
      phase: 'done',
      done: work.length,
      total: work.length,
      message: work.length
        ? `${msg().pagesUpdated(work.length)}${note}`
        : `${msg().noChanges}${note}`
    })
  } catch (err) {
    invalidateVectorCache()

    invalidateItemIndex()
    onProgress({ phase: 'error', done: 0, total: 0, message: (err as Error).message })
    throw err
  } finally {
    running = false
  }
}

// Repopulates the hunt/creature tables from already indexed pages, without recomputing embeddings.
// Used when the parsers change (STRUCTURED_SCHEMA in db.ts); takes ~1 min instead of ~10.
export async function refreshStructured(onProgress?: (done: number, total: number) => void): Promise<void> {
  if (running) return
  running = true
  try {
    const db = getDb()
    const pages = db.prepare('SELECT id, title FROM pages').all() as { id: number; title: string }[]
    const idOf = new Map(pages.map((p) => [p.title, p.id]))
    for (let i = 0; i < pages.length; i += 50) {
      const contents = await fetchContents(pages.slice(i, i + 50).map((p) => p.title))
      db.transaction(() => {
        for (const page of contents) {
          const id = idOf.get(page.title)
          if (id === undefined) continue
          clearStructured(db, id)
          saveStructured(db, id, page.title, page.content)
        }
      })()
      onProgress?.(Math.min(i + 50, pages.length), pages.length)
    }
    setMeta('structuredStale', '0')
  } finally {
    running = false
  }
}

// NPC names from the wiki, for the name check in answers (verify.ts). Refreshed weekly on startup.
export function npcNamesStale(): boolean {
  const synced = getMeta('npcsSyncedAt')
  return !synced || Date.now() - Date.parse(synced) > 7 * 24 * 60 * 60 * 1000
}

export async function syncNpcNames(): Promise<number> {
  const names = await listCategory('NPCs', null)
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM npcs').run()
    const ins = db.prepare('INSERT OR IGNORE INTO npcs (name) VALUES (?)')
    for (const n of names) ins.run(n)
  })()
  setMeta('npcsSyncedAt', new Date().toISOString())
  invalidateKnownNames()
  return names.length
}

export function structuredRefreshNeeded(): boolean {
  if (getMeta('structuredStale') !== '1') return false
  return (getDb().prepare('SELECT COUNT(*) AS n FROM pages').get() as { n: number }).n > 0
}

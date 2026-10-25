import { getDb, getMeta, setMeta } from '../db'
import { dataVersion, delta, utc } from '../tibiadata'
import { relevantCreatureNames, syncCreatures } from './creatures-api'
import { embed } from './embeddings'
import { invalidateVectorCache } from './search'
import { clearStructured, saveStructured } from './structured'
import { pageUrl } from './urls'
import { chunkText, isRedirect, wikitextToPlain } from './wikitext'
import type { IngestProgress } from '../../shared/types'

const API = 'https://tibia.fandom.com/api.php'
const USER_AGENT = 'DungeonGuideAI/0.1 (Tibia companion app prototype)'
const EMBED_BATCH = 16

// Reference pages that are always indexed, regardless of the selected categories.
const EXTRA_PAGES = ['Cyclopedia', 'Access Quests']

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function wikiApi<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(API)
  for (const [k, v] of Object.entries({ ...params, format: 'json', formatversion: '2' })) {
    url.searchParams.set(k, v)
  }
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`TibiaWiki respondeu ${res.status}`)
  await sleep(200) // be polite to Fandom's servers
  return (await res.json()) as T
}

async function listCategory(category: string, max: number | null): Promise<string[]> {
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
    onProgress({ phase: 'fetching', done, total: work.length, message: `Baixando ${batch[0].title}…` })
    const pages = await fetchContents(batch.map((b) => b.title))
    const categoryOf = new Map(batch.map((b) => [b.title, b.category]))

    for (const page of pages) {
      done++
      if (isRedirect(page.content)) continue
      const chunks = chunkText(wikitextToPlain(page.content))
      if (!chunks.length) continue
      onProgress({ phase: 'embedding', done, total: work.length, message: `Indexando ${page.title}` })
      const embedded: { heading: string; text: string; embedding: Float32Array }[] = []
      for (let k = 0; k < chunks.length; k += EMBED_BATCH) {
        const slice = chunks.slice(k, k + EMBED_BATCH)
        const vecs = await embed(
          slice.map((c) => `${page.title} — ${c.heading}\n${c.text}`),
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
      onProgress({ phase: 'fetching', done, total, message: 'Baixando dados de criaturas da TibiaData…' })
    )
    return failed ? ` (${failed} criaturas sem dados na TibiaData)` : ''
  } catch (err) {
    return ` (TibiaData indisponível: ${(err as Error).message}; usando só os dados da wiki)`
  }
}

let running = false

export async function ingest(
  categories: string[],
  maxPagesPerCategory: number | null,
  onProgress: (p: IngestProgress) => void
): Promise<void> {
  if (running) throw new Error('Já existe uma indexação em andamento')
  running = true
  try {
    // Watermark for the incremental update: anything changed after this goes into the delta.
    const since = await dataVersion()
      .then((v) => utc(v.latestDataUpdateUtc))
      .catch(() => new Date().toISOString())

    onProgress({ phase: 'listing', done: 0, total: 0, message: 'Listando páginas da TibiaWiki…' })
    const work: { title: string; category: string }[] = EXTRA_PAGES.map((title) => ({ title, category: 'Guias' }))
    const seen = new Set<string>(EXTRA_PAGES)
    for (const category of categories) {
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
    invalidateVectorCache()
    onProgress({ phase: 'done', done: work.length, total: work.length, message: `Base de conhecimento atualizada!${note}` })
  } catch (err) {
    invalidateVectorCache()
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
  if (running) throw new Error('Já existe uma indexação em andamento')
  const since = getMeta('tibiadataSince') ?? getMeta('lastIngestAt')
  if (!since) throw new Error('Faça uma indexação completa antes de atualizar só as mudanças.')
  running = true
  try {
    onProgress({ phase: 'listing', done: 0, total: 0, message: 'Buscando mudanças na TibiaData…' })
    const feed = await delta(since, Object.keys(DELTA_RESOURCES))
    if (feed.hasMore) {
      throw new Error('Muitas mudanças desde a última atualização. Use "Indexar / atualizar" para refazer a base.')
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
    onProgress({
      phase: 'done',
      done: work.length,
      total: work.length,
      message: work.length
        ? `${work.length} página(s) atualizada(s)!${note}`
        : `Nenhuma mudança relevante desde a última atualização.${note}`
    })
  } catch (err) {
    invalidateVectorCache()
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

export function structuredRefreshNeeded(): boolean {
  if (getMeta('structuredStale') !== '1') return false
  return (getDb().prepare('SELECT COUNT(*) AS n FROM pages').get() as { n: number }).n > 0
}

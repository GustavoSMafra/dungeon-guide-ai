import { getDb, getMeta, INDEX_SCHEMA } from '../db'
import { EMBEDDING_DIM, embed } from './embeddings'
import { englishTerms } from './glossary'
import { createMatcher, titleAliases, type NameMatcher } from './names'
import { rerank } from './rerank'
import { invalidateCreatureNames, structuredStats } from './structured'
import { chunkContext } from './wikitext'
import { invalidateKnownNames } from './verify'
import type { KnowledgeStats } from '../../shared/types'

export interface SearchHit {
  id: number
  title: string
  heading: string
  text: string
  url: string
  // Reranker score, when the reranker ran.
  score?: number
  // The chunk's page is named in the question.
  named?: boolean
}

// Brute-force in-memory vector search: tens of thousands of chunks × 384 dims
// take a few milliseconds, so the prototype does not need an ANN index.
let vectors: { ids: number[]; pageIds: number[]; matrix: Float32Array } | null = null
let titles: { matcher: NameMatcher; pageId: Map<string, number> } | null = null

export function invalidateVectorCache(): void {
  vectors = null
  titles = null
  invalidateKnownNames()
  invalidateCreatureNames()
}

function loadVectors(): { ids: number[]; pageIds: number[]; matrix: Float32Array } {
  if (vectors) return vectors
  const rows = getDb().prepare('SELECT id, page_id AS pageId, embedding FROM chunks').all() as {
    id: number
    pageId: number
    embedding: Buffer
  }[]
  const matrix = new Float32Array(rows.length * EMBEDDING_DIM)
  rows.forEach((r, i) => {
    // Copy into an aligned buffer before reinterpreting as float32.
    matrix.set(new Float32Array(new Uint8Array(r.embedding).buffer), i * EMBEDDING_DIM)
  })
  vectors = { ids: rows.map((r) => r.id), pageIds: rows.map((r) => r.pageId), matrix }
  return vectors
}

// Page titles as they appear in questions (see titleAliases). Category index pages ("Creatures", "Hunting
// Places") are left out: their title is an ordinary word in questions ("which creatures in Goroma…").
function loadTitles(): { matcher: NameMatcher; pageId: Map<string, number> } {
  if (titles) return titles
  const rows = getDb().prepare('SELECT id, title, category FROM pages').all() as {
    id: number
    title: string
    category: string
  }[]
  const aliases: [string, string][] = []
  for (const { title, category } of rows) {
    if (title === category) continue
    for (const alias of titleAliases(title)) aliases.push([alias, title])
  }
  titles = { matcher: createMatcher(aliases), pageId: new Map(rows.map((r) => [r.title, r.id])) }
  return titles
}

// Pages the text names (titles and their aliases), for the chat's entity routing.
export function findNamedPages(text: string): { title: string; category: string }[] {
  const found = loadTitles().matcher.find(text)
  if (!found.length) return []
  const get = getDb().prepare('SELECT title, category FROM pages WHERE title = ?')
  return found.map((t) => get.get(t) as { title: string; category: string }).filter(Boolean)
}

const STOPWORDS = new Set(
  'que para com uma como qual quais onde meu minha sou tem mais melhor fazer posso pra dos das nos nas por sobre esse essa isso ele ela voce jogo the and for what how which where can are does you your get game'.split(
    ' '
  )
)

// Keyword search: good for proper nouns (Ferumbras, Demon Helmet, Roshamuul).
function keywordSearch(query: string, k: number): number[] {
  const terms = Array.from(
    new Set(
      query
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .match(/[a-z0-9']{3,}/g) ?? []
    )
  )
    .filter((t) => !STOPWORDS.has(t))
    .slice(0, 16)
  if (!terms.length) return []
  const match = terms.map((t) => `"${t}"`).join(' OR ')
  const rows = getDb()
    .prepare(
      'SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts, 5.0, 1.0) LIMIT ?'
    )
    .all(match, k) as { id: number }[]
  return rows.map((r) => r.id)
}

export interface SearchOptions {
  // Pages named in the question get their chunks as a third ranked list.
  entities: boolean
  // English terms for Portuguese words, added to the keyword search.
  glossary: boolean
  // Cross-encoder reranking of the candidates, dropping the ones below minScore.
  rerank: boolean
  minScore?: number
  gate?: Gate
}

export const DEFAULT_SEARCH: SearchOptions = { entities: true, glossary: true, rerank: true }

// Filled by hybridSearch when passed in (debug mode, eval): why each candidate ranked where it did.
export interface SearchTrace {
  query: string
  keywordTerms: string[]
  namedPages: string[]
  candidates: {
    title: string
    heading: string
    rank: number
    fused: number
    vectorRank: number | null
    keywordRank: number | null
    named: boolean
    rerank: number | null
    kept: boolean
  }[]
}

// Candidates sent to the reranker; more catches more, but each costs ~0.1 s of CPU.
const RERANK_CANDIDATES = 20
// Reranker logit below which an excerpt is treated as unrelated (calibrated with eval/questions.json).
export const RERANK_MIN = -2
export const RERANK_GATE: Gate = 'chunk'
// Chunks per named page in the entity list.
const ENTITY_CHUNKS = 3

// Merges vector, keyword and named-page lists with Reciprocal Rank Fusion, then optionally reranks.
// With the reranker, the result can be empty: nothing in the base is about the question.
export async function hybridSearch(
  query: string,
  limit = 8,
  opts: SearchOptions = DEFAULT_SEARCH,
  trace?: SearchTrace
): Promise<SearchHit[]> {
  const { ids, pageIds, matrix } = loadVectors()
  if (!ids.length) return []
  const [q] = await embed([query], 'query')
  const dots = new Float32Array(ids.length)
  for (let i = 0; i < ids.length; i++) {
    let dot = 0
    const off = i * EMBEDDING_DIM
    for (let d = 0; d < EMBEDDING_DIM; d++) dot += q[d] * matrix[off + d]
    dots[i] = dot
  }
  const order = Array.from(ids.keys()).sort((a, b) => dots[b] - dots[a])
  const vec = order.slice(0, 30).map((i) => ids[i])

  const extra = opts.glossary ? englishTerms(query) : []
  const kw = keywordSearch([query, ...extra].join(' '), 30)
  if (trace) {
    trace.query = query
    trace.keywordTerms = extra
  }

  // Chunks of the pages the question names, best-matching chunk of each page first.
  const entity: number[] = []
  const namedPages = new Set<number>()
  if (opts.entities) {
    const t = loadTitles()
    for (const title of t.matcher.find(query).slice(0, 4)) {
      const id = t.pageId.get(title)
      if (id !== undefined) namedPages.add(id)
    }
    const perPage = new Map<number, number[]>()
    for (const i of order) {
      const page = pageIds[i]
      if (!namedPages.has(page)) continue
      const list = perPage.get(page) ?? []
      if (list.length < ENTITY_CHUNKS) perPage.set(page, [...list, ids[i]])
    }
    for (let r = 0; r < ENTITY_CHUNKS; r++) for (const list of perPage.values()) if (list[r]) entity.push(list[r])
  }

  const score = new Map<number, number>()
  for (const list of [vec, kw, entity]) {
    list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (60 + rank)))
  }
  const top = [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.rerank ? RERANK_CANDIDATES : limit)
    .map(([id]) => id)
  // The best chunk of every named page is a candidate even when the fused ranking left it out.
  for (const id of entity.slice(0, namedPages.size)) if (!top.includes(id)) top.push(id)
  if (!top.length) return []

  const rows = getDb()
    .prepare(
      `SELECT c.id, c.page_id AS pageId, p.title, p.category, c.heading, c.text, p.url
       FROM chunks c JOIN pages p ON p.id = c.page_id
       WHERE c.id IN (${top.map(() => '?').join(',')})`
    )
    .all(...top) as (SearchHit & { pageId: number; category: string })[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  const hits = top
    .map((id) => byId.get(id))
    .filter((r): r is SearchHit & { pageId: number; category: string } => Boolean(r))
  const record = (scores: number[] | null, kept: SearchHit[]): void => {
    if (!trace) return
    const keptIds = new Set(kept.map((h) => h.id))
    const pageTitle = new Map(hits.map((h) => [h.pageId, h.title]))
    trace.namedPages = [...namedPages].map((id) => pageTitle.get(id) ?? `#${id}`)
    trace.candidates = hits.map((h, i) => ({
      title: h.title,
      heading: h.heading,
      rank: i + 1,
      fused: Number((score.get(h.id) ?? 0).toFixed(4)),
      vectorRank: vec.indexOf(h.id) + 1 || null,
      keywordRank: kw.indexOf(h.id) + 1 || null,
      named: namedPages.has(h.pageId),
      rerank: scores ? Number(scores[i].toFixed(2)) : null,
      kept: keptIds.has(h.id)
    }))
  }
  if (!opts.rerank) {
    const out = hits.slice(0, limit).map(({ pageId: _, ...h }) => h)
    record(null, out)
    return out
  }

  let scores: number[]
  try {
    scores = await rerank(
      query,
      hits.map((h) => `${chunkContext(h.title, h.category, h.heading)}\n${h.text}`)
    )
  } catch {
    // Model not downloadable (offline on first use): answer with the unfiltered excerpts.
    const out = hits.slice(0, limit).map(({ pageId: _, ...h }) => h)
    record(null, out)
    return out
  }
  // The reranker only filters: as a ranker it did worse than the fused order (it prefers "Memory of a
  // Hydra" to "Hydra"), but it tells unrelated excerpts apart well (eval/retrieval.ts).
  const scored = hits.map(({ pageId, ...h }, i) => ({ ...h, score: scores[i], named: namedPages.has(pageId) }))
  const out = applyCutoff(scored, opts.minScore ?? RERANK_MIN, limit, opts.gate ?? RERANK_GATE)
  record(scores, out)
  return out
}

export type Gate = 'chunk' | 'question'

// Applies the reranker cutoff to hits in fused order. 'chunk' drops each excerpt below the cutoff;
// 'question' drops everything only when no excerpt reaches it. Either way, a page the question names
// keeps its first excerpt: the player asked about that page. Exported for eval/retrieval.ts.
export function applyCutoff(hits: SearchHit[], minScore: number, limit: number, gate: Gate): SearchHit[] {
  const relevant = (h: SearchHit): boolean => (h.score ?? 0) >= minScore
  // Pages the question names come first: small models lean on the first excerpt (a question about Goroma
  // got the creatures of whatever hunt was listed first).
  const namedFirst = (list: SearchHit[]): SearchHit[] => [
    ...list.filter((h) => h.named),
    ...list.filter((h) => !h.named)
  ]
  if (gate === 'question') {
    return hits.some((h) => relevant(h) || h.named) ? namedFirst(hits).slice(0, limit) : []
  }
  const keptPages = new Set<string>()
  const kept = hits.filter((h) => {
    const keep = relevant(h) || (Boolean(h.named) && !keptPages.has(h.title))
    if (keep) keptPages.add(h.title)
    return keep
  })
  // When the question names pages, other pages' excerpts only add things to confuse them with: a question
  // about The Inquisition Quest got the Explorer Society page too, and the model made it a prerequisite.
  const named = kept.filter((h) => h.named)
  return (named.length ? named : kept).slice(0, limit)
}

export function knowledgeStats(): KnowledgeStats {
  const db = getDb()
  const pages = (db.prepare('SELECT COUNT(*) AS n FROM pages').get() as { n: number }).n
  const chunks = (db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n
  return {
    pages,
    chunks,
    ...structuredStats(),
    lastIngestAt: getMeta('lastIngestAt'),
    // Built before the current chunk format (or embedding model): answers improve after a full index.
    reindexNeeded: pages > 0 && getMeta('indexSchema') !== INDEX_SCHEMA
  }
}

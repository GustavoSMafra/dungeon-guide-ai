import { getDb, getMeta } from '../db'
import { EMBEDDING_DIM, embed } from './embeddings'
import { structuredStats } from './structured'
import type { KnowledgeStats } from '../../shared/types'

export interface SearchHit {
  id: number
  title: string
  heading: string
  text: string
  url: string
}

// Brute-force in-memory vector search: tens of thousands of chunks × 384 dims
// take a few milliseconds, so the prototype does not need an ANN index.
let vectors: { ids: number[]; matrix: Float32Array } | null = null

export function invalidateVectorCache(): void {
  vectors = null
}

function loadVectors(): { ids: number[]; matrix: Float32Array } {
  if (vectors) return vectors
  const rows = getDb().prepare('SELECT id, embedding FROM chunks').all() as { id: number; embedding: Buffer }[]
  const matrix = new Float32Array(rows.length * EMBEDDING_DIM)
  rows.forEach((r, i) => {
    // Copy into an aligned buffer before reinterpreting as float32.
    matrix.set(new Float32Array(new Uint8Array(r.embedding).buffer), i * EMBEDDING_DIM)
  })
  vectors = { ids: rows.map((r) => r.id), matrix }
  return vectors
}

async function vectorSearch(query: string, k: number): Promise<number[]> {
  const { ids, matrix } = loadVectors()
  if (!ids.length) return []
  const [q] = await embed([query], 'query')
  const scores = ids.map((id, i) => {
    let dot = 0
    const off = i * EMBEDDING_DIM
    for (let d = 0; d < EMBEDDING_DIM; d++) dot += q[d] * matrix[off + d]
    return { id, dot }
  })
  return scores
    .sort((a, b) => b.dot - a.dot)
    .slice(0, k)
    .map((s) => s.id)
}

const STOPWORDS = new Set(
  'que para com uma como qual quais onde meu minha sou tem mais melhor fazer posso pra dos das nos nas por sobre esse essa isso ele ela voce the and for what how which where'.split(
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
    .slice(0, 12)
  if (!terms.length) return []
  const match = terms.map((t) => `"${t}"`).join(' OR ')
  const rows = getDb()
    .prepare(
      'SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts, 5.0, 1.0) LIMIT ?'
    )
    .all(match, k) as { id: number }[]
  return rows.map((r) => r.id)
}

// Merges both lists with Reciprocal Rank Fusion.
export async function hybridSearch(query: string, limit = 8): Promise<SearchHit[]> {
  const [vec, kw] = await Promise.all([vectorSearch(query, 30), Promise.resolve(keywordSearch(query, 30))])
  const score = new Map<number, number>()
  for (const list of [vec, kw]) {
    list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (60 + rank)))
  }
  const top = [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
  if (!top.length) return []

  const rows = getDb()
    .prepare(
      `SELECT c.id, p.title, c.heading, c.text, p.url FROM chunks c JOIN pages p ON p.id = c.page_id
       WHERE c.id IN (${top.map(() => '?').join(',')})`
    )
    .all(...top) as SearchHit[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  return top.map((id) => byId.get(id)).filter((r): r is SearchHit => Boolean(r))
}

export function knowledgeStats(): KnowledgeStats {
  const db = getDb()
  const pages = (db.prepare('SELECT COUNT(*) AS n FROM pages').get() as { n: number }).n
  const chunks = (db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n
  return { pages, chunks, ...structuredStats(), lastIngestAt: getMeta('lastIngestAt') }
}

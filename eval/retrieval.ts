// Retrieval evaluation: runs eval/questions.json through hybridSearch with several option sets and prints
// how often the expected page is among the excerpts, and how often unanswerable questions get none.
// Reads the app's real database (read-only use). Usage: npm run eval [-- --data=<userData dir>]

import { app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  applyCutoff,
  hybridSearch,
  RERANK_GATE,
  RERANK_MIN,
  type Gate,
  type SearchHit,
  type SearchOptions
} from '../src/main/rag/search'

interface Question {
  q: string
  // Pages that answer it; empty = nothing in the base does (the search should return no excerpts).
  expect: string[]
}

const K = 5
const data = process.argv.find((a) => a.startsWith('--data='))?.slice(7)
app.setPath('userData', data ?? join(app.getPath('appData'), 'dungeon-guide-ai'))

const questions = JSON.parse(readFileSync(join(process.cwd(), 'eval', 'questions.json'), 'utf8')) as Question[]

interface Score {
  hit1: number
  hit3: number
  hitK: number
  abstain: number
  excerpts: number
  misses: string[]
}

function score(results: { q: Question; hits: SearchHit[] }[]): Score {
  const s: Score = { hit1: 0, hit3: 0, hitK: 0, abstain: 0, excerpts: 0, misses: [] }
  for (const { q, hits } of results) {
    const titles = hits.map((h) => h.title)
    if (!q.expect.length) {
      if (!hits.length) s.abstain++
      else s.misses.push(`${q.q} → should be empty, got ${[...new Set(titles)].slice(0, 3).join(', ')}`)
      continue
    }
    s.excerpts += hits.length
    const rank = titles.findIndex((t) => q.expect.includes(t))
    if (rank === 0) s.hit1++
    if (rank !== -1 && rank < 3) s.hit3++
    if (rank !== -1 && rank < K) s.hitK++
    else s.misses.push(`${q.q} → ${[...new Set(titles)].slice(0, 3).join(', ') || '(none)'}`)
  }
  return s
}

function report(name: string, s: Score, ms?: number): void {
  const answerable = questions.filter((q) => q.expect.length).length
  const pct = (n: number, of: number): string => `${Math.round((100 * n) / of)}%`.padStart(5)
  console.log(
    `${name.padEnd(34)} hit@1 ${pct(s.hit1, answerable)}  hit@3 ${pct(s.hit3, answerable)}  ` +
      `hit@${K} ${pct(s.hitK, answerable)}  abstain ${s.abstain}/${questions.length - answerable}  ` +
      `excerpts/q ${(s.excerpts / answerable).toFixed(1)}${ms === undefined ? '' : `  ${Math.round(ms)} ms/q`}`
  )
}

async function run(opts: SearchOptions, limit = K): Promise<{ results: { q: Question; hits: SearchHit[] }[]; ms: number }> {
  const results: { q: Question; hits: SearchHit[] }[] = []
  const start = Date.now()
  for (const q of questions) results.push({ q, hits: await hybridSearch(q.q, limit, opts) })
  return { results, ms: (Date.now() - start) / questions.length }
}

app.whenReady().then(async () => {
  const variants: [string, SearchOptions][] = [
    ['baseline (vector + keyword)', { entities: false, glossary: false, rerank: false }],
    ['+ named pages', { entities: true, glossary: false, rerank: false }],
    ['+ named pages + glossary', { entities: true, glossary: true, rerank: false }]
  ]
  let last: Score | null = null
  for (const [name, opts] of variants) {
    const { results, ms } = await run(opts)
    last = score(results)
    report(name, last, ms)
  }

  // Reranker: score every candidate once, then try both gates at several cutoffs.
  const { results, ms } = await run(
    { entities: true, glossary: true, rerank: true, minScore: -Infinity, gate: 'chunk' },
    20
  )
  let current: Score | null = last
  for (const gate of ['chunk', 'question'] as Gate[]) {
    for (const cut of [-4, -3, -2.5, -2, -1.5, -1, -0.5, 0]) {
      const s = score(results.map(({ q, hits }) => ({ q, hits: applyCutoff(hits, cut, K, gate) })))
      const isCurrent = cut === RERANK_MIN && gate === RERANK_GATE
      if (isCurrent) current = s
      report(`+ reranker ${gate} gate ${cut}${isCurrent ? ' *' : ''}`, s, cut === -4 ? ms : undefined)
    }
  }

  const verbose = process.argv.includes('--verbose')
  if (current?.misses.length) {
    console.log(`\nMisses with the current settings (${current.misses.length}):`)
    for (const m of current.misses) console.log(`  - ${m}`)
  }
  if (verbose) {
    for (const { q, hits } of results) {
      console.log(`\n${q.q}`)
      for (const h of hits.slice(0, 6)) console.log(`  ${(h.score ?? 0).toFixed(2).padStart(6)} ${h.named ? '*' : ' '} ${h.title} / ${h.heading}`)
    }
  }
  app.quit()
})

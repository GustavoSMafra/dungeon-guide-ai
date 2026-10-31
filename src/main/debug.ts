import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Finding } from './judge'
import type { SearchTrace } from './rag/search'

// Debug mode: one JSON line per question with the search query, every retrieved candidate (scores,
// positions, kept or dropped), the blocks and the full prompt sent to the model, the answer and the name
// check. Enabled with DGA_DEBUG=1 (written to userData/debug/chat-YYYY-MM-DD.jsonl); eval/answers.ts
// installs its own sink.

export interface DebugRecord {
  at: string
  conversationId: string
  question: string
  provider: string
  model: string
  searchQuery: string
  search: SearchTrace | null
  blocks: string[]
  prompt: { role: string; content: string }[]
  answer: string | null
  unverified: string[]
  // Statements the judge found without support (null: not run or failed).
  judge: Finding[] | null
  // Pages whose data or excerpts were in the context, and the ones shown to the player.
  contextSources: string[]
  sources: string[]
  // Why the pipeline answered without calling the model (grounding gate, out-of-scope question).
  shortCircuit: string | null
  error: string | null
}

type Sink = (record: DebugRecord) => void

function fileSink(record: DebugRecord): void {
  const dir = join(app.getPath('userData'), 'debug')
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, `chat-${record.at.slice(0, 10)}.jsonl`), JSON.stringify(record) + '\n')
}

let sink: Sink | null = process.env.DGA_DEBUG ? fileSink : null

export function setDebugSink(next: Sink | null): void {
  sink = next
}

export function debugEnabled(): boolean {
  return sink !== null
}

export function emitDebug(record: DebugRecord): void {
  try {
    sink?.(record)
  } catch {
    // Debug output must never break a chat answer.
  }
}

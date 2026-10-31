import { chatJson } from './ollama'
import type { Prompts } from './prompts'
import { statements } from './rag/verify'

// Second pass over a local model's answer. The answer is split into numbered statements and the same model,
// shown the context the answer was written from, classifies every one: supported, unsupported, or not a fact
// (advice, offers, "the base does not say"). Only unsupported ones are removed. Classifying every statement
// works better than asking for a list of problems: asked for a list, the model returned nothing for answers
// with made-up routes and listed correct sentences "because they are supported". The name check (verify.ts)
// catches made-up names; this catches wrong relations between real ones, routes and numbers.

export interface Finding {
  quote: string
  reason: string
}

const SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          verdict: { type: 'string', enum: ['supported', 'unsupported', 'not_a_fact'] },
          reason: { type: 'string' }
        },
        required: ['id', 'verdict', 'reason']
      }
    }
  },
  required: ['verdicts']
}

// A stuck check must not hold the answer forever; on timeout the answer stays as it was.
const TIMEOUT_MS = 180_000

export interface JudgeOptions {
  // Reasoning mode (Qwen3 etc.). On saved answers with known errors it caught every made-up route where the
  // non-reasoning judge caught half, and removed nothing from correct answers; it takes 10–70 s instead of 2–15 s.
  think?: boolean
}

// The unsupported statements, or null when the check could not run.
export async function judgeAnswer(
  p: Prompts,
  model: string,
  context: string,
  answer: string,
  opts: JudgeOptions = {}
): Promise<Finding[] | null> {
  const list = statements(answer)
  if (!list.length) return []
  try {
    const out = await chatJson<{ verdicts?: { id: number; verdict: string; reason: string }[] }>(
      model,
      [
        { role: 'system', content: p.judge.system },
        { role: 'user', content: p.judge.user(context, list.map((s, i) => `${i + 1}. ${s}`).join('\n')) }
      ],
      SCHEMA,
      { signal: AbortSignal.timeout(TIMEOUT_MS), think: opts.think ?? false }
    )
    return (out.verdicts ?? [])
      .filter((v) => v.verdict === 'unsupported' && list[v.id - 1])
      .map((v) => ({ quote: list[v.id - 1], reason: v.reason }))
  } catch {
    return null
  }
}

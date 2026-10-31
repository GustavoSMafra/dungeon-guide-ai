import type Anthropic from '@anthropic-ai/sdk'
import { pageUrl } from './rag/urls'
import { wikitextToPlain } from './rag/wikitext'
import { isAllowedRoute, search, tdGet } from './tibiadata'
import type { Prompts } from './prompts'
import type { Source } from '../shared/types'

// Tools Claude can call to query the TibiaData API while answering.
// Meant for exact facts (HP, loot, requirements) the indexed excerpts did not cover.
// Names, descriptions and result keys follow the app language (prompts.ts).

export function tools(p: Prompts): Anthropic.Beta.BetaTool[] {
  const t = p.tools
  return [
    {
      name: t.search,
      description: t.searchDesc,
      eager_input_streaming: true,
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string', description: t.queryDesc } },
        required: ['query'],
        additionalProperties: false
      }
    },
    {
      name: t.details,
      description: t.detailsDesc,
      eager_input_streaming: true,
      input_schema: {
        type: 'object',
        properties: { [t.route]: { type: 'string', description: t.routeDesc } },
        required: [t.route],
        additionalProperties: false
      }
    }
  ]
}

const MAX_RESULT_CHARS = 12_000
const MAX_WIKITEXT_CHARS = 8_000
// Fields that only matter for rendering or syncing.
const DROP_KEYS = new Set(['images', 'primaryImage', 'assets', 'lastSeenAt', 'relatedRoutes', 'scene'])

function compact(value: unknown, cut: string): unknown {
  if (Array.isArray(value)) return value.map((v) => compact(v, cut))
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (DROP_KEYS.has(k) || v === null || v === '') continue
    // Raw wikitext becomes plain text, which uses far fewer tokens.
    if (k === 'rawWikiText' && typeof v === 'string') {
      const plain = wikitextToPlain(v)
      out.text = plain.length > MAX_WIKITEXT_CHARS ? `${plain.slice(0, MAX_WIKITEXT_CHARS)}… ${cut}` : plain
      continue
    }
    out[k] = compact(v, cut)
  }
  return out
}

const pageName = (route: string): string | null => {
  const m = /^\/api\/v1\/(?:creatures|hunting-places|quests|spells|items|npcs|achievements)\/([^/]+)$/.exec(route)
  return m ? decodeURIComponent(m[1]) : null
}

export interface ToolOutcome {
  content: string
  isError: boolean
  // Wiki page looked up, to show in the answer's sources.
  source?: Source
}

export async function runTool(p: Prompts, name: string, input: unknown): Promise<ToolOutcome> {
  const t = p.tools
  const args = (input ?? {}) as Record<string, unknown>
  try {
    if (name === t.search) {
      if (typeof args.query !== 'string' || !args.query.trim()) {
        return { content: `${t.invalidInput}: ${JSON.stringify(input)}`, isError: true }
      }
      const { totalCount, items } = await search(args.query.trim())
      const k = t.keys
      const results = items.map((i) => ({ [k.kind]: i.kind, [k.title]: i.title, [k.summary]: i.summary, [k.route]: i.route }))
      return { content: JSON.stringify({ [k.total]: totalCount, [k.results]: results }), isError: false }
    }
    if (name === t.details) {
      const raw = args[t.route]
      const route = typeof raw === 'string' ? raw.trim() : ''
      if (!isAllowedRoute(route)) return { content: `${t.invalidRoute}: ${JSON.stringify(input)}`, isError: true }
      const body = compact(await tdGet<unknown>(route), t.textCut)
      let content = JSON.stringify(body)
      if (content.length > MAX_RESULT_CHARS) content = `${content.slice(0, MAX_RESULT_CHARS)}… ${t.answerCut}`
      const title = pageName(route)
      const wikiUrl = (body as { wikiUrl?: unknown }).wikiUrl
      return {
        content,
        isError: false,
        source: title
          ? {
              title,
              heading: 'TibiaData',
              url: typeof wikiUrl === 'string' ? wikiUrl : pageUrl(title)
            }
          : undefined
      }
    }
    return { content: `${t.unknownTool}: ${name}`, isError: true }
  } catch (err) {
    return { content: (err as Error).message, isError: true }
  }
}

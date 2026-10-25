import type Anthropic from '@anthropic-ai/sdk'
import { pageUrl } from './rag/urls'
import { wikitextToPlain } from './rag/wikitext'
import { isAllowedRoute, search, tdGet } from './tibiadata'
import type { Source } from '../shared/types'

// Tools Claude can call to query the TibiaData API while answering.
// Meant for exact facts (HP, loot, requirements) the indexed excerpts did not cover.

export const TOOLS_NOTE = `

Ferramentas:
- buscar_tibiadata e detalhes_tibiadata consultam ao vivo uma cópia estruturada da TibiaWiki (criaturas, loot, hunts, quests, magias, itens, NPCs, achievements).
- Use quando a pergunta pede um fato exato (HP, exp, fraquezas, loot, requisitos, preço, localização) que não está nos blocos da mensagem, ou para conferir um número duvidoso. Busque primeiro e depois abra o resultado certo pela rota.
- Não use para o que os blocos da mensagem já respondem. Cite a página consultada entre colchetes, como nos trechos.`

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'buscar_tibiadata',
    description:
      'Busca por nome em criaturas, itens, hunts, quests, magias, NPCs e outros recursos da TibiaWiki. ' +
      'Retorna tipo, título, resumo e a rota para abrir os detalhes. Use nomes em inglês, como no jogo.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Nome ou parte do nome, em inglês (ex.: "Hydra", "Banuta").' }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'detalhes_tibiadata',
    description:
      'Abre os detalhes de um resultado de buscar_tibiadata. Para criaturas, acrescente "/loot" à rota para ver ' +
      'o loot por raridade. Para hunts, "/area-recommendation" dá level e skills recomendados por vocação.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        rota: { type: 'string', description: 'Rota exata vinda da busca, ex.: "/api/v1/creatures/Hydra".' }
      },
      required: ['rota'],
      additionalProperties: false
    }
  }
]

const MAX_RESULT_CHARS = 12_000
const MAX_WIKITEXT_CHARS = 8_000
// Fields that only matter for rendering or syncing.
const DROP_KEYS = new Set(['images', 'primaryImage', 'assets', 'lastSeenAt', 'relatedRoutes', 'scene'])

function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (DROP_KEYS.has(k) || v === null || v === '') continue
    // Raw wikitext becomes plain text, which uses far fewer tokens.
    if (k === 'rawWikiText' && typeof v === 'string') {
      const plain = wikitextToPlain(v)
      out.text = plain.length > MAX_WIKITEXT_CHARS ? `${plain.slice(0, MAX_WIKITEXT_CHARS)}… [texto cortado]` : plain
      continue
    }
    out[k] = compact(v)
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

export async function runTool(name: string, input: unknown): Promise<ToolOutcome> {
  const args = (input ?? {}) as Record<string, unknown>
  try {
    if (name === 'buscar_tibiadata') {
      if (typeof args.query !== 'string' || !args.query.trim()) {
        return { content: `Entrada inválida: ${JSON.stringify(input)}`, isError: true }
      }
      const { totalCount, items } = await search(args.query.trim())
      const results = items.map((i) => ({ tipo: i.kind, titulo: i.title, resumo: i.summary, rota: i.route }))
      return { content: JSON.stringify({ total: totalCount, resultados: results }), isError: false }
    }
    if (name === 'detalhes_tibiadata') {
      const route = typeof args.rota === 'string' ? args.rota.trim() : ''
      if (!isAllowedRoute(route)) return { content: `Rota inválida: ${JSON.stringify(input)}`, isError: true }
      const body = compact(await tdGet<unknown>(route))
      let content = JSON.stringify(body)
      if (content.length > MAX_RESULT_CHARS) content = `${content.slice(0, MAX_RESULT_CHARS)}… [resposta cortada]`
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
    return { content: `Ferramenta desconhecida: ${name}`, isError: true }
  } catch (err) {
    return { content: (err as Error).message, isError: true }
  }
}

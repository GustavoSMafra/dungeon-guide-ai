// Cliente da API pública da TibiaData (https://tibiadata.bytewizards.de): espelho estruturado
// da TibiaWiki. Não confundir com a api.tibiadata.com usada para personagens (characters.ts).

const BASE = 'https://tibiadata.bytewizards.de'
const USER_AGENT = 'DungeonGuideAI/0.1 (Tibia companion app prototype)'
const TIMEOUT_MS = 20_000

export async function tdGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, BASE)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`TibiaData respondeu ${res.status} em ${url.pathname}`)
  return (await res.json()) as T
}

// As datas da API vêm em UTC, mas sem o "Z".
export const utc = (s: string): string => (/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`)

export async function dataVersion(): Promise<{ latestDataUpdateUtc: string }> {
  return tdGet('/api/v1/meta/version')
}

// --- Delta: o que mudou desde uma data ------------------------------------------

export interface DeltaChange {
  resource: string
  identifier: string
  updatedAtUtc: string
  changeType: string
}

export interface DeltaFeed {
  latestChangeUtc: string | null
  hasMore: boolean
  changes: DeltaChange[]
}

// O feed vem do mais novo para o mais antigo e não pagina para trás: com hasMore, as mudanças
// mais antigas ficaram de fora e só uma indexação completa resolve.
export async function delta(since: string, resources: string[]): Promise<DeltaFeed> {
  return tdGet('/api/v1/meta/delta', { since, resources: resources.join(','), limit: '500' })
}

// --- Criaturas -------------------------------------------------------------------

export interface ApiCreature {
  name: string
  hitpoints: number
  experience: number
  structuredData?: { infobox?: Record<string, string | null> }
  lootStatistics?: { itemName: string; chance: string | null; rarity: string | null }[]
}

export async function creature(name: string): Promise<ApiCreature> {
  return tdGet(`/api/v1/creatures/${encodeURIComponent(name)}`)
}

// --- Busca e detalhes (ferramentas do chat) ---------------------------------------

export interface SearchItem {
  kind: string
  title: string
  summary: string | null
  route: string
  wikiUrl: string | null
}

export async function search(query: string, limit = 10): Promise<{ totalCount: number; items: SearchItem[] }> {
  return tdGet('/api/v1/search', { query, limit: String(limit) })
}

// Só rotas de leitura da própria API; a rota vem do modelo, então não pode apontar para fora.
export function isAllowedRoute(route: string): boolean {
  return /^\/api\/v1\/[\w\-/%().,'!~*]+$/.test(route) && !route.includes('..')
}

// Tipos compartilhados entre o processo main, o preload e a UI.

export interface Character {
  id: number
  name: string
  world: string | null
  vocation: string | null
  level: number | null
  residence: string | null
  guild: string | null
  notes: string
  lastSyncedAt: string | null
  // Conta premium efetiva: a escolha manual, se houver; senão a do Tibia.com (null = desconhecido).
  premium: boolean | null
  // Informado pelo Tibia.com na última sincronização.
  premiumAuto: boolean | null
  // Escolha manual do jogador (null = automático).
  premiumOverride: boolean | null
  // Informadas pelo jogador; null = o app usa o valor típico para o level.
  skills: CharacterSkills
  // Valor típico estimado para o level; null nos campos que não importam para a vocação.
  typicalSkills: CharacterSkills
  sex: 'male' | 'female' | null
  // Outfit padrão da vocação na TibiaWiki (o Tibia.com não publica o visual do personagem).
  outfitUrl: string | null
  // Imagem escolhida pelo jogador (data URL); tem prioridade sobre o outfit.
  portrait: string | null
}

// Todas as skills do Tibia. null = não informada.
export interface CharacterSkills {
  magicLevel: number | null
  fist: number | null
  club: number | null
  sword: number | null
  axe: number | null
  distance: number | null
  shielding: number | null
  fishing: number | null
}

export const SKILL_KEYS = [
  'magicLevel',
  'fist',
  'club',
  'sword',
  'axe',
  'distance',
  'shielding',
  'fishing'
] as const satisfies readonly (keyof CharacterSkills)[]

export interface LevelEntry {
  level: number
  recordedAt: string
}

export type ProgressKind = 'quest' | 'access' | 'goal'
export type ProgressStatus = 'todo' | 'doing' | 'done'

export interface ProgressItem {
  id: number
  characterId: number
  kind: ProgressKind
  title: string
  status: ProgressStatus
  notes: string
  updatedAt: string
}

export interface Source {
  title: string
  heading: string
  url: string
}

export interface KnowledgeStats {
  pages: number
  chunks: number
  hunts: number
  creatures: number
  quests: number
  lastIngestAt: string | null
}

export interface IngestProgress {
  phase: 'listing' | 'fetching' | 'embedding' | 'done' | 'error'
  done: number
  total: number
  message: string
}

export type Provider = 'claude' | 'ollama'

export interface SettingsView {
  hasApiKey: boolean
  apiKeyFromEnv: boolean
  provider: Provider
  ollamaModel: string
}

// Categorias da TibiaWiki disponíveis para indexação.
export const WIKI_CATEGORIES = [
  { id: 'Creatures', label: 'Criaturas' },
  { id: 'Bosses', label: 'Bosses' },
  { id: 'Hunting Places', label: 'Hunting places' },
  { id: 'Quest Overview Pages', label: 'Quests' },
  { id: 'Spells', label: 'Magias' },
  { id: 'Achievements', label: 'Achievements' }
] as const

export interface Api {
  chat: {
    send(conversationId: string, text: string, characterId: number | null): Promise<void>
    reset(conversationId: string): Promise<void>
    onDelta(cb: (e: { conversationId: string; text: string }) => void): () => void
    onSources(cb: (e: { conversationId: string; sources: Source[] }) => void): () => void
    onDone(cb: (e: { conversationId: string; model: string; error?: string }) => void): () => void
  }
  characters: {
    list(): Promise<Character[]>
    add(name: string): Promise<Character>
    sync(id: number): Promise<Character>
    remove(id: number): Promise<void>
    saveNotes(id: number, notes: string): Promise<void>
    setPremiumOverride(id: number, premium: boolean | null): Promise<void>
    setSkills(id: number, skills: CharacterSkills): Promise<void>
    setPortrait(id: number, dataUrl: string | null): Promise<void>
    levelHistory(id: number): Promise<LevelEntry[]>
    progress(id: number): Promise<ProgressItem[]>
    addProgress(characterId: number, kind: ProgressKind, title: string): Promise<ProgressItem>
    setProgressStatus(id: number, status: ProgressStatus): Promise<void>
    removeProgress(id: number): Promise<void>
  }
  knowledge: {
    stats(): Promise<KnowledgeStats>
    ingest(categories: string[], maxPagesPerCategory: number | null): Promise<void>
    // Reindexa só o que mudou na wiki desde a última atualização (feed da TibiaData).
    update(): Promise<void>
    onProgress(cb: (p: IngestProgress) => void): () => void
  }
  settings: {
    get(): Promise<SettingsView>
    setApiKey(key: string): Promise<void>
    setProvider(provider: Provider, ollamaModel: string): Promise<void>
    // Modelos instalados no Ollama; lança erro se o Ollama não estiver rodando.
    ollamaModels(): Promise<string[]>
  }
}

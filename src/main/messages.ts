// Messages from the main process that reach the UI (errors, indexing progress), in the app language.
// Model-facing text lives in prompts.ts.

import { getLanguage } from './settings'
import type { Lang } from '../shared/types'

const pt = {
  noEncryption: 'Criptografia do sistema indisponível; defina ANTHROPIC_API_KEY no ambiente.',
  // Characters
  tibiaDataStatus: (status: number) => `TibiaData respondeu ${status}`,
  tibiaDataStatusAt: (status: number, path: string) => `TibiaData respondeu ${status} em ${path}`,
  characterNotOnTibia: (name: string) => `Personagem "${name}" não encontrado no Tibia.com`,
  characterNotFound: 'Personagem não encontrado',
  imageFormat: 'Formato de imagem não suportado',
  // Ollama
  ollamaUnreachable: 'Não consegui falar com o Ollama em localhost:11434. Ele está aberto?',
  ollamaStatus: (status: number) => `erro ${status}`,
  // Chat
  noApiKey: 'Configure sua chave da API do Claude na aba Configurações.',
  invalidApiKey: 'Chave da API inválida. Confira em Configurações.',
  rateLimited: 'Limite de uso da API atingido. Tente de novo em instantes.',
  apiError: (status: number | undefined, message: string) => `Erro da API (${status}): ${message}`,
  tooLong: 'A resposta ficou longa demais. Tente uma pergunta mais específica.',
  refused: 'O modelo recusou esta pergunta. Tente reformular.',
  // Indexing
  wikiStatus: (status: number) => `TibiaWiki respondeu ${status}`,
  ingestRunning: 'Já existe uma indexação em andamento',
  fullIngestFirst: 'Faça uma indexação completa antes de atualizar só as mudanças.',
  tooManyChanges: 'Muitas mudanças desde a última atualização. Use "Indexar tudo" para refazer a base.',
  listingPages: 'Listando páginas da TibiaWiki…',
  downloading: (title: string) => `Baixando ${title}…`,
  indexing: (title: string) => `Indexando ${title}`,
  downloadingCreatures: 'Baixando dados de criaturas da TibiaData…',
  creaturesMissing: (n: number) => ` (${n} criaturas sem dados na TibiaData)`,
  tibiaDataDown: (error: string) => ` (TibiaData indisponível: ${error}; usando só os dados da wiki)`,
  baseUpdated: 'Base de conhecimento atualizada!',
  fetchingChanges: 'Buscando mudanças na TibiaData…',
  pagesUpdated: (n: number) => `${n} página(s) atualizada(s)!`,
  noChanges: 'Nenhuma mudança relevante desde a última atualização.',
  refreshingStructured: 'Atualizando dados de hunts e criaturas…',
  structuredRefreshed: 'Dados de hunts e criaturas atualizados!',
  // Grounding gate: the question names something the base does not have, and nothing close.
  notInBase: (names: string[], similar: string[]) =>
    `Não encontrei ${names.map((n) => `"${n}"`).join(', ')} na base de conhecimento, então não vou responder ` +
    'sobre isso para não inventar.' +
    (similar.length ? ` Talvez você queira saber sobre: ${similar.join(', ')}.` : ''),
  // Name check: the answer used names found nowhere; those parts were removed.
  removedNames: (names: string[]) =>
    `⚠️ Removi desta resposta trechos que citavam nomes que não encontrei na base: ${names.join(', ')}.`,
  notEnoughData: 'Não tenho dados confiáveis na base para responder a isso.',
  // Judge: statements without support in the base were removed.
  removedClaims: (n: number) =>
    `⚠️ Removi ${n === 1 ? '1 afirmação' : `${n} afirmações`} desta resposta que não encontrei nos dados da base.`
}

export type Messages = typeof pt

const en: Messages = {
  noEncryption: 'System encryption is unavailable; set ANTHROPIC_API_KEY in the environment.',
  tibiaDataStatus: (status) => `TibiaData responded ${status}`,
  tibiaDataStatusAt: (status, path) => `TibiaData responded ${status} at ${path}`,
  characterNotOnTibia: (name) => `Character "${name}" not found on Tibia.com`,
  characterNotFound: 'Character not found',
  imageFormat: 'Unsupported image format',
  ollamaUnreachable: 'Could not reach Ollama at localhost:11434. Is it running?',
  ollamaStatus: (status) => `error ${status}`,
  noApiKey: 'Set your Claude API key in the Settings tab.',
  invalidApiKey: 'Invalid API key. Check it in Settings.',
  rateLimited: 'API usage limit reached. Try again in a moment.',
  apiError: (status, message) => `API error (${status}): ${message}`,
  tooLong: 'The answer got too long. Try a more specific question.',
  refused: 'The model declined this question. Try rephrasing it.',
  wikiStatus: (status) => `TibiaWiki responded ${status}`,
  ingestRunning: 'Indexing is already in progress',
  fullIngestFirst: 'Run a full index before updating only the changes.',
  tooManyChanges: 'Too many changes since the last update. Use "Index everything" to rebuild the base.',
  listingPages: 'Listing TibiaWiki pages…',
  downloading: (title) => `Downloading ${title}…`,
  indexing: (title) => `Indexing ${title}`,
  downloadingCreatures: 'Downloading creature data from TibiaData…',
  creaturesMissing: (n) => ` (${n} creatures without TibiaData data)`,
  tibiaDataDown: (error) => ` (TibiaData unavailable: ${error}; using only the wiki data)`,
  baseUpdated: 'Knowledge base updated!',
  fetchingChanges: 'Looking for changes on TibiaData…',
  pagesUpdated: (n) => `${n} page(s) updated!`,
  noChanges: 'No relevant changes since the last update.',
  refreshingStructured: 'Updating hunt and creature data…',
  structuredRefreshed: 'Hunt and creature data updated!',
  notInBase: (names, similar) =>
    `I could not find ${names.map((n) => `"${n}"`).join(', ')} in the knowledge base, so I will not answer ` +
    'about it rather than make something up.' +
    (similar.length ? ` Maybe you mean: ${similar.join(', ')}.` : ''),
  removedNames: (names) =>
    `⚠️ I removed parts of this answer that named things I could not find in the base: ${names.join(', ')}.`,
  notEnoughData: 'I do not have reliable data in the base to answer this.',
  removedClaims: (n) =>
    `⚠️ I removed ${n === 1 ? '1 statement' : `${n} statements`} from this answer that I could not find in the base data.`
}

const MESSAGES: Record<Lang, Messages> = { pt, en }

export const msg = (): Messages => MESSAGES[getLanguage()]

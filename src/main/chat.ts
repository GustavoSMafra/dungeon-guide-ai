import Anthropic from '@anthropic-ai/sdk'
import type { WebContents } from 'electron'
import { describeCharacter, getCharacter, listProgress } from './characters'
import { runTool, TOOLS, TOOLS_NOTE } from './chat-tools'
import { streamChat } from './ollama'
import {
  characterStats,
  partyModeFromText,
  VOCATION_DAMAGE,
  vocationGroup,
  type CharacterSkills,
  type VocationGroup
} from './rag/risk'
import type { LootItem } from './rag/infobox'
import { adviseHunts, adviseQuests, type QuestAdvice } from './rag/structured'
import { hybridSearch, type SearchHit } from './rag/search'
import { getApiKey, getProvider } from './settings'
import type { Source } from '../shared/types'

const CLAUDE_MODEL = 'claude-opus-5-5'

// Mantido estável (sem datas ou dados do personagem) para o prompt caching funcionar.
const SYSTEM = `Você é o Dungeon Guide, um companheiro experiente de Tibia que ajuda o jogador com dicas, dúvidas, rotas de hunt, quests, bosses e tutoriais passo a passo.

Cada mensagem do jogador pode trazer:
- <personagem>: dados e progresso do personagem ativo. Use para personalizar (vocação, level, quests já feitas).
- <hunts_do_banco>: hunts da TibiaWiki já avaliadas pelo app para o level e a vocação do personagem. Cada hunt traz a formação recomendada (solo, dupla ou grupo), o risco calculado e o risco de cada criatura, com HP, exp, dificuldade no bestiário e fraquezas. É a fonte certa para recomendar hunts e bestiário.
- <quests_do_banco>: quests da TibiaWiki já filtradas pelo app (level mínimo atingido, tipo de conta, sem as já concluídas), com level mínimo e recomendado, o que a recompensa dá e o risco das criaturas perigosas. As marcadas como [ACESSO] liberam áreas ou funções importantes. É a fonte certa para recomendar quests.
- <trechos_wiki>: trechos recuperados da TibiaWiki (em inglês). Eles são sua fonte principal.

Como responder:
- Responda em português do Brasil, mesmo que os trechos estejam em inglês. Mantenha nomes próprios do jogo (criaturas, itens, NPCs, lugares) em inglês, como aparecem no jogo.
- Baseie fatos concretos (HP, exp, fraquezas, loot, requisitos) nos trechos e cite a página entre colchetes, ex.: [Demon]. Se os trechos não cobrirem a pergunta, diga isso e responda com seu conhecimento geral, avisando que pode estar desatualizado.
- Para tutoriais e rotas, use passos numerados e seja prático: o que levar, onde ir, o que evitar.
- Ao recomendar hunts, use os riscos e formações de <hunts_do_banco> como estão, sem recalcular. Se o jogador não disse se vai sozinho, em dupla ou em grupo, informe para cada hunt a formação recomendada ("solo", "dupla" ou "grupo"). Avise sobre as criaturas marcadas como perigosas.
- Ao recomendar quests, priorize as de acesso e use os levels exatamente como aparecem em <quests_do_banco>; nunca escreva um requisito que não esteja lá. Mencione a formação recomendada e os perigos.
- Os riscos são estimativas do app: diga isso uma vez, de forma breve.
- Não ajude com bots, cheats, exploits ou qualquer coisa que viole as regras do Tibia.`

// Modelos locais pequenos inventam muito quando faltam dados; para eles, regras mais rígidas.
const STRICT_RULES = `

Regras obrigatórias:
- Use somente criaturas, hunts, quests, cidades, itens e números que aparecem em <hunts_do_banco>, <quests_do_banco> ou <trechos_wiki>. Nunca invente nomes, levels, exp ou locais.
- Se a informação não estiver nesses blocos, diga claramente: "Não encontrei isso na base de conhecimento" e sugira indexar mais categorias nas Configurações. Não complete com suposições.`

// Perguntas sobre onde caçar ou sobre bestiário recebem a lista filtrada de hunts.
const HUNT_INTENT = /\bhunts?\b|ca[çc]a|upar|\bxp\b|\bexp\b|experi[eê]ncia|besti[aá]ri|charm|onde (ir|treinar)|respawn/i

const RISK_ICON: Record<string, string> = { baixo: '🟢', moderado: '🟡', alto: '🟠', 'muito alto': '🔴' }

const QUEST_INTENT = /\bquests?\b|miss(ão|ao|ões|oes)\b|\bacesso\b|\baccess\b|bless/i

const shorten = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

function questLine(q: QuestAdvice): string {
  const levels = [
    `level mínimo: ${q.level ?? 'não informado'}`,
    `level recomendado: ${q.levelRec ?? 'não informado'}`,
    `conta: ${q.premium === true ? 'premium' : q.premium === false ? 'free' : 'não informado'}`
  ]
  const flags = [q.isAccess ? '[ACESSO]' : '', q.inProgress ? '[EM ANDAMENTO]' : ''].filter(Boolean)
  const formation = q.recommended
    ? `formação recomendada: ${q.recommended}`
    : q.risk
      ? 'formação recomendada: evitar por enquanto'
      : 'formação: sem dados de perigo'
  const danger = q.risk?.dangerous.length ? ` · ⚠ perigosos solo: ${q.risk.dangerous.map((d) => d.name).join(', ')}` : ''
  return [
    `- ${q.name}${q.aka ? ` (aka ${q.aka})` : ''} ${flags.join(' ')}`,
    `  ${levels.join(' · ')} · ${formation}${danger}`,
    q.tags.length ? `  recompensa dá: ${q.tags.join(', ')}` : '',
    q.reward ? `  recompensa: ${shorten(q.reward, 260)}` : '',
    q.location ? `  local: ${shorten(q.location, 120)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

function questsBlock(characterId: number | null, text: string): { block: string; sources: Source[] } | null {
  if (characterId === null || !QUEST_INTENT.test(text)) return null
  const c = getCharacter(characterId)
  if (!c?.level) return null
  const { now, later } = adviseQuests(
    { vocation: c.vocation, level: c.level, premium: c.premium, skills: c.skills },
    listProgress(characterId).filter((p) => p.kind === 'quest')
  )
  const account = c.premium === null ? 'tipo de conta desconhecido' : c.premium ? 'conta Premium' : 'conta Free'
  const header =
    `Quests para ${c.vocation} level ${c.level} (${account}), sem as que o jogador marcou como concluídas. ` +
    'Ordenadas por importância: acesso primeiro, depois blessings, magias, outfits e montarias.'
  // Seções separadas: modelos pequenos confundem o rótulo [ACESSO] numa lista única.
  const section = (title: string, list: QuestAdvice[]): string =>
    list.length ? `\n## ${title}\n${list.map(questLine).join('\n')}` : ''
  const body =
    section('Quests de acesso (as mais importantes)', now.filter((q) => q.isAccess)) +
    section('Outras quests (não são de acesso)', now.filter((q) => !q.isAccess))
  const freeNote =
    c.premium === false
      ? '\nObservação: a conta é Free, então quests premium (incluindo muitas de acesso) foram omitidas. Avise o jogador disso.'
      : ''
  const next = section('Para mais tarde (quests de acesso ainda acima do level)', later)
  return {
    block: `<quests_do_banco>\n${header}${freeNote}${body || '\nNenhuma quest indexada no alcance do level atual.'}${next}\n</quests_do_banco>`,
    sources: [...now, ...later].map((q) => ({ title: q.name, heading: 'Quest', url: q.url }))
  }
}

const SKILL_NAME: Record<VocationGroup, string> = {
  knight: 'melee',
  monk: 'fist',
  paladin: 'distance',
  sorcerer: 'magic level',
  druid: 'magic level'
}

// Explica ao modelo que skill entrou no cálculo e como ela se compara à típica do level.
function skillNote(group: VocationGroup, level: number, skills: CharacterSkills): string {
  const { offense } = characterStats(group, level, skills)
  const name = SKILL_NAME[group]
  if (!offense.informed) {
    return (
      `Skills não informadas: o app usou valores típicos para o level (${name} ~${offense.typical}). ` +
      'Sugira ao jogador preencher as skills na aba Personagens para uma avaliação mais precisa.'
    )
  }
  const diff = offense.skill - offense.typical
  const comparison = Math.abs(diff) <= 3 ? 'na média' : diff > 0 ? 'acima da média' : 'abaixo da média'
  return `Skills informadas: ${name} ${offense.skill} (típico do level: ~${offense.typical}, ${comparison}); os riscos já consideram isso.`
}

// Os drops mais valiosos costumam ser os raros; a lista inteira lotaria o bloco.
function rareLoot(loot: LootItem[] | undefined): string {
  const rare = (loot ?? []).filter((l) => l.rarity === 'very rare' || l.rarity === 'rare').slice(0, 4)
  return rare.length ? `loot raro: ${rare.map((l) => l.item).join(', ')}` : ''
}

function huntsBlock(characterId: number | null, text: string): { block: string; sources: Source[] } | null {
  if (characterId === null || !HUNT_INTENT.test(text)) return null
  const c = getCharacter(characterId)
  if (!c?.level) return null
  const party = partyModeFromText(text)
  const group = vocationGroup(c.vocation)
  const hunts = adviseHunts(c.vocation, c.level, party, 10, c.skills)
  const header =
    `Avaliação do app para ${c.vocation} level ${c.level}. ` +
    (group ? `${skillNote(group, c.level, c.skills)} ` : '') +
    (party
      ? `O jogador disse que vai em formação "${party}": só aparecem hunts com risco aceitável nessa formação.`
      : 'O jogador não disse a formação: cada hunt traz a formação recomendada (solo, dupla ou grupo).') +
    ' Os riscos são estimativas a partir dos dados da TibiaWiki.' +
    (group ? `\n${c.vocation} ${VOCATION_DAMAGE[group]}.` : '') +
    '\nBestiário: criaturas de dificuldade Harmless/Trivial/Easy pedem menos kills para completar; priorize as de risco baixo e boa exp.' +
    '\nLoot: cite apenas os itens listados em "melhor loot" ou "loot raro"; se não houver, não invente itens.'
  if (!hunts.length) {
    const why = party ? `com risco aceitável em ${party}` : 'avaliáveis'
    return {
      block: `<hunts_do_banco>\n${header}\nNenhuma hunt ${why} encontrada perto do level ${c.level}. A base pode estar incompleta.\n</hunts_do_banco>`,
      sources: []
    }
  }
  const lines = hunts.map((h) => {
    const meta = [
      h.city ? `cidade ${h.city}` : '',
      `level recomendado ${h.level}`,
      h.exp ? `exp ${h.exp}` : '',
      h.loot ? `loot ${h.loot}` : '',
      h.bestLoot.length ? `melhor loot: ${h.bestLoot.join(', ')}` : ''
    ].filter(Boolean)
    const formation = party
      ? `risco em ${party}: ${h.risk.label}`
      : h.recommended
        ? `formação recomendada: ${h.recommended} · risco nessa formação: ${h.risk.label}`
        : `formação recomendada: evitar por enquanto (risco ${h.risk.label} mesmo em grupo)`
    const creatures = h.creatureInfo.map(({ data, risk }) => {
      const parts = [
        `HP ${data.hp}`,
        data.exp !== null ? `exp ${data.exp}` : '',
        data.bestiaryLevel ? `bestiário ${data.bestiaryLevel}${data.bestiaryClass ? ` (${data.bestiaryClass})` : ''}` : '',
        `risco ${RISK_ICON[risk.label]} ${risk.label}`,
        risk.label === 'alto' || risk.label === 'muito alto'
          ? `golpe máx. ~${risk.burstPct}% da sua vida${risk.killSeconds !== null ? `, ~${risk.killSeconds}s para matar` : ''}`
          : '',
        data.isBoss ? 'BOSS' : '',
        data.damage ?? '',
        rareLoot(data.loot)
      ].filter(Boolean)
      return `  - ${data.name}: ${parts.join(' · ')}`
    })
    const danger = h.risk.dangerous.length
      ? `\n  ⚠ perigosas nessa formação: ${h.risk.dangerous.map((d) => d.name).join(', ')}`
      : ''
    const unknown = h.unknownCreatures.length ? `\n  sem dados na base: ${h.unknownCreatures.join(', ')}` : ''
    return `- ${h.name} (${meta.join(' · ')})\n  ${formation}${danger}\n  criaturas:\n${creatures.join('\n')}${unknown}`
  })
  return {
    block: `<hunts_do_banco>\n${header}\n${lines.join('\n')}\n</hunts_do_banco>`,
    sources: hunts.map((h) => ({ title: h.name, heading: 'Hunt', url: h.url }))
  }
}

interface Conversation {
  // Histórico neutro (texto puro), usado pelo Ollama e para trocar de provedor no meio da conversa.
  transcript: { role: 'user' | 'assistant'; content: string }[]
  // Histórico nativo do Claude (inclui thinking e chamadas de ferramenta); válido só enquanto
  // claudeCovers for igual ao tamanho do transcript.
  claude: Anthropic.Beta.BetaMessageParam[]
  claudeCovers: number
  queries: string[]
}

const conversations = new Map<string, Conversation>()

function getConversation(id: string): Conversation {
  let c = conversations.get(id)
  if (!c) {
    c = { transcript: [], claude: [], claudeCovers: 0, queries: [] }
    conversations.set(id, c)
  }
  return c
}

function buildUserTurn(text: string, hits: SearchHit[], character: string | null, blocks: string[]): string {
  const parts: string[] = []
  if (character) parts.push(`<personagem>\n${character}\n</personagem>`)
  parts.push(...blocks)
  if (hits.length) {
    const excerpts = hits
      .map((h) => `<trecho fonte="${h.title}" secao="${h.heading}" url="${h.url}">\n${h.text}\n</trecho>`)
      .join('\n')
    parts.push(`<trechos_wiki>\n${excerpts}\n</trechos_wiki>`)
  } else {
    parts.push('<trechos_wiki>Nenhum trecho encontrado (a base pode não estar indexada).</trechos_wiki>')
  }
  parts.push(`<pergunta>\n${text}\n</pergunta>`)
  return parts.join('\n\n')
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Chave da API inválida. Confira em Configurações.'
  if (err instanceof Anthropic.RateLimitError) return 'Limite de uso da API atingido. Tente de novo em instantes.'
  if (err instanceof Anthropic.APIError) return `Erro da API (${err.status}): ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

export function resetConversation(conversationId: string): void {
  conversations.delete(conversationId)
}

// Rodadas de ferramenta por pergunta; na última, o modelo tem de responder sem ferramentas.
const MAX_TOOL_ROUNDS = 6

async function answerWithClaude(
  conv: Conversation,
  userTurn: string,
  onDelta: (text: string) => void,
  onSource: (source: Source) => void
): Promise<string | null> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('Configure sua chave da API do Claude na aba Configurações.')
  const client = new Anthropic({ apiKey })

  // Se a conversa teve turnos de outro provedor, reconstrói o histórico a partir do texto.
  const history: Anthropic.Beta.BetaMessageParam[] =
    conv.claudeCovers === conv.transcript.length ? conv.claude : [...conv.transcript]
  const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: 'user', content: userTurn }]

  let answer = ''
  let jsonRetries = 0
  for (let round = 0; ; round++) {
    const stream = client.beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 64000,
      system: SYSTEM + TOOLS_NOTE,
      tools: TOOLS,
      tool_choice: round < MAX_TOOL_ROUNDS ? { type: 'auto' } : { type: 'none' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      // Se um classificador de segurança recusar por engano, a API refaz o pedido em outro modelo.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages
    })
    // Separa o texto de rodadas diferentes (antes e depois de uma consulta).
    let first = true
    stream.on('text', (delta) => {
      if (first && answer && delta) onDelta('\n\n')
      first = false
      onDelta(delta)
    })

    let final: Anthropic.Beta.BetaMessage
    try {
      final = await stream.finalMessage()
      jsonRetries = 0
    } catch (err) {
      // Com eager_input_streaming, uma entrada de ferramenta ilegível rejeita aqui; só esse caso
      // é refeito. Erros da API seguem para describeError.
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err
      round--
      continue
    }
    if (final.stop_reason === 'refusal') return null

    const text = final.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    if (text) answer = answer ? `${answer}\n\n${text}` : text
    // Anexa o conteúdo completo (thinking, chamadas de ferramenta) para manter o histórico append-only.
    messages.push({ role: 'assistant', content: final.content })

    const calls = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (!calls.length) break
    if (final.stop_reason === 'max_tokens') throw new Error('A resposta ficou longa demais. Tente uma pergunta mais específica.')

    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const out = await runTool(call.name, call.input)
        if (out.source) onSource(out.source)
        return { type: 'tool_result', tool_use_id: call.id, content: out.content, is_error: out.isError }
      })
    )
    messages.push({ role: 'user', content: results })
  }

  conv.claude = messages
  // sendMessage acrescenta a pergunta e a resposta ao transcript logo em seguida.
  conv.claudeCovers = conv.transcript.length + 2
  return answer
}

export async function sendMessage(
  wc: WebContents,
  conversationId: string,
  text: string,
  characterId: number | null
): Promise<void> {
  const { provider, ollamaModel } = getProvider()
  const model = provider === 'claude' ? CLAUDE_MODEL : ollamaModel
  try {
    const conv = getConversation(conversationId)

    // As duas últimas perguntas ajudam em follow-ups como "e qual a fraqueza dele?".
    conv.queries = [...conv.queries, text].slice(-2)
    const structured = [huntsBlock(characterId, text), questsBlock(characterId, text)].filter(
      (b): b is { block: string; sources: Source[] } => b !== null
    )
    // Com listas avaliadas pelo app (hunts, quests), poucos trechos soltos: itens fora da lista
    // (sem filtro de level nem avaliação de risco) confundem o modelo.
    const hits = await hybridSearch(conv.queries.join('\n'), structured.length ? 3 : 8)
    const seen = new Set<string>()
    const sources: Source[] = [...structured.flatMap((s) => s.sources), ...hits]
      .filter((s) => !seen.has(s.title) && seen.add(s.title))
      .map((s) => ({ title: s.title, heading: s.heading, url: s.url }))
    wc.send('chat:sources', { conversationId, sources })
    // Páginas consultadas pelas ferramentas entram nas fontes (a UI substitui a lista inteira).
    const onSource = (s: Source): void => {
      if (seen.has(s.title)) return
      seen.add(s.title)
      sources.push(s)
      wc.send('chat:sources', { conversationId, sources: [...sources] })
    }

    const character = characterId === null ? null : describeCharacter(characterId)
    const userTurn = buildUserTurn(
      text,
      hits,
      character,
      structured.map((s) => s.block)
    )
    const onDelta = (delta: string): void => wc.send('chat:delta', { conversationId, text: delta })

    const answer =
      provider === 'claude'
        ? await answerWithClaude(conv, userTurn, onDelta, onSource)
        : await streamChat(
            ollamaModel,
            [{ role: 'system', content: SYSTEM + STRICT_RULES }, ...conv.transcript, { role: 'user', content: userTurn }],
            onDelta
          )

    if (answer === null) {
      wc.send('chat:done', { conversationId, model, error: 'O modelo recusou esta pergunta. Tente reformular.' })
      return
    }
    // Guarda só a pergunta: o contexto (trechos, hunts) é refeito a cada turno e lotaria
    // a janela de contexto dos modelos locais.
    conv.transcript.push({ role: 'user', content: text }, { role: 'assistant', content: answer })
    wc.send('chat:done', { conversationId, model })
  } catch (err) {
    wc.send('chat:done', { conversationId, model, error: describeError(err) })
  }
}

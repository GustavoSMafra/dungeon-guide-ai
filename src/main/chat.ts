import Anthropic from '@anthropic-ai/sdk'
import type { WebContents } from 'electron'
import { describeCharacter, getCharacter, listProgress } from './characters'
import { debugEnabled, emitDebug, type DebugRecord } from './debug'
import { runTool, tools } from './chat-tools'
import { msg } from './messages'
import { streamChat } from './ollama'
import { PROMPTS, type Prompts } from './prompts'
import { characterStats, partyModeFromText, vocationGroup, type CharacterSkills, type VocationGroup } from './rag/risk'
import type { LootItem } from './rag/infobox'
import { aboutOtherItem, findItems, itemDetails, similarItems } from './rag/items'
import {
  adviseCreature,
  adviseDroppers,
  adviseHunts,
  adviseQuests,
  findCreatures,
  questCards,
  questsRewarding,
  type DropperAdvice,
  type QuestAdvice,
  type QuestCharacter,
  type RewardingQuest
} from './rag/structured'
import { findNamedPages, hybridSearch, type SearchHit, type SearchTrace } from './rag/search'
import {
  candidateNames,
  similarNames,
  stripNames,
  stripQuotes,
  unknownNamesInQuestion,
  unverifiedNames
} from './rag/verify'
import { judgeAnswer } from './judge'
import { pageUrl } from './rag/urls'
import { summarizeDamageMods, wikitextToPlain } from './rag/wikitext'
import { getApiKey, getJudge, getLanguage, getProvider } from './settings'
import type { Source } from '../shared/types'

const CLAUDE_MODEL = 'claude-opus-5-5'

// Intent detection accepts both languages whatever the app language: players mix them freely.
// Questions about where to hunt or about the bestiary get the filtered hunt list.
const HUNT_INTENT =
  /\bhunts?\b|\bhunting\b|ca[çc]a|upar|\bxp\b|\bexp\b|experi[eê]ncia|experience|besti[aá]ri|charm|onde (ir|treinar)|respawn|level(ing)? up|\bgrind|where (to|should i|can i) (go|train|level)/i

const RISK_ICON: Record<string, string> = { baixo: '🟢', moderado: '🟡', alto: '🟠', 'muito alto': '🔴' }

const QUEST_INTENT = /\bquests?\b|miss(ão|ao|ões|oes)\b|\bmissions?\b|\bacesso\b|\baccess\b|bless/i

const shorten = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

// --- Who the answer is for ------------------------------------------------------

// 'saved': the active character, for personal questions ("can I…", "where should I hunt?"). 'question': the
// level/vocation/account the question states ("for a level 80 Knight"); nothing else is assumed, so an
// account type the question leaves out stays unknown. Factual questions ("how much HP does X have?") get
// no profile at all, so the answer carries no unrequested advice.
interface Profile {
  source: 'saved' | 'question'
  characterId: number | null
  vocation: string | null
  level: number | null
  premium: boolean | null
  skills?: CharacterSkills
}

const PERSONAL =
  /\b(i|i'm|im|i've|i'd|me|my|mine|eu|meu|minha|meus|minhas|posso|devo|consigo|preciso|estou|tenho)\b|pra mim|para mim/i
const RECOMMENDATION = /recommend|suggest|\bworth\b|\bshould\b|vale a pena|indica|sugere|recomenda/i
const VOCATION_WORDS: [RegExp, string][] = [
  [/\b(elite )?knights?\b|\bcavaleiros?\b/i, 'Knight'],
  [/\b(royal )?paladins?\b|\bpaladinos?\b/i, 'Paladin'],
  [/\b(master )?sorcerers?\b|\bfeiticeir[oa]s?\b/i, 'Sorcerer'],
  [/\b(elder )?druids?\b|\bdruidas?\b/i, 'Druid'],
  [/\b(exalted )?monks?\b|\bmonges?\b/i, 'Monk']
]

function statedProfile(text: string): { level: number | null; vocation: string | null; premium: boolean | null } {
  const level = /\b(?:level|lvl|n[ií]vel)\s*(\d{1,4})\b|\b(\d{1,4})\s*(?:level|lvl)\b/i.exec(text)
  const vocation = VOCATION_WORDS.find(([re]) => re.test(text))?.[1] ?? null
  const premium = /\bfree[- ]?acc(ount)?\b|\bf2p\b|\bconta (free|gratuita|gr[aá]tis)\b/i.test(text)
    ? false
    : /\bpremium[- ]?acc(ount)?\b|\bpacc\b|\bconta premium\b/i.test(text)
      ? true
      : null
  return { level: level ? Number(level[1] ?? level[2]) : null, vocation, premium }
}

function resolveProfile(text: string, characterId: number | null, namesEntities: boolean): Profile | null {
  const stated = statedProfile(text)
  if (stated.level !== null) return { source: 'question', characterId: null, ...stated }
  // Recommendation questions ("onde upar?") are personal even without a pronoun, unless they are about a
  // named thing ("how much XP does a Dragon Lord give?" is a fact).
  const recommends = RECOMMENDATION.test(text) || HUNT_INTENT.test(text) || QUEST_INTENT.test(text)
  const personal = PERSONAL.test(text) || (!namesEntities && recommends)
  if (characterId === null || !personal) return null
  const c = getCharacter(characterId)
  if (!c) return null
  return {
    source: 'saved',
    characterId,
    vocation: c.vocation,
    level: c.level,
    premium: stated.premium ?? c.premium,
    skills: c.skills
  }
}

// The advisors need a level; without one the blocks list data without risk.
function advisorCharacter(profile: Profile | null): QuestCharacter | null {
  if (!profile?.level) return null
  return { vocation: profile.vocation, level: profile.level, premium: profile.premium, skills: profile.skills }
}

function describeProfile(p: Prompts, profile: Profile | null): string | null {
  if (!profile) return null
  if (profile.source === 'saved' && profile.characterId !== null) return describeCharacter(profile.characterId, p)
  const account = profile.premium === null ? p.character.accountUnknown : profile.premium ? 'Premium' : 'Free'
  return p.character.fromQuestion(profile.vocation, profile.level ?? 0, account)
}

function questLine(p: Prompts, q: QuestAdvice): string {
  const t = p.quests
  const levels = [
    `${t.levelMin}: ${q.level ?? t.notListed}`,
    `${t.levelRec}: ${q.levelRec ?? t.notListed}`,
    `${t.account}: ${q.premium === true ? 'premium' : q.premium === false ? 'free' : t.notListed}`
  ]
  const flags = [q.isAccess ? t.accessFlag : '', q.inProgress ? t.inProgressFlag : ''].filter(Boolean)
  const formation = q.recommended
    ? `${t.recommended}: ${p.party[q.recommended]}`
    : q.risk
      ? `${t.recommended}: ${t.avoid}`
      : t.noDangerData
  const danger = q.risk?.dangerous.length ? ` · ⚠ ${t.dangerousSolo}: ${q.risk.dangerous.map((d) => d.name).join(', ')}` : ''
  return [
    `- ${q.name}${q.aka ? ` (aka ${q.aka})` : ''} ${flags.join(' ')}`,
    `  ${levels.join(' · ')} · ${formation}${danger}`,
    q.tags.length ? `  ${t.rewardGives}: ${q.tags.map((tag) => p.rewardTags[tag] ?? tag).join(', ')}` : '',
    q.reward ? `  ${t.reward}: ${shorten(q.reward, 260)}` : '',
    q.location ? `  ${t.location}: ${shorten(q.location, 120)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

type Block = { block: string; sources: Source[] }

function questsBlock(p: Prompts, profile: Profile | null, text: string): Block | null {
  const c = advisorCharacter(profile)
  if (!c || !QUEST_INTENT.test(text)) return null
  // Progress only belongs to the saved character, not to one described in the question.
  const progress =
    profile?.source === 'saved' && profile.characterId !== null
      ? listProgress(profile.characterId).filter((item) => item.kind === 'quest')
      : []
  const { now, later } = adviseQuests(c, progress)
  const t = p.quests
  const account = c.premium === null ? t.accountUnknown : c.premium ? t.accountPremium : t.accountFree
  // Separate sections: small models mix up the access label in a single list.
  const section = (title: string, list: QuestAdvice[]): string =>
    list.length ? `\n## ${title}\n${list.map((q) => questLine(p, q)).join('\n')}` : ''
  const body =
    section(t.sectionAccess, now.filter((q) => q.isAccess)) + section(t.sectionOther, now.filter((q) => !q.isAccess))
  const freeNote = c.premium === false ? t.freeNote : ''
  const next = section(t.sectionLater, later)
  const tag = p.tags.quests
  return {
    block: `<${tag}>\n${t.header(c.vocation, c.level, account)}${freeNote}${body || t.none}${next}\n</${tag}>`,
    sources: [...now, ...later].map((q) => ({ title: q.name, heading: 'Quest', url: q.url }))
  }
}

// Quests the question names: their own data, not the recommendation list (ten unrelated quests buried the
// one asked about, and the model built "prerequisites" out of them).
// Whether the profile can do the quest, computed here: asked to reason it out, the model opened with "Yes, you
// can" and then explained that the quest needs a Premium account.
function questVerdict(p: Prompts, q: QuestAdvice, profile: Profile | null): string {
  if (!profile) return ''
  const t = p.quests.verdict
  const parts: string[] = []
  if (q.premium === true) {
    if (profile.premium === false) parts.push(t.premiumNeeded)
    else if (profile.premium === null) parts.push(t.premiumUnknown)
  }
  if (profile.level !== null) {
    if (q.level !== null && profile.level < q.level) parts.push(t.levelShort(q.level))
    else if (q.levelRec !== null && profile.level < q.levelRec) parts.push(t.belowRec(q.levelRec))
  }
  if (!parts.length && profile.level !== null) parts.push(t.ok)
  return parts.length ? `  → ${t.label(profile.vocation, profile.level)}: ${parts.join('; ')}` : ''
}

function namedQuestsBlock(p: Prompts, titles: string[], profile: Profile | null): Block | null {
  const cards = questCards(titles)
  if (!cards.length) return null
  const tag = p.tags.quests
  const lines = cards.map((q) => [questLine(p, q), questVerdict(p, q, profile)].filter(Boolean).join('\n'))
  return {
    block: `<${tag}>\n${p.quests.named}\n${lines.join('\n')}\n</${tag}>`,
    sources: cards.map((q) => ({ title: q.name, heading: 'Quest', url: q.url }))
  }
}

const SKILL_NAME: Record<VocationGroup, string> = {
  knight: 'melee',
  monk: 'fist',
  paladin: 'distance',
  sorcerer: 'magic level',
  druid: 'magic level'
}

// Tells the model which skill went into the calculation and how it compares to the level's typical value.
function skillNote(p: Prompts, group: VocationGroup, level: number, skills?: CharacterSkills): string {
  const { offense } = characterStats(group, level, skills)
  const name = SKILL_NAME[group]
  if (!offense.informed) return p.hunts.skillsMissing(name, offense.typical)
  const diff = offense.skill - offense.typical
  const comparison = Math.abs(diff) <= 3 ? p.hunts.average : diff > 0 ? p.hunts.above : p.hunts.below
  return p.hunts.skillsGiven(name, offense.skill, offense.typical, comparison)
}

// The most valuable drops are usually the rare ones; the full list would bloat the block.
function rareLoot(p: Prompts, loot: LootItem[] | undefined): string {
  const rare = (loot ?? []).filter((l) => l.rarity === 'very rare' || l.rarity === 'rare').slice(0, 4)
  return rare.length ? `${p.hunts.rareLoot}: ${rare.map((l) => l.item).join(', ')}` : ''
}

// Weaknesses and resistances, rendered from the raw modifiers in the app language
// (the stored `damage` summary is in pt-BR).
function damageLine(p: Prompts, mods: Record<string, number>): string {
  const params = Object.entries(mods).map(([element, pct]): [string, string] => [`${element}DmgMod`, String(pct)])
  return summarizeDamageMods(params, p.damageMods).slice(1).join('; ')
}

// The hunt list for the profile or, when the question names hunting places, just those (with every
// creature's risk) whatever their level.
function huntsBlock(p: Prompts, profile: Profile | null, text: string, places: string[]): Block | null {
  if (!places.length && !HUNT_INTENT.test(text)) return null
  const c = advisorCharacter(profile)
  if (!c) return null
  const t = p.hunts
  const tag = p.tags.hunts
  const mode = partyModeFromText(text)
  // Party modes and risk labels are internal keys; the model sees them in the app language.
  const party = mode && p.party[mode]
  const group = vocationGroup(c.vocation)
  const hunts = adviseHunts(
    c.vocation,
    c.level,
    mode,
    places.length ? 4 : 10,
    c.skills,
    places.length ? places : undefined
  )
  const header =
    t.header(c.vocation, c.level) +
    (places.length ? t.namedPlaces : '') +
    (group ? `${skillNote(p, group, c.level, c.skills)} ` : '') +
    (party ? t.partyGiven(party) : t.partyMissing) +
    t.estimates +
    (group ? `\n${c.vocation} ${p.vocationDamage[group]}.` : '') +
    t.bestiary +
    t.lootRule
  if (!hunts.length) {
    return { block: `<${tag}>\n${header}\n${t.noneFound(party, c.level)}\n</${tag}>`, sources: [] }
  }
  const lines = hunts.map((h) => {
    const risk = p.risk[h.risk.label]
    const meta = [
      h.city ? `${t.city} ${h.city}` : '',
      `${t.levelRec} ${h.level}`,
      h.exp ? `exp ${h.exp}` : '',
      h.loot ? `loot ${h.loot}` : '',
      h.bestLoot.length ? `${t.bestLoot}: ${h.bestLoot.join(', ')}` : ''
    ].filter(Boolean)
    const formation = party
      ? t.riskIn(party, risk)
      : h.recommended
        ? t.recommended(p.party[h.recommended], risk)
        : t.avoid(risk)
    const creatures = h.creatureInfo.map(({ data, risk: cr }) => {
      const parts = [
        `HP ${data.hp}`,
        data.exp !== null ? `exp ${data.exp}` : '',
        data.bestiaryLevel ? `${t.bestiaryLevel} ${data.bestiaryLevel}${data.bestiaryClass ? ` (${data.bestiaryClass})` : ''}` : '',
        `${t.risk} ${RISK_ICON[cr.label]} ${p.risk[cr.label]}`,
        cr.label === 'alto' || cr.label === 'muito alto'
          ? `${t.maxHit(cr.burstPct)}${cr.killSeconds !== null ? `, ${t.killTime(cr.killSeconds)}` : ''}`
          : '',
        data.isBoss ? 'BOSS' : '',
        damageLine(p, data.damageMods),
        rareLoot(p, data.loot)
      ].filter(Boolean)
      return `  - ${data.name}: ${parts.join(' · ')}`
    })
    const danger = h.risk.dangerous.length
      ? `\n  ⚠ ${t.dangerous}: ${h.risk.dangerous.map((d) => d.name).join(', ')}`
      : ''
    const unknown = h.unknownCreatures.length ? `\n  ${t.noData}: ${h.unknownCreatures.join(', ')}` : ''
    return `- ${h.name} (${meta.join(' · ')})\n  ${formation}${danger}\n  ${t.creatures}:\n${creatures.join('\n')}${unknown}`
  })
  return {
    block: `<${tag}>\n${header}\n${lines.join('\n')}\n</${tag}>`,
    sources: hunts.map((h) => ({ title: h.name, heading: 'Hunt', url: h.url }))
  }
}

// A multi-word item name is enough ("is magic plate armor good?"); single words ("Rope") also need
// one of these, or every question mentioning a common word would get an item block.
const ITEM_INTENT =
  /\b(get|obtain|find|buy|sell|drops?|dropped|loot|farm|price|worth|cost)\b|consig|conseguir|obter|pegar|comprar|vender|\bdropa|onde (acho|encontro)|pre[çc]o|\bvale\b/i

// NPC lists come as "Rashid, Sam:6400;sayname, H.L.:720".
function npcList(p: Prompts, value: string | null | undefined): string {
  const s = (value ?? '').replace(/;\w+/g, '').replace(/:\s*(\d+)/g, ' ($1 gp)').trim()
  return !s || s === '--' ? p.items.none : shorten(s, 300)
}

// Levels and account type come along so the model does not make them up.
function questSummary(p: Prompts, q: RewardingQuest): string {
  const t = p.quests
  return (
    `${q.name} (${t.levelMin}: ${q.level ?? t.notListed} · ${t.levelRec}: ${q.levelRec ?? t.notListed} · ` +
    `${t.account}: ${q.premium === true ? 'premium' : q.premium === false ? 'free' : t.notListed})`
  )
}

function dropperLine(p: Prompts, d: DropperAdvice): string {
  const parts = [
    d.data?.isBoss ? 'BOSS' : '',
    d.rarity ? `${p.items.rarity} ${d.rarity}` : '',
    d.data?.exp ? `exp ${d.data.exp}` : '',
    d.soloRisk ? `${p.creatures.soloRisk} ${RISK_ICON[d.soloRisk.label]} ${p.risk[d.soloRisk.label]}` : '',
    d.soloRisk ? `${p.quests.recommended}: ${d.recommended ? p.party[d.recommended] : p.quests.avoid}` : ''
  ].filter(Boolean)
  // No line at all when no hunt lists the creature: "place: not in the base" leaked into answers.
  const where = d.hunts.length
    ? `\n  ${p.items.foundIn}: ${d.hunts.slice(0, 3).map((h) => `${h.name} (${p.hunts.levelRec} ${h.level})`).join(', ')}`
    : d.estimatedLevel
      ? `\n  ${p.creatures.estimatedLevel(d.estimatedLevel)}`
      : ''
  return `- ${d.name}${parts.length ? `: ${parts.join(' · ')}` : ''}${where}`
}

// Exact data for the item the question names, so the model does not answer from look-alike excerpts.
async function itemBlock(p: Prompts, profile: Profile | null, name: string): Promise<(Block & { item: string }) | null> {
  const t = p.items
  const tag = p.tags.items
  const d = await itemDetails(name)
  if (!d) return { block: `<${tag}>\n${t.unavailable(name)}\n</${tag}>`, sources: [], item: name }

  const character = advisorCharacter(profile)
  const attrs = new Map((d.additionalAttributes?.entries ?? []).map((e) => [e.key, e.value]))
  const stats = [
    d.categoryName ? `${t.type}: ${d.categoryName}` : '',
    d.vocation ? `${t.vocation}: ${d.vocation}` : '',
    `${t.level}: ${d.levelRequired ?? t.noLevel}`,
    d.armor ? `armor ${d.armor}` : '',
    d.attack ? `attack ${d.attack}` : '',
    d.defense ? `defense ${d.defense}` : ''
  ].filter(Boolean)
  const notes = attrs.get('notes') ? `${t.notes}: ${shorten(wikitextToPlain(attrs.get('notes') ?? ''), 240)}` : ''

  const quests = questsRewarding(findItems, d.name)
  const droppers = adviseDroppers(d.droppedBy ?? [], d.name, character)
  const section = (title: string, list: DropperAdvice[]): string =>
    list.length ? `\n## ${title}\n${list.slice(0, 8).map((x) => dropperLine(p, x)).join('\n')}` : ''
  let drops: string
  if (!droppers.length) drops = `\n${t.noDroppers}`
  else if (!character) drops = section(t.droppedByPlain, droppers)
  else {
    const noData = droppers.filter((x) => !x.risk)
    drops =
      `\n${t.droppedBy(character.vocation, character.level)}:` +
      section(t.now, droppers.filter((x) => x.risk && x.recommended)) +
      section(t.later, droppers.filter((x) => x.risk && !x.recommended)) +
      (noData.length ? `\n## ${t.noData}\n${noData.map((x) => x.name).join(', ')}` : '')
  }
  const similar = similarItems(d.name)

  const body = [
    t.header(d.name),
    stats.join(' · '),
    `${d.marketable === 'yes' ? t.market : t.noMarket}${d.value ? ` · ${t.value}: ${d.value} gp` : ''}`,
    `${t.npcSell}: ${npcList(p, attrs.get('buyFrom'))}`,
    `${t.npcBuy}: ${npcList(p, attrs.get('sellTo'))}`,
    `${t.quests}: ${quests.length ? quests.map((q) => questSummary(p, q)).join('; ') : t.noQuests}`,
    notes,
    drops.trimStart(),
    similar.length ? `${t.similar}: ${similar.join(', ')}` : ''
  ].filter(Boolean)
  return {
    block: `<${tag}>\n${body.join('\n')}\n</${tag}>`,
    sources: [
      { title: d.name, heading: 'Item', url: d.wikiUrl ?? pageUrl(d.name) },
      ...quests.map((q) => ({ title: q.name, heading: 'Quest', url: q.url }))
    ],
    item: d.name
  }
}

const RARITY_ORDER = ['very rare', 'rare', 'semi-rare', 'uncommon', 'common']

// Exact data for the creatures the question names (at most two). The indexed text no longer carries loot
// lists or engine flags, so this block is where those facts come from.
function creaturesBlock(p: Prompts, profile: Profile | null, names: string[]): Block | null {
  if (!names.length) return null
  const character = advisorCharacter(profile)
  const t = p.creatures
  const cards = names
    .map((name) => adviseCreature(name, character))
    .filter((a): a is DropperAdvice & { data: NonNullable<DropperAdvice['data']> } => a?.data != null)
  if (!cards.length) return null

  const lines = cards.map(({ data, soloRisk, recommended, hunts, estimatedLevel }) => {
    const stats = [
      data.hp !== null ? `HP ${data.hp}` : '',
      data.exp !== null ? `exp ${data.exp}` : '',
      data.bestiaryLevel
        ? `${p.hunts.bestiaryLevel} ${data.bestiaryLevel}${data.bestiaryClass ? ` (${data.bestiaryClass})` : ''}`
        : '',
      data.isBoss ? 'BOSS' : ''
    ].filter(Boolean)
    const maxDamage = Object.entries(data.maxDamage)
      .map(([element, value]) => `${element} ${value}`)
      .join(', ')
    const forCharacter =
      soloRisk && character
        ? `${t.riskFor(character.vocation, character.level)}: ` +
          `${t.soloRisk} ${RISK_ICON[soloRisk.label]} ${p.risk[soloRisk.label]} · ` +
          `${p.quests.recommended}: ${recommended ? p.party[recommended] : p.quests.avoid}`
        : ''
    const where = hunts.length
      ? `${p.items.foundIn}: ${hunts.slice(0, 4).map((h) => `${h.name} (${p.hunts.levelRec} ${h.level})`).join(', ')}`
      : estimatedLevel
        ? t.estimatedLevel(estimatedLevel)
        : ''
    const loot = data.loot?.length
      ? `${t.loot}: ` +
        RARITY_ORDER.concat([''])
          .map((rarity) => {
            const items = data.loot!.filter((l) => (l.rarity ?? '') === rarity).map((l) => l.item)
            return items.length ? `${rarity || '?'}: ${shorten(items.join(', '), 300)}` : ''
          })
          .filter(Boolean)
          .join(' | ')
      : t.noLoot
    return [
      `- ${data.name}: ${stats.join(' · ')}`,
      damageLine(p, data.damageMods) ? `  ${damageLine(p, data.damageMods)}` : '',
      maxDamage ? `  ${t.maxDamage}: ${maxDamage}` : '',
      forCharacter ? `  ${forCharacter}` : '',
      where ? `  ${where}` : '',
      `  ${loot}`
    ]
      .filter(Boolean)
      .join('\n')
  })
  const tag = p.tags.creatures
  return {
    block: `<${tag}>\n${t.header}\n${lines.join('\n')}\n</${tag}>`,
    sources: cards.map((x) => ({ title: x.data.name, heading: 'Creature', url: pageUrl(x.data.name) }))
  }
}

interface Conversation {
  // Provider-neutral history (plain text), used by Ollama and when switching providers mid-conversation.
  transcript: { role: 'user' | 'assistant'; content: string }[]
  // Native Claude history (includes thinking and tool calls); valid only while
  // claudeCovers equals the transcript length.
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

function buildUserTurn(p: Prompts, text: string, hits: SearchHit[], character: string | null, blocks: string[]): string {
  const t = p.tags
  const parts: string[] = []
  if (character) parts.push(`<${t.character}>\n${character}\n</${t.character}>`)
  parts.push(...blocks)
  if (hits.length) {
    const excerpts = hits
      .map(
        (h) =>
          `<${t.excerpt} ${t.source}="${h.title}" ${t.section}="${h.heading}" url="${h.url}">\n${h.text}\n</${t.excerpt}>`
      )
      .join('\n')
    parts.push(`<${t.excerpts}>\n${excerpts}\n</${t.excerpts}>`)
  } else {
    parts.push(`<${t.excerpts}>${p.noExcerpts}</${t.excerpts}>`)
  }
  parts.push(`<${t.question}>\n${text}\n</${t.question}>`, p.answerLanguage)
  return parts.join('\n\n')
}

// Pages named in the answer (cited as [Page] or just mentioned). When it names none, the list stays
// as is rather than showing no sources at all.
function usedSources(sources: Source[], answer: string): Source[] {
  const text = answer.toLowerCase()
  const used = sources.filter((s) => text.includes(s.title.replace(/\s*\([^)]*\)$/, '').toLowerCase()))
  return used.length ? used : sources
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return msg().invalidApiKey
  if (err instanceof Anthropic.RateLimitError) return msg().rateLimited
  if (err instanceof Anthropic.APIError) return msg().apiError(err.status, err.message)
  return err instanceof Error ? err.message : String(err)
}

export function resetConversation(conversationId: string): void {
  conversations.delete(conversationId)
}

// Tool rounds per question; on the last one the model must answer without tools.
const MAX_TOOL_ROUNDS = 6

async function answerWithClaude(
  p: Prompts,
  conv: Conversation,
  userTurn: string,
  onDelta: (text: string) => void,
  onSource: (source: Source) => void,
  onToolResult: (content: string) => void
): Promise<string | null> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error(msg().noApiKey)
  const client = new Anthropic({ apiKey })

  // If the conversation had turns from another provider, rebuild the history from plain text.
  const history: Anthropic.Beta.BetaMessageParam[] =
    conv.claudeCovers === conv.transcript.length ? conv.claude : [...conv.transcript]
  const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: 'user', content: userTurn }]

  let answer = ''
  let jsonRetries = 0
  for (let round = 0; ; round++) {
    const stream = client.beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 64000,
      system: p.system + p.toolsNote,
      tools: tools(p),
      tool_choice: round < MAX_TOOL_ROUNDS ? { type: 'auto' } : { type: 'none' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      // If a safety classifier refuses by mistake, the API retries the request on another model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages
    })
    // Separates text from different rounds (before and after a lookup).
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
      // With eager_input_streaming, an unparseable tool input rejects here; only that case
      // is retried. API errors go on to describeError.
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err
      round--
      continue
    }
    if (final.stop_reason === 'refusal') return null

    const text = final.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    if (text) answer = answer ? `${answer}\n\n${text}` : text
    // Appends the full content (thinking, tool calls) to keep the history append-only.
    messages.push({ role: 'assistant', content: final.content })

    const calls = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (!calls.length) break
    if (final.stop_reason === 'max_tokens') throw new Error(msg().tooLong)

    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const out = await runTool(p, call.name, call.input)
        if (out.source) onSource(out.source)
        if (!out.isError) onToolResult(out.content)
        return { type: 'tool_result', tool_use_id: call.id, content: out.content, is_error: out.isError }
      })
    )
    messages.push({ role: 'user', content: results })
  }

  conv.claude = messages
  // sendMessage appends the question and the answer to the transcript right after.
  conv.claudeCovers = conv.transcript.length + 2
  return answer
}

// Questions about a price "right now": the base has none.
const REALTIME = /\b(right now|currently|current price|today|at the moment|agora|hoje|atualmente|no momento)\b/i
const PRICE = /\b(cost|costs|price|prices|worth|preço|preços|custa|custo|valor)\b/i

// Blanks out every occurrence of the names (case-insensitive) so a later lookup cannot match inside them.
function maskNames(text: string, names: string[]): string {
  let out = text
  for (const name of names) {
    const lower = name.toLowerCase()
    let at = out.toLowerCase().indexOf(lower)
    while (at !== -1) {
      out = out.slice(0, at) + ' '.repeat(name.length) + out.slice(at + name.length)
      at = out.toLowerCase().indexOf(lower, at + name.length)
    }
  }
  return out
}

// Hunting-place pages and quest pages the question names get their own data blocks.
const QUEST_CATEGORY = 'Quest Overview Pages'
const PLACE_CATEGORY = 'Hunting Places'

export async function sendMessage(
  wc: WebContents,
  conversationId: string,
  text: string,
  characterId: number | null
): Promise<void> {
  const { provider, ollamaModel } = getProvider()
  const model = provider === 'claude' ? CLAUDE_MODEL : ollamaModel
  // Read on every question; the UI starts a new conversation when the language changes.
  const p = PROMPTS[getLanguage()]
  const dbg: DebugRecord | null = debugEnabled()
    ? {
        at: new Date().toISOString(),
        conversationId,
        question: text,
        provider,
        model,
        searchQuery: '',
        search: null,
        blocks: [],
        prompt: [],
        answer: null,
        unverified: [],
        judge: null,
        contextSources: [],
        sources: [],
        shortCircuit: null,
        error: null
      }
    : null
  try {
    const conv = getConversation(conversationId)

    // What the question names: items, pages (titles and aliases) and creatures. Item names are masked
    // before the page lookup: "Plate Armor" (alias of "Plate Armor Quest") must not match inside "Magic
    // Plate Armor".
    const foundItems = findItems(text)
    const items = foundItems.filter((n) => n.includes(' ') || ITEM_INTENT.test(text)).slice(0, 2)
    const pages = findNamedPages(maskNames(text, foundItems))
    const creatures = findCreatures(text)
      .filter((n) => !items.some((i) => i.toLowerCase() === n.toLowerCase()))
      .slice(0, 3)
    const namesEntities = pages.length + items.length + creatures.length > 0
    const unknown = unknownNamesInQuestion(text)

    // Grounding gate: the question is about something the base does not know and nothing close to it.
    // Answering anyway is how made-up quests and creatures reached the player.
    if (unknown.length && !namesEntities) {
      const similar = [...new Set(unknown.flatMap((n) => similarNames(n)))].slice(0, 4)
      if (!similar.length) {
        const reply = msg().notInBase(unknown, [])
        wc.send('chat:sources', { conversationId, sources: [] })
        wc.send('chat:delta', { conversationId, text: reply })
        conv.transcript.push({ role: 'user', content: text }, { role: 'assistant', content: reply })
        if (dbg) emitDebug({ ...dbg, answer: reply, shortCircuit: `unknown names: ${unknown.join(', ')}` })
        wc.send('chat:done', { conversationId, model })
        return
      }
    }

    // A question that names nothing is a follow-up ("and its weaknesses?"): it inherits the previous
    // question for the search and sees the last exchange. Otherwise each question stands alone: earlier
    // questions and answers leaked into retrieval and into the answers. Towns without a page ("from Thais
    // to Liberty Bay") also make a question stand alone.
    const followUp = !namesEntities && !candidateNames(text).length && conv.queries.length > 0
    const searchQuery = followUp ? [...conv.queries.slice(-1), text].join('\n') : text
    conv.queries = [text]
    const history = followUp ? conv.transcript.slice(-2) : []

    const profile = resolveProfile(text, characterId, namesEntities)
    const questTitles = pages.filter((pg) => pg.category === QUEST_CATEGORY).map((pg) => pg.title)
    const placeTitles = pages.filter((pg) => pg.category === PLACE_CATEGORY).map((pg) => pg.title)
    const itemBlocks = await Promise.all(items.map((name) => itemBlock(p, profile, name)))
    const structured = [
      questTitles.length ? namedQuestsBlock(p, questTitles, profile) : questsBlock(p, profile, text),
      // A named creature has its own block; the generic hunt list would only add unrelated hunts.
      creatures.length ? null : huntsBlock(p, profile, text, placeTitles),
      ...itemBlocks,
      creaturesBlock(p, profile, creatures)
    ].filter((b): b is Block => b !== null)
    const askedItems = itemBlocks.filter((b): b is Block & { item: string } => b !== null).map((b) => b.item)

    // With app-scored lists (hunts, quests), only a few loose excerpts: items outside the list
    // (not filtered by level nor risk-scored) confuse the model. Excerpts about a look-alike item
    // ("Plate Armor Quest" for Magic Plate Armor) are dropped.
    const trace = dbg ? ({} as SearchTrace) : undefined
    const hits = (await hybridSearch(searchQuery, structured.length ? 3 : 8, undefined, trace)).filter(
      (h) => !askedItems.length || !askedItems.every((i) => aboutOtherItem(h.title, i))
    )
    if (dbg) {
      dbg.searchQuery = searchQuery
      dbg.search = trace ?? null
      dbg.blocks = structured.map((s) => s.block)
    }
    const seen = new Set<string>()
    const sources: Source[] = [...structured.flatMap((s) => s.sources), ...hits]
      .filter((s) => !seen.has(s.title) && seen.add(s.title))
      .map((s) => ({ title: s.title, heading: s.heading, url: s.url }))
    wc.send('chat:sources', { conversationId, sources })
    if (dbg) dbg.contextSources = sources.map((s) => s.title)
    // Pages looked up by the tools are added to the sources (the UI replaces the whole list).
    const onSource = (s: Source): void => {
      if (seen.has(s.title)) return
      seen.add(s.title)
      sources.push(s)
      wc.send('chat:sources', { conversationId, sources: [...sources] })
    }

    const notes = [
      unknown.length ? p.missingNote(unknown, [...new Set(unknown.flatMap((n) => similarNames(n)))].slice(0, 4)) : '',
      REALTIME.test(text) && PRICE.test(text) ? p.realtimeNote : ''
    ].filter(Boolean)
    const userTurn = buildUserTurn(
      p,
      text,
      hits,
      describeProfile(p, profile),
      [...notes, ...structured.map((s) => s.block)]
    )
    const onDelta = (delta: string): void => wc.send('chat:delta', { conversationId, text: delta })
    // What Claude's tools returned also counts as context for the name check.
    const toolResults: string[] = []

    const ollamaMessages = [
      { role: 'system' as const, content: p.system + p.strictRules },
      ...history,
      { role: 'user' as const, content: userTurn }
    ]
    if (dbg) {
      dbg.prompt =
        provider === 'claude'
          ? [{ role: 'system', content: p.system + p.toolsNote }, ...conv.transcript, { role: 'user', content: userTurn }]
          : ollamaMessages
    }
    const answer =
      provider === 'claude'
        ? await answerWithClaude(p, conv, userTurn, onDelta, onSource, (c) => toolResults.push(c))
        : await streamChat(ollamaModel, ollamaMessages, onDelta)

    if (answer === null) {
      if (dbg) emitDebug({ ...dbg, error: msg().refused })
      wc.send('chat:done', { conversationId, model, error: msg().refused })
      return
    }

    // Names the answer uses that neither the context nor the base has: likely made up. The answer has
    // already streamed, so the cleaned version replaces it: the parts that use those names are removed.
    const unverified = unverifiedNames(answer, [userTurn, ...toolResults].join('\n'))
    let cleaned = unverified.length ? stripNames(answer, unverified) : answer
    // Second pass for local models (judge.ts): statements the context does not support, which the name check
    // cannot see (wrong relations between real names, routes, numbers). Claude checks with its tools instead.
    const findings =
      provider === 'ollama' && getJudge() && cleaned.length >= 80
        ? await judgeAnswer(p, ollamaModel, userTurn, cleaned, { think: true })
        : null
    if (findings?.length) cleaned = stripQuotes(cleaned, findings.map((f) => f.quote))
    let final = answer
    const removals = [
      unverified.length ? msg().removedNames(unverified) : '',
      findings?.length ? msg().removedClaims(findings.length) : ''
    ].filter(Boolean)
    if (removals.length) {
      final = `${cleaned.length >= 80 ? cleaned : msg().notEnoughData}\n\n---\n${removals.join('\n')}`
      wc.send('chat:replace', { conversationId, text: final })
    }
    // Stores only the question: the context (excerpts, hunts) is rebuilt every turn and would fill
    // the context window of local models.
    conv.transcript.push({ role: 'user', content: text }, { role: 'assistant', content: final })
    // Sources the answer actually uses (by page name); the context ones it ignored would mislead.
    const used = usedSources(sources, final)
    if (used.length !== sources.length) wc.send('chat:sources', { conversationId, sources: used })
    if (dbg) emitDebug({ ...dbg, answer: final, unverified, judge: findings, sources: used.map((s) => s.title) })
    wc.send('chat:done', { conversationId, model })
  } catch (err) {
    if (dbg) emitDebug({ ...dbg, error: describeError(err) })
    wc.send('chat:done', { conversationId, model, error: describeError(err) })
  }
}

import {
  extractTemplate,
  parseInfobox,
  parseTemplateRaw,
  splitTopLevel,
  summarizeDamageMods,
  wikitextToPlain
} from './wikitext'

export interface HuntData {
  name: string
  city: string | null
  levels: Record<string, number>
  exp: string | null
  loot: string | null
  // Itens de destaque (bestloot, bestloot2... do infobox).
  bestLoot: string[]
  creatures: string[]
}

export interface CreatureData {
  name: string
  hp: number | null
  exp: number | null
  bestiaryClass: string | null
  bestiaryLevel: string | null
  occurrence: string | null
  damage: string | null
  // Dano máximo por elemento (ou { total } quando a wiki só informa o total).
  maxDamage: Record<string, number>
  attackType: string | null
  isBoss: boolean
  // % de dano que a criatura recebe por elemento (100 = normal).
  damageMods: Record<string, number>
  // Só nos dados da API da TibiaData (o parser de wikitext não extrai loot).
  loot?: LootItem[]
}

export interface LootItem {
  item: string
  // common, uncommon, semi-rare, rare, very rare (null = não informado).
  rarity: string | null
}

const toInt = (v: string | undefined): number | null => {
  const n = parseInt((v ?? '').replace(/[^\d]/g, ''), 10)
  return Number.isNaN(n) ? null : n
}

export function parseHunt(title: string, src: string): HuntData | null {
  const box = parseInfobox(src, 'Infobox Hunt')
  if (!box) return null
  const levels: Record<string, number> = {}
  for (const [key, value] of box) {
    const m = /^lvl(\w+)$/.exec(key)
    const n = toInt(value)
    if (m && n !== null) levels[m[1]] = n
  }
  const list = extractTemplate(src, 'CreatureList')
  const creatures = list
    ? splitTopLevel(list)
        .slice(1)
        .filter((p) => !p.includes('='))
        .map((p) => wikitextToPlain(p).trim())
        .filter(Boolean)
    : []
  return {
    name: box.get('name') ?? title,
    city: box.get('city') ?? null,
    levels,
    exp: box.get('exp') ?? null,
    loot: box.get('loot') ?? null,
    bestLoot: ['bestloot', 'bestloot2', 'bestloot3', 'bestloot4', 'bestloot5']
      .map((k) => box.get(k))
      .filter((v): v is string => Boolean(v)),
    creatures
  }
}

// "{{Max Damage|physical=120|fire=310}}" → { physical: 120, fire: 310 }; "358" → { total: 358 }.
export function parseMaxDamage(raw: string | undefined): Record<string, number> {
  if (!raw) return {}
  const tpl = parseTemplateRaw(raw, 'Max Damage')
  if (!tpl) {
    const total = toInt(raw)
    return total ? { total } : {}
  }
  const out: Record<string, number> = {}
  for (const [key, value] of tpl) {
    const n = toInt(value)
    if (n) out[key] = n
  }
  return out
}

export function parseCreature(title: string, src: string): CreatureData | null {
  const raw = parseTemplateRaw(src, 'Infobox Creature')
  const box = parseInfobox(src, 'Infobox Creature')
  if (!raw || !box) return null
  const damage = summarizeDamageMods([...box.entries()]).slice(1).join('; ')
  const damageMods: Record<string, number> = {}
  for (const [key, value] of box) {
    const m = /^(\w+)dmgmod$/.exec(key)
    const pct = parseFloat(value)
    if (m && !Number.isNaN(pct)) damageMods[m[1]] = pct
  }
  return {
    name: box.get('name') ?? title,
    hp: toInt(box.get('hp')),
    exp: toInt(box.get('exp')),
    bestiaryClass: box.get('bestiaryclass') ?? null,
    bestiaryLevel: box.get('bestiarylevel') ?? null,
    occurrence: box.get('occurrence') ?? null,
    damage: damage || null,
    maxDamage: parseMaxDamage(raw.get('maxdmg')),
    attackType: box.get('attacktype') ?? null,
    isBoss: /^yes/i.test(box.get('isboss') ?? ''),
    damageMods
  }
}


export interface QuestData {
  name: string
  aka: string | null
  level: number | null
  levelRec: number | null
  premium: boolean | null
  reward: string | null
  location: string | null
  // Criaturas e bosses citados em "dangers" (alvos dos links).
  dangers: string[]
  legend: string | null
  // O que a recompensa dá: acesso, blessing, outfit, montaria...
  tags: string[]
}

const REWARD_TAGS: [string, RegExp][] = [
  ['acesso', /\baccess\b/i],
  ['blessing', /blessing/i],
  ['outfit', /outfit|addon/i],
  ['montaria', /\bmount\b/i],
  ['magia', /\bspell\b/i],
  ['achievement', /achievement/i]
]

// Links [[Alvo|texto]] de um trecho de wikitext → ["Alvo"].
function linkTargets(raw: string): string[] {
  return [...raw.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)]
    .map((m) => m[1].trim())
    .filter((t) => !/^(file|image|category):/i.test(t))
}

export function parseQuest(title: string, src: string): QuestData | null {
  const raw = parseTemplateRaw(src, 'Infobox Quest')
  const box = parseInfobox(src, 'Infobox Quest')
  if (!raw || !box) return null
  const reward = box.get('reward') ?? null
  const premium = box.get('premium')
  return {
    name: box.get('name') ?? title,
    aka: box.get('aka') ?? null,
    level: toInt(box.get('lvl')?.match(/\d+/)?.[0]),
    levelRec: toInt(box.get('lvlrec')?.match(/\d+/)?.[0]),
    premium: premium ? /^yes/i.test(premium) : null,
    reward,
    location: box.get('location') ?? null,
    dangers: [...new Set(linkTargets(raw.get('dangers') ?? ''))],
    legend: box.get('legend') ?? null,
    tags: reward ? REWARD_TAGS.filter(([, re]) => re.test(reward)).map(([tag]) => tag) : []
  }
}

// Nomes listados num {{QuestList|...}} (ex.: a página "Access Quests").
export function parseQuestList(src: string): string[] {
  const inner = extractTemplate(src, 'QuestList')
  if (!inner) return []
  return splitTopLevel(inner)
    .slice(1)
    .filter((p) => !p.includes('='))
    .map((p) => wikitextToPlain(p).trim())
    .filter(Boolean)
}

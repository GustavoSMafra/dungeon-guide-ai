import { getDb } from '../db'
import { containsWord, titleAliases } from './names'

// Checks the proper names in an answer against the context the model got and every name the app knows
// (pages, items, creatures, quests, hunts, NPCs, towns). Small local models make up names even with the
// right page in the context ("Speed Ring", "Mount Trader in Ardougne"). The chat removes the sentences
// that use such names and says so. It is a heuristic on capitalized words: it misses wrong relations
// between real names ("the Crystal Wand is used in the Inquisition") and made-up lower-case claims.

// Towns, islands and regions: most have no page in the indexed categories.
const PLACES = [
  "Ab'Dendriel", 'Ankrahmun', 'Carlin', 'Darashia', 'Edron', 'Farmine', 'Gray Beach', 'Issavi', 'Kazordoon',
  'Liberty Bay', 'Marapur', 'Moonfall', 'Port Hope', 'Rathleton', 'Roshamuul', 'Svargrond', 'Thais', 'Venore',
  'Yalahar', 'Rookgaard', 'Dawnport', 'Krailos', 'Oramond', 'Zao', 'Feyrist', 'Gnomprona', 'Tiquanda',
  'Banuta', 'Goroma', 'Okolnir', 'Folda', 'Senja', 'Vega', 'Cormaya', 'Fibula', 'Calassa', 'Nargor', 'Meriana',
  'Treasure Island', 'Femor Hills', 'Mount Sternum', 'Hrodmir', 'Kharos', 'Ghostlands', 'Isle of the Kings',
  'Shadowthorn', 'Laguna Islands', 'Edron Island', 'Draconia', 'Zao Steppe', 'Muggy Plains', 'Ferumbras Citadel',
  'Mintwallin', 'Svargrond Arena', 'Poh', 'Ramoa', 'Talahu', 'Chor', 'Kilmaresh', 'Ingol', 'Bounac', 'Grimvale',
  'Oskayaat', 'Gnomegate', 'Werelands', 'Cobra Bastion', 'Tibia', 'TibiaWiki', 'Tibia.com', 'Tibia Market',
  'CipSoft', 'Dungeon Guide', 'Dungeon Master', 'Market', 'Store', 'Tibia Coins', 'Tibia Coin', 'Premium',
  'Free Account', 'Premium Account', 'Elite Knight', 'Royal Paladin', 'Master Sorcerer', 'Elder Druid',
  'Exalted Monk', 'Knight', 'Paladin', 'Sorcerer', 'Druid', 'Monk'
]

// Capitalized words that are not names: headings, labels, directions and instructions models like to write
// in Title Case ("Armor Rating", "Loot Highlights", "Head North").
const GENERIC = new Set(
  (
    'a an and or the of for to in on at by with from not now later best better worse other more less very too ' +
    'can be low moderate high higher lower risk risks safe dangerous danger dangers option options alternative ' +
    'method methods summary note notes tip tips warning important step steps recommended recommendation setup ' +
    'solo duo party group farming farm farmed hunt hunts hunting quest quests creature creatures item items ' +
    'reward rewards requirement requirements level levels experience exp xp hp rarity rare location locations ' +
    'where how what why when which who market purchase buying selling trading trade buy sell efficient ' +
    'efficiency fastest fast account free premium vocation strategy tactics spell spells weakness weaknesses ' +
    'resistance resistances immunity immunities damage overview conclusion final answer yes no first second ' +
    'third next last also extra bonus key points point obs since check find use using if while you your this ' +
    'these that it its as after before kill killing get getting go going bring try make look consider complete ' +
    'defeat value type minimum maximum drop drops dropped rate current total average estimated base here there ' +
    'both all each every some many most however otherwise alternatively finally additionally then so but just ' +
    'only always never usually please remember keep avoid head take travel walk follow enter exit leave cross ' +
    'climb turn north south east west northeast northwest southeast southwest north-east north-west south-east ' +
    'south-west up down left right area areas restricted rating armor attack defense loot highlights stats ' +
    'statistics details detail info information comparison difference differences pros cons verdict ' +
    'observação observações resumo dica dicas opção opções risco riscos baixo moderado alto alerta atenção passo ' +
    'passos melhor local locais recompensa recompensas criatura criaturas nível conta grátis vocação estratégia ' +
    'fraquezas conclusão importante sim não agora depois mais menos muito para por com sem de do da dos das em ' +
    'vá siga pegue norte sul leste oeste'
  ).split(' ')
)
// 'and'/'or' are not connectors: "Dawnport and Mudguard" is two names (one real, one made up).
const CONNECTORS = new Set(['of', 'the', 'de', 'do', 'da', 'dos', 'das'])
const LEADING = new Set(['The', 'A', 'An', 'O', 'Os', 'As'])
// A single capitalized word after one of these is taken as a place name ("in Ardougne or Varka", "em Thais").
const PLACE_PREPOSITIONS = new Set(
  ['in', 'at', 'near', 'from', 'to', 'and', 'or', 'em', 'no', 'na', 'perto', 'para', 'de', 'e', 'ou']
)
const SENTENCE_END = '‖'

let known: { lower: Set<string>; original: Map<string, string> } | null = null
let vocabulary: Set<string> | null = null

function loadKnown(): { lower: Set<string>; original: Map<string, string> } {
  if (known) return known
  const db = getDb()
  const names = (sql: string): string[] => (db.prepare(sql).all() as { name: string }[]).map((r) => r.name)
  const all = [
    ...names('SELECT title AS name FROM pages').flatMap(titleAliases),
    ...names('SELECT name FROM api_items'),
    ...names('SELECT name FROM creatures UNION SELECT name FROM api_creatures'),
    ...names('SELECT name FROM quests UNION SELECT name FROM hunts').flatMap(titleAliases),
    ...names('SELECT name FROM npcs'),
    ...PLACES
  ]
  known = { lower: new Set(), original: new Map() }
  for (const n of all) {
    const lower = n.toLowerCase()
    known.lower.add(lower)
    if (!known.original.has(lower)) known.original.set(lower, n)
  }
  return known
}

// Every word of the indexed wiki text (lower-case, accents removed, as FTS5 stores them).
function loadVocabulary(): Set<string> {
  if (vocabulary) return vocabulary
  const rows = getDb().prepare('SELECT term FROM chunks_vocab').all() as { term: string }[]
  vocabulary = new Set(rows.map((r) => r.term))
  return vocabulary
}

export function invalidateKnownNames(): void {
  known = null
  vocabulary = null
}

// The pronoun "I" is not a name; with the Portuguese connector "do" it glued "I do The Djinn War" together.
const isCapitalized = (w: string): boolean =>
  !/^I(['’](m|ll|ve|d))?$/.test(w) && (/^[A-ZÀ-Ý][a-zà-ÿ'’]/.test(w) || /^[A-ZÀ-Ý]$/.test(w))
const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export interface Candidate {
  name: string
  // A lone capitalized word: only suspicious when the wiki never uses the word at all.
  single: boolean
}

// Proper-name candidates: runs of 2+ capitalized words ("Speed Ring", "Isle of the Kings"), lone
// capitalized words in the middle of a sentence ("from Ardougne, Karamja"), and [citations].
export function candidateNames(text: string): Candidate[] {
  const out = new Map<string, Candidate>()
  const add = (name: string, single: boolean): void => {
    if (!out.has(name)) out.set(name, { name, single })
  }
  const clean = text
    .replace(/```[\s\S]*?```|`[^`]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ')
  for (const m of clean.matchAll(/\[([^\]\n]{2,80})\]/g)) {
    for (const part of m[1].split(/,|;/)) {
      const name = part.trim()
      // "[ACCESS]" flags and "etc." are not page citations.
      if (name && isCapitalized(name) && !/^etc\.?$/i.test(name)) add(name, !name.includes(' '))
    }
  }

  for (const rawLine of clean.split('\n')) {
    // Headings and whole-line bold labels are Title Case by style, not names.
    if (/^\s*#/.test(rawLine) || /^\s*[-*>\d.]*\s*\*\*[^*]+\*\*:?\s*$/.test(rawLine)) continue
    // Labels ("- **Drop Rate:** rare", "Armor Rating: 17") are Title Case by style; the value is kept.
    // Bold markers are dropped, not treated as punctuation: "in **Ardougne**" is still "in Ardougne".
    const line = rawLine
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\*\*|__/g, '')
      .replace(/(^|[\s(])(?:[A-ZÀ-Ý][\wÀ-ÿ'’-]*\s){0,3}[A-ZÀ-Ý][\wÀ-ÿ'’-]*:(?=\s|$)/g, '$1 | ')
    // Sentence ends and list starts reset the run; other punctuation only breaks it.
    const tokens = line
      .replace(/^\s*(?:[-*>]|\d+[.)])\s+/, `${SENTENCE_END} `)
      .replace(/[.!?]+(?=\s|$)/g, ` ${SENTENCE_END} `)
      .replace(/[,;:()[\]*_"“”|/]+/g, ' | ')
      .split(/\s+/)
      .filter(Boolean)
    let run: string[] = []
    let before: string | undefined
    const flush = (): void => {
      while (run.length && CONNECTORS.has(run[run.length - 1])) run.pop()
      // A known name stays whole even when it ends in a generic word ("Magic Plate Armor", "Free Account").
      const whole = (LEADING.has(run[0]) ? run.slice(1) : run).join(' ')
      if (whole.includes(' ') && isKnownName(whole)) {
        add(whole, false)
        run = []
        return
      }
      // Sentence-initial words and Title Case filler ("Since the Magic Plate Armor", "Farming Angry Demons").
      while (run.length && (LEADING.has(run[0]) || GENERIC.has(run[0].toLowerCase()) || CONNECTORS.has(run[0]))) {
        run.shift()
      }
      while (run.length && GENERIC.has(run[run.length - 1].toLowerCase())) run.pop()
      const caps = run.filter(isCapitalized)
      if (caps.length && !caps.every((w) => GENERIC.has(w.toLowerCase()))) {
        if (caps.length >= 2) add(run.join(' '), false)
        else {
          const sentenceStart = before === undefined || before === SENTENCE_END
          if (!sentenceStart || PLACE_PREPOSITIONS.has((before ?? '').toLowerCase())) add(caps[0], true)
        }
      }
      run = []
    }
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]
      const next = tokens[i + 1]
      if (isCapitalized(tok)) {
        if (!run.length) before = tokens[i - 1]
        run.push(tok)
      } else if (run.length && CONNECTORS.has(tok.toLowerCase()) && next && isCapitalized(next)) {
        run.push(tok)
      } else if (run.length) {
        flush()
      }
    }
    if (run.length) flush()
  }
  return [...out.values()]
}

function isKnownName(name: string): boolean {
  const names = loadKnown().lower
  const lower = name.toLowerCase()
  return names.has(lower) || names.has(lower.replace(/e?s$/, ''))
}

function isKnown(name: string, ctx: string): boolean {
  const names = loadKnown().lower
  const lower = name.toLowerCase().replace(/['’]s$/, '')
  // Plurals: "Lizard Legionnaires", "Crosses", "War Wolves", "Harpies".
  const singulars = [/s$/, /es$/, /ves$/, /ies$/].map((re, i) => lower.replace(re, ['', '', 'f', 'y'][i]))
  const forms = [lower, ...singulars, lower.replace(/^the /, ''), lower.split('-')[0]]
  // A capitalized verb at the start of a sentence joins the name that follows ("Ask Captain Bluebear",
  // "Ride the Magic Carpet"): the rest counts if it is still a name of two or more words.
  const rest = lower.replace(/^\S+\s+/, '').replace(/^(the|a|an|o|a)\s+/, '')
  if (rest !== lower && rest.includes(' ')) forms.push(rest)
  return forms.some((f) => containsWord(ctx, f) || names.has(f))
}

// Names in the answer that are neither in the context the model got nor among the names the app knows.
// A lone capitalized word is only reported when the wiki never uses it: "Varrock", "Smithing" are flagged,
// "Vampires" or "Restricted" are not.
export function unverifiedNames(answer: string, context: string): string[] {
  const ctx = context.toLowerCase()
  const vocab = loadVocabulary()
  // The index stores "ice-based" as "ice" + "based" and "Ghazbaran's" as "ghazbaran" + "s".
  const inVocab = (name: string): boolean =>
    fold(name)
      .split(/[-'’\s]+/)
      .filter((part) => part.length > 1)
      .every((part) => vocab.has(part))
  return candidateNames(answer)
    .filter((c) => !isKnown(c.name, ctx))
    .filter((c) => !c.single || !inVocab(c.name))
    .map((c) => c.name)
}

// Names the question uses that the base does not know (e.g. "Water Nymph Lair"). Single words are ignored:
// in a question they are usually ordinary words.
export function unknownNamesInQuestion(question: string): string[] {
  return candidateNames(question)
    .filter((c) => !c.single && !isKnown(c.name, ''))
    .map((c) => c.name)
}

// Place-type words: "Water Nymph Lair" is not similar to every other lair.
const KIND_WORDS = new Set(
  'lair lairs cave caves camp camps mine mines island isle tower temple dungeon quest quests hunt hunts room city town'.split(' ')
)

// Known names sharing a significant word with an unknown one ("Water Nymph Lair" → "Water Nymph", "Nymph").
// Names made only of the unknown name's words come first.
export function similarNames(name: string, max = 4): string[] {
  const words = name
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !GENERIC.has(w) && !KIND_WORDS.has(w))
  if (!words.length) return []
  const { original } = loadKnown()
  const scored: { name: string; score: number }[] = []
  for (const [lower, orig] of original) {
    const parts = lower.split(/\s+/)
    const shared = parts.filter((p) => words.includes(p)).length
    if (!shared) continue
    const inside = parts.every((p) => words.includes(p) || GENERIC.has(p))
    scored.push({ name: orig, score: (inside ? 10 : 0) + shared * 2 - parts.length * 0.1 })
  }
  const seen = new Set<string>()
  return scored
    .sort((a, b) => b.score - a.score)
    .map((s) => s.name)
    .filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
    .slice(0, max)
}

// Removes what uses unverified names: list items and short lines whole, longer paragraphs sentence by
// sentence. The rest of the answer stays, so verified facts still reach the player.
export function stripNames(answer: string, names: string[]): string {
  return stripWhere(answer, (s) =>
    names.some((n) => containsWord(s.toLowerCase().replace(/\*\*/g, ''), n.toLowerCase()))
  )
}

const plain = (s: string): string =>
  s
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(?:[-*>#]+|\d+[.)])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

// Removes the sentences and list items that contain one of the quoted statements (the judge's findings).
// Quotes are matched loosely: markdown and spacing differ between the answer and what the judge copied.
export function stripQuotes(answer: string, quotes: string[]): string {
  const wanted = quotes.map(plain).filter((q) => q.length >= 12)
  return stripWhere(answer, (s) => {
    const seg = plain(s)
    return seg.length > 0 && wanted.some((q) => seg.includes(q) || (seg.length >= 20 && q.includes(seg)))
  })
}

// The answer's statements as the removal sees them: list items and short lines whole, longer paragraphs
// sentence by sentence. Headings, separators and fragments without words are left out.
export function statements(answer: string): string[] {
  const out: string[] = []
  for (const line of answer.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || /^-{3,}$/.test(t)) continue
    if (/^(?:[-*>]|\d+[.)])/.test(t) || t.length <= 160) out.push(t)
    else out.push(...t.split(/(?<=[.!?])\s+/))
  }
  return out.filter((s) => /[A-Za-zÀ-ÿ]{3}/.test(s))
}

function stripWhere(answer: string, hit: (s: string) => boolean): string {
  const lines = answer.split('\n').flatMap((line) => {
    if (!hit(line)) return [line]
    if (/^\s*(?:[-*>#]|\d+[.)])/.test(line) || line.length <= 160) return []
    const kept = line.split(/(?<=[.!?])\s+/).filter((s) => !hit(s))
    return kept.length ? [kept.join(' ')] : []
  })
  return dropEmptyHeadings(lines)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const isHeading = (line: string): boolean =>
  /^\s*#{1,6}\s/.test(line) || /^\s*(?:\d+[.)]\s*)?\*\*[^*]+\*\*:?\s*$/.test(line)

// Headings whose content was all removed ("### 2. Using a Magic Carpet" followed by the next heading).
function dropEmptyHeadings(lines: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (isHeading(lines[i])) {
      const next = lines.slice(i + 1).find((l) => l.trim())
      if (next === undefined || isHeading(next) || /^\s*-{3,}\s*$/.test(next)) continue
    }
    out.push(lines[i])
  }
  return out
}

// Portuguese (and a few English) → wiki terms for the keyword search. The wiki is in English, so
// "andar mais rápido" never matches the Speed page by keyword, and the small embedding model links the
// two only weakly.
// Keys are lower-case and accent-free; multi-word keys are checked before single words.
const TERMS: Record<string, string> = {
  'escudo magico': 'magic shield',
  'cura em grupo': 'heal party mass healing',
  'curar o grupo': 'heal party mass healing',
  'fazer dinheiro': 'money gold profit',
  'ganhar dinheiro': 'money gold profit',
  'mais rapido': 'speed haste',
  rapido: 'speed haste fast',
  velocidade: 'speed',
  correr: 'speed haste',
  montaria: 'mount',
  montarias: 'mounts',
  fraqueza: 'weakness weak',
  fraquezas: 'weaknesses weak',
  resistencia: 'resistance',
  resistencias: 'resistances',
  imune: 'immune',
  imunidade: 'immunity',
  magia: 'spell',
  magias: 'spells',
  cura: 'healing heal',
  curar: 'heal healing',
  grupo: 'party team',
  casa: 'house',
  casas: 'houses',
  comprar: 'buy',
  vender: 'sell',
  mercado: 'market',
  morte: 'death',
  morrer: 'death die',
  morro: 'death die',
  bencao: 'blessing',
  bencaos: 'blessings',
  treinar: 'training train',
  treino: 'training',
  arma: 'weapon',
  armas: 'weapons',
  escudo: 'shield',
  armadura: 'armor',
  capacete: 'helmet',
  botas: 'boots',
  bota: 'boots',
  anel: 'ring',
  amuleto: 'amulet',
  colar: 'amulet necklace',
  runa: 'rune',
  runas: 'runes',
  dano: 'damage',
  vida: 'health hitpoints',
  experiencia: 'experience',
  nivel: 'level',
  missao: 'quest mission',
  missoes: 'quests missions',
  recompensa: 'reward',
  chefe: 'boss',
  chefes: 'bosses',
  criatura: 'creature',
  criaturas: 'creatures',
  dropa: 'loot drop',
  dinheiro: 'money gold',
  ouro: 'gold',
  cacar: 'hunt hunting',
  caca: 'hunt hunting',
  cacada: 'hunt hunting',
  vocacao: 'vocation',
  cavaleiro: 'knight',
  paladino: 'paladin',
  feiticeiro: 'sorcerer',
  druida: 'druid',
  monge: 'monk',
  aranha: 'spider',
  dragao: 'dragon',
  dragoes: 'dragons',
  demonio: 'demon',
  demonios: 'demons',
  veneno: 'poison',
  fogo: 'fire',
  gelo: 'ice',
  terra: 'earth',
  energia: 'energy',
  sagrado: 'holy',
  fisico: 'physical',
  afogamento: 'drown',
  conquista: 'achievement',
  conquistas: 'achievements',
  roupa: 'outfit',
  roupas: 'outfits',
  addon: 'addon',
  comida: 'food',
  regenerar: 'regeneration',
  regeneracao: 'regeneration',
  presa: 'prey',
  tarefa: 'task',
  tarefas: 'tasks',
  forja: 'forge',
  roda: 'wheel',
  // English words players use for things the wiki names differently.
  faster: 'speed haste',
  quicker: 'speed haste',
  dying: 'death',
  die: 'death'
}

const PHRASES = Object.keys(TERMS).filter((k) => k.includes(' '))

const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// English terms for the Portuguese words in the text (empty when there are none).
export function englishTerms(text: string): string[] {
  let t = normalize(text)
  const out: string[] = []
  for (const phrase of PHRASES) {
    if (t.includes(phrase)) {
      out.push(TERMS[phrase])
      t = t.replace(phrase, ' ')
    }
  }
  for (const word of t.match(/[a-z]+/g) ?? []) {
    if (TERMS[word] && !word.includes(' ')) out.push(TERMS[word])
  }
  return [...new Set(out.join(' ').split(' '))]
}

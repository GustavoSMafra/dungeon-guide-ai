// UI text in each app language. `en` is typed after `pt`, so a missing translation fails the typecheck.
// Tibia terms (skills, Premium/Free, vocations, creature and place names) stay as in the game.

import { createContext, useContext } from 'react'
import type { Lang, ProgressKind, ProgressStatus, WikiCategory } from '../../shared/types'

const pt = {
  locale: 'pt-BR',
  app: {
    nav: 'Navegação',
    newChat: 'Nova conversa',
    tabs: { chat: 'Guia', characters: 'Personagens', settings: 'Configurações' }
  },
  wizardAlt: 'Dungeon Master: mago idoso de barba branca trançada, com chapéu vermelho',
  noVocation: 'Sem vocação',
  chat: {
    title: 'O Dungeon Master',
    thinking: 'consultando os tomos…',
    speaking: 'falando…',
    idle: 'à sua espera',
    greeting:
      'Saudações, jovem aventureiro! Conheço os segredos de Tibia… mas só respondo a quem pergunta. Por onde quer começar?',
    suggestions: [
      'Quais as melhores hunts para o meu level e vocação?',
      'Qual a próxima quest que vale a pena eu fazer?',
      'Me dê um tutorial de como funciona o Bestiary.',
      'Como enfrentar um Demon com segurança?'
    ],
    typing: 'Hmm, deixe-me consultar os pergaminhos',
    sources: 'Fontes:',
    placeholder: 'Faça sua pergunta ao Dungeon Master… (ex.: onde caçar com um Elite Knight level 120?)',
    hint: 'Enter envia · Shift+Enter quebra a linha',
    wait: 'Aguarde',
    ask: 'Perguntar'
  },
  sheet: {
    aria: 'Ficha do jogador',
    title: 'Ficha do Jogador',
    switch: 'Trocar personagem',
    none: 'Nenhum personagem',
    list: 'Personagens',
    generic: 'Nenhum (conselhos genéricos)',
    add: 'Adicionar personagem',
    weapon: 'Arma',
    weaponHint: 'Informe sua skill de arma na aba Personagens',
    notEntered: (typical: number | null) => `Não informado (típico ~${typical})`,
    residence: 'Residência',
    questsDoing: 'Quests em andamento',
    noneMarked: 'Nenhuma marcada.',
    pick: 'Escolha um personagem para conselhos sob medida.',
    addFirst: 'Adicione seu personagem para conselhos sob medida.'
  },
  characters: {
    title: 'Personagens',
    kinds: {
      quest: { label: 'Quest', plural: 'Quests', lower: 'quest' },
      access: { label: 'Acesso', plural: 'Acessos', lower: 'acesso' },
      goal: { label: 'Meta', plural: 'Metas', lower: 'meta' }
    } as Record<ProgressKind, { label: string; plural: string; lower: string }>,
    status: { todo: 'A fazer', doing: 'Em andamento', done: 'Concluído' } as Record<ProgressStatus, string>,
    imageError: 'Não foi possível ler a imagem',
    addLabel: 'Nome do personagem no Tibia',
    addPlaceholder: 'Ex.: Bubble',
    searching: 'Buscando…',
    add: 'Adicionar',
    addNote: 'Os dados públicos vêm do Tibia.com via TibiaData. O progresso fica salvo só no seu PC.',
    yours: 'Seus personagens',
    addCharacter: 'Adicionar personagem',
    emptyTitle: 'Adicione seu primeiro personagem',
    emptyText:
      'Com o personagem cadastrado, o Dungeon Master recomenda hunts e quests para o seu level, vocação e tipo de conta.',
    never: 'nunca',
    vocation: 'Vocação',
    world: 'Mundo',
    residence: 'Residência',
    sex: 'Sexo',
    female: 'Feminino',
    male: 'Masculino',
    portraitAlt: (name: string) => `Retrato de ${name}`,
    sync: 'Atualizar do Tibia.com',
    syncTitle: (when: string) => `Atualizar do Tibia.com (última vez: ${when})`,
    more: 'Mais opções',
    changeImage: 'Trocar imagem',
    useOutfit: 'Usar outfit da vocação',
    confirmRemove: (name: string) => `Remover ${name} e todo o progresso salvo?`,
    remove: 'Remover personagem',
    account: 'Conta',
    auto: (current: string) => `Automático (${current})`,
    notes: 'Anotações',
    notesPlaceholder: 'Equipamento atual, imbuements, onde parou na hunt…',
    notesHint: 'O Dungeon Master também lê isto.',
    skillsHint: 'em branco = típico do level',
    typical: (n: number) => `Típico do level: ~${n}`,
    showVocation: 'Mostrar só as da vocação',
    showAll: 'Mostrar todas as skills',
    levelTitle: 'Evolução de level',
    gain: (from: number, to: number, days: number) => `${from} → ${to} em ${days} ${days === 1 ? 'dia' : 'dias'}`,
    chartAria: (from: number, to: number, days: number) => `Level foi de ${from} para ${to} em ${days} dias`,
    chartEmpty: 'O gráfico aparece depois de algumas sincronizações com o Tibia.com.',
    progress: 'Progresso',
    filter: 'Filtrar por tipo',
    all: 'Todos',
    advance: (status: string, title: string) => `${status}: avançar status de ${title}`,
    advanceTitle: (status: string) => `${status} (clique para avançar)`,
    removeItem: (title: string) => `Remover ${title}`,
    removeShort: 'Remover',
    empty: 'Nada aqui ainda.',
    itemKind: 'Tipo do item',
    newItem: 'Novo item',
    placeholders: {
      quest: 'Ex.: The Inquisition Quest',
      access: 'Ex.: Roshamuul',
      goal: 'Ex.: Chegar ao level 200'
    } as Record<ProgressKind, string>,
    addItem: 'Adicionar item'
  },
  settings: {
    title: 'Configurações',
    sections: 'Seções',
    nav: {
      general: { label: 'Geral', hint: 'Idioma' },
      ai: { label: 'Inteligência', hint: 'Claude ou Ollama' },
      library: { label: 'Biblioteca', hint: 'Base da TibiaWiki' },
      about: { label: 'Sobre', hint: 'Créditos e licenças' }
    },
    generalLead: 'Preferências do app.',
    language: 'Idioma',
    languageDesc:
      'Idioma da interface e das respostas do Dungeon Master. Ele entende perguntas nos dois idiomas. Trocar o idioma começa uma nova conversa.',
    aiLead: 'Quem dá voz ao Dungeon Master.',
    provider: 'Provedor',
    providerDesc:
      'Claude roda na nuvem e dá as respostas mais precisas, mas precisa de uma chave da API. Ollama roda no seu computador: grátis e offline, porém mais lento e menos preciso.',
    apiKey: 'Chave da API do Claude',
    apiKeyDesc:
      'Fica criptografada pelo cofre do sistema e só sai deste computador para falar com a API da Anthropic. Envie o campo vazio para apagá-la. Crie uma em console.anthropic.com.',
    keyFromEnv: 'Usando ANTHROPIC_API_KEY do ambiente',
    keySet: 'Chave configurada',
    keyNone: 'Nenhuma chave configurada',
    keyReplace: '••••••••  (trocar chave)',
    save: 'Salvar',
    localModel: 'Modelo local',
    localModelDesc: 'Modelo instalado no Ollama que o Dungeon Master vai usar. Para instalar outro, rode no terminal:',
    modelArg: '<modelo>',
    noModels: 'Nenhum modelo instalado. Rode no terminal: ollama pull qwen3:8b',
    notInstalled: (model: string) => `${model} (não instalado)`,
    reloadModels: 'Recarregar modelos',
    judge: 'Revisar respostas',
    judgeDesc:
      'Depois de responder, o modelo confere cada afirmação contra os dados da base e remove o que não tiver apoio. ' +
      'Evita respostas inventadas, mas cada resposta leva de 10 a 70 segundos a mais.',
    stats: (pages: string, hunts: string, creatures: string, quests: string) =>
      `${pages} páginas · ${hunts} hunts · ${creatures} criaturas · ${quests} quests · `,
    updatedAt: (when: string) => `atualizada em ${when}`,
    notIndexed: 'ainda não indexada',
    reindexNeeded:
      'A base foi criada com um formato antigo. Use "Indexar tudo" para recriá-la: as respostas ficam mais precisas.',
    loading: 'Carregando…',
    update: 'Atualizar a base',
    updateDesc:
      '“Só as mudanças” baixa apenas o que mudou na wiki e leva segundos. “Indexar tudo” refaz a base com as categorias abaixo e leva alguns minutos; na primeira vez, o modelo de busca (~120 MB) é baixado.',
    indexing: 'Indexando…',
    indexAll: 'Indexar tudo',
    onlyChanges: 'Só as mudanças',
    starting: 'Iniciando…',
    fetchingChanges: 'Buscando mudanças…',
    categories: 'Categorias da TibiaWiki',
    category: {
      Creatures: { label: 'Criaturas', hint: 'Atributos, loot, fraquezas e resistências de cada criatura.' },
      Bosses: { label: 'Bosses', hint: 'Mecânicas, requisitos e recompensas dos bosses.' },
      'Hunting Places': { label: 'Hunting places', hint: 'Níveis indicados, criaturas e rotas de cada hunt.' },
      'Quest Overview Pages': { label: 'Quests', hint: 'Requisitos, passos e recompensas das quests.' },
      Spells: { label: 'Magias', hint: 'Magias por vocação, nível, mana e custo.' },
      Achievements: { label: 'Achievements', hint: 'Como obter cada achievement e quantos pontos vale.' }
    } as Record<WikiCategory, { label: string; hint: string }>,
    sample: 'Modo amostra',
    sampleDesc: 'Indexa só 50 páginas por categoria, em ordem alfabética, para testar rápido.',
    sampleWarn: 'A amostra deixa de fora a maioria das hunts e criaturas, e as recomendações ficam incompletas.',
    aboutLead: 'Dungeon Guide AI, um companheiro de jogo para Tibia.',
    content: 'Conteúdo',
    contentDesc:
      'Dados da TibiaWiki (tibia.fandom.com), sob licença CC BY-SA. Dados estruturados via TibiaData (tibiadata.bytewizards.de).',
    charactersTitle: 'Personagens',
    charactersDesc:
      'Dados públicos do Tibia.com via TibiaData API (tibiadata.com). O progresso fica salvo só neste computador.',
    brand: 'Marca',
    brandDesc: 'Tibia é uma marca da CipSoft GmbH. Este app não é afiliado à CipSoft.'
  }
}

export type Dict = typeof pt

const en: Dict = {
  locale: 'en-US',
  app: {
    nav: 'Navigation',
    newChat: 'New conversation',
    tabs: { chat: 'Guide', characters: 'Characters', settings: 'Settings' }
  },
  wizardAlt: 'Dungeon Master: an old wizard with a braided white beard and a red hat',
  noVocation: 'No vocation',
  chat: {
    title: 'The Dungeon Master',
    thinking: 'consulting the tomes…',
    speaking: 'speaking…',
    idle: 'awaiting you',
    greeting:
      'Greetings, young adventurer! I know the secrets of Tibia… but I only answer those who ask. Where would you like to begin?',
    suggestions: [
      'What are the best hunts for my level and vocation?',
      'Which quest is worth doing next?',
      'Give me a tutorial on how the Bestiary works.',
      'How do I fight a Demon safely?'
    ],
    typing: 'Hmm, let me consult the scrolls',
    sources: 'Sources:',
    placeholder: 'Ask the Dungeon Master… (e.g. where should an Elite Knight level 120 hunt?)',
    hint: 'Enter sends · Shift+Enter adds a line',
    wait: 'Please wait',
    ask: 'Ask'
  },
  sheet: {
    aria: 'Player sheet',
    title: 'Player Sheet',
    switch: 'Switch character',
    none: 'No character',
    list: 'Characters',
    generic: 'None (general advice)',
    add: 'Add character',
    weapon: 'Weapon',
    weaponHint: 'Enter your weapon skill in the Characters tab',
    notEntered: (typical) => `Not entered (typical ~${typical})`,
    residence: 'Residence',
    questsDoing: 'Quests in progress',
    noneMarked: 'None marked.',
    pick: 'Pick a character for tailored advice.',
    addFirst: 'Add your character for tailored advice.'
  },
  characters: {
    title: 'Characters',
    kinds: {
      quest: { label: 'Quest', plural: 'Quests', lower: 'quest' },
      access: { label: 'Access', plural: 'Access', lower: 'access' },
      goal: { label: 'Goal', plural: 'Goals', lower: 'goal' }
    },
    status: { todo: 'To do', doing: 'In progress', done: 'Done' },
    imageError: 'Could not read the image',
    addLabel: 'Character name in Tibia',
    addPlaceholder: 'e.g. Bubble',
    searching: 'Searching…',
    add: 'Add',
    addNote: 'Public data comes from Tibia.com via TibiaData. Your progress is saved only on your PC.',
    yours: 'Your characters',
    addCharacter: 'Add character',
    emptyTitle: 'Add your first character',
    emptyText:
      'With a character saved, the Dungeon Master recommends hunts and quests for your level, vocation and account type.',
    never: 'never',
    vocation: 'Vocation',
    world: 'World',
    residence: 'Residence',
    sex: 'Sex',
    female: 'Female',
    male: 'Male',
    portraitAlt: (name) => `Portrait of ${name}`,
    sync: 'Update from Tibia.com',
    syncTitle: (when) => `Update from Tibia.com (last time: ${when})`,
    more: 'More options',
    changeImage: 'Change image',
    useOutfit: 'Use the vocation outfit',
    confirmRemove: (name) => `Remove ${name} and all saved progress?`,
    remove: 'Remove character',
    account: 'Account',
    auto: (current) => `Automatic (${current})`,
    notes: 'Notes',
    notesPlaceholder: 'Current gear, imbuements, where you stopped in the hunt…',
    notesHint: 'The Dungeon Master reads this too.',
    skillsHint: 'blank = typical for the level',
    typical: (n) => `Typical for the level: ~${n}`,
    showVocation: "Show only the vocation's skills",
    showAll: 'Show all skills',
    levelTitle: 'Level progress',
    gain: (from, to, days) => `${from} → ${to} in ${days} ${days === 1 ? 'day' : 'days'}`,
    chartAria: (from, to, days) => `Level went from ${from} to ${to} in ${days} days`,
    chartEmpty: 'The chart appears after a few syncs with Tibia.com.',
    progress: 'Progress',
    filter: 'Filter by type',
    all: 'All',
    advance: (status, title) => `${status}: advance the status of ${title}`,
    advanceTitle: (status) => `${status} (click to advance)`,
    removeItem: (title) => `Remove ${title}`,
    removeShort: 'Remove',
    empty: 'Nothing here yet.',
    itemKind: 'Item type',
    newItem: 'New item',
    placeholders: {
      quest: 'e.g. The Inquisition Quest',
      access: 'e.g. Roshamuul',
      goal: 'e.g. Reach level 200'
    },
    addItem: 'Add item'
  },
  settings: {
    title: 'Settings',
    sections: 'Sections',
    nav: {
      general: { label: 'General', hint: 'Language' },
      ai: { label: 'Intelligence', hint: 'Claude or Ollama' },
      library: { label: 'Library', hint: 'TibiaWiki knowledge base' },
      about: { label: 'About', hint: 'Credits and licenses' }
    },
    generalLead: 'App preferences.',
    language: 'Language',
    languageDesc:
      "Language of the interface and of the Dungeon Master's answers. It understands questions in both languages. Changing the language starts a new conversation.",
    aiLead: 'Who gives the Dungeon Master a voice.',
    provider: 'Provider',
    providerDesc:
      'Claude runs in the cloud and gives the most accurate answers, but needs an API key. Ollama runs on your computer: free and offline, but slower and less accurate.',
    apiKey: 'Claude API key',
    apiKeyDesc:
      'It is encrypted by the system keychain and only leaves this computer to talk to the Anthropic API. Submit an empty field to delete it. Create one at console.anthropic.com.',
    keyFromEnv: 'Using ANTHROPIC_API_KEY from the environment',
    keySet: 'Key configured',
    keyNone: 'No key configured',
    keyReplace: '••••••••  (replace key)',
    save: 'Save',
    localModel: 'Local model',
    localModelDesc: 'Model installed in Ollama that the Dungeon Master will use. To install another one, run in a terminal:',
    modelArg: '<model>',
    noModels: 'No models installed. Run in a terminal: ollama pull qwen3:8b',
    notInstalled: (model) => `${model} (not installed)`,
    reloadModels: 'Reload models',
    judge: 'Review answers',
    judgeDesc:
      'After answering, the model checks each statement against the base data and removes what has no support. ' +
      'It prevents made-up answers, but each answer takes 10 to 70 seconds longer.',
    stats: (pages, hunts, creatures, quests) =>
      `${pages} pages · ${hunts} hunts · ${creatures} creatures · ${quests} quests · `,
    updatedAt: (when) => `updated ${when}`,
    notIndexed: 'not indexed yet',
    reindexNeeded: 'The library was built in an older format. Use "Index everything" to rebuild it for more accurate answers.',
    loading: 'Loading…',
    update: 'Update the knowledge base',
    updateDesc:
      '“Only changes” downloads just what changed on the wiki and takes seconds. “Index everything” rebuilds the base with the categories below and takes a few minutes; the first time, the search model (~120 MB) is downloaded.',
    indexing: 'Indexing…',
    indexAll: 'Index everything',
    onlyChanges: 'Only changes',
    starting: 'Starting…',
    fetchingChanges: 'Looking for changes…',
    categories: 'TibiaWiki categories',
    category: {
      Creatures: { label: 'Creatures', hint: 'Attributes, loot, weaknesses and resistances of each creature.' },
      Bosses: { label: 'Bosses', hint: 'Mechanics, requirements and rewards of the bosses.' },
      'Hunting Places': { label: 'Hunting places', hint: 'Suggested levels, creatures and routes of each hunt.' },
      'Quest Overview Pages': { label: 'Quests', hint: 'Requirements, steps and rewards of the quests.' },
      Spells: { label: 'Spells', hint: 'Spells by vocation, level, mana and price.' },
      Achievements: { label: 'Achievements', hint: 'How to get each achievement and how many points it is worth.' }
    },
    sample: 'Sample mode',
    sampleDesc: 'Indexes only 50 pages per category, in alphabetical order, for a quick test.',
    sampleWarn: 'The sample leaves out most hunts and creatures, so the recommendations are incomplete.',
    aboutLead: 'Dungeon Guide AI, a game companion for Tibia.',
    content: 'Content',
    contentDesc:
      'Data from the TibiaWiki (tibia.fandom.com), under the CC BY-SA license. Structured data via TibiaData (tibiadata.bytewizards.de).',
    charactersTitle: 'Characters',
    charactersDesc: 'Public Tibia.com data via the TibiaData API (tibiadata.com). Progress is saved only on this computer.',
    brand: 'Trademark',
    brandDesc: 'Tibia is a trademark of CipSoft GmbH. This app is not affiliated with CipSoft.'
  }
}

export const DICTS: Record<Lang, Dict> = { pt, en }

export const LangContext = createContext<Lang>('pt')

export const useLang = (): Lang => useContext(LangContext)
export const useT = (): Dict => DICTS[useContext(LangContext)]

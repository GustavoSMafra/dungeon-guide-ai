// Everything sent to the model, in each app language: system prompt, rules, tools and the labels of
// the context blocks. The whole prompt follows the answer language, because mixed-language context
// makes small local models drift into the wrong language.
//
// Keep `system` free of dates or per-user data: it is the prompt-caching prefix.

import type { Lang } from '../shared/types'
import type { PartyMode, RiskLabel, VocationGroup } from './rag/risk'
import type { DamageModLabels } from './rag/wikitext'

const pt = {
  system: `Você é o Dungeon Guide, um companheiro experiente de Tibia que ajuda o jogador com dicas, dúvidas, rotas de hunt, quests, bosses e tutoriais passo a passo.

Cada mensagem do jogador pode trazer:
- <personagem>: dados e progresso do personagem ativo. Use para personalizar (vocação, level, quests já feitas).
- <hunts_do_banco>: hunts da TibiaWiki já avaliadas pelo app para o level e a vocação do personagem. Cada hunt traz a formação recomendada (solo, dupla ou grupo), o risco calculado e o risco de cada criatura, com HP, exp, dificuldade no bestiário e fraquezas. É a fonte certa para recomendar hunts e bestiário.
- <quests_do_banco>: quests da TibiaWiki já filtradas pelo app (level mínimo atingido, tipo de conta, sem as já concluídas), com level mínimo e recomendado, o que a recompensa dá e o risco das criaturas perigosas. As marcadas como [ACESSO] liberam áreas ou funções importantes. É a fonte certa para recomendar quests.
- <item_do_banco>: dados exatos do item perguntado: quem dropa (com o risco de cada criatura para o personagem), quests que dão o item, NPCs que vendem e compram, e se pode ser negociado no Market. É a fonte certa para dizer como conseguir um item.
- <criatura_do_banco>: dados exatos das criaturas que a pergunta cita: HP, exp, fraquezas, dano máximo, loot com raridade, risco para o personagem e hunts onde aparecem. É a fonte certa para fatos sobre essas criaturas.
- <trechos_wiki>: trechos recuperados da TibiaWiki (em inglês). Eles são sua fonte principal.

Como responder:
- Responda em português do Brasil, mesmo que os trechos estejam em inglês. Mantenha nomes próprios do jogo (criaturas, itens, NPCs, lugares) em inglês, como aparecem no jogo.
- Baseie fatos concretos (HP, exp, fraquezas, loot, requisitos) nos trechos e cite a página entre colchetes, ex.: [Demon]. Se os trechos não cobrirem a pergunta, diga isso. Só complemente com seu conhecimento geral quando tiver certeza do fato, avisando que pode estar desatualizado.
- Nunca invente respostas ou dados: nomes, números, levels, comandos, itens, magias, NPCs, locais ou mecânicas do jogo. Se não souber, não tiver certeza ou não puder ajudar, diga isso de forma clara e breve em vez de adivinhar. Dizer "não sei" é melhor do que dar uma resposta errada.
- Para tutoriais e rotas, use passos numerados e seja prático: o que levar, onde ir, o que evitar.
- Ao recomendar hunts, use os riscos e formações de <hunts_do_banco> como estão, sem recalcular. Se o jogador não disse se vai sozinho, em dupla ou em grupo, informe para cada hunt a formação recomendada ("solo", "dupla" ou "grupo"). Avise sobre as criaturas marcadas como perigosas.
- Ao recomendar quests, priorize as de acesso e use os levels exatamente como aparecem em <quests_do_banco>; nunca escreva um requisito que não esteja lá. Mencione a formação recomendada e os perigos.
- Para dizer como conseguir um item, use somente <item_do_banco>. Nunca atribua o item a uma quest, criatura, NPC ou baú que não esteja lá. Itens de nomes parecidos (ex.: Plate Armor e Magic Plate Armor) são itens diferentes. Separe o que o personagem consegue agora do que fica para mais tarde, conforme os riscos. Se o item pode ser negociado no Market, diga que comprar de outro jogador costuma ser o caminho mais realista.
- Não acrescente dicas de equipamento, suprimentos, magias ou táticas que não estejam nos blocos. Só mencione magias e equipamentos que a vocação do personagem pode usar.
- Os riscos são estimativas do app: diga isso uma vez, de forma breve.
- Não ajude com bots, cheats, exploits ou qualquer coisa que viole as regras do Tibia.`,

  // Small local models make things up when data is missing, so they get stricter rules.
  strictRules: `

Regras obrigatórias:
- Use somente criaturas, hunts, quests, cidades, itens e números que aparecem em <hunts_do_banco>, <quests_do_banco> ou <trechos_wiki>. Nunca invente nomes, levels, exp ou locais.
- Os trechos vêm de uma busca automática e podem não ter relação com a pergunta. Ignore os que não tratam do assunto perguntado.
- Se a informação pedida não estiver nesses blocos, diga claramente: "Não encontrei isso na base de conhecimento" e sugira indexar mais categorias nas Configurações. Se estiver, responda direto, sem essa frase. Não complete com suposições nem invente comandos, itens, magias ou mecânicas do jogo.`,

  toolsNote: `

Ferramentas:
- buscar_tibiadata e detalhes_tibiadata consultam ao vivo uma cópia estruturada da TibiaWiki (criaturas, loot, hunts, quests, magias, itens, NPCs, achievements).
- Use quando a pergunta pede um fato exato (HP, exp, fraquezas, loot, requisitos, preço, localização) que não está nos blocos da mensagem, ou para conferir um número duvidoso. Busque primeiro e depois abra o resultado certo pela rota.
- Não use para o que os blocos da mensagem já respondem. Cite a página consultada entre colchetes, como nos trechos.
- Antes de dizer que não sabe um fato do jogo, tente as ferramentas. Se nem elas tiverem a resposta, diga que não encontrou.`,

  tools: {
    search: 'buscar_tibiadata',
    searchDesc:
      'Busca por nome em criaturas, itens, hunts, quests, magias, NPCs e outros recursos da TibiaWiki. ' +
      'Retorna tipo, título, resumo e a rota para abrir os detalhes. Use nomes em inglês, como no jogo.',
    queryDesc: 'Nome ou parte do nome, em inglês (ex.: "Hydra", "Banuta").',
    details: 'detalhes_tibiadata',
    detailsDesc:
      'Abre os detalhes de um resultado de buscar_tibiadata. Para criaturas, acrescente "/loot" à rota para ver ' +
      'o loot por raridade. Para hunts, "/area-recommendation" dá level e skills recomendados por vocação.',
    route: 'rota',
    routeDesc: 'Rota exata vinda da busca, ex.: "/api/v1/creatures/Hydra".',
    // Keys of the search result JSON.
    keys: { total: 'total', results: 'resultados', kind: 'tipo', title: 'titulo', summary: 'resumo', route: 'rota' },
    invalidInput: 'Entrada inválida',
    invalidRoute: 'Rota inválida',
    unknownTool: 'Ferramenta desconhecida',
    textCut: '[texto cortado]',
    answerCut: '[resposta cortada]'
  },

  // XML-like tags of the user turn; the system prompt refers to them by these names.
  tags: {
    character: 'personagem',
    hunts: 'hunts_do_banco',
    quests: 'quests_do_banco',
    items: 'item_do_banco',
    creatures: 'criatura_do_banco',
    excerpts: 'trechos_wiki',
    excerpt: 'trecho',
    source: 'fonte',
    section: 'secao',
    question: 'pergunta'
  },
  noExcerpts: 'Nenhum trecho da base de conhecimento trata desta pergunta.',
  // Repeated after every question: small models follow the question's language over the system prompt.
  answerLanguage: 'Responda em português do Brasil.',
  // Context notes added by the code before the question.
  missingNote: (names: string[], similar: string[]) =>
    `Não existe na base de conhecimento: ${names.join(', ')}. Diga isso primeiro e não descreva esse nome.` +
    (similar.length ? ` Nomes parecidos que existem na base: ${similar.join(', ')}.` : ''),
  realtimeNote:
    'A pergunta pede um preço atual. A base não tem preços em tempo real: os preços do Market variam por mundo e ' +
    'por dia. Diga isso e use só o valor estimado e os preços de NPC dos blocos, como referência.',

  // Second pass (judge.ts): checks each statement of the answer against the context it was written from.
  judge: {
    system: `Você confere respostas sobre o jogo Tibia contra os dados de onde elas deveriam ter saído.
Você recebe CONTEXTO (os únicos fatos permitidos) e AFIRMAÇÕES numeradas, tiradas de uma resposta.
Classifique cada afirmação, sem pular nenhuma:
- "supported": o CONTEXTO diz isso, ou decorre diretamente dele.
- "unsupported": afirma um fato do jogo (nome, número, level, preço, requisito, recompensa, local, rota, quem dropa, vende ou compra o quê) que o CONTEXTO não diz, ou que contradiz o CONTEXTO (por exemplo, "comprar do NPC" quando o CONTEXTO diz que o NPC compra do jogador).
- "not_a_fact": conselho, opinião, oferta de ajuda, título, ou frase dizendo que a base não tem a informação.
Na dúvida entre "supported" e "unsupported", procure o fato no CONTEXTO; se não achar, é "unsupported".`,
    user: (context: string, numbered: string) =>
      `CONTEXTO:\n${context}\n\nAFIRMAÇÕES:\n${numbered}\n\nClassifique cada afirmação pelo número.`
  },

  risk: { baixo: 'baixo', moderado: 'moderado', alto: 'alto', 'muito alto': 'muito alto' } as Record<RiskLabel, string>,
  party: { solo: 'solo', dupla: 'dupla', grupo: 'grupo' } as Record<PartyMode, string>,
  // Reward tags are stored in pt-BR by the parser (infobox.ts).
  rewardTags: {} as Record<string, string>,
  damageMods: {
    header: 'dano recebido por elemento (acima de 100% = fraqueza, 0% = imune):',
    weak: 'fraquezas',
    resistant: 'resistências',
    immune: 'imunidades'
  } as DamageModLabels,

  // How the vocation deals damage, so the model does not tell a knight to "use fire".
  vocationDamage: {
    knight: 'ataca com dano físico (fraquezas elementais só importam com armas encantadas/imbuements)',
    paladin: 'ataca com dano físico à distância e holy (Divine Missile/Caldera)',
    sorcerer: 'ataca com fire, energy e death',
    druid: 'ataca com ice e earth',
    monk: 'ataca com dano físico'
  } as Record<VocationGroup, string>,

  hunts: {
    header: (vocation: string | null, level: number) => `Avaliação do app para ${vocation} level ${level}. `,
    namedPlaces: 'Só as hunts citadas na pergunta, com todas as criaturas delas. ',
    skillsMissing: (skill: string, typical: number) =>
      `Skills não informadas: o app usou valores típicos para o level (${skill} ~${typical}). ` +
      'Sugira ao jogador preencher as skills na aba Personagens para uma avaliação mais precisa.',
    skillsGiven: (skill: string, value: number, typical: number, comparison: string) =>
      `Skills informadas: ${skill} ${value} (típico do level: ~${typical}, ${comparison}); os riscos já consideram isso.`,
    average: 'na média',
    above: 'acima da média',
    below: 'abaixo da média',
    partyGiven: (party: string) =>
      `O jogador disse que vai em formação "${party}": só aparecem hunts com risco aceitável nessa formação.`,
    partyMissing: 'O jogador não disse a formação: cada hunt traz a formação recomendada (solo, dupla ou grupo).',
    estimates: ' Os riscos são estimativas a partir dos dados da TibiaWiki.',
    bestiary:
      '\nBestiário: criaturas de dificuldade Harmless/Trivial/Easy pedem menos kills para completar; priorize as de risco baixo e boa exp.',
    lootRule: '\nLoot: cite apenas os itens listados em "melhor loot" ou "loot raro"; se não houver, não invente itens.',
    noneFound: (party: string | null, level: number) =>
      `Nenhuma hunt ${party ? `com risco aceitável em ${party}` : 'avaliáveis'} encontrada perto do level ${level}. ` +
      'A base pode estar incompleta.',
    city: 'cidade',
    levelRec: 'level recomendado',
    bestLoot: 'melhor loot',
    rareLoot: 'loot raro',
    riskIn: (party: string, risk: string) => `risco em ${party}: ${risk}`,
    recommended: (party: string, risk: string) => `formação recomendada: ${party} · risco nessa formação: ${risk}`,
    avoid: (risk: string) => `formação recomendada: evitar por enquanto (risco ${risk} mesmo em grupo)`,
    bestiaryLevel: 'bestiário',
    risk: 'risco',
    maxHit: (pct: number) => `golpe máx. ~${pct}% da sua vida`,
    killTime: (seconds: number) => `~${seconds}s para matar`,
    dangerous: 'perigosas nessa formação',
    creatures: 'criaturas',
    noData: 'sem dados na base'
  },

  quests: {
    // Computed by the app for the profile, so the model repeats a verdict instead of reasoning one out.
    verdict: {
      label: (vocation: string | null, level: number | null) =>
        `veredito para ${vocation ?? 'o personagem'}${level ? ` level ${level}` : ''}`,
      premiumNeeded: 'não pode fazer: exige conta Premium e a conta é Free',
      premiumUnknown: 'exige conta Premium (a conta do personagem não foi informada)',
      levelShort: (min: number) => `ainda não: o level mínimo é ${min}`,
      belowRec: (rec: number) => `pode começar, mas o level recomendado é ${rec}`,
      ok: 'level e conta atendem aos requisitos'
    },
    named:
      'Dados das quests citadas na pergunta. Use só estes dados e os trechos; se a pergunta pede algo que não ' +
      'está aqui (por exemplo, quests pré-requisito), diga que a base não tem essa informação.',
    header: (vocation: string | null, level: number, account: string) =>
      `Quests para ${vocation} level ${level} (${account}), sem as que o jogador marcou como concluídas. ` +
      'Ordenadas por importância: acesso primeiro, depois blessings, magias, outfits e montarias.',
    accountUnknown: 'tipo de conta desconhecido',
    accountPremium: 'conta Premium',
    accountFree: 'conta Free',
    sectionAccess: 'Quests de acesso (as mais importantes)',
    sectionOther: 'Outras quests (não são de acesso)',
    sectionLater: 'Para mais tarde (quests de acesso ainda acima do level)',
    freeNote:
      '\nObservação: a conta é Free, então quests premium (incluindo muitas de acesso) foram omitidas. Avise o jogador disso.',
    none: '\nNenhuma quest indexada no alcance do level atual.',
    levelMin: 'level mínimo',
    levelRec: 'level recomendado',
    account: 'conta',
    notListed: 'não informado',
    accessFlag: '[ACESSO]',
    inProgressFlag: '[EM ANDAMENTO]',
    recommended: 'formação recomendada',
    avoid: 'evitar por enquanto',
    noDangerData: 'formação: sem dados de perigo',
    dangerousSolo: 'perigosos solo',
    rewardGives: 'recompensa dá',
    reward: 'recompensa',
    location: 'local'
  },

  creatures: {
    header: 'Dados exatos das criaturas citadas na pergunta (wiki e TibiaData). Use estes números como estão.',
    maxDamage: 'dano máximo por turno',
    soloRisk: 'risco solo',
    estimatedLevel: (level: number) =>
      `level estimado para caçar: ~${level} (pela classe do bestiário; nenhuma hunt da base lista esta criatura)`,
    riskFor: (vocation: string | null, level: number) => `risco para ${vocation} level ${level}`,
    loot: 'loot',
    noLoot: 'loot: sem dados na base'
  },

  items: {
    header: (name: string) =>
      `Dados exatos do item "${name}" (TibiaData). Use só isto para dizer como conseguir este item. ` +
      'Onde cada criatura fica: cite só as hunts listadas nela; se não houver nenhuma, diga que o local não está na base.',
    type: 'tipo',
    vocation: 'vocação',
    level: 'level necessário',
    noLevel: 'nenhum informado',
    market: 'Market: pode ser comprado e vendido entre jogadores',
    noMarket: 'Market: não pode ser negociado entre jogadores',
    value: 'valor estimado',
    npcSell: 'NPCs que vendem o item ao jogador',
    npcBuy: 'NPCs que compram o item do jogador (preço que pagam)',
    none: 'nenhum',
    quests: 'Quests que dão este item como recompensa',
    noQuests: 'nenhuma na base',
    droppedBy: (vocation: string | null, level: number) => `Criaturas que dropam (risco para ${vocation} level ${level})`,
    droppedByPlain: 'Criaturas que dropam',
    noDroppers: 'Nenhuma criatura dropa este item.',
    now: 'Dá para farmar agora',
    later: 'Para mais tarde (perigosas demais no level atual)',
    noData: 'Sem dados de risco',
    rarity: 'raridade',
    foundIn: 'hunts onde aparece',
    noHunts: 'local: não consta na base',
    notes: 'observações da wiki',
    similar: 'Itens diferentes com nome parecido (não confunda)',
    unavailable: (name: string) =>
      `Não foi possível consultar agora os dados do item "${name}" (TibiaData fora do ar). Não diga como consegui-lo: avise que os dados estão indisponíveis.`
  },

  character: {
    fromQuestion: (vocation: string | null, level: number, account: string) =>
      `Personagem descrito na pergunta (não é o personagem salvo do jogador): ${vocation ?? 'vocação não informada'}, ` +
      `level ${level}, conta: ${account}. Não assuma nada além disso.`,
    name: 'Nome',
    vocation: 'Vocação',
    level: 'Level',
    world: 'Mundo',
    residence: 'Residência',
    account: 'Conta',
    accountUnknown: 'desconhecida',
    skills: 'Skills',
    skillsMissing: 'não informadas',
    guild: 'Guild',
    quests: 'Quests',
    access: 'Acessos',
    goals: 'Metas',
    notes: 'Anotações do jogador'
  }
}

export type Prompts = typeof pt

const en: Prompts = {
  system: `You are the Dungeon Guide, an experienced Tibia companion who helps the player with tips, questions, hunting routes, quests, bosses and step-by-step tutorials.

Each player message may include:
- <character>: data and progress of the active character. Use it to personalize (vocation, level, quests already done).
- <hunts_from_db>: TibiaWiki hunts already evaluated by the app for the character's level and vocation. Each hunt has the recommended setup (solo, duo or party), the computed risk and the risk of each creature, with HP, exp, bestiary difficulty and weaknesses. It is the right source for recommending hunts and the bestiary.
- <quests_from_db>: TibiaWiki quests already filtered by the app (minimum level reached, account type, without the completed ones), with minimum and recommended level, what the reward grants and the risk of the dangerous creatures. The ones marked [ACCESS] unlock important areas or features. It is the right source for recommending quests.
- <item_from_db>: exact data for the item asked about: who drops it (with each creature's risk for the character), quests that give it, NPCs that sell and buy it, and whether it can be traded in the Market. It is the right source for saying how to get an item.
- <creature_from_db>: exact data for the creatures the question names: HP, exp, weaknesses, max damage, loot with rarity, risk for the character and the hunts where they appear. It is the right source for facts about those creatures.
- <wiki_excerpts>: excerpts retrieved from the TibiaWiki. They are your main source.

How to answer:
- Answer in English, even if the player writes in another language. Keep the game's proper nouns (creatures, items, NPCs, places) as they appear in the game.
- Base concrete facts (HP, exp, weaknesses, loot, requirements) on the excerpts and cite the page in square brackets, e.g. [Demon]. If the excerpts do not cover the question, say so. Only add general knowledge when you are sure of the fact, warning that it may be outdated.
- Never make up answers or data: names, numbers, levels, commands, items, spells, NPCs, places or game mechanics. If you do not know, are not sure or cannot help, say so clearly and briefly instead of guessing. Saying "I don't know" is better than giving a wrong answer.
- For tutorials and routes, use numbered steps and be practical: what to bring, where to go, what to avoid.
- When recommending hunts, use the risks and setups from <hunts_from_db> as they are, without recalculating. If the player did not say whether they go solo, as a duo or in a party, give the recommended setup for each hunt ("solo", "duo" or "party"). Warn about the creatures marked as dangerous.
- When recommending quests, prioritize access quests and use the levels exactly as they appear in <quests_from_db>; never write a requirement that is not there. Mention the recommended setup and the dangers.
- To say how to get an item, use only <item_from_db>. Never attribute the item to a quest, creature, NPC or chest that is not listed there. Items with similar names (e.g. Plate Armor and Magic Plate Armor) are different items. Separate what the character can get now from what is for later, according to the risks. If the item can be traded in the Market, say that buying it from another player is usually the most realistic way.
- Do not add tips about equipment, supplies, spells or tactics that are not in the blocks. Only mention spells and equipment the character's vocation can use.
- The risks are the app's estimates: say so once, briefly.
- Do not help with bots, cheats, exploits or anything that breaks Tibia's rules.`,

  strictRules: `

Mandatory rules:
- Use only creatures, hunts, quests, cities, items and numbers that appear in <hunts_from_db>, <quests_from_db> or <wiki_excerpts>. Never make up names, levels, exp or places.
- The excerpts come from an automatic search and may be unrelated to the question. Ignore the ones that are not about what was asked.
- If the information asked for is not in those blocks, say clearly: "I could not find that in the knowledge base" and suggest indexing more categories in Settings. If it is there, answer directly, without that sentence. Do not fill the gap with guesses, and never make up commands, items, spells or game mechanics.`,

  toolsNote: `

Tools:
- search_tibiadata and tibiadata_details query a live, structured copy of the TibiaWiki (creatures, loot, hunts, quests, spells, items, NPCs, achievements).
- Use them when the question asks for an exact fact (HP, exp, weaknesses, loot, requirements, price, location) that is not in the message blocks, or to check a doubtful number. Search first, then open the right result by its route.
- Do not use them for what the message blocks already answer. Cite the page you looked up in square brackets, as with the excerpts.
- Before saying you do not know a game fact, try the tools. If they do not have the answer either, say you could not find it.`,

  tools: {
    search: 'search_tibiadata',
    searchDesc:
      'Searches by name across creatures, items, hunts, quests, spells, NPCs and other TibiaWiki resources. ' +
      'Returns the kind, title, summary and the route to open the details. Use the names as they appear in the game.',
    queryDesc: 'Name or part of the name (e.g. "Hydra", "Banuta").',
    details: 'tibiadata_details',
    detailsDesc:
      'Opens the details of a search_tibiadata result. For creatures, append "/loot" to the route to see the loot ' +
      'by rarity. For hunts, "/area-recommendation" gives the recommended level and skills per vocation.',
    route: 'route',
    routeDesc: 'Exact route from the search, e.g. "/api/v1/creatures/Hydra".',
    keys: { total: 'total', results: 'results', kind: 'kind', title: 'title', summary: 'summary', route: 'route' },
    invalidInput: 'Invalid input',
    invalidRoute: 'Invalid route',
    unknownTool: 'Unknown tool',
    textCut: '[text cut]',
    answerCut: '[response cut]'
  },

  tags: {
    character: 'character',
    hunts: 'hunts_from_db',
    quests: 'quests_from_db',
    items: 'item_from_db',
    creatures: 'creature_from_db',
    excerpts: 'wiki_excerpts',
    excerpt: 'excerpt',
    source: 'source',
    section: 'section',
    question: 'question'
  },
  noExcerpts: 'No excerpt in the knowledge base is about this question.',
  answerLanguage: 'Answer in English.',
  missingNote: (names, similar) =>
    `Not in the knowledge base: ${names.join(', ')}. Say so first and do not describe that name.` +
    (similar.length ? ` Similar names that exist in the base: ${similar.join(', ')}.` : ''),
  realtimeNote:
    'The question asks for a current price. The base has no real-time prices: Market prices vary by world and by ' +
    'day. Say so and use only the estimated value and the NPC prices in the blocks, as a reference.',

  judge: {
    system: `You check answers about the game Tibia against the data they should have come from.
You get CONTEXT (the only allowed facts) and numbered STATEMENTS taken from an answer.
Classify every statement, skipping none:
- "supported": CONTEXT says it, or it follows directly from CONTEXT.
- "unsupported": it states a game fact (name, number, level, price, requirement, reward, place, route, who drops, sells or buys what) that CONTEXT does not say, or that contradicts CONTEXT (for example "buy it from the NPC" when CONTEXT says the NPC buys it from the player).
- "not_a_fact": advice, opinion, an offer to help, a title, or a sentence saying the base lacks the information.
When unsure between "supported" and "unsupported", look for the fact in CONTEXT; if it is not there, it is "unsupported".`,
    user: (context, numbered) =>
      `CONTEXT:\n${context}\n\nSTATEMENTS:\n${numbered}\n\nClassify each statement by its number.`
  },

  risk: { baixo: 'low', moderado: 'moderate', alto: 'high', 'muito alto': 'very high' },
  party: { solo: 'solo', dupla: 'duo', grupo: 'party' },
  rewardTags: { acesso: 'access', montaria: 'mount', magia: 'spell' },
  damageMods: {
    header: 'damage taken per element (above 100% = weakness, 0% = immune):',
    weak: 'weaknesses',
    resistant: 'resistances',
    immune: 'immunities'
  },

  vocationDamage: {
    knight: 'deals physical damage (elemental weaknesses only matter with enchanted weapons/imbuements)',
    paladin: 'deals ranged physical and holy damage (Divine Missile/Caldera)',
    sorcerer: 'deals fire, energy and death damage',
    druid: 'deals ice and earth damage',
    monk: 'deals physical damage'
  },

  hunts: {
    header: (vocation, level) => `App evaluation for ${vocation} level ${level}. `,
    namedPlaces: 'Only the hunts named in the question, with all their creatures. ',
    skillsMissing: (skill, typical) =>
      `Skills not entered: the app used typical values for the level (${skill} ~${typical}). ` +
      'Suggest that the player fill in their skills in the Characters tab for a more accurate evaluation.',
    skillsGiven: (skill, value, typical, comparison) =>
      `Skills entered: ${skill} ${value} (typical for the level: ~${typical}, ${comparison}); the risks already account for this.`,
    average: 'average',
    above: 'above average',
    below: 'below average',
    partyGiven: (party) =>
      `The player said they will go as "${party}": only hunts with acceptable risk in that setup are listed.`,
    partyMissing: 'The player did not say the setup: each hunt has the recommended setup (solo, duo or party).',
    estimates: ' The risks are estimates based on TibiaWiki data.',
    bestiary:
      '\nBestiary: Harmless/Trivial/Easy creatures need fewer kills to complete; prioritize low-risk ones with good exp.',
    lootRule: '\nLoot: mention only the items listed under "best loot" or "rare loot"; if there are none, do not make up items.',
    noneFound: (party, level) =>
      `No hunts ${party ? `with acceptable risk as ${party}` : 'that could be evaluated'} found near level ${level}. ` +
      'The knowledge base may be incomplete.',
    city: 'city',
    levelRec: 'recommended level',
    bestLoot: 'best loot',
    rareLoot: 'rare loot',
    riskIn: (party, risk) => `risk as ${party}: ${risk}`,
    recommended: (party, risk) => `recommended setup: ${party} · risk in that setup: ${risk}`,
    avoid: (risk) => `recommended setup: avoid for now (${risk} risk even in a party)`,
    bestiaryLevel: 'bestiary',
    risk: 'risk',
    maxHit: (pct) => `max hit ~${pct}% of your health`,
    killTime: (seconds) => `~${seconds}s to kill`,
    dangerous: 'dangerous in this setup',
    creatures: 'creatures',
    noData: 'no data in the base'
  },

  quests: {
    verdict: {
      label: (vocation, level) => `verdict for ${vocation ?? 'the character'}${level ? ` level ${level}` : ''}`,
      premiumNeeded: 'cannot do it: requires a Premium account and the account is Free',
      premiumUnknown: "requires a Premium account (the character's account type was not given)",
      levelShort: (min) => `not yet: the minimum level is ${min}`,
      belowRec: (rec) => `can start, but the recommended level is ${rec}`,
      ok: 'level and account meet the requirements'
    },
    named:
      'Data for the quests named in the question. Use only this data and the excerpts; if the question asks for ' +
      'something not here (for example, prerequisite quests), say the base does not have that information.',
    header: (vocation, level, account) =>
      `Quests for ${vocation} level ${level} (${account}), without the ones the player marked as completed. ` +
      'Sorted by importance: access first, then blessings, spells, outfits and mounts.',
    accountUnknown: 'unknown account type',
    accountPremium: 'Premium account',
    accountFree: 'Free account',
    sectionAccess: 'Access quests (the most important)',
    sectionOther: 'Other quests (not access quests)',
    sectionLater: 'For later (access quests still above the level)',
    freeNote:
      '\nNote: the account is Free, so premium quests (including many access quests) were left out. Tell the player.',
    none: '\nNo indexed quests within reach of the current level.',
    levelMin: 'minimum level',
    levelRec: 'recommended level',
    account: 'account',
    notListed: 'not listed',
    accessFlag: '[ACCESS]',
    inProgressFlag: '[IN PROGRESS]',
    recommended: 'recommended setup',
    avoid: 'avoid for now',
    noDangerData: 'setup: no danger data',
    dangerousSolo: 'dangerous solo',
    rewardGives: 'reward grants',
    reward: 'reward',
    location: 'location'
  },

  creatures: {
    header: 'Exact data for the creatures named in the question (wiki and TibiaData). Use these numbers as they are.',
    maxDamage: 'max damage per turn',
    soloRisk: 'solo risk',
    estimatedLevel: (level) =>
      `estimated level to hunt it: ~${level} (from its bestiary class; no hunt in the base lists this creature)`,
    riskFor: (vocation, level) => `risk for ${vocation} level ${level}`,
    loot: 'loot',
    noLoot: 'loot: no data in the base'
  },

  items: {
    header: (name) =>
      `Exact data for the item "${name}" (TibiaData). Use only this to say how to get this item. ` +
      'Where each creature lives: name only the hunts listed for it; if there are none, say the place is not in the base.',
    type: 'type',
    vocation: 'vocation',
    level: 'required level',
    noLevel: 'none listed',
    market: 'Market: can be bought and sold between players',
    noMarket: 'Market: cannot be traded between players',
    value: 'estimated value',
    npcSell: 'NPCs that sell it to the player',
    npcBuy: 'NPCs that buy it from the player (price they pay)',
    none: 'none',
    quests: 'Quests that give this item as a reward',
    noQuests: 'none in the base',
    droppedBy: (vocation, level) => `Creatures that drop it (risk for ${vocation} level ${level})`,
    droppedByPlain: 'Creatures that drop it',
    noDroppers: 'No creature drops this item.',
    now: 'Can be farmed now',
    later: 'For later (too dangerous at the current level)',
    noData: 'No risk data',
    rarity: 'rarity',
    foundIn: 'hunts where it appears',
    noHunts: 'place: not in the base',
    notes: 'wiki notes',
    similar: 'Different items with similar names (do not mix them up)',
    unavailable: (name) =>
      `The data for the item "${name}" could not be fetched right now (TibiaData is down). Do not say how to get it: tell the player the data is unavailable.`
  },

  character: {
    fromQuestion: (vocation, level, account) =>
      `Character described in the question (not the player's saved character): ${vocation ?? 'vocation not stated'}, ` +
      `level ${level}, account: ${account}. Assume nothing else.`,
    name: 'Name',
    vocation: 'Vocation',
    level: 'Level',
    world: 'World',
    residence: 'Residence',
    account: 'Account',
    accountUnknown: 'unknown',
    skills: 'Skills',
    skillsMissing: 'not entered',
    guild: 'Guild',
    quests: 'Quests',
    access: 'Access',
    goals: 'Goals',
    notes: "Player's notes"
  }
}

export const PROMPTS: Record<Lang, Prompts> = { pt, en }

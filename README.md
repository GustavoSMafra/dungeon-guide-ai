# Dungeon Guide AI

Um companheiro de jogo para desktop que responde dúvidas, dá dicas, cria tutoriais e acompanha o
progresso dos seus personagens. Usa IA (Claude) com RAG sobre a TibiaWiki. O primeiro jogo suportado
é o **Tibia**.

> O app é um companheiro separado do jogo: **não lê a memória do cliente nem automatiza nada**.
> Ele usa só dados públicos (TibiaWiki, Tibia.com via TibiaData) e o que você informa.

## Como rodar

Pré-requisito: [Node.js LTS](https://nodejs.org) (22 ou mais recente).

```bash
npm install     # também recompila o better-sqlite3 para o Electron
npm run dev
```

No app:

1. **Configurações**: cole sua chave da API (crie uma em console.anthropic.com). Ela fica salva
   e criptografada pelo sistema operacional.
2. **Configurações → Base de conhecimento**: escolha as categorias e clique em *Indexar*. Use a
   amostra para testar rápido. Na primeira vez, o modelo de embeddings (~120 MB) é baixado.
3. **Personagens**: adicione um personagem pelo nome. Level, vocação e mundo vêm do Tibia.com.
4. **Guia**: converse. As respostas citam as páginas da wiki usadas.

## Arquitetura

```
src/
  main/                 processo principal (Node)
    index.ts            janela + IPC
    chat.ts             Claude ou Ollama (streaming) + montagem do contexto RAG
    ollama.ts           cliente da API local do Ollama
    characters.ts       personagens, histórico de level e progresso (SQLite) + TibiaData
    settings.ts         chave da API criptografada com safeStorage
    db.ts               esquema SQLite (better-sqlite3)
    rag/
      ingest.ts         TibiaWiki (API MediaWiki) → limpeza → trechos → embeddings
      wikitext.ts       wikitext → texto simples, preservando dados dos infoboxes
      infobox.ts        extrai hunts (level por vocação, criaturas) e criaturas (HP, exp, bestiário, fraquezas)
      structured.ts     tabelas de hunts/criaturas + seleção de hunts por level, vocação e risco
      risk.ts           cálculo de risco criatura × personagem (vocação, level, solo/dupla/grupo)
                        quests: level mín./recomendado, premium, recompensa (acesso, blessing, outfit...),
                        lista oficial "Access Quests" e risco das criaturas em "dangers"
      embeddings.ts     multilingual-e5-small local (transformers.js / ONNX)
      search.ts         busca híbrida: vetorial + FTS5 (BM25), combinadas por RRF
  preload/index.ts      ponte segura (contextBridge) → window.api
  shared/types.ts       tipos compartilhados
  renderer/             UI em React
```

Por que essas escolhas:

- **Embeddings multilíngues locais**: as perguntas em português encontram trechos da wiki em
  inglês, sem custo e sem depender de outra API.
- **Busca híbrida**: a parte vetorial entende a intenção ("onde caçar sendo knight"), e o FTS5
  acerta nomes próprios ("Ferumbras", "Demon Helmet").
- **Dados estruturados para perguntas numéricas**: "hunts para EK 72" exige filtrar por level, o
  que embeddings não fazem. As hunts e criaturas viram tabelas, e o app entrega ao modelo uma lista já
  filtrada (`<hunts_do_banco>`). Isso reduziu muito as invenções do modelo local.
- **Risco calculado pelo app** (`rag/risk.ts`): compara o golpe máximo de cada criatura (dano por
  elemento da wiki, reduzido pela defesa da vocação) com a vida efetiva do personagem (fórmula
  oficial + magic shield para magos), e o tempo para matar (explorando as fraquezas que a vocação
  usa) com a cura por segundo. Em grupo, divide o tempo de luta e soma a cura de suporte. O level
  recomendado da wiki limita a formação: solo até +5 levels acima do personagem, dupla até +15 e
  grupo até +30. As constantes de dano e cura são estimativas, fáceis de calibrar no topo do arquivo.
- **Skills do personagem** (preenchidas pelo jogador, já que o Tibia.com não as publica): a skill de
  ataque (melee/fist, distance ou magic level) ajusta o dano em relação ao típico do level; o
  shielding ajusta o dano físico recebido; o magic level entra no magic shield. Skills acima do
  típico também ampliam a folga de level (~1 level a cada 3 pontos, até +10; abaixo, até -5).
  Campos vazios usam o típico estimado (`TYPICAL_SKILLS` em `risk.ts`).
- **Dados derivados versionados**: ao mudar os parsers, suba `STRUCTURED_SCHEMA` em `db.ts`. O app
  recria as tabelas e as repovoa da wiki na abertura (~30s), sem refazer os embeddings.
- **Modelo local (Ollama) com regras mais rígidas**: ele só pode citar o que está nos dados recuperados.
- **Busca vetorial por força bruta em memória**: alguns milhares de trechos com 384 dimensões
  levam milissegundos, então não vale ter um banco vetorial no protótipo.

Os dados ficam em `%APPDATA%/dungeon-guide-ai/` (banco SQLite, modelos e configurações).

## Próximos passos

- Busca agêntica: o Claude chama uma ferramenta `search_wiki` e reformula a busca em inglês.
- Busca na web restrita a tibia.com/tibia.fandom.com para notícias e eventos recentes.
- Histórico de conversas salvo no banco.
- Tutoriais guiados salvos por personagem (checklists gerados pela IA).
- Suporte a outros jogos: um "pacote de jogo" com as fontes de dados e o prompt próprio de cada um.

Conteúdo da TibiaWiki sob licença CC BY-SA.

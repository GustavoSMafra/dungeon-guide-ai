# Dungeon Guide AI

A desktop game companion that answers questions, gives tips, writes step-by-step guides and tracks your
characters' progress. It uses an LLM (Claude, or a local model through Ollama) with RAG over the
TibiaWiki. The first supported game is **Tibia**. The app itself and its answers are in Brazilian
Portuguese.

> The app is a separate companion: **it never reads the game client's memory and never automates
> anything**. It only uses public data (TibiaWiki, Tibia.com through TibiaData) and what you enter.

## Getting started

Requirement: [Node.js LTS](https://nodejs.org) (22 or newer).

```bash
npm install     # also rebuilds better-sqlite3 for Electron
npm run dev
```

In the app:

1. **Configurações → Inteligência**: choose Claude or Ollama. For Claude, paste your API key (create
   one at console.anthropic.com). It is stored encrypted by the operating system.
2. **Configurações → Biblioteca**: pick the wiki categories and click *Indexar tudo*. The first run
   downloads the embedding model (~120 MB). Later, *Só as mudanças* updates only what changed on the
   wiki, in seconds.
3. **Personagens**: add a character by name. Level, vocation and world come from Tibia.com. Fill in
   your skills for more accurate risk estimates.
4. **Guia**: chat with the Dungeon Master. Answers cite the wiki pages they used.

Other scripts:

```bash
npm run dev:mock    # UI with a canned answer: no LLM, no API key, no indexed base
npm run typecheck   # type-check main/preload/shared and the renderer
npm run build       # production build
```

## Architecture

```
src/
  main/                 main process (Node)
    index.ts            window + IPC
    chat.ts             RAG context + streaming answer (Claude with tools, or Ollama)
    chat-tools.ts       tools Claude can call to look things up live on TibiaData
    ollama.ts           client for the local Ollama API
    characters.ts       characters, level history and progress (SQLite) + Tibia.com via TibiaData
    settings.ts         provider choice and the API key, encrypted with safeStorage
    tibiadata.ts        client for tibiadata.bytewizards.de, a structured TibiaWiki mirror
    db.ts               SQLite schema (better-sqlite3)
    rag/
      ingest.ts         TibiaWiki (MediaWiki API) → cleanup → chunks → embeddings; incremental updates
                        from the TibiaData change feed
      wikitext.ts       wikitext → plain text, keeping infobox data
      infobox.ts        parses hunts (level per vocation, creatures), creatures and quests
      creatures-api.ts  creature stats and loot from TibiaData
      structured.ts     hunt/creature/quest tables + hunt and quest selection by level, vocation and risk
      risk.ts           creature-vs-character risk model (vocation, level, skills, solo/duo/party)
      embeddings.ts     local multilingual-e5-small (transformers.js / ONNX)
      search.ts         hybrid search: vectors + FTS5 (BM25), merged with RRF
  preload/index.ts      secure bridge (contextBridge) → window.api
  shared/               shared types and helpers
  renderer/             React UI (Guia, Personagens, Configurações)
```

Why these choices:

- **Local multilingual embeddings**: questions in Portuguese find English wiki excerpts, at no cost and
  without another API.
- **Hybrid search**: the vector side understands intent ("where to hunt as a knight"), and FTS5 nails
  proper nouns ("Ferumbras", "Demon Helmet").
- **Structured data for numeric questions**: "hunts for an EK level 72" requires filtering by level,
  which embeddings cannot do. Hunts, creatures and quests become tables, and the app hands the model a
  pre-filtered list (`<hunts_do_banco>`, `<quests_do_banco>`). This greatly reduced made-up answers from
  local models.
- **Risk computed by the app** (`rag/risk.ts`): compares each creature's max hit (per-element damage from
  the wiki, reduced by the vocation's defense) against the character's effective health (official
  formula + magic shield for mages), and the time to kill (exploiting weaknesses the vocation can use)
  against healing per second. In a party, fight time is split and support healing is added. The wiki's
  recommended level caps the party mode: solo up to 5 levels above the character, duo up to 15, party
  up to 30. Damage and healing constants are estimates, easy to calibrate at the top of the file.
- **Character skills** (entered by the player, since Tibia.com does not publish them): the attack skill
  (melee/fist, distance or magic level) scales damage against the typical value for the level; shielding
  scales physical damage taken; magic level feeds the magic shield. Skills above typical also widen the
  level slack (~1 level per 3 points, up to +10; below typical, down to -5). Empty fields use the
  estimated typical value (`TYPICAL_SKILLS` in `risk.ts`).
- **TibiaData integration**: the change feed makes updates incremental, creature data includes loot, and
  Claude can call `buscar_tibiadata` / `detalhes_tibiadata` for exact facts the excerpts did not cover.
  If TibiaData is down, the app falls back to data parsed from the wiki.
- **Versioned derived data**: when the parsers change, bump `STRUCTURED_SCHEMA` in `db.ts`. The app
  recreates the tables and repopulates them from the wiki on startup (~30 s), without recomputing
  embeddings.
- **Stricter rules for local models (Ollama)**: they may only cite what is in the retrieved data.
- **Brute-force in-memory vector search**: a few thousand chunks with 384 dimensions take milliseconds,
  so the prototype does not need a vector database.

Data lives in `%APPDATA%/dungeon-guide-ai/` (SQLite database, models and settings).

## Next steps

- Web search restricted to tibia.com and tibia.fandom.com for news and recent events.
- Conversation history saved in the database.
- Guided tutorials saved per character (AI-generated checklists).
- Support for other games: a "game pack" with each game's data sources and prompt.

## Credits

TibiaWiki content is licensed under CC BY-SA. Structured data from TibiaData. Tibia is a trademark of
CipSoft GmbH; this project is not affiliated with CipSoft.

# CLAUDE.md

Guidance for working on **Dungeon Guide AI**: a desktop companion app for the MMORPG Tibia. It answers
questions, recommends hunts and quests, and tracks character progress, using an LLM (Claude or a local
Ollama model) with RAG over the TibiaWiki.

The app is a separate companion: it **never reads the game client's memory or automates gameplay**, and
the assistant must refuse help with bots, cheats or exploits. Keep it that way.

## Commands

```bash
npm install         # also rebuilds better-sqlite3 for Electron (postinstall)
npm run dev         # run the app with hot reload
npm run dev:mock    # run with a canned chat answer: no LLM, no API key, no indexed base needed
npm run typecheck   # tsc for main/preload/shared and for the renderer (two tsconfigs)
npm run build       # production build into out/
npm start           # preview the production build
npm run eval        # retrieval evaluation on eval/questions.json against the real database
npm run eval:answers -- --label=x   # full-pipeline answers for eval/answers.json (needs Ollama/Claude)
```

There is no unit test suite and no linter. Before finishing any change, run `npm run typecheck` **and**
`npm run build`. For UI changes, also look at the running app (see "Verifying UI changes"). For changes
to retrieval (search, chunking, embeddings, glossary, reranker), run `npm run eval` before and after and
compare: it reports how often the expected page ranks first / in the top 5 and how often unanswerable
questions get no excerpts. It reads the database in `%APPDATA%/dungeon-guide-ai` (`-- --data=<dir>` for a
copy) and needs an indexed base. Add questions to `eval/questions.json` when you fix a retrieval miss.

## Language conventions

- **English**: code, identifiers, code comments, README, this file, and commit messages.
- **The app is bilingual (pt-BR and English)**, chosen in Settings → Geral/General (`language` in
  `settings.json`; defaults to the system locale). Every text the user sees and every text sent to the
  LLM exists in both languages:
  - UI copy: `src/renderer/src/i18n.ts` (`useT()`). The `en` dictionary is typed after `pt`, so a
    missing translation fails `npm run typecheck`. Never hard-code UI strings in components.
  - Errors and progress messages from the main process: `src/main/messages.ts` (`msg()`).
  - Everything model-facing (system prompt, strict rules, tool names/descriptions, context-block tags and
    labels, risk and party labels): `src/main/prompts.ts` (`PROMPTS[lang]`). The whole prompt follows the
    answer language; mixed-language context makes small local models drift. The pt-BR text is the
    original and is tuned: change it deliberately.
  - Internal keys stay in pt-BR and are never shown raw: risk levels `baixo`/`moderado`/…, party modes
    `solo`/`dupla`/`grupo`, reward tags (`acesso`, `montaria`…) and the stored creature `damage`
    summary. Map them through `PROMPTS[lang]`.
  - Intent and party-mode detection (`HUNT_INTENT`, `QUEST_INTENT`, `partyModeFromText`) accept both
    languages regardless of the setting.
  - Changing the language starts a new conversation (the UI resets the chat).
- Tibia proper nouns (creatures, items, NPCs, places, quest names) stay in English, as in the game.
- The TibiaWiki content is in English. Retrieval works across languages because the embedding model is
  multilingual.

## Code style

TypeScript strict, React function components, 2-space indent, single quotes, **no semicolons**, lines up
to ~120 characters. Comments are sparse and explain *why*, not *what*. Match the surrounding file.

## Architecture

Electron app built with electron-vite: main process (Node), sandboxed preload bridge, React renderer.

```
src/
  main/                     Node side
    index.ts                window, IPC handlers, background refresh of derived tables on startup
    chat.ts                 builds the RAG context and streams the answer (Claude or Ollama)
    chat-tools.ts           client-side tools Claude can call (TibiaData search/details)
    ollama.ts               minimal Ollama client (local models)
    characters.ts           characters, level history, progress items; Tibia.com data via api.tibiadata.com
    settings.ts             provider, language and the API key, encrypted with Electron safeStorage
    prompts.ts              all model-facing text, per language
    messages.ts             main-process messages shown in the UI, per language
    debug.ts                DGA_DEBUG=1: per-question JSON trace (search, prompt, answer, name check)
    judge.ts                second pass for local models: removes statements the context does not support
    tibiadata.ts            client for tibiadata.bytewizards.de (structured TibiaWiki mirror)
    mock.ts                 canned answer for `dev:mock`
    db.ts                   SQLite schema and migrations (better-sqlite3)
    rag/
      ingest.ts             full ingest (Fandom MediaWiki API) and incremental update (TibiaData delta feed)
      wikitext.ts           wikitext → plain text, keeps infobox data, chunking
      infobox.ts            parsers for hunt, creature and quest infoboxes
      creatures-api.ts      creature data + loot from TibiaData (api_creatures table)
      structured.ts         derived tables and the hunt/quest/item-source advisors
      items.ts              item names (api_items) to spot items in questions; live item details
      risk.ts               creature-vs-character risk model (vocation, level, skills, party size)
      embeddings.ts         local multilingual-e5-small (transformers.js / ONNX); DGA_EMBEDDING=gemma switches
                            to EmbeddingGemma for experiments (tied with e5 on the eval, 5x slower to index)
      search.ts             hybrid search: vectors + FTS5 (BM25) + pages named in the question, merged with
                            RRF, then filtered (not reordered) by the reranker
      rerank.ts             multilingual cross-encoder (mmarco-mMiniLMv2, ~120 MB) used as a relevance gate
      glossary.ts           pt → en (and a few en) game terms added to the keyword search
      names.ts              longest-match name finder (item names, page titles)
      verify.ts             name check on answers: flags proper names found neither in the context nor
                            in any known list (pages, items, creatures, quests, hunts, NPCs, towns)
  preload/index.ts          contextBridge → window.api
  shared/                   types and helpers used by both sides (types.ts, vocation.ts)
  renderer/src/             React UI
    i18n.ts                 UI dictionaries (pt, en) and the LangContext / useT() hook
    App.tsx                 icon rail + tab switching; loads the language and provides LangContext
    views/Chat.tsx          "Guia": floating Dungeon Master, speech bubbles, composer, player sheet
    views/Characters.tsx    characters dashboard (chips, info card, skills, level chart, progress, notes)
    views/Settings.tsx      sectioned settings (Geral, Inteligência, Biblioteca, Sobre)
    components/Wizard.tsx   the Dungeon Master SVG and its moods (idle / thinking / speaking)
    components/PlayerSheet.tsx  right-hand "Ficha do Jogador" on the Guia screen
    styles.css              all styles; palette tokens at the top of :root
```

### How an answer is built (`chat.ts`)

1. **Entities.** Items (`findItems`), page titles and their aliases (`findNamedPages`, `titleAliases` in
   `names.ts`: "The Djinn War" covers both faction pages, "Goroma" covers "Goroma/Dragon Lairs") and creatures
   (`findCreatures`) are found in the question; plurals match. Item names are masked before the page lookup
   so "Plate Armor" does not match inside "Magic Plate Armor".
2. **Grounding gate.** Multi-word capitalized names the base does not know (`unknownNamesInQuestion`) with no
   known entity and nothing similar get a fixed "not in the base" reply without calling the model. With
   similar names (`similarNames`), a note in the context tells the model to say so first.
3. **Isolation.** A question that names anything stands alone: the search uses only it and Ollama gets no
   history. Only a question with no names ("and its weaknesses?") inherits the previous question and the last
   exchange. Earlier questions used to leak into retrieval (the main cause of wrong answers in a long chat).
4. **Profile** (`resolveProfile`). A level stated in the question ("for a level 80 Knight") becomes the profile,
   with only what the question states (account unknown unless stated). Personal questions ("can I…", "my…",
   or recommendations without a named thing) use the saved character. Factual questions get no profile, so no
   risk lines and no unrequested advice.
5. **Blocks**, all built from the database (`structured.ts`), never from free text:
   - `<quests_do_banco>`: the named quests' own data (`questCards`) with a verdict computed for the profile
     (`questVerdict`: premium needed, level short, OK), or, with no quest named and a `QUEST_INTENT`, the
     recommendation list for the profile.
   - `<hunts_do_banco>`: the named hunting places with every creature's risk, or, with no creature named and a
     `HUNT_INTENT`, the recommendation list.
   - `<item_do_banco>` (up to two items): exact data fetched live from TibiaData: droppers with solo risk and
     recommended setup, quests whose reward lists that exact item, NPCs that sell it to / buy it from the player,
     Market. Items are not indexed as pages; only their names are stored, refreshed weekly on startup.
   - `<criatura_do_banco>` (up to three creatures): stats, weaknesses, max damage, loot by rarity, solo risk and
     recommended setup, and the hunts where it appears. The indexed text has no loot lists.
   Risk is always shown as "solo risk X · recommended setup Y" (`soloRisk`): a risk computed for a party read
   as "safe solo". A creature no indexed hunt lists gets a level estimated from its bestiary class or exp
   (`estimatedHuntLevel` in `risk.ts`, calibrated on the base) and that level gates the recommendation.
   Notes for real-time price questions (`realtimeNote`) and unknown names (`missingNote`) go before the blocks.
6. `<trechos_wiki>`: hybrid search results (up to 8 excerpts, or 3 when structured blocks are present, because
   unfiltered excerpts confuse the model). The best chunk of each named page is always a candidate and comes
   first. Excerpts the reranker scores below `RERANK_MIN` are dropped, so the block can be empty: then the
   model is told nothing in the base covers the question. The cutoff and the gate mode were chosen with
   `npm run eval`; re-run it before changing them. Excerpts about a look-alike item are dropped
   (`aboutOtherItem`).
7. `<personagem>`: the saved character, or the one described in the question (`describeProfile`).
8. **Claude** gets two tools (`buscar_tibiadata`, `detalhes_tibiadata`; `search_tibiadata`,
   `tibiadata_details` in English) and runs a manual streaming tool loop (max 6 rounds, then
   `tool_choice: none`). **Ollama** gets no tools and stricter rules (`strictRules`).
9. **Name check.** After the answer streams, `unverifiedNames` (`verify.ts`) checks its proper names. A name
   found neither in the context (including Claude's tool results) nor in the known-name lists is suspect; a
   lone capitalized word only when the wiki never uses it (`chunks_vocab`). The sentences and list items that
   use suspect names are removed (`stripNames`) and the cleaned answer replaces the streamed one
   (`chat:replace`), with a note. It cannot catch wrong relations between real names. Extend `GENERIC`
   when a label or heading is flagged by mistake, and `PLACES` for real towns/regions without a page.
10. **Judge** (`judge.ts`, Ollama only, Settings → Inteligência "Revisar respostas", on by default). The cleaned
   answer is split into numbered statements (`statements` in `verify.ts`) and the same model, with the
   context, classifies every one as supported / unsupported / not a fact (JSON via `chatJson`, Ollama
   structured outputs, reasoning on). Unsupported ones are removed (`stripQuotes`). Asking it to classify
   every statement beat asking for a list of problems (it returned nothing for made-up routes and listed
   correct sentences). On saved answers with known errors, reasoning caught every made-up route (without it,
   half) and removed nothing from correct answers, at 10–70 s per answer. It still misses some contradictions
   ("buy it from the NPC" when the NPC only buys). On failure or timeout (180 s) the answer stays as it was.

**Debugging an answer:** run the app with `DGA_DEBUG=1` (`debug.ts`): each question appends a JSON line to
`userData/debug/chat-YYYY-MM-DD.jsonl` with the search query, every candidate (fused rank, vector and keyword
rank, named, reranker score, kept), the blocks, the full prompt, the answer and the name check.
`npm run eval:answers -- --label=<name> [--data=<dir>] [--same-session]` runs `eval/answers.json` through
the whole pipeline (configured provider) and writes `out/eval/answers-<name>.json` and `.md` for review.

Tag names and labels in this list are the pt-BR ones; `prompts.ts` has both versions. Keep the `system`
prompt free of dates or per-user data: it is the prompt-caching prefix.

The `system` prompt forbids making up answers or data (names, numbers, commands, items, spells, mechanics)
and tells the model to say it does not know instead of guessing; Claude must try its tools first. Keep
that rule in both languages when editing the prompts.

### Data sources (do not mix them up)

| Source | Used for | Code |
|---|---|---|
| TibiaWiki (tibia.fandom.com MediaWiki API) | full page text for RAG, wikitext for the parsers | `rag/ingest.ts` |
| TibiaData mirror (tibiadata.bytewizards.de) | incremental updates (delta feed), creature data + loot, item names + live item details, live tool lookups | `tibiadata.ts`, `rag/creatures-api.ts`, `rag/items.ts`, `chat-tools.ts` |
| TibiaData API v4 (api.tibiadata.com) | public character data from Tibia.com (level, vocation, world) | `characters.ts` |

Both "TibiaData" services share a name but are unrelated. The bytewizards mirror has no batch endpoint
and responds in ~0.85 s per request; creature sync uses 6 parallel requests. Its delta feed returns at
most 500 changes, newest first, and cannot be paged backwards: when `hasMore` is true, a full re-index is
required (the app tells the user).

## Things that are easy to break

- **Adding an IPC call** needs four edits: the handler in `src/main/index.ts`, the bridge in
  `src/preload/index.ts`, the `Api` type in `src/shared/types.ts`, and the renderer call.
- **Changing a parser** (`infobox.ts`, `structured.ts` save logic): bump `STRUCTURED_SCHEMA` in `db.ts`.
  On the next start the derived tables (`hunts`, `creatures`, `quests`, `access_quests`) are dropped and
  rebuilt from the wiki without recomputing embeddings. `api_creatures` is **not** dropped by this.
- **Creature lookups** go through `creatureLookup()` in `structured.ts`: TibiaData data (`api_creatures`)
  first, wikitext-parsed data (`creatures`) as fallback. Keep both paths working; the API can be down.
- **Schema changes to user tables** (`characters`, `progress`, …) must be additive migrations in
  `migrate()` (`ALTER TABLE … ADD COLUMN` guarded by `PRAGMA table_info`). Never drop user data.
- **Changing the indexed text or the embedding model** (`wikitext.ts` flattening/chunking, `chunkContext`,
  `embeddings.ts`): bump `INDEX_SCHEMA` in `db.ts`. Existing bases keep working, and Settings → Library
  shows a notice asking for a full index. The indexed text is English only and leaves out infobox noise
  (`NOISE_PARAMS`) and creature loot; each chunk is embedded with a context line
  (`Hydra (creature) — Strategy`).
- **The vector cache** in `search.ts` must be invalidated (`invalidateVectorCache()`) after any write to
  `chunks` or `pages` (it also holds the page-title matcher).
- **The reranker is a filter, not a ranker.** As a ranker it scored worse than the fused order on the eval
  set (it prefers "Memory of a Hydra" to "Hydra"). If it cannot load, the search falls back to the
  unfiltered excerpts.
- **The risk numbers are estimates.** The calibration constants live at the top of `risk.ts`. The prompt
  asks the model to say once that risks are app estimates; keep that disclaimer.
- **Claude model and API usage** live in `chat.ts` (`CLAUDE_MODEL`, effort, server-side fallback beta,
  prompt caching). When changing them, check the current Anthropic SDK docs rather than memory.

## UI and design

- **Palette**: the "classic" palette (dark brown, gold accent, parchment bubbles). All colors are CSS
  custom properties at the top of `styles.css` (`--bg`, `--panel`, `--panel-2`, `--border`, `--text`,
  `--muted`, `--accent`, `--accent-ink`, `--parchment*`, `--ink*`). Use the tokens instead of hex values.
  Text on a gold (`--accent`) background must use `--accent-ink` (dark), never white.
- **Layout**: a 72px icon rail (`.rail`) on the left with a round "+" button that starts a new chat.
  The Guia screen is a grid: the Dungeon Master header, the messages, the composer, and the player sheet
  on the right (hidden under 980px). Settings use a sub-navigation with rows (label + description on
  the left, control on the right). Characters use a two-column card dashboard.
- **The Dungeon Master** (`Wizard.tsx`) is an original hand-written SVG: red wizard hat, long straight
  white hair, a straight beard over the lower face with two braids and red beads, fading into mist. Its
  animations are CSS (`.wz-*` in `styles.css`) and respect `prefers-reduced-motion`. Do not replace it
  with copyrighted artwork.
- Interactive elements are real `<button>`/`<input>`/`<label>` elements with accessible names; icon-only
  buttons need `aria-label`. Keep touch targets around 44px.
- The settings UI is mouse-driven: no single-key shortcuts.

## Verifying UI changes

`npm run dev:mock` shows the UI without an LLM. For automated screenshots there is no Playwright in the
project; a throwaway Electron script works: create a `BrowserWindow` with
`webPreferences: { preload: out/preload/index.js, contextIsolation: true, sandbox: true, backgroundThrottling: false }`,
register fake `ipcMain.handle(...)` responses for the channels the screen calls, load
`out/renderer/index.html`, then save `webContents.capturePage()`. Keep such scripts outside the repo.
Without `backgroundThrottling: false`, captures can come back empty when the window is not focused.

## Runtime data and secrets

- User data lives in Electron's `userData` folder (`%APPDATA%/dungeon-guide-ai/` on Windows): the SQLite
  database `dungeon-guide.db`, `settings.json` (the API key is stored encrypted with safeStorage), and the
  model cache under `models/` (embeddings and reranker, ~120 MB each, downloaded on first use).
- `ANTHROPIC_API_KEY` from the environment is used when no key is saved in the app.
- Never commit keys, `.env` files, the database, or `out/`/`node_modules/` (see `.gitignore`).

## Environment notes

- Development happens on Windows. The user folder contains a non-ASCII character (`Usuário`), so prefer
  absolute paths and quote them; some tools resolve the 8.3 short path (`USURIO~2`) instead.
- `better-sqlite3` is a native module rebuilt for Electron by `postinstall`. If the app fails with a
  `NODE_MODULE_VERSION` error, run `npx electron-rebuild -f -w better-sqlite3`.
- Licensing: TibiaWiki content is CC BY-SA; Tibia is a trademark of CipSoft GmbH and the app is not
  affiliated with it. These credits are shown in Settings → Sobre; keep them when touching that screen.

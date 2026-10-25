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
```

There is no test suite and no linter. Before finishing any change, run `npm run typecheck` **and**
`npm run build`. For UI changes, also look at the running app (see "Verifying UI changes").

## Language conventions

- **All user-facing text and code comments are in Brazilian Portuguese.** Keep new UI copy, prompts and
  comments in pt-BR, with the same tone.
- Identifiers (variables, functions, types, CSS classes) are in English, with a few pt-BR exceptions
  inherited from domain terms (`<hunts_do_banco>`, `ps-*` classes for "player sheet", etc.).
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
    settings.ts             provider choice and the API key, encrypted with Electron safeStorage
    tibiadata.ts            client for tibiadata.bytewizards.de (structured TibiaWiki mirror)
    mock.ts                 canned answer for `dev:mock`
    db.ts                   SQLite schema and migrations (better-sqlite3)
    rag/
      ingest.ts             full ingest (Fandom MediaWiki API) and incremental update (TibiaData delta feed)
      wikitext.ts           wikitext → plain text, keeps infobox data, chunking
      infobox.ts            parsers for hunt, creature and quest infoboxes
      creatures-api.ts      creature data + loot from TibiaData (api_creatures table)
      structured.ts         derived tables and the hunt/quest advisors
      risk.ts               creature-vs-character risk model (vocation, level, skills, party size)
      embeddings.ts         local multilingual-e5-small (transformers.js / ONNX)
      search.ts             hybrid search: in-memory vectors + FTS5 (BM25), merged with RRF
  preload/index.ts          contextBridge → window.api
  shared/                   types and helpers used by both sides (types.ts, vocation.ts)
  renderer/src/             React UI
    App.tsx                 icon rail + tab switching
    views/Chat.tsx          "Guia": floating Dungeon Master, speech bubbles, composer, player sheet
    views/Characters.tsx    characters dashboard (chips, info card, skills, level chart, progress, notes)
    views/Settings.tsx      sectioned settings (Inteligência, Biblioteca, Sobre)
    components/Wizard.tsx   the Dungeon Master SVG and its moods (idle / thinking / speaking)
    components/PlayerSheet.tsx  right-hand "Ficha do Jogador" on the Guia screen
    styles.css              all styles; palette tokens at the top of :root
```

### How an answer is built (`chat.ts`)

1. Intent detection by regex (`HUNT_INTENT`, `QUEST_INTENT`) decides whether to add structured blocks.
2. `<hunts_do_banco>` / `<quests_do_banco>`: lists pre-filtered and risk-scored by the app
   (`structured.ts` + `risk.ts`) for the active character. The model is told to use these numbers as is.
3. `<trechos_wiki>`: hybrid search results (8 excerpts, or 3 when structured blocks are present, because
   unfiltered excerpts confuse the model).
4. `<personagem>`: the active character's data and progress.
5. **Claude** gets two tools (`buscar_tibiadata`, `detalhes_tibiadata`) and runs a manual streaming tool
   loop (max 6 rounds, then `tool_choice: none`). **Ollama** gets no tools and stricter rules
   (`STRICT_RULES`).

Keep the `SYSTEM` prompt free of dates or per-user data: it is the prompt-caching prefix.

### Data sources (do not mix them up)

| Source | Used for | Code |
|---|---|---|
| TibiaWiki (tibia.fandom.com MediaWiki API) | full page text for RAG, wikitext for the parsers | `rag/ingest.ts` |
| TibiaData mirror (tibiadata.bytewizards.de) | incremental updates (delta feed), creature data + loot, live tool lookups | `tibiadata.ts`, `rag/creatures-api.ts`, `chat-tools.ts` |
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
- **The vector cache** in `search.ts` must be invalidated (`invalidateVectorCache()`) after any write to
  `chunks`.
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
  embedding model cache under `models/` (~120 MB, downloaded on first index).
- `ANTHROPIC_API_KEY` from the environment is used when no key is saved in the app.
- Never commit keys, `.env` files, the database, or `out/`/`node_modules/` (see `.gitignore`).

## Environment notes

- Development happens on Windows. The user folder contains a non-ASCII character (`Usuário`), so prefer
  absolute paths and quote them; some tools resolve the 8.3 short path (`USURIO~2`) instead.
- `better-sqlite3` is a native module rebuilt for Electron by `postinstall`. If the app fails with a
  `NODE_MODULE_VERSION` error, run `npx electron-rebuild -f -w better-sqlite3`.
- Licensing: TibiaWiki content is CC BY-SA; Tibia is a trademark of CipSoft GmbH and the app is not
  affiliated with it. These credits are shown in Settings → Sobre; keep them when touching that screen.

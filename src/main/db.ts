import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(join(app.getPath('userData'), 'dungeon-guide.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

// Bump when the schema of the derived tables (hunts, creatures) changes. They are recreated
// and repopulated from the wiki (see refreshStructured) without recomputing embeddings.
export const STRUCTURED_SCHEMA = '4'

function migrate(d: Database.Database): void {
  d.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const schema = d.prepare("SELECT value FROM meta WHERE key = 'structuredSchema'").get() as
    | { value: string }
    | undefined
  if (schema?.value !== STRUCTURED_SCHEMA) {
    d.exec(
      'DROP TABLE IF EXISTS hunts; DROP TABLE IF EXISTS creatures; DROP TABLE IF EXISTS quests; DROP TABLE IF EXISTS access_quests;'
    )
    d.prepare(
      `INSERT INTO meta (key, value) VALUES ('structuredSchema', ?), ('structuredStale', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(STRUCTURED_SCHEMA)
  }
  d.exec(`
    -- Knowledge base (RAG)
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      url TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      heading TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chunks_page ON chunks(page_id);
    -- FTS rowid = chunks.id
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      title, text, tokenize = 'unicode61 remove_diacritics 2'
    );

    -- Structured data extracted from infoboxes, for filters semantic search cannot do
    -- (e.g. hunts by level and vocation). Deleted along with the page.
    CREATE TABLE IF NOT EXISTS hunts (
      page_id INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      city TEXT,
      levels TEXT NOT NULL,      -- JSON: { knights: 10, paladins: 10, mages: 8 }
      exp TEXT,
      loot TEXT,
      best_loot TEXT NOT NULL DEFAULT '[]',  -- JSON: ["Bear Paw", "Small Diamond"]
      creatures TEXT NOT NULL    -- JSON: ["Amazon", "Valkyrie"]
    );
    CREATE TABLE IF NOT EXISTS creatures (
      page_id INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE,
      hp INTEGER,
      exp INTEGER,
      bestiary_class TEXT,
      bestiary_level TEXT,
      occurrence TEXT,
      damage TEXT,               -- summary of weaknesses/resistances/immunities
      max_damage TEXT NOT NULL DEFAULT '{}',   -- JSON: { physical: 120, fire: 310 }
      attack_type TEXT,
      is_boss INTEGER NOT NULL DEFAULT 0,
      damage_mods TEXT NOT NULL DEFAULT '{}'   -- JSON: { holy: 112, fire: 0 }
    );
    CREATE INDEX IF NOT EXISTS creatures_name ON creatures(name);
    CREATE TABLE IF NOT EXISTS quests (
      page_id INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE,
      aka TEXT,
      level INTEGER,             -- minimum level
      level_rec INTEGER,         -- recommended level
      premium INTEGER,           -- 1, 0 or NULL (unknown)
      reward TEXT,
      location TEXT,
      dangers TEXT NOT NULL DEFAULT '[]',  -- JSON: dangerous creatures/bosses
      legend TEXT,
      tags TEXT NOT NULL DEFAULT '[]'      -- JSON: ["acesso", "outfit"]
    );
    -- Official list of access quests (the wiki's "Access Quests" page).
    CREATE TABLE IF NOT EXISTS access_quests (name TEXT PRIMARY KEY COLLATE NOCASE);
    -- Creatures from the TibiaData API (see creatures-api.ts). They take precedence over the
    -- creatures table and do not depend on an indexed page.
    CREATE TABLE IF NOT EXISTS api_creatures (
      name TEXT PRIMARY KEY COLLATE NOCASE,
      hp INTEGER,
      exp INTEGER,
      bestiary_class TEXT,
      bestiary_level TEXT,
      occurrence TEXT,
      damage TEXT,
      max_damage TEXT NOT NULL DEFAULT '{}',
      attack_type TEXT,
      is_boss INTEGER NOT NULL DEFAULT 0,
      damage_mods TEXT NOT NULL DEFAULT '{}',
      loot TEXT NOT NULL DEFAULT '[]',     -- JSON: [{ item: "Boots of Haste", rarity: "very rare" }]
      fetched_at TEXT NOT NULL
    );

    -- Characters and progress
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      world TEXT,
      vocation TEXT,
      level INTEGER,
      residence TEXT,
      guild TEXT,
      notes TEXT NOT NULL DEFAULT '',
      last_synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS level_history (
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      level INTEGER NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS progress (
      id INTEGER PRIMARY KEY,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)

  // Columns added after the first version.
  const charColumns = (d.prepare('PRAGMA table_info(characters)').all() as { name: string }[]).map((c) => c.name)
  if (!charColumns.includes('account_status')) d.exec('ALTER TABLE characters ADD COLUMN account_status TEXT')
  // Player's manual choice: 1 = premium, 0 = free, NULL = use what Tibia.com reports.
  if (!charColumns.includes('premium_override')) d.exec('ALTER TABLE characters ADD COLUMN premium_override INTEGER')
  // Skills entered by the player (Tibia.com does not publish skills).
  for (const col of ['skill_melee', 'skill_distance', 'skill_shielding', 'magic_level']) {
    if (!charColumns.includes(col)) d.exec(`ALTER TABLE characters ADD COLUMN ${col} INTEGER`)
  }
  // Full sheet: each combat skill separately + fishing. The old skill_melee becomes
  // fist (monk) or sword (knight), since the weapon cannot be known.
  if (!charColumns.includes('skill_fist')) {
    for (const col of ['skill_fist', 'skill_club', 'skill_sword', 'skill_axe', 'skill_fishing']) {
      d.exec(`ALTER TABLE characters ADD COLUMN ${col} INTEGER`)
    }
    d.exec(`UPDATE characters SET skill_fist = skill_melee WHERE vocation LIKE '%monk%'`)
    d.exec(`UPDATE characters SET skill_sword = skill_melee WHERE vocation LIKE '%knight%'`)
  }
  for (const col of ['sex', 'outfit_url', 'portrait']) {
    if (!charColumns.includes(col)) d.exec(`ALTER TABLE characters ADD COLUMN ${col} TEXT`)
  }
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

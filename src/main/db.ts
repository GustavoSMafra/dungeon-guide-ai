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

// Suba quando mudar o esquema das tabelas derivadas (hunts, creatures). Elas são recriadas
// e repovoadas a partir da wiki (ver refreshStructured), sem refazer os embeddings.
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
    -- Base de conhecimento (RAG)
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
    -- rowid do FTS = chunks.id
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      title, text, tokenize = 'unicode61 remove_diacritics 2'
    );

    -- Dados estruturados extraídos dos infoboxes, para filtros que a busca semântica não faz
    -- (ex.: hunts por level e vocação). Apagados junto com a página.
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
      damage TEXT,               -- resumo de fraquezas/resistências/imunidades
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
      level INTEGER,             -- level mínimo
      level_rec INTEGER,         -- level recomendado
      premium INTEGER,           -- 1, 0 ou NULL (desconhecido)
      reward TEXT,
      location TEXT,
      dangers TEXT NOT NULL DEFAULT '[]',  -- JSON: criaturas/bosses perigosos
      legend TEXT,
      tags TEXT NOT NULL DEFAULT '[]'      -- JSON: ["acesso", "outfit"]
    );
    -- Lista oficial de quests de acesso (página "Access Quests" da wiki).
    CREATE TABLE IF NOT EXISTS access_quests (name TEXT PRIMARY KEY COLLATE NOCASE);
    -- Criaturas da API da TibiaData (ver creatures-api.ts). Têm prioridade sobre a tabela
    -- creatures e não dependem de uma página indexada.
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

    -- Personagens e progresso
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

  // Colunas adicionadas depois da primeira versão.
  const charColumns = (d.prepare('PRAGMA table_info(characters)').all() as { name: string }[]).map((c) => c.name)
  if (!charColumns.includes('account_status')) d.exec('ALTER TABLE characters ADD COLUMN account_status TEXT')
  // Escolha manual do jogador: 1 = premium, 0 = free, NULL = usar o que o Tibia.com informa.
  if (!charColumns.includes('premium_override')) d.exec('ALTER TABLE characters ADD COLUMN premium_override INTEGER')
  // Skills informadas pelo jogador (o Tibia.com não publica skills).
  for (const col of ['skill_melee', 'skill_distance', 'skill_shielding', 'magic_level']) {
    if (!charColumns.includes(col)) d.exec(`ALTER TABLE characters ADD COLUMN ${col} INTEGER`)
  }
  // Ficha completa: cada skill de combate separada + fishing. O antigo skill_melee vira
  // fist (monk) ou sword (knight), já que não dá para saber a arma.
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

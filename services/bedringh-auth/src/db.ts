import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const dbPath = path.join(DB_DIR, 'auth.db');
export const db = new Database(dbPath);

// Режим WAL для максимальной производительности
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    telegram_id INTEGER UNIQUE,
    telegram_username TEXT,
    two_factor_enabled INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    code TEXT NOT NULL,
    enable_2fa INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    telegram_id INTEGER,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS resets (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS two_factor_codes (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(code);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_users_tg ON users(telegram_id);
`);

// Миграции на случай существующей БД
try {
  db.exec("ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0;");
} catch {}
try {
  db.exec("ALTER TABLE sessions ADD COLUMN enable_2fa INTEGER DEFAULT 0;");
} catch {}
try {
  db.exec("ALTER TABLE users ADD COLUMN skin_model TEXT DEFAULT 'classic';");
} catch {}
try {
  db.exec("ALTER TABLE users ADD COLUMN skin_texture TEXT;");
} catch {}
try {
  db.exec("ALTER TABLE users ADD COLUMN cape_url TEXT;");
} catch {}
try {
  db.exec("ALTER TABLE users ADD COLUMN cape_name TEXT;");
} catch {}
try {
  db.exec("ALTER TABLE users ADD COLUMN launcher_settings TEXT;");
} catch {}

export const SKINS_DIR = path.join(DB_DIR, 'skins');
if (!fs.existsSync(SKINS_DIR)) {
  fs.mkdirSync(SKINS_DIR, { recursive: true });
}

export const CAPES_DIR = process.env.CAPES_DIR || path.join(process.cwd(), 'textures', 'capes');
if (!fs.existsSync(CAPES_DIR)) {
  fs.mkdirSync(CAPES_DIR, { recursive: true });
}

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  telegram_id: number | null;
  telegram_username: string | null;
  two_factor_enabled: number;
  skin_model?: 'classic' | 'slim';
  skin_texture?: string | null;
  cape_url?: string | null;
  cape_name?: string | null;
  launcher_settings?: string | null;
  created_at: string;
}

export interface SessionRow {
  token: string;
  username: string;
  password_hash: string;
  code: string;
  enable_2fa: number;
  status: 'pending' | 'confirmed' | 'rejected';
  telegram_id: number | null;
  expires_at: number;
}


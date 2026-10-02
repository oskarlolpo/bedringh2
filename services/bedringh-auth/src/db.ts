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

  CREATE TABLE IF NOT EXISTS active_sessions (
    uuid TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(code);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_users_tg ON users(telegram_id);
  CREATE INDEX IF NOT EXISTS idx_active_sessions_uuid ON active_sessions(uuid);
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
try {
  db.exec("ALTER TABLE users ADD COLUMN servers TEXT;");
} catch {}
try {
  db.exec("ALTER TABLE users ADD COLUMN last_uuid TEXT;");
} catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS cloud_packs (
    id TEXT PRIMARY KEY,
    author_username TEXT NOT NULL COLLATE NOCASE,
    name TEXT NOT NULL,
    description TEXT,
    game_version TEXT NOT NULL,
    loader TEXT NOT NULL,
    loader_version TEXT,
    version_number INTEGER DEFAULT 1,
    manifest TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_cloud_packs_author ON cloud_packs(author_username);

  CREATE TABLE IF NOT EXISTS cloud_pack_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pack_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    changelog TEXT,
    manifest TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pack_id, version_number)
  );
  CREATE INDEX IF NOT EXISTS idx_pack_versions_pack ON cloud_pack_versions(pack_id);

  CREATE TABLE IF NOT EXISTS friendships (
    id TEXT PRIMARY KEY,
    user_a TEXT NOT NULL COLLATE NOCASE,
    user_b TEXT NOT NULL COLLATE NOCASE,
    created_at INTEGER NOT NULL,
    UNIQUE(user_a, user_b)
  );
  CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships(user_a);
  CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(user_b);

  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    from_user TEXT NOT NULL COLLATE NOCASE,
    to_user TEXT NOT NULL COLLATE NOCASE,
    created_at INTEGER NOT NULL,
    UNIQUE(from_user, to_user)
  );
  CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_user);
  CREATE INDEX IF NOT EXISTS idx_friend_requests_from ON friend_requests(from_user);

  CREATE TABLE IF NOT EXISTS user_presence (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    status TEXT DEFAULT 'offline',
    place TEXT DEFAULT 'launcher',
    instance_name TEXT,
    loader TEXT,
    mc_version TEXT,
    server_address TEXT,
    server_name TEXT,
    pack_code TEXT,
    started_at INTEGER,
    total_minutes INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    room_id TEXT,
    sender TEXT NOT NULL COLLATE NOCASE,
    recipient TEXT COLLATE NOCASE,
    content TEXT NOT NULL,
    reply_to_id TEXT,
    reply_sender TEXT,
    reply_preview TEXT,
    attachment_url TEXT,
    attachment_type TEXT,
    voice_duration REAL,
    voice_peaks TEXT,
    reactions_json TEXT DEFAULT '{}',
    edited_at INTEGER,
    deleted INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_dm ON chat_messages(sender, recipient, created_at);
  CREATE INDEX IF NOT EXISTS idx_chat_room ON chat_messages(room_id, created_at);

  CREATE TABLE IF NOT EXISTS chat_reads (
    reader TEXT NOT NULL COLLATE NOCASE,
    target_key TEXT NOT NULL COLLATE NOCASE,
    last_read_at INTEGER NOT NULL,
    PRIMARY KEY(reader, target_key)
  );

  CREATE TABLE IF NOT EXISTS chat_rooms (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    owner TEXT NOT NULL COLLATE NOCASE,
    members_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

export const CUSTOM_FILES_DIR = path.join(DB_DIR, 'custom_files');
if (!fs.existsSync(CUSTOM_FILES_DIR)) {
  fs.mkdirSync(CUSTOM_FILES_DIR, { recursive: true });
}

export const CHAT_MEDIA_DIR = path.join(DB_DIR, 'chat_media');
if (!fs.existsSync(CHAT_MEDIA_DIR)) {
  fs.mkdirSync(CHAT_MEDIA_DIR, { recursive: true });
}

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
  servers?: string | null;
  last_uuid?: string | null;
  created_at: string;
}

export interface CloudPackRow {
  id: string;
  author_username: string;
  name: string;
  description: string | null;
  game_version: string;
  loader: string;
  loader_version: string | null;
  version_number: number;
  manifest: string;
  created_at: string;
  updated_at: string;
}

export interface CloudPackVersionRow {
  id: number;
  pack_id: string;
  version_number: number;
  changelog: string | null;
  manifest: string;
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


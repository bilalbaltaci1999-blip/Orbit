import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

let dbInstance: Database.Database | null = null;

export function getDb(customPath?: string): Database.Database {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const dbPath = customPath || process.env.DB_PATH || path.resolve(process.cwd(), 'data/orbit.db');
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrationsDir = path.resolve(process.cwd(), 'src/db/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const appliedStmt = db.prepare('SELECT 1 FROM _migrations WHERE name = ?');
  const insertStmt = db.prepare('INSERT INTO _migrations (name) VALUES (?)');

  for (const file of files) {
    const alreadyApplied = appliedStmt.get(file);
    if (!alreadyApplied) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      const migrateTx = db.transaction(() => {
        db.exec(sql);
        insertStmt.run(file);
      });
      migrateTx();
    }
  }
}

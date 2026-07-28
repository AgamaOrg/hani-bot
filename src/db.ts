import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'standup_bot.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS standups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    date TEXT NOT NULL,                  -- YYYY-MM-DD
    today TEXT NOT NULL,                 -- What did you do today? (Bulleted, project tasks)
    tomorrow TEXT NOT NULL,              -- What will you do tomorrow? (Bulleted, project tasks)
    proof_of_output TEXT NOT NULL DEFAULT '', -- Proof of Output link
    project_blockers TEXT,               -- Blockers in the project
    outside_blockers TEXT,               -- Blockers outside the project
    blockers TEXT,                       -- Legacy column
    feedback TEXT,                       -- Legacy column
    yesterday TEXT,                      -- Legacy column
    message_id TEXT,
    thread_id TEXT,
    created_at TEXT NOT NULL,           -- ISO timestamp
    UNIQUE(user_id, guild_id, date)
  );
`);

// Migrations for existing databases
try {
  db.exec(`ALTER TABLE standups ADD COLUMN tomorrow TEXT;`);
} catch {}
try {
  db.exec(`ALTER TABLE standups ADD COLUMN feedback TEXT;`);
} catch {}
try {
  db.exec(`ALTER TABLE standups ADD COLUMN proof_of_output TEXT NOT NULL DEFAULT '';`);
} catch {}
try {
  db.exec(`ALTER TABLE standups ADD COLUMN project_blockers TEXT;`);
} catch {}
try {
  db.exec(`ALTER TABLE standups ADD COLUMN outside_blockers TEXT;`);
} catch {}

export interface StandupRecord {
  id?: number;
  user_id: string;
  guild_id: string;
  date: string;
  today: string;
  tomorrow: string;
  proof_of_output: string;
  project_blockers?: string | null;
  outside_blockers?: string | null;
  blockers?: string | null;
  feedback?: string | null;
  yesterday?: string | null;
  message_id?: string | null;
  thread_id?: string | null;
  created_at?: string;
}

export function getUserTodayStandup(
  userId: string,
  guildId: string,
  dateStr?: string
): StandupRecord | null {
  const targetDate = dateStr || getTodayISOString();
  const stmt = db.prepare(`
    SELECT * FROM standups WHERE user_id = ? AND guild_id = ? AND date = ?
  `);
  return (stmt.get(userId, guildId, targetDate) as StandupRecord) || null;
}

export function hasSubmittedToday(userId: string, guildId: string, dateStr?: string): boolean {
  const targetDate = dateStr || getTodayISOString();
  const stmt = db.prepare(`
    SELECT COUNT(*) as cnt FROM standups WHERE user_id = ? AND guild_id = ? AND date = ?
  `);
  const result = stmt.get(userId, guildId, targetDate) as { cnt: number };
  return result.cnt > 0;
}

export function upsertStandup(record: Omit<StandupRecord, 'id' | 'created_at'>): StandupRecord {
  const createdAt = new Date().toISOString();
  const todayVal = record.today || record.yesterday || '';
  const tomorrowVal = record.tomorrow || '';
  const yesterdayVal = record.yesterday || todayVal;
  const proofVal = record.proof_of_output || '';
  const projBlockersVal = record.project_blockers ?? record.blockers ?? null;
  const outBlockersVal = record.outside_blockers ?? null;

  const stmt = db.prepare(`
    INSERT INTO standups (user_id, guild_id, date, yesterday, today, tomorrow, proof_of_output, project_blockers, outside_blockers, blockers, feedback, message_id, thread_id, created_at)
    VALUES (@user_id, @guild_id, @date, @yesterday, @today, @tomorrow, @proof_of_output, @project_blockers, @outside_blockers, @blockers, @feedback, @message_id, @thread_id, @created_at)
    ON CONFLICT(user_id, guild_id, date) DO UPDATE SET
      yesterday = excluded.yesterday,
      today = excluded.today,
      tomorrow = excluded.tomorrow,
      proof_of_output = excluded.proof_of_output,
      project_blockers = excluded.project_blockers,
      outside_blockers = excluded.outside_blockers,
      blockers = excluded.blockers,
      feedback = excluded.feedback,
      message_id = COALESCE(excluded.message_id, standups.message_id),
      thread_id = COALESCE(excluded.thread_id, standups.thread_id),
      created_at = excluded.created_at
  `);

  stmt.run({
    user_id: record.user_id,
    guild_id: record.guild_id,
    date: record.date,
    yesterday: yesterdayVal,
    today: todayVal,
    tomorrow: tomorrowVal,
    proof_of_output: proofVal,
    project_blockers: projBlockersVal,
    outside_blockers: outBlockersVal,
    blockers: projBlockersVal,
    feedback: record.feedback ?? null,
    message_id: record.message_id ?? null,
    thread_id: record.thread_id ?? null,
    created_at: createdAt,
  });

  const getStmt = db.prepare(`
    SELECT * FROM standups WHERE user_id = ? AND guild_id = ? AND date = ?
  `);
  return getStmt.get(record.user_id, record.guild_id, record.date) as StandupRecord;
}

export function getTodayStandups(guildId: string, dateStr?: string): StandupRecord[] {
  const targetDate = dateStr || getTodayISOString();
  const stmt = db.prepare(`
    SELECT * FROM standups WHERE guild_id = ? AND date = ? ORDER BY id ASC
  `);
  return stmt.all(guildId, targetDate) as StandupRecord[];
}

export function getActiveRoster(guildId: string, windowDays: number = 14): string[] {
  const cutoffDate = getCutoffISOString(windowDays);
  const stmt = db.prepare(`
    SELECT DISTINCT user_id FROM standups WHERE guild_id = ? AND date >= ?
  `);
  const rows = stmt.all(guildId, cutoffDate) as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

export function getUserHistory(
  guildId: string,
  userId: string,
  days: number = 14
): StandupRecord[] {
  const cappedDays = Math.min(Math.max(days, 1), 60);
  const cutoffDate = getCutoffISOString(cappedDays);
  const stmt = db.prepare(`
    SELECT * FROM standups
    WHERE guild_id = ? AND user_id = ? AND date >= ?
    ORDER BY date DESC
    LIMIT 60
  `);
  return stmt.all(guildId, userId, cutoffDate) as StandupRecord[];
}

export function getRangeSubmissions(
  guildId: string,
  startDateStr: string,
  endDateStr: string
): { user_id: string; submitted_days: number }[] {
  const stmt = db.prepare(`
    SELECT user_id, COUNT(DISTINCT date) as submitted_days
    FROM standups
    WHERE guild_id = ? AND date >= ? AND date <= ?
    GROUP BY user_id
  `);
  return stmt.all(guildId, startDateStr, endDateStr) as { user_id: string; submitted_days: number }[];
}

export function getTodayISOString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCutoffISOString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

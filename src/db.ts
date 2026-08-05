import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    '[db] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

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

export async function getUserTodayStandup(
  userId: string,
  guildId: string,
  dateStr?: string
): Promise<StandupRecord | null> {
  const targetDate = dateStr || getTodayISOString();
  const { data, error } = await supabase
    .from('standups')
    .select('*')
    .eq('user_id', userId)
    .eq('guild_id', guildId)
    .eq('date', targetDate)
    .maybeSingle();
  if (error) throw error;
  return (data as StandupRecord) || null;
}

export async function hasSubmittedToday(
  userId: string,
  guildId: string,
  dateStr?: string
): Promise<boolean> {
  const targetDate = dateStr || getTodayISOString();
  const { data, error } = await supabase
    .from('standups')
    .select('user_id')
    .eq('user_id', userId)
    .eq('guild_id', guildId)
    .eq('date', targetDate)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function upsertStandup(
  record: Omit<StandupRecord, 'id' | 'created_at'>
): Promise<StandupRecord> {
  const createdAt = new Date().toISOString();
  const todayVal = record.today || record.yesterday || '';
  const tomorrowVal = record.tomorrow || '';
  const yesterdayVal = record.yesterday || todayVal;
  const proofVal = record.proof_of_output || '';
  const projBlockersVal = record.project_blockers ?? record.blockers ?? null;
  const outBlockersVal = record.outside_blockers ?? null;

  const row = {
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
  };

  const { data: existing, error: fetchError } = await supabase
    .from('standups')
    .select('message_id, thread_id')
    .eq('user_id', record.user_id)
    .eq('guild_id', record.guild_id)
    .eq('date', record.date)
    .maybeSingle();
  if (fetchError) throw fetchError;

  if (existing && row.message_id === null) row.message_id = existing.message_id;
  if (existing && row.thread_id === null) row.thread_id = existing.thread_id;

  const { data, error } = await supabase
    .from('standups')
    .upsert(row, { onConflict: 'user_id,guild_id,date' })
    .select()
    .single();
  if (error) throw error;
  return data as StandupRecord;
}

export async function getTodayStandups(
  guildId: string,
  dateStr?: string
): Promise<StandupRecord[]> {
  const targetDate = dateStr || getTodayISOString();
  const { data, error } = await supabase
    .from('standups')
    .select('*')
    .eq('guild_id', guildId)
    .eq('date', targetDate)
    .order('id', { ascending: true });
  if (error) throw error;
  return (data as StandupRecord[]) || [];
}

export async function getActiveRoster(
  guildId: string,
  windowDays: number = 14
): Promise<string[]> {
  const cutoffDate = getCutoffISOString(windowDays);
  const { data, error } = await supabase
    .from('standups')
    .select('user_id')
    .eq('guild_id', guildId)
    .gte('date', cutoffDate);
  if (error) throw error;
  const seen = new Set<string>();
  for (const row of data || []) seen.add(row.user_id);
  return [...seen];
}

export async function getUserHistory(
  guildId: string,
  userId: string,
  days: number = 14
): Promise<StandupRecord[]> {
  const cappedDays = Math.min(Math.max(days, 1), 60);
  const cutoffDate = getCutoffISOString(cappedDays);
  const { data, error } = await supabase
    .from('standups')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .gte('date', cutoffDate)
    .order('date', { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data as StandupRecord[]) || [];
}

export async function getRangeSubmissions(
  guildId: string,
  startDateStr: string,
  endDateStr: string
): Promise<{ user_id: string; submitted_days: number }[]> {
  const { data, error } = await supabase
    .from('standups')
    .select('user_id, date')
    .eq('guild_id', guildId)
    .gte('date', startDateStr)
    .lte('date', endDateStr);
  if (error) throw error;
  const dayCounts = new Map<string, Set<string>>();
  for (const row of data || []) {
    if (!dayCounts.has(row.user_id)) dayCounts.set(row.user_id, new Set());
    dayCounts.get(row.user_id)!.add(row.date);
  }
  return [...dayCounts.entries()].map(([user_id, dates]) => ({
    user_id,
    submitted_days: dates.size,
  }));
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

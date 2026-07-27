import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  discordToken: string;
  updateChannelId: string;
  kpiChannelId: string;
  reminderHour: number;
  reminderMinute: number;
  eodHour: number;
  eodMinute: number;
  rosterWindowDays: number;
}

export function loadConfig(): Config {
  const discordToken = process.env.DISCORD_TOKEN || '';
  const updateChannelId =
    process.env.UPDATE_CHANNEL_ID || process.env.DAILY_STANDUP_CHANNEL_ID || '';
  const kpiChannelId = process.env.KPI_CHANNEL_ID || '';

  const reminderHour = parseInt(process.env.REMINDER_HOUR || '9', 10);
  const reminderMinute = parseInt(process.env.REMINDER_MINUTE || '0', 10);
  const eodHour = parseInt(process.env.EOD_HOUR || '18', 10);
  const eodMinute = parseInt(process.env.EOD_MINUTE || '0', 10);
  const rosterWindowDays = parseInt(process.env.ROSTER_WINDOW_DAYS || '14', 10);

  return {
    discordToken,
    updateChannelId,
    kpiChannelId,
    reminderHour,
    reminderMinute,
    eodHour,
    eodMinute,
    rosterWindowDays,
  };
}

export const config = loadConfig();

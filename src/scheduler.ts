import cron from 'node-cron';
import { Client, EmbedBuilder } from 'discord.js';
import { config } from './config.js';
import { getActiveRoster, getTodayStandups, getTodayISOString } from './db.js';
import { generateMonthlyKpiReport } from './kpi.js';
import { fetchGuildRoster } from './commands.js';

export function setupScheduler(client: Client) {
  // 1. Daily Nudge Task
  const reminderCron = `${config.reminderMinute} ${config.reminderHour} * * *`;
  cron.schedule(reminderCron, async () => {
    console.log(`[Cron] Running daily nudge task...`);
    const channelId = config.updateChannelId;
    if (!channelId) return;

    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel && channel.isTextBased() && 'send' in channel) {
        await channel.send(
          '⏰ **Daily Standup Reminder**: Good morning team! Please submit your daily standup update using the `/standup` command.'
        );
      }
    } catch (err) {
      console.error('[Cron] Error running daily nudge task:', err);
    }
  });

  // 2. EOD Summary Task
  const eodCron = `${config.eodMinute} ${config.eodHour} * * *`;
  cron.schedule(eodCron, async () => {
    console.log(`[Cron] Running EOD summary task...`);
    const channelId = config.updateChannelId;
    if (!channelId) return;

    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased() || !('send' in channel)) return;

      const guilds = client.guilds.cache;
      for (const [guildId, guild] of guilds) {
        const todayStr = getTodayISOString();
        const targetRoster = await fetchGuildRoster(
          guild,
          guildId,
          config.rosterWindowDays
        );

        const todayStandups = getTodayStandups(guildId, todayStr);
        const submittedMap = new Map(todayStandups.map((s) => [s.user_id, s]));

        const postedList: string[] = [];
        const missingList: string[] = [];

        for (const standup of todayStandups) {
          const rawBlocker = standup.blockers;
          const hasBlocker = rawBlocker && rawBlocker !== 'None' && rawBlocker.trim().length > 0;
          const statusIcon = hasBlocker ? '⚠️' : '✅';
          const blockerText = hasBlocker
            ? ` (Blocker: ${
                rawBlocker!.length > 60
                  ? rawBlocker!.substring(0, 60) + '...'
                  : rawBlocker
              })`
            : '';
          postedList.push(`${statusIcon} <@${standup.user_id}>${blockerText}`);
        }

        for (const userId of targetRoster) {
          if (!submittedMap.has(userId)) {
            missingList.push(`<@${userId}>`);
          }
        }

        const embed = new EmbedBuilder()
          .setTitle(`🌆 End-of-Day Standup Summary — ${todayStr}`)
          .setColor(missingList.length > 0 ? 0xe74c3c : 0x2ecc71)
          .addFields(
            {
              name: `Posted Today (${todayStandups.length})`,
              value: postedList.length > 0 ? postedList.join('\n') : 'No updates submitted today.',
            },
            {
              name: `Missing Updates (${missingList.length})`,
              value:
                missingList.length > 0
                  ? missingList.join(', ')
                  : 'All active team members submitted their updates today! 🎉',
            }
          )
          .setTimestamp();

        const pingContent =
          missingList.length > 0
            ? `⚠️ **Missing Standup Updates**: ${missingList.join(', ')} — Please submit your \`/standup\` as soon as possible!`
            : undefined;

        await channel.send(
          pingContent
            ? { content: pingContent, embeds: [embed] }
            : { embeds: [embed] }
        );
      }
    } catch (err) {
      console.error('[Cron] Error running EOD summary task:', err);
    }
  });

  // 3. Monthly KPI Report Task (Runs at 09:00 on the 15th of every month for the completed 15th-to-14th cycle)
  cron.schedule('0 9 15 * *', async () => {
    console.log(`[Cron] Running monthly automated KPI report task...`);
    const kpiChannelId = config.kpiChannelId;
    if (!kpiChannelId) return;

    try {
      const kpiChannel = await client.channels.fetch(kpiChannelId).catch(() => null);
      if (!kpiChannel || !kpiChannel.isTextBased() || !('send' in kpiChannel)) return;

      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      const guilds = client.guilds.cache;
      for (const [guildId, guild] of guilds) {
        const serverRoster = await fetchGuildRoster(
          guild,
          guildId,
          config.rosterWindowDays
        );

        const kpiData = generateMonthlyKpiReport(
          guildId,
          currentYear,
          currentMonth,
          config.rosterWindowDays,
          serverRoster
        );

        const embed = new EmbedBuilder()
          .setTitle(`📊 Monthly KPI Report — ${kpiData.shortName} ${currentYear}`)
          .setColor(0x9b59b6)
          .setDescription(
            `Automated monthly KPI report.\n` +
              `**Evaluation Period:** ${kpiData.cycleLabel}\n` +
              `**Total Business Days (Mon–Fri):** ${kpiData.businessDays}\n` +
              `**Total Members Evaluated:** ${kpiData.totalMembers}\n` +
              `**Team Average Score:** ${kpiData.averageScore} / 20 pts (${kpiData.averagePercentage}%)`
          )
          .addFields({
            name: '📈 Rating Tier Breakdown',
            value:
              `🌟 **Excellent (20 pts):** ${kpiData.summaryTiers.excellent} members\n` +
              `🟢 **Good (16 pts):** ${kpiData.summaryTiers.good} members\n` +
              `🟡 **Satisfactory (12 pts):** ${kpiData.summaryTiers.satisfactory} members\n` +
              `🟠 **Needs Improvement (8 pts):** ${kpiData.summaryTiers.needsImprovement} members\n` +
              `🔴 **Unsatisfactory (4 pts):** ${kpiData.summaryTiers.unsatisfactory} members`,
          })
          .setTimestamp();

        if (kpiData.results.length === 0) {
          embed.addFields({
            name: '👥 Member Details',
            value: 'No server members found to evaluate for this period.',
          });
        } else {
          const memberLines = kpiData.results.map((r) => {
            const icon =
              r.score === 20
                ? '🌟'
                : r.score === 16
                ? '🟢'
                : r.score === 12
                ? '🟡'
                : r.score === 8
                ? '🟠'
                : '🔴';
            return `${icon} <@${r.userId}>: **${r.score} pts** (${r.rating}) — ${r.submittedDays}/${r.businessDays} days (${r.percentage}%)`;
          });
          const linesText = memberLines.join('\n');
          embed.addFields({
            name: `👥 Member Performance Breakdown (${kpiData.results.length})`,
            value: linesText.length > 1020 ? linesText.substring(0, 1017) + '...' : linesText,
          });
        }

        await kpiChannel.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error('[Cron] Error running monthly KPI report task:', err);
    }
  });

  console.log(
    `[Scheduler] Cron tasks initialized (Reminder: ${config.reminderHour}:${config.reminderMinute}, EOD: ${config.eodHour}:${config.eodMinute}, Monthly KPI: 1st of month @ 09:00).`
  );
}

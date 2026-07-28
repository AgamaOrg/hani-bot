import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  GuildMember,
  Guild,
  MessageFlags,
} from 'discord.js';
import { config } from './config.js';
import {
  upsertStandup,
  hasSubmittedToday,
  getUserTodayStandup,
  getTodayStandups,
  getActiveRoster,
  getUserHistory,
  getTodayISOString,
} from './db.js';
import { generateMonthlyKpiReport } from './kpi.js';

export interface TaskItem {
  category: 'today' | 'tomorrow';
  text: string;
  proofUrl?: string;
}

export interface BlockerItem {
  category: 'project' | 'outside';
  text: string;
}

export interface StandupDraft {
  userId: string;
  guildId: string;
  dateStr: string;
  todayTasks: TaskItem[];
  tomorrowTasks: TaskItem[];
  blockers: BlockerItem[];
}

const activeDrafts = new Map<string, StandupDraft>();

export function getDraftKey(userId: string, guildId: string): string {
  return `${guildId}:${userId}`;
}

export function getOrCreateDraft(userId: string, guildId: string): StandupDraft {
  const key = getDraftKey(userId, guildId);
  const dateStr = getTodayISOString();
  let draft = activeDrafts.get(key);
  if (!draft || draft.dateStr !== dateStr) {
    draft = {
      userId,
      guildId,
      dateStr,
      todayTasks: [],
      tomorrowTasks: [],
      blockers: [],
    };
    activeDrafts.set(key, draft);
  }
  return draft;
}

export function clearDraft(userId: string, guildId: string) {
  activeDrafts.delete(getDraftKey(userId, guildId));
}

function parseTodayFromRecord(today: string): TaskItem[] {
  return today.split('\n')
    .filter(l => l.startsWith('- '))
    .map(l => {
      const m = l.match(/^- (.+?)(?: \(Proof: (.+)\))?$/);
      if (!m) return { category: 'today' as const, text: l.replace(/^- /, '') };
      return { category: 'today' as const, text: m[1], proofUrl: m[2] || undefined };
    });
}

function parseTomorrowFromRecord(tomorrow: string): TaskItem[] {
  return tomorrow.split('\n')
    .filter(l => l.startsWith('- '))
    .map(l => {
      const text = l.replace(/^- /, '');
      return { category: 'tomorrow' as const, text };
    });
}

function parseBlockersFromRecord(project?: string | null, outside?: string | null): BlockerItem[] {
  const blockers: BlockerItem[] = [];
  for (const line of (project || '').split('\n')) {
    const m = line.match(/^- (.+)$/);
    if (m) blockers.push({ category: 'project', text: m[1] });
  }
  for (const line of (outside || '').split('\n')) {
    const m = line.match(/^- (.+)$/);
    if (m) blockers.push({ category: 'outside', text: m[1] });
  }
  return blockers;
}

export function buildDraftEmbedAndComponents(draft: StandupDraft, displayName: string) {
  const todayLines = draft.todayTasks.map((t, i) => {
    let line = `${i + 1}. ${t.text}`;
    if (t.proofUrl && t.proofUrl.trim().length > 0) {
      line += `\n   🔗 *Proof:* ${t.proofUrl}`;
    }
    return line;
  });

  const tomorrowLines = draft.tomorrowTasks.map(
    (t, i) => `${i + 1}. ${t.text}`
  );

  const projBlockerLines = draft.blockers
    .filter((b) => b.category === 'project')
    .map((b, i) => `${i + 1}. ${b.text}`);

  const outBlockerLines = draft.blockers
    .filter((b) => b.category === 'outside')
    .map((b, i) => `${i + 1}. ${b.text}`);

  const proofList = draft.todayTasks
    .map((t) => t.proofUrl)
    .filter((p): p is string => Boolean(p && p.trim().length > 0));

  const embed = new EmbedBuilder()
    .setTitle(`📋 Daily Standup Draft — ${draft.dateStr}`)
    .setColor(0x3498db)
    .setDescription(
      `Drafting standup for **${displayName}**. Use the buttons below to add tasks, add blockers, or edit entries.`
    )
    .addFields(
      {
        name: `Today's Tasks (${draft.todayTasks.length})`,
        value: todayLines.length > 0 ? todayLines.join('\n') : '*No tasks added yet. Click [➕ Add Task].*',
      },
      {
        name: `Tomorrow's Tasks (${draft.tomorrowTasks.length})`,
        value: tomorrowLines.length > 0 ? tomorrowLines.join('\n') : '*No tasks added yet. Click [➕ Add Task].*',
      },
      {
        name: 'Proof of Output (Integrated)',
        value: proofList.length > 0 ? proofList.map((p, i) => `${i + 1}. ${p}`).join('\n') : '*Add Proof URL via [➕ Add Task] for Today.*',
      },
      {
        name: `Project Blockers (${projBlockerLines.length})`,
        value: projBlockerLines.length > 0 ? projBlockerLines.join('\n') : 'None',
      },
      {
        name: `Outside Project Blockers (${outBlockerLines.length})`,
        value: outBlockerLines.length > 0 ? outBlockerLines.join('\n') : 'None',
      }
    )
    .setTimestamp();

  const totalEntries = draft.todayTasks.length + draft.tomorrowTasks.length + draft.blockers.length;

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('btn_add_task').setLabel('➕ Add Task').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('btn_add_blocker').setLabel('🚧 Add Blocker').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_edit_entry')
      .setLabel('✏️ Edit Entry')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(totalEntries === 0),
    new ButtonBuilder().setCustomId('btn_submit_standup').setLabel('🚀 Submit Standup').setStyle(ButtonStyle.Success)
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('btn_reset_draft').setLabel('🗑️ Reset').setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row1, row2] };
}

function buildSubmittedEmbed(displayName: string, dateStr: string, color: number, fields: { name: string; value: string }[]) {
  return new EmbedBuilder()
    .setTitle(`Daily Standup — ${dateStr}`)
    .setColor(color)
    .setAuthor({ name: displayName, iconURL: undefined })
    .addFields(fields)
    .setTimestamp();
}

export const slashCommands = [
  new SlashCommandBuilder()
    .setName('standup')
    .setDescription('Open interactive task list card (1 per day limit)'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('View instructions and guidelines on how to use the standup bot'),

  new SlashCommandBuilder()
    .setName('teamstatus')
    .setDescription('Display team daily standup status'),

  new SlashCommandBuilder()
    .setName('history')
    .setDescription('Lookup member standup history')
    .addUserOption((option) =>
      option.setName('member').setDescription('Member to query history for').setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('days')
        .setDescription('Number of days (1-60)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(60)
    ),

  new SlashCommandBuilder()
    .setName('kpireport')
    .setDescription('Generate and publish monthly Update Frequency KPI report')
    .addStringOption((option) =>
      option
        .setName('month')
        .setDescription('Select target month cutoff period')
        .setRequired(false)
        .addChoices(
          { name: 'Jan (15 Dec - 14 Jan)', value: 'jan' },
          { name: 'Feb (15 Jan - 14 Feb)', value: 'feb' },
          { name: 'Mar (15 Feb - 14 Mar)', value: 'mar' },
          { name: 'Apr (15 Mar - 14 Apr)', value: 'apr' },
          { name: 'May (15 Apr - 14 May)', value: 'may' },
          { name: 'Jun (15 May - 14 Jun)', value: 'jun' },
          { name: 'Jul (15 Jun - 14 Jul)', value: 'jul' },
          { name: 'Aug (15 Jul - 14 Aug)', value: 'aug' },
          { name: 'Sep (15 Aug - 14 Sep)', value: 'sep' },
          { name: 'Oct (15 Sep - 14 Oct)', value: 'oct' },
          { name: 'Nov (15 Oct - 14 Nov)', value: 'nov' },
          { name: 'Dec (15 Nov - 14 Dec)', value: 'dec' }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName('year')
        .setDescription('4-digit Year (e.g. 2026)')
        .setRequired(false)
        .setMinValue(2020)
        .setMaxValue(2100)
    ),
];

export async function handleStandupCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guildId || 'default_guild';
  const userId = interaction.user.id;
  const dateStr = getTodayISOString();

  const existing = getUserTodayStandup(userId, guildId, dateStr);
  const draft = getOrCreateDraft(userId, guildId);
  if (existing) {
    draft.todayTasks = parseTodayFromRecord(existing.today);
    draft.tomorrowTasks = parseTomorrowFromRecord(existing.tomorrow);
    draft.blockers = parseBlockersFromRecord(existing.project_blockers, existing.outside_blockers);
  }

  const member = interaction.member as GuildMember | null;
  const displayName = member?.displayName || interaction.user.displayName || interaction.user.username;

  const payload = buildDraftEmbedAndComponents(draft, displayName);
  await interaction.editReply(payload);
}

export async function handleButtonInteraction(interaction: ButtonInteraction) {
  const guildId = interaction.guildId || 'default_guild';
  const userId = interaction.user.id;
  const dateStr = getTodayISOString();

  const draft = getOrCreateDraft(userId, guildId);

  if (interaction.customId === 'btn_add_task') {
    const modal = new ModalBuilder().setCustomId('modal_add_task').setTitle('Add Task Entry');

    const categoryInput = new TextInputBuilder()
      .setCustomId('category')
      .setLabel('Category ("today" or "tomorrow")')
      .setPlaceholder('today')
      .setValue('today')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);

    const textInput = new TextInputBuilder()
      .setCustomId('text')
      .setLabel('Task Detail')
      .setPlaceholder('Implemented OAuth2 callback handler')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000);

    const proofInput = new TextInputBuilder()
      .setCustomId('proof_url')
      .setLabel('Proof of Output Link (Req for Today)')
      .setPlaceholder('https://github.com/org/repo/pull/123')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(500);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(categoryInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(textInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(proofInput)
    );

    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === 'btn_add_blocker') {
    const modal = new ModalBuilder().setCustomId('modal_add_blocker').setTitle('Add Blocker Entry');

    const categoryInput = new TextInputBuilder()
      .setCustomId('category')
      .setLabel('Category ("project" or "outside")')
      .setPlaceholder('project')
      .setValue('project')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);

    const textInput = new TextInputBuilder()
      .setCustomId('text')
      .setLabel('Blocker Detail / Impact')
      .setPlaceholder('API rate limit exceeded, waiting on DevOps')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(categoryInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(textInput)
    );

    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === 'btn_edit_entry') {
    const options: StringSelectMenuOptionBuilder[] = [];

    draft.todayTasks.forEach((t, i) => {
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(`Today Task ${i + 1}: ${t.text.substring(0, 50)}`)
          .setValue(`today:${i}`)
          .setDescription(t.text.substring(0, 50))
      );
    });

    draft.tomorrowTasks.forEach((t, i) => {
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(`Tomorrow Task ${i + 1}: ${t.text.substring(0, 50)}`)
          .setValue(`tomorrow:${i}`)
          .setDescription(t.text.substring(0, 50))
      );
    });

    draft.blockers.forEach((b, i) => {
      const catLabel = b.category === 'project' ? 'Project Blocker' : 'Outside Blocker';
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(`${catLabel} ${i + 1}: ${b.text.substring(0, 50)}`)
          .setValue(`blocker:${i}`)
          .setDescription(b.text.substring(0, 50))
      );
    });

    if (options.length === 0) {
      await interaction.reply({
        content: '⚠️ No entries available to edit in your draft.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_edit_entry')
      .setPlaceholder('Select an entry to edit...')
      .addOptions(options.slice(0, 25));

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
      content: '✏️ **Select an entry below to edit or modify:**',
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.customId === 'btn_reset_draft') {
    await interaction.deferUpdate();
    draft.todayTasks = [];
    draft.tomorrowTasks = [];
    draft.blockers = [];

    const member = interaction.member as GuildMember | null;
    const displayName = member?.displayName || interaction.user.displayName || interaction.user.username;
    const payload = buildDraftEmbedAndComponents(draft, displayName);
    await interaction.editReply(payload);
    return;
  }

  if (interaction.customId === 'btn_submit_standup') {
    await interaction.deferUpdate();

    if (draft.todayTasks.length === 0 && draft.tomorrowTasks.length === 0) {
      await interaction.followUp({
        content: '⚠️ **No Tasks Added**: Please click **[➕ Add Task]** to add at least one task before submitting.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (draft.todayTasks.length > 0) {
      const hasProof = draft.todayTasks.some((t) => t.proofUrl && t.proofUrl.trim().length > 0);
      if (!hasProof) {
        await interaction.followUp({
          content: '⚠️ **Missing Proof of Output**: Please provide a Proof URL for at least one Today\'s task (via **[➕ Add Task]** or **[✏️ Edit Entry]**) before submitting.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const member = interaction.member as GuildMember | null;
    const displayName = member?.displayName || interaction.user.displayName || interaction.user.username;

    const todayText = draft.todayTasks.length > 0
      ? draft.todayTasks.map((t) => {
          let line = `- ${t.text}`;
          if (t.proofUrl && t.proofUrl.trim().length > 0) {
            line += ` (Proof: ${t.proofUrl})`;
          }
          return line;
        }).join('\n')
      : 'None';

    const tomorrowText = draft.tomorrowTasks.length > 0
      ? draft.tomorrowTasks.map((t) => `- ${t.text}`).join('\n')
      : 'None';

    const proofList = draft.todayTasks
      .map((t) => t.proofUrl)
      .filter((p): p is string => Boolean(p && p.trim().length > 0));
    const proofOfOutputText = proofList.length > 0 ? proofList.join(', ') : 'N/A';

    const projBlockerList = draft.blockers.filter((b) => b.category === 'project');
    const outBlockerList = draft.blockers.filter((b) => b.category === 'outside');

    const projBlockerText = projBlockerList.length > 0
      ? projBlockerList.map((b) => `- ${b.text}`).join('\n')
      : 'None';

    const outBlockerText = outBlockerList.length > 0
      ? outBlockerList.map((b) => `- ${b.text}`).join('\n')
      : 'None';

    const hasAnyBlockers = draft.blockers.length > 0;
    const embedColor = hasAnyBlockers ? 0xffa500 : 0x00ff00;

    const fields = [
      { name: 'What did you do today? (Project)', value: todayText },
      { name: 'What will you do tomorrow? (Project)', value: tomorrowText },
      { name: 'Proof of Output', value: proofOfOutputText },
      { name: 'Project Blockers', value: projBlockerText },
      { name: 'Outside Project Blockers', value: outBlockerText },
    ];

    const channelId = config.updateChannelId;
    const channel = channelId ? await interaction.client.channels.fetch(channelId).catch(() => null) : null;

    let messageId: string | undefined;
    let threadId: string | undefined;

    const existingRecord = getUserTodayStandup(userId, guildId, dateStr);
    const postedEmbed = buildSubmittedEmbed(displayName, dateStr, embedColor, fields);

    if (existingRecord?.message_id && channel && 'messages' in channel) {
      try {
        const existingMsg = await channel.messages.fetch(existingRecord.message_id);
        await existingMsg.edit({ embeds: [postedEmbed] });
        messageId = existingRecord.message_id ?? undefined;
        threadId = existingRecord.thread_id ?? undefined;
      } catch {
        // Message deleted or inaccessible, send fresh
        const sentMsg = await channel.send({ embeds: [postedEmbed] });
        messageId = sentMsg.id;
        if ('startThread' in sentMsg) {
          try {
            const thread = await sentMsg.startThread({
              name: `${displayName} — ${dateStr}`,
              autoArchiveDuration: 1440,
            });
            threadId = thread.id;
          } catch (threadErr) {
            console.error('Failed to create feedback thread:', threadErr);
          }
        }
      }
    } else if (channel && channel.isTextBased() && 'send' in channel) {
      try {
        const sentMsg = await channel.send({ embeds: [postedEmbed] });
        messageId = sentMsg.id;

        if ('startThread' in sentMsg) {
          try {
            const thread = await sentMsg.startThread({
              name: `${displayName} — ${dateStr}`,
              autoArchiveDuration: 1440,
            });
            threadId = thread.id;
          } catch (threadErr) {
            console.error('Failed to create feedback thread:', threadErr);
          }
        }
      } catch (msgErr) {
        console.error('Failed to send standup message to update channel:', msgErr);
      }
    }

    upsertStandup({
      user_id: userId,
      guild_id: guildId,
      date: dateStr,
      today: todayText,
      tomorrow: tomorrowText,
      proof_of_output: proofOfOutputText,
      project_blockers: projBlockerList.length > 0 ? projBlockerText : null,
      outside_blockers: outBlockerList.length > 0 ? outBlockerText : null,
      message_id: messageId,
      thread_id: threadId,
    });

    clearDraft(userId, guildId);

    await interaction.editReply({
      content: '✅ **Daily Standup Submitted Successfully!** Your update has been posted to the team channel.',
      embeds: [],
      components: [],
    });
  }
}

export async function handleSelectMenuInteraction(interaction: StringSelectMenuInteraction) {
  const guildId = interaction.guildId || 'default_guild';
  const userId = interaction.user.id;
  const draft = getOrCreateDraft(userId, guildId);

  if (interaction.customId === 'select_edit_entry') {
    const selectedValue = interaction.values[0];
    const [type, indexStr] = selectedValue.split(':');
    const index = parseInt(indexStr, 10);

    if (type === 'today' || type === 'tomorrow') {
      const taskList = type === 'today' ? draft.todayTasks : draft.tomorrowTasks;
      const task = taskList[index];
      if (!task) {
        await interaction.reply({ content: '⚠️ Task entry not found.', flags: MessageFlags.Ephemeral });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`modal_edit_task:${type}:${index}`)
        .setTitle(`Edit ${type === 'today' ? 'Today' : 'Tomorrow'} Task`);

      const textInput = new TextInputBuilder()
        .setCustomId('text')
        .setLabel('Task Detail')
        .setValue(task.text)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      const proofInput = new TextInputBuilder()
        .setCustomId('proof_url')
        .setLabel('Proof of Output Link')
        .setValue(task.proofUrl || '')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(textInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(proofInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (type === 'blocker') {
      const blocker = draft.blockers[index];
      if (!blocker) {
        await interaction.reply({ content: '⚠️ Blocker entry not found.', flags: MessageFlags.Ephemeral });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`modal_edit_blocker:${index}`)
        .setTitle('Edit Blocker Entry');

      const categoryInput = new TextInputBuilder()
        .setCustomId('category')
        .setLabel('Category ("project" or "outside")')
        .setValue(blocker.category)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10);

      const textInput = new TextInputBuilder()
        .setCustomId('text')
        .setLabel('Blocker Detail / Impact')
        .setValue(blocker.text)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(categoryInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(textInput)
      );

      await interaction.showModal(modal);
      return;
    }
  }
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guildId || 'default_guild';
  const userId = interaction.user.id;
  const draft = getOrCreateDraft(userId, guildId);
  const member = interaction.member as GuildMember | null;
  const displayName = member?.displayName || interaction.user.displayName || interaction.user.username;

  if (interaction.customId === 'modal_add_task') {
    await interaction.deferUpdate();

    const rawCategory = interaction.fields.getTextInputValue('category').trim().toLowerCase();
    const category = rawCategory === 'tomorrow' ? 'tomorrow' : 'today';
    const text = interaction.fields.getTextInputValue('text').trim();
    const proofUrl = interaction.fields.getTextInputValue('proof_url').trim();

    if (text.length > 0) {
      const task: TaskItem = { category, text, proofUrl: proofUrl || undefined };
      if (category === 'tomorrow') {
        draft.tomorrowTasks.push(task);
      } else {
        draft.todayTasks.push(task);
      }
    }

    const payload = buildDraftEmbedAndComponents(draft, displayName);
    await interaction.editReply(payload);
    return;
  }

  if (interaction.customId === 'modal_add_blocker') {
    await interaction.deferUpdate();

    const rawCategory = interaction.fields.getTextInputValue('category').trim().toLowerCase();
    const category = rawCategory === 'outside' ? 'outside' : 'project';
    const text = interaction.fields.getTextInputValue('text').trim();

    if (text.length > 0) {
      draft.blockers.push({ category, text });
    }

    const payload = buildDraftEmbedAndComponents(draft, displayName);
    await interaction.editReply(payload);
    return;
  }

  if (interaction.customId.startsWith('modal_edit_task:')) {
    await interaction.deferUpdate();

    const parts = interaction.customId.split(':');
    const type = parts[1] as 'today' | 'tomorrow';
    const index = parseInt(parts[2], 10);

    const text = interaction.fields.getTextInputValue('text').trim();
    const proofUrl = interaction.fields.getTextInputValue('proof_url').trim();

    const taskList = type === 'today' ? draft.todayTasks : draft.tomorrowTasks;
    if (taskList[index]) {
      if (text.length === 0) {
        taskList.splice(index, 1);
      } else {
        taskList[index] = { category: type, text, proofUrl: proofUrl || undefined };
      }
    }

    const payload = buildDraftEmbedAndComponents(draft, displayName);
    await interaction.editReply(payload);
    return;
  }

  if (interaction.customId.startsWith('modal_edit_blocker:')) {
    await interaction.deferUpdate();

    const indexStr = interaction.customId.split(':')[1];
    const index = parseInt(indexStr, 10);

    const rawCategory = interaction.fields.getTextInputValue('category').trim().toLowerCase();
    const category = rawCategory === 'outside' ? 'outside' : 'project';
    const text = interaction.fields.getTextInputValue('text').trim();

    if (draft.blockers[index]) {
      if (text.length === 0) {
        draft.blockers.splice(index, 1);
      } else {
        draft.blockers[index] = { category, text };
      }
    }

    const payload = buildDraftEmbedAndComponents(draft, displayName);
    await interaction.editReply(payload);
    return;
  }
}

export async function handleHelpCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const embed = new EmbedBuilder()
    .setTitle('📖 Daily Standup Bot — Interactive Usage Guide')
    .setColor(0x3498db)
    .setDescription('Welcome! Here is how to use the interactive Standup Bot buttons and features.')
    .addFields(
      {
        name: '🤖 Commands Guide',
        value:
          '`/standup` — Open interactive task list card\n' +
          '`/teamstatus` — Display team submission status & missing member pings\n' +
          '`/history [member] [days]` — Query past standup updates (up to 60 days)\n' +
          '`/kpireport [month] [year]` — Generate monthly Update Frequency KPI report\n' +
          '`/help` — Display this usage guide',
      },
      {
        name: '📋 Interactive Action Buttons',
        value:
          '1. Run `/standup` to open your private Task List Card.\n' +
          '2. Click **[➕ Add Task]** to add individual task titles, descriptions, and Proof URLs for Today.\n' +
          '3. Click **[🚧 Add Blocker]** to add Project or Outside Project blockers.\n' +
          '4. Click **[✏️ Edit Entry]** to pick any added draft item from a dropdown menu and update or remove it.\n' +
          '5. Click **[🚀 Submit Standup]** to post your daily update!',
      },
      {
        name: '📝 Editing After Submit',
        value: 'You can run `/standup` again after submitting to edit your update. Re-submitting will update the existing post in the team channel.',
      },
      {
        name: '🚧 Categorized Blockers',
        value: '• **Project Blockers**: Issues directly affecting project code, reviews, or deliverables.\n' +
          '• **Outside Project Blockers**: External impediments (cross-team delays, vendor issues, network).',
      }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

export async function fetchGuildRoster(
  guild: Guild | null,
  guildId: string,
  rosterWindowDays: number
): Promise<string[]> {
  if (guild) {
    try {
      const fetchPromise = guild.members.fetch();
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 2500)
      );

      const members = await Promise.race([fetchPromise, timeoutPromise]);
      if (members && 'filter' in members) {
        const ids = members.filter((m) => !m.user.bot).map((m) => m.id);
        if (ids.length > 0) return ids;
      }
    } catch (err) {
      console.error('[Roster] Failed to fetch guild members:', err);
    }

    const cachedIds = guild.members.cache.filter((m) => !m.user.bot).map((m) => m.id);
    if (cachedIds.length > 0) return cachedIds;
  }

  return getActiveRoster(guildId, rosterWindowDays);
}

export async function handleTeamStatusCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const guildId = interaction.guildId || 'default_guild';
  const todayStr = getTodayISOString();

  const targetRoster = await fetchGuildRoster(
    interaction.guild,
    guildId,
    config.rosterWindowDays
  );

  const todayStandups = getTodayStandups(guildId, todayStr);
  const submittedMap = new Map(todayStandups.map((s) => [s.user_id, s]));

  const postedList: string[] = [];
  const missingList: string[] = [];

  for (const standup of todayStandups) {
    const projBlocker = standup.project_blockers || standup.blockers;
    const outBlocker = standup.outside_blockers;
    const hasBlocker = Boolean(
      (projBlocker && projBlocker.trim().length > 0) ||
      (outBlocker && outBlocker.trim().length > 0)
    );

    const statusIcon = hasBlocker ? '⚠️' : '✅';
    let blockerText = '';
    if (projBlocker && projBlocker.trim().length > 0) {
      blockerText += ` (Project Blocker: ${projBlocker.length > 50 ? projBlocker.substring(0, 50) + '...' : projBlocker})`;
    }
    if (outBlocker && outBlocker.trim().length > 0) {
      blockerText += ` (Outside Blocker: ${outBlocker.length > 50 ? outBlocker.substring(0, 50) + '...' : outBlocker})`;
    }

    postedList.push(`${statusIcon} <@${standup.user_id}>${blockerText}`);
  }

  for (const userId of targetRoster) {
    if (!submittedMap.has(userId)) {
      missingList.push(`<@${userId}>`);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`Team Standup Status — ${todayStr}`)
    .setColor(0x3498db)
    .addFields(
      {
        name: `Posted Today (${todayStandups.length})`,
        value: postedList.length > 0 ? postedList.join('\n') : 'No updates submitted yet today.',
      },
      {
        name: `Missing Updates (${missingList.length})`,
        value:
          missingList.length > 0
            ? missingList.join(', ')
            : 'All active team members have posted! 🎉',
      }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

export async function handleHistoryCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guildId || 'default_guild';
  const targetUser = interaction.options.getUser('member') || interaction.user;
  const days = interaction.options.getInteger('days') || 14;

  const historyRecords = getUserHistory(guildId, targetUser.id, days);

  if (historyRecords.length === 0) {
    await interaction.editReply({
      content: `No standup history found for <@${targetUser.id}> in the last ${days} days.`,
    });
    return;
  }

  let content = `### Standup History for <@${targetUser.id}> (Last ${days} days)\n\n`;
  for (const rec of historyRecords) {
    const todayText = rec.today || rec.yesterday || '';
    const projBlocker = rec.project_blockers || rec.blockers || 'None';
    const outBlocker = rec.outside_blockers || 'None';
    const proof = rec.proof_of_output || 'N/A';

    const entryText =
      `**📅 ${rec.date}**\n` +
      `**Today (Project):** ${todayText}\n` +
      `**Tomorrow (Project):** ${rec.tomorrow || 'None'}\n` +
      `**Proof of Output:** ${proof}\n` +
      `**Project Blockers:** ${projBlocker}\n` +
      `**Outside Blockers:** ${outBlocker}\n` +
      `\n`;
    if ((content + entryText).length > 1950) {
      content += '*[Truncated due to character limit]*';
      break;
    }
    content += entryText;
  }

  await interaction.editReply({
    content,
  });
}

export async function handleKpiReportCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const now = new Date();
  const monthInput = interaction.options.getString('month');
  const year = interaction.options.getInteger('year') || now.getFullYear();
  const guildId = interaction.guildId || 'default_guild';

  const serverRoster = await fetchGuildRoster(
    interaction.guild,
    guildId,
    config.rosterWindowDays
  );

  const kpiData = generateMonthlyKpiReport(
    guildId,
    year,
    monthInput,
    config.rosterWindowDays,
    serverRoster
  );

  const embed = new EmbedBuilder()
    .setTitle(`📊 Monthly KPI Report — ${kpiData.shortName} ${year}`)
    .setColor(0x9b59b6)
    .setDescription(
      `**Evaluation Period:** ${kpiData.cycleLabel}\n` +
        `**Elapsed Business Days (Mon–Fri):** ${kpiData.businessDays}\n` +
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

  const kpiChannelId = config.kpiChannelId;
  const kpiChannel = kpiChannelId
    ? await interaction.client.channels.fetch(kpiChannelId).catch(() => null)
    : null;

  if (kpiChannel && kpiChannel.isTextBased() && 'send' in kpiChannel) {
    await kpiChannel.send({ embeds: [embed] });
    await interaction.editReply({
      content: `✅ Monthly KPI report generated and published to <#${kpiChannelId}>.`,
    });
  } else {
    await interaction.editReply({ embeds: [embed] });
  }
}

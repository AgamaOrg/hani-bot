import { Client, Events, GatewayIntentBits, REST, Routes, MessageFlags } from 'discord.js';
import { config } from './config.js';
import {
  slashCommands,
  handleStandupCommand,
  handleButtonInteraction,
  handleSelectMenuInteraction,
  handleModalSubmit,
  handleTeamStatusCommand,
  handleHistoryCommand,
  handleKpiReportCommand,
  handleHelpCommand,
} from './commands.js';
import { setupScheduler } from './scheduler.js';

if (!config.discordToken) {
  console.error('Error: DISCORD_TOKEN is not defined in environment variables.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

async function registerSlashCommands(clientId: string) {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  try {
    console.log('Started registering application (/) commands...');
    await rest.put(Routes.applicationCommands(clientId), {
      body: slashCommands.map((cmd) => cmd.toJSON()),
    });
    console.log('Successfully registered application (/) commands.');
  } catch (error) {
    console.error('Failed to register application (/) commands:', error);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[Bot] Logged in as ${c.user.tag}`);
  await registerSlashCommands(c.user.id);
  setupScheduler(client);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'standup':
          await handleStandupCommand(interaction);
          break;
        case 'help':
          await handleHelpCommand(interaction);
          break;
        case 'teamstatus':
          await handleTeamStatusCommand(interaction);
          break;
        case 'history':
          await handleHistoryCommand(interaction);
          break;
        case 'kpireport':
          await handleKpiReportCommand(interaction);
          break;
        default:
          break;
      }
    } else if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenuInteraction(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  } catch (err) {
    console.error(`Error handling interaction ${interaction.id}:`, err);
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
    }
  }
});

client.login(config.discordToken).catch((err) => {
  console.error('[Bot] Failed to log in with DISCORD_TOKEN:', err);
});

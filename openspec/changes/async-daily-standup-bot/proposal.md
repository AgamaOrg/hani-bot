## Why

The team is fully async and requires a lightweight mechanism to surface daily progress and blockers without synchronous meetings. While Jira manages task tracking, this bot handles daily standup collection, team feedback threads, active roster status visibility, automated nudges/summaries, and monthly KPI update frequency calculation.

## What Changes

- Build a Node.js / TypeScript Discord bot using `discord.js`, `better-sqlite3`, and `node-cron`.
- Add a `.gitignore` file to prevent committing `node_modules/`, `dist/`, `.env`, and SQLite database files (`standup_bot.db*`).
- **Slash Commands**:
  - `/standup`: Displays a private interactive Task List Card with separate action buttons: `[➕ Add Task]`, `[🚧 Add Blocker]`, `[✏️ Edit Entry]`, and `[🚀 Submit Standup]`. Tasks and blockers use single-line text entries with Category dropdown selection (`today`/`tomorrow` for tasks; `project`/`outside` for blockers). `[➕ Add Task]` includes an integrated Proof of Output URL field for Today's tasks. `[✏️ Edit Entry]` allows selecting and modifying draft entries in place before submission. Enforces a strict once-per-day submission limit per user per date. Posts a color-coded embed to `UPDATE_CHANNEL_ID`, creates an attached feedback thread, records in SQLite, and confirms ephemerally.
  - `/help`: Displays bot usage instructions for adding single-line task entries, adding blockers, proof of output links on Today's tasks, entry editing, and blocker categorization.
  - `/teamstatus`: Posts public channel status showing who checked in (✅/⚠️ with blocker preview) and @-mentions missing server members (excluding bots).
  - `/history [member] [days]`: Ephemeral lookup of past standup entries up to 60 days.
  - `/kpireport [month] [year]`: Provides a month dropdown picker (`Jan`–`Dec`) displaying 15th-to-14th cutoff date windows, calculating Update Frequency metrics for all server members (including offline members) against elapsed Mon–Fri business days, and posting a detailed breakdown to `KPI_CHANNEL_ID`.
- **Automated Tasks**:
  - Daily Nudge at `REMINDER_HOUR:REMINDER_MINUTE` (default 09:00).
  - EOD Summary & @-mention ping at `EOD_HOUR:EOD_MINUTE` (default 18:00).
  - Monthly automated KPI report trigger on the 15th of each month at 09:00.
- **Database**:
  - SQLite database (`standup_bot.db`) storing standups with `(user_id, guild_id, date)` uniqueness.

## Capabilities

### New Capabilities
- `async-standup`: Core daily standup workflows, once-per-day restriction, proof of output links, bulleted project tasks, categorized blockers, help instructions, slash commands, modal forms, status reports, automated nudges, history lookup, and KPI update frequency calculations.

### Modified Capabilities

*(None)*

## Impact

- **New Application**: Node.js/TypeScript backend service.
- **Dependencies**: `discord.js`, `better-sqlite3`, `node-cron`, `dotenv`, `typescript`, `tsx`.
- **Database**: SQLite database stored locally as `standup_bot.db`.
- **Environment**: Configured via `.env` (`DISCORD_TOKEN`, `UPDATE_CHANNEL_ID`, `KPI_CHANNEL_ID`, timing & roster variables).

## Context

The Operations Department requires an asynchronous Discord bot to facilitate daily developer standups and compute monthly Update Frequency scores for developer KPI evaluations. The bot will run on Node.js/TypeScript using `discord.js` v14, `better-sqlite3`, `node-cron`, and `dotenv`.

## Goals / Non-Goals

**Goals:**
- Provide `/standup` command with an interactive Task List Card featuring separate `[➕ Add Task]`, `[🚧 Add Blocker]`, `[✏️ Edit Entry]`, and `[🚀 Submit Standup]` buttons.
- Allow users to add individual single-line task entries (with Proof URL for Today's tasks) and single-line blocker entries via dedicated buttons, selecting category via dropdown selection, and editing draft entries before submission.
- Enforce strict once-per-day submission limits per user per date.
- Provide a `/help` slash command displaying clear bot instructions, task entry steps, proof link requirements, blocker categorization, and entry editing rules.
- Post color-coded embeds (orange for blockers, green for clean updates) in `UPDATE_CHANNEL_ID` with Proof of Output link and attached feedback threads (`{Name} — {Date}`).
- Save standup records in SQLite (`standup_bot.db`).
- Surface team status via `/teamstatus` and automated EOD summary at `EOD_HOUR:EOD_MINUTE` with missing member @-mentions.
- Send daily group nudge at `REMINDER_HOUR:REMINDER_MINUTE`.
- Support private standup history lookup via `/history [member] [days]`.
- Compute monthly Update Frequency KPI ratings (20-point policy rubric) via `/kpireport` and monthly automated job sent to `KPI_CHANNEL_ID`.

**Non-Goals:**
- Jira ticket sync or task checklist management.
- Requiring separate title headers and description fields per task.
- Allowing multiple daily updates or overwriting past updates once submitted on the same day.

## Decisions

### 1. Technology Stack & Rules
- **Framework**: Node.js + TypeScript (`discord.js` v14) using `Events.ClientReady` (`clientReady`) to avoid v15 deprecation warnings, with `Guilds`, `GuildMessages`, and `GuildMembers` intents to fetch all server members (including offline members).
- **Interactive Task & Blocker Entry Flow**: `/standup` renders a private Task List Embed displaying draft entries formatted as simple bullet points (`- {Task}`).
  - Clicking `[➕ Add Task]` opens a modal (Category: "today" or "tomorrow", single-line Task Detail, and optional Proof URL).
  - Clicking `[🚧 Add Blocker]` opens a modal (Blocker Category: "project" or "outside", single-line Blocker Detail).
  - Clicking `[✏️ Edit Entry]` displays a select menu of added draft entries, opening a pre-filled edit modal to modify the entry in place.
- **Modal Input Constraints**: Ensure all `TextInputBuilder` labels are strictly <= 45 characters (Discord API constraint).
- **Interaction Handling**: Invoke `interaction.deferReply({ flags: MessageFlags.Ephemeral })` on command and submit actions to prevent 3-second timeouts.
- **Once-Per-Day Enforcement**: Before displaying the task list card or processing submission, query SQLite for existing records for `(user_id, guild_id, date)`. If an entry exists for today, reject execution with an ephemeral error ("You have already submitted your standup for today! Submissions are limited to once per day.").
- **Database**: `better-sqlite3` for synchronous, low-overhead database operations with WAL mode enabled.
- **Scheduling**: `node-cron` for managing daily nudges, EOD summaries, and monthly KPI triggers.

### 2. Database Schema (`standups`)
```sql
CREATE TABLE IF NOT EXISTS standups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  date TEXT NOT NULL,                  -- YYYY-MM-DD (ISO date)
  today TEXT NOT NULL,                 -- Bulleted tasks done today (JSON array or formatted text)
  tomorrow TEXT NOT NULL,              -- Bulleted tasks planned for tomorrow (JSON array or formatted text)
  proof_of_output TEXT NOT NULL,       -- Link or proof of output (PR, commit, docs, Figma)
  project_blockers TEXT,               -- Blockers within the project
  outside_blockers TEXT,               -- Blockers outside the project
  message_id TEXT,
  thread_id TEXT,
  created_at TEXT NOT NULL,           -- UTC ISO timestamp
  UNIQUE(user_id, guild_id, date)
);
```

### 3. Guild Team Roster
- Primary: Fetch all non-bot guild members from Discord (`guild.members.fetch()` filtering out `user.bot === true`).
- Fallback: Use SQLite historical submitter IDs if member fetching is restricted or in offline test environments.

### 4. Business Day Calculation & KPI Breakdown
- Slash Command Dropdown Choices: `.addChoices()` for `jan` through `dec` mapping to human-readable month labels (`Jan (15 Dec - 14 Jan)`, `Feb (15 Jan - 14 Feb)`, etc.).
- Cutoff Period: 15th of previous month to 14th of target month.
- Cron Trigger: `0 9 15 * *` (15th of every month at 09:00).
- Roster & Scoring: Uses `fetchGuildRoster` to retrieve all non-bot guild members (online and offline). Evaluates Mon–Fri business days in the 15th-to-14th window. Members with 0 updates during the period are evaluated at 0% (4 pts - Unsatisfactory).
- Rating mapping:
  - 100% = 20 pts (Excellent)
  - 80–99% = 16 pts (Good)
  - 60–79% = 12 pts (Satisfactory)
  - 40–59% = 8 pts (Needs Improvement)
  - <40% = 4 pts (Unsatisfactory)
- Breakdown Output: Embed detailing summary metrics (Total evaluated members, Average score, Tier breakdown counts) alongside itemized member scores and ratings.

### 5. Help Command (`/help`)
- Responds ephemerally detailing bot overview, command instructions (`/standup`, `/teamstatus`, `/history`, `/kpireport`), rules requiring bulleted project tasks formatted with assigned task headers and detailed descriptions (e.g. `- **[Task Header]**: [Description]`), Proof of Output URL requirements, and explanation of Project vs Outside Project blockers.

### 6. Repository Hygiene & Ignore Rules
- Maintain `.gitignore` to exclude `node_modules/`, `dist/`, `.env`, `*.log`, and SQLite files (`standup_bot.db*`).

## Risks / Trade-offs

- **Discord 2000-char Limit** → Mitigation: Truncate multi-day history strings in `/history` cleanly.
- **New Hire Cold Start** → Mitigation: Document that new hires appear on the roster upon submitting their first `/standup`.

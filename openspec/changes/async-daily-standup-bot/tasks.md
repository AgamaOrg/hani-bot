## 1. Project Initialization & Environment Setup

- [x] 1.1 Initialize Node.js TypeScript project, `package.json`, `tsconfig.json`, and dependencies (`discord.js`, `better-sqlite3`, `node-cron`, `dotenv`, `tsx`).
- [x] 1.2 Build environment configuration parser (`config.ts`) supporting `DISCORD_TOKEN`, `UPDATE_CHANNEL_ID`, `KPI_CHANNEL_ID`, `REMINDER_HOUR`, `REMINDER_MINUTE`, `EOD_HOUR`, `EOD_MINUTE`, and `ROSTER_WINDOW_DAYS`.
- [x] 1.3 Add `.gitignore` file ignoring `node_modules`, `dist`, `.env`, `*.log`, and `standup_bot.db*`.

## 2. Database & Data Models

- [x] 2.1 Setup SQLite database instance (`standup_bot.db`) with `better-sqlite3` and create `standups` schema with `proof_of_output`, `project_blockers`, `outside_blockers`, and `UNIQUE(user_id, guild_id, date)`.
- [x] 2.2 Implement database helper module (`db.ts`) with functions: `saveStandup`, `hasSubmittedToday`, `getTodayStandups`, `getActiveRoster`, `getUserHistory`, and `getMonthlySubmissions`.

## 3. Discord Slash Commands & Modal Interactions

- [x] 3.1 Implement `/standup` command trigger with once-per-day check, rendering interactive private Task List Card with action buttons (`[➕ Add Task]`, `[🚧 Add Blocker]`, `[✏️ Edit Entry]`, `[🚀 Submit Standup]`).
- [x] 3.2 Implement Button Component, Select Menu, and Modal handlers for adding single-line task entries (Today with Proof URL / Tomorrow), adding single-line blockers (Project / Outside Project), editing existing draft entries in place (`[✏️ Edit Entry]`), saving to DB, and posting color-coded embeds.
- [x] 3.3 Implement `/teamstatus` command: output posted today members (✅ or ⚠️ with blocker preview) and @-mention missing non-bot server members.
- [x] 3.4 Implement `/history [member] [days]` command: fetch user history (up to 60 days) and respond ephemerally with formatted text.
- [x] 3.5 Implement `/kpireport [month] [year]` command: register month dropdown choices (`jan`–`dec` with date window labels), compute Mon-Fri business days for 15th-to-14th cutoff period across all server members, and post detailed breakdown to `KPI_CHANNEL_ID`.
- [x] 3.6 Implement `/help` command: output interactive bot usage guide for single-line task entries (`[➕ Add Task]` with proof on Today tasks), `[🚧 Add Blocker]`, `[✏️ Edit Entry]`, and Project vs Outside Project blocker explanations.

## 4. Scheduler & Automated Cron Tasks

- [x] 4.1 Implement daily nudge task using `node-cron` scheduled at `REMINDER_HOUR:REMINDER_MINUTE` to post reminder in `UPDATE_CHANNEL_ID`.
- [x] 4.2 Implement EOD summary task scheduled at `EOD_HOUR:EOD_MINUTE` to post team status breakdown and @-mention missing non-bot server members.
- [x] 4.3 Implement monthly automated KPI report task triggering on the 15th of each month at 09:00 to publish completed 15th-to-14th cycle stats to `KPI_CHANNEL_ID`.

## 5. Bot Entry Point & Command Deployment

- [x] 5.1 Implement bot client entry point (`index.ts`), event handlers (`interactionCreate`, `clientReady`), and command deployment logic (`REST` slash command registration).
- [x] 5.2 Test end-to-end bot execution, database operations, slash commands, and scheduling.

## ADDED Requirements

### Requirement: Add Button Daily Standup Task List Submission
The bot SHALL provide a `/standup` slash command that opens an ephemeral interactive Task List Card featuring separate `[➕ Add Task]` and `[🚧 Add Blocker]` buttons allowing users to add single-line task entries (with integrated Proof of Output link for Today's tasks) and single-line blocker entries separately using category selection, an `[✏️ Edit Entry]` button to edit any draft entry in place, and a `[🚀 Submit Standup]` button to finalize submission.

#### Scenario: Submitting a valid standup
- **WHEN** a user finishes adding or editing tasks and blockers and clicks `[🚀 Submit Standup]`
- **THEN** the bot saves the entry into SQLite keyed by `(user_id, guild_id, date)`, posts a color-coded embed to `UPDATE_CHANNEL_ID` (orange if any blockers present, green if clean) containing the bulleted task entries (formatted as single line bullets `- {Task}` with proof links), Proof of Output summary, and separated Project/Outside Project blockers, attaches a feedback thread named `{display name} — {date}`, and confirms ephemerally to the submitter.

#### Scenario: Re-submitting standup on the same day
- **WHEN** a user attempts to run `/standup` a second time on the same date
- **THEN** the bot rejects the operation with an ephemeral notice informing the user that standup updates are limited to once per day.

### Requirement: User Instructions and Help Command
The bot SHALL provide a `/help` slash command that displays instructions on how to use the bot and requirements for standup submissions in an ephemeral message.

#### Scenario: Viewing usage instructions
- **WHEN** a user executes `/help`
- **THEN** the bot returns an ephemeral embed detailing all available commands (`/standup`, `/teamstatus`, `/history`, `/kpireport`), instructions on using `[➕ Add Task]` and `[🚧 Add Blocker]` buttons for single-line entries, Proof of Output links on Today's tasks, editing draft entries with `[✏️ Edit Entry]`, and guidelines for Project vs Outside Project blockers.

### Requirement: Team Status Summary
The bot SHALL provide a `/teamstatus` slash command that displays a public summary in the current channel listing members who have posted today (with ✅ or ⚠️ + blocker preview) and @-mentioning missing server members (excluding bots).

#### Scenario: Checking team status
- **WHEN** any user executes `/teamstatus`
- **THEN** the bot queries all non-bot members in the Discord server, identifies who has and hasn't submitted today, and posts a visible status breakdown with missing member mentions.

### Requirement: Member Standup History Lookup
The bot SHALL provide a `/history [member] [days]` slash command that displays past standups up to 60 days in an ephemeral message.

#### Scenario: Querying history for self or teammate
- **WHEN** a user executes `/history` (with optional member and days parameters)
- **THEN** the bot returns an ephemeral response showing Yesterday, Today, Proof of Output, and Blockers entries newest first, truncating cleanly if exceeding Discord's 2000-character limit.

### Requirement: Automated Nudges and EOD Summaries
The bot SHALL run scheduled jobs for daily group nudges at `REMINDER_HOUR:REMINDER_MINUTE` and end-of-day missing member summaries at `EOD_HOUR:EOD_MINUTE`.

#### Scenario: Daily reminder trigger
- **WHEN** the host clock reaches `REMINDER_HOUR:REMINDER_MINUTE`
- **THEN** the bot posts a group reminder message in `UPDATE_CHANNEL_ID` without individual user pings.

#### Scenario: EOD summary trigger
- **WHEN** the host clock reaches `EOD_HOUR:EOD_MINUTE`
- **THEN** the bot posts the `/teamstatus` breakdown in `UPDATE_CHANNEL_ID` and @-mentions all active roster members who haven't submitted today.

### Requirement: KPI Update Frequency Calculation
The bot SHALL provide a `/kpireport [month] [year]` slash command featuring predefined month choices (`Jan` through `Dec` with cutoff date labels) and an automated monthly job (on the 15th of each month at 09:00) to compute Update Frequency metrics for ALL non-bot members in the Discord server (including offline members) over the period starting from the 15th of the previous month to the 14th of the target month, mapping scores to the 5-tier policy rubric (20/16/12/8/4 points) and posting a detailed breakdown to `KPI_CHANNEL_ID`.

#### Scenario: Generating monthly KPI report
- **WHEN** `/kpireport` is run or the monthly timer triggers on the 15th of the month
- **THEN** the bot calculates each member's submitted business days divided by total elapsed business days (Mon–Fri) within the 15th-to-14th cutoff window across all server members (online + offline), maps scores to the policy's 5-tier rating (20/16/12/8/4 points), and posts the detailed breakdown embed to `KPI_CHANNEL_ID`.

### Requirement: Repository Security and Artifact Exclusion
The repository SHALL contain a `.gitignore` file ignoring sensitive configuration (`.env`), dependencies (`node_modules/`), build outputs (`dist/`), log files (`*.log`), and local database files (`*.db*`).

#### Scenario: Preventing sensitive file commits
- **WHEN** git checks working tree status
- **THEN** untracked `.env`, `node_modules/`, `dist/`, `*.log`, and `*.db*` files are ignored by repository controls.


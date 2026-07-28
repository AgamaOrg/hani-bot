import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { loadConfig } from './config.js';
import {
  db,
  upsertStandup,
  hasSubmittedToday,
  getTodayStandups,
  getActiveRoster,
  getUserHistory,
  getRangeSubmissions,
  getTodayISOString,
  getCutoffISOString,
} from './db.js';
import {
  parseMonthInput,
  getCutoffPeriodBusinessDays,
  evaluateKpiScore,
  generateMonthlyKpiReport,
} from './kpi.js';

console.log('=== RUNNING BOT END-TO-END TESTS ===');

// 1. Test Config Parser
console.log('[Test 1] Testing Config Parser...');
const testConfig = loadConfig();
assert.ok(testConfig.reminderHour !== undefined, 'reminderHour should be defined');
assert.ok(testConfig.rosterWindowDays === 14, 'rosterWindowDays should default to 14');
console.log('✓ Config parser test passed.');

// 2. Test DB Operations
console.log('[Test 2] Testing DB Operations...');
const guildId = 'test_guild_123';
const userId1 = 'user_111';
const userId2 = 'user_222';
const dateToday = getTodayISOString();

// Clear test data
db.prepare(`DELETE FROM standups WHERE guild_id = ?`).run(guildId);

// Test Upsert Standup
const record1 = upsertStandup({
  user_id: userId1,
  guild_id: guildId,
  date: dateToday,
  today: '- Finished feature A',
  tomorrow: '- Working on feature B',
  proof_of_output: 'https://github.com/org/repo/pull/1',
  project_blockers: null,
  outside_blockers: null,
  blockers: null,
  feedback: null,
});

assert.strictEqual(record1.user_id, userId1);
assert.strictEqual(record1.date, dateToday);
assert.strictEqual(record1.today, '- Finished feature A');
assert.strictEqual(record1.tomorrow, '- Working on feature B');
assert.strictEqual(record1.proof_of_output, 'https://github.com/org/repo/pull/1');

// Test hasSubmittedToday
assert.strictEqual(hasSubmittedToday(userId1, guildId, dateToday), true);
assert.strictEqual(hasSubmittedToday('user_999', guildId, dateToday), false);

// Check today's standups
const todayList = getTodayStandups(guildId, dateToday);
assert.strictEqual(todayList.length, 1);
assert.strictEqual(todayList[0].user_id, userId1);

// Add second user standup
upsertStandup({
  user_id: userId2,
  guild_id: guildId,
  date: dateToday,
  today: '- Documentation',
  tomorrow: '- Bug fixes',
  proof_of_output: 'https://github.com/org/repo/pull/2',
  project_blockers: null,
  outside_blockers: null,
  blockers: null,
  feedback: null,
});

const todayList2 = getTodayStandups(guildId, dateToday);
assert.strictEqual(todayList2.length, 2);

// Test Active Roster
const roster = getActiveRoster(guildId, 14);
assert.ok(roster.includes(userId1));
assert.ok(roster.includes(userId2));

// Test User History
const historyUser1 = getUserHistory(guildId, userId1, 14);
assert.strictEqual(historyUser1.length, 1);
assert.strictEqual(historyUser1[0].today, '- Finished feature A');
assert.strictEqual(historyUser1[0].tomorrow, '- Working on feature B');

// Test Range Submissions for 15th-to-14th cycle
const pastDateStr = '2026-02-01';
upsertStandup({
  user_id: userId1,
  guild_id: guildId,
  date: pastDateStr,
  today: '- Past task',
  tomorrow: '- Past task 2',
  proof_of_output: 'https://github.com/org/repo/commit/123456',
  project_blockers: null,
  outside_blockers: null,
  blockers: null,
  feedback: null,
});

const febRangeSubmissions = getRangeSubmissions(guildId, '2026-01-15', '2026-02-14');
assert.strictEqual(febRangeSubmissions.length, 1);
assert.strictEqual(febRangeSubmissions[0].user_id, userId1);
assert.strictEqual(febRangeSubmissions[0].submitted_days, 1);

console.log('✓ DB operations test passed.');

// 3. Test KPI Logic
console.log('[Test 3] Testing KPI Calculation & Cutoff Logic...');

// Test Month Parser
assert.strictEqual(parseMonthInput('feb').monthNumber, 2);
assert.strictEqual(parseMonthInput('February').monthNumber, 2);
assert.strictEqual(parseMonthInput(2).shortName, 'Feb');

// Test 15th-to-14th Cutoff Business Days
const febCutoff = getCutoffPeriodBusinessDays(2026, 2); // 15 Jan 2026 to 14 Feb 2026 -> 22 business days
assert.strictEqual(febCutoff.startStr, '2026-01-15');
assert.strictEqual(febCutoff.endStr, '2026-02-14');
assert.strictEqual(febCutoff.totalBusinessDays, 22);

// Test Rating mapping
assert.deepStrictEqual(evaluateKpiScore(22, 22), { score: 20, rating: 'Excellent', percentage: 100 });
assert.deepStrictEqual(evaluateKpiScore(18, 22), { score: 16, rating: 'Good', percentage: 82 });
assert.deepStrictEqual(evaluateKpiScore(14, 22), { score: 12, rating: 'Satisfactory', percentage: 64 });
assert.deepStrictEqual(evaluateKpiScore(10, 22), { score: 8, rating: 'Needs Improvement', percentage: 45 });
assert.deepStrictEqual(evaluateKpiScore(5, 22), { score: 4, rating: 'Unsatisfactory', percentage: 23 });

const febReport = generateMonthlyKpiReport(guildId, 2026, 'feb', 14);
assert.strictEqual(febReport.businessDays, 22);
assert.strictEqual(febReport.shortName, 'Feb');
assert.ok(febReport.results.some((r) => r.userId === userId1));

console.log('✓ KPI calculation test passed.');

// 4. Test Interactive Standup Draft & Components
console.log('[Test 4] Testing Standup Draft, Task/Blocker Buttons & Integrated Proof...');
const { getOrCreateDraft, clearDraft, buildDraftEmbedAndComponents } = await import('./commands.js');

const draftUser = 'user_draft_1';
const testDraft = getOrCreateDraft(draftUser, guildId);
assert.strictEqual(testDraft.todayTasks.length, 0);
assert.strictEqual(testDraft.blockers.length, 0);

// Add Today task with proof
testDraft.todayTasks.push({
  category: 'today',
  text: 'Setup Database and created SQLite schema',
  proofUrl: 'https://github.com/org/repo/pull/10',
});

// Add Blocker
testDraft.blockers.push({
  category: 'project',
  text: 'CI Build Delay: Runner offline',
});

const payload = buildDraftEmbedAndComponents(testDraft, 'Draft User');
assert.strictEqual(payload.embeds.length, 1);
assert.strictEqual(payload.components.length, 2); // Row 1 (Actions), Row 2 (Reset)

// Check row 1 buttons
const row1Buttons = payload.components[0].components;
assert.strictEqual(row1Buttons.length, 4);
assert.strictEqual(row1Buttons[0].data.custom_id, 'btn_add_task');
assert.strictEqual(row1Buttons[1].data.custom_id, 'btn_add_blocker');
assert.strictEqual(row1Buttons[2].data.custom_id, 'btn_edit_entry');
assert.strictEqual(row1Buttons[2].data.disabled, false);
assert.strictEqual(row1Buttons[3].data.custom_id, 'btn_submit_standup');

// Edit entry simulation
testDraft.todayTasks[0].text = 'Setup Database (Updated single line)';
const updatedPayload = buildDraftEmbedAndComponents(testDraft, 'Draft User');
const updatedTodayField = updatedPayload.embeds[0].data.fields?.find(f => f.name.startsWith("Today's Tasks"));
assert.ok(updatedTodayField?.value.includes('Setup Database (Updated single line)'));

clearDraft(draftUser, guildId);
console.log('✓ Draft & interactive buttons test passed.');

// Cleanup test records
db.prepare(`DELETE FROM standups WHERE guild_id = ?`).run(guildId);

console.log('=== ALL TESTS PASSED SUCCESSFULLY! ===');

import { getRangeSubmissions, getActiveRoster } from './db.js';

export interface UserKpiResult {
  userId: string;
  submittedDays: number;
  businessDays: number;
  percentage: number;
  score: number;
  rating: string;
}

export interface MonthlyKpiReportData {
  year: number;
  monthNumber: number;
  monthName: string;
  shortName: string;
  cycleLabel: string;
  startDateStr: string;
  endDateStr: string;
  businessDays: number;
  totalMembers: number;
  averageScore: number;
  averagePercentage: number;
  summaryTiers: {
    excellent: number;
    good: number;
    satisfactory: number;
    needsImprovement: number;
    unsatisfactory: number;
  };
  results: UserKpiResult[];
}

export function parseMonthInput(input?: string | number | null): {
  monthNumber: number;
  monthName: string;
  shortName: string;
} {
  const months = [
    { number: 1, short: 'Jan', full: 'January' },
    { number: 2, short: 'Feb', full: 'February' },
    { number: 3, short: 'Mar', full: 'March' },
    { number: 4, short: 'Apr', full: 'April' },
    { number: 5, short: 'May', full: 'May' },
    { number: 6, short: 'Jun', full: 'June' },
    { number: 7, short: 'Jul', full: 'July' },
    { number: 8, short: 'Aug', full: 'August' },
    { number: 9, short: 'Sep', full: 'September' },
    { number: 10, short: 'Oct', full: 'October' },
    { number: 11, short: 'Nov', full: 'November' },
    { number: 12, short: 'Dec', full: 'December' },
  ];

  const now = new Date();
  let num: number;

  if (typeof input === 'number') {
    num = input;
  } else if (typeof input === 'string') {
    const clean = input.trim().toLowerCase();
    const parsed = parseInt(clean, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 12) {
      num = parsed;
    } else {
      const found = months.find(
        (m) => m.short.toLowerCase() === clean || m.full.toLowerCase() === clean
      );
      num = found ? found.number : now.getMonth() + 1;
    }
  } else {
    num = now.getMonth() + 1;
  }

  if (num < 1 || num > 12) num = now.getMonth() + 1;
  const target = months[num - 1];
  return { monthNumber: target.number, monthName: target.full, shortName: target.short };
}

export function getCutoffPeriodBusinessDays(
  targetYear: number,
  targetMonth: number
): {
  startStr: string;
  endStr: string;
  startMonthShort: string;
  endMonthShort: string;
  cycleLabel: string;
  totalBusinessDays: number;
} {
  const startMonthNum = targetMonth === 1 ? 12 : targetMonth - 1;
  const startYearNum = targetMonth === 1 ? targetYear - 1 : targetYear;

  const startMonthInfo = parseMonthInput(startMonthNum);
  const targetMonthInfo = parseMonthInput(targetMonth);

  const startStr = `${startYearNum}-${String(startMonthNum).padStart(2, '0')}-15`;
  const endStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-14`;

  const startDate = new Date(startYearNum, startMonthNum - 1, 15);
  const endDate = new Date(targetYear, targetMonth - 1, 14);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const cycleLabel = `${startMonthInfo.shortName} 15, ${startYearNum} – ${targetMonthInfo.shortName} 14, ${targetYear}`;

  if (today < startDate) {
    return {
      startStr,
      endStr,
      startMonthShort: startMonthInfo.shortName,
      endMonthShort: targetMonthInfo.shortName,
      cycleLabel,
      totalBusinessDays: 0,
    };
  }

  const lastDayToCount = today < endDate ? today : endDate;

  let totalBusinessDays = 0;
  const curr = new Date(startDate);
  while (curr <= lastDayToCount) {
    const dayOfWeek = curr.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      totalBusinessDays++;
    }
    curr.setDate(curr.getDate() + 1);
  }

  return {
    startStr,
    endStr,
    startMonthShort: startMonthInfo.shortName,
    endMonthShort: targetMonthInfo.shortName,
    cycleLabel,
    totalBusinessDays,
  };
}

export function evaluateKpiScore(
  submittedDays: number,
  totalBusinessDays: number
): { score: number; rating: string; percentage: number } {
  if (totalBusinessDays <= 0) {
    return { score: 20, rating: 'Excellent', percentage: 100 };
  }

  const percentage = Math.min(100, Math.round((submittedDays / totalBusinessDays) * 100));

  let score = 4;
  let rating = 'Unsatisfactory';

  if (percentage >= 100) {
    score = 20;
    rating = 'Excellent';
  } else if (percentage >= 80) {
    score = 16;
    rating = 'Good';
  } else if (percentage >= 60) {
    score = 12;
    rating = 'Satisfactory';
  } else if (percentage >= 40) {
    score = 8;
    rating = 'Needs Improvement';
  } else {
    score = 4;
    rating = 'Unsatisfactory';
  }

  return { score, rating, percentage };
}

export async function generateMonthlyKpiReport(
  guildId: string,
  year: number,
  monthInput?: string | number | null,
  rosterWindowDays: number = 14,
  serverRosterIds?: string[]
): Promise<MonthlyKpiReportData> {
  const monthInfo = parseMonthInput(monthInput);
  const cutoffInfo = getCutoffPeriodBusinessDays(year, monthInfo.monthNumber);

  const rangeSubmissions = await getRangeSubmissions(guildId, cutoffInfo.startStr, cutoffInfo.endStr);
  const submissionMap = new Map<string, number>();
  for (const item of rangeSubmissions) {
    submissionMap.set(item.user_id, item.submitted_days);
  }

  const defaultRoster =
    serverRosterIds && serverRosterIds.length > 0
      ? serverRosterIds
      : await getActiveRoster(guildId, rosterWindowDays);

  const allUserIds = new Set<string>([...defaultRoster, ...submissionMap.keys()]);

  const results: UserKpiResult[] = [];
  const summaryTiers = {
    excellent: 0,
    good: 0,
    satisfactory: 0,
    needsImprovement: 0,
    unsatisfactory: 0,
  };

  let totalScoreSum = 0;
  let totalPercentageSum = 0;

  for (const userId of allUserIds) {
    const submittedDays = submissionMap.get(userId) || 0;
    const { score, rating, percentage } = evaluateKpiScore(
      submittedDays,
      cutoffInfo.totalBusinessDays
    );

    results.push({
      userId,
      submittedDays,
      businessDays: cutoffInfo.totalBusinessDays,
      percentage,
      score,
      rating,
    });

    totalScoreSum += score;
    totalPercentageSum += percentage;

    if (score === 20) summaryTiers.excellent++;
    else if (score === 16) summaryTiers.good++;
    else if (score === 12) summaryTiers.satisfactory++;
    else if (score === 8) summaryTiers.needsImprovement++;
    else summaryTiers.unsatisfactory++;
  }

  results.sort((a, b) => b.score - a.score || b.percentage - a.percentage);

  const totalMembers = results.length;
  const averageScore = totalMembers > 0 ? Math.round((totalScoreSum / totalMembers) * 10) / 10 : 0;
  const averagePercentage = totalMembers > 0 ? Math.round(totalPercentageSum / totalMembers) : 0;

  return {
    year,
    monthNumber: monthInfo.monthNumber,
    monthName: monthInfo.monthName,
    shortName: monthInfo.shortName,
    cycleLabel: cutoffInfo.cycleLabel,
    startDateStr: cutoffInfo.startStr,
    endDateStr: cutoffInfo.endStr,
    businessDays: cutoffInfo.totalBusinessDays,
    totalMembers,
    averageScore,
    averagePercentage,
    summaryTiers,
    results,
  };
}

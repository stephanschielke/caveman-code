/**
 * WS19: /cost slash command — session totals + today + this-week aggregates.
 *
 * Usage:
 *   /cost
 *
 * Output:
 *   Cost summary
 *
 *     Session
 *       Input:        5.4k tokens
 *       Output:       2.1k tokens
 *       Cache read:   1.0k tokens
 *       Cost:         $0.0123
 *
 *     Today (2026-04-28)
 *       Tokens in:    12.3k
 *       Tokens out:    4.5k
 *       Cost:         $0.0456
 *
 *     This week
 *       Tokens in:    45.0k
 *       Tokens out:   18.0k
 *       Cost:         $0.1234
 */

import { type DailyTotal, formatCostSummary } from "../cost-formatter.js";
import { getThisWeekTotal, getTodayTotal } from "../cost-persistence.js";

export interface CostCommandContext {
	/** Accumulated session token stats. */
	stats: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
		/** Total $ spent. 0 means unknown pricing. */
		dollars: number;
		/** Whether the session model has known pricing. */
		pricingKnown: boolean;
	};
	/** Optional override path to cost-totals.json (for testing). */
	costTotalsPath?: string;
}

export interface CostCommandResult {
	lines: string[];
	errors: number;
}

function ok(...lines: string[]): CostCommandResult {
	return { lines, errors: 0 };
}

/**
 * Run /cost — produces session totals + daily + weekly aggregates.
 */
export function runCostCommand(ctx: CostCommandContext): CostCommandResult {
	const { stats, costTotalsPath } = ctx;

	// Load daily + weekly from persistence
	const todayRaw = getTodayTotal(costTotalsPath);
	const weekRaw = getThisWeekTotal(costTotalsPath);

	const today: DailyTotal | undefined = todayRaw
		? {
				date: new Date().toISOString().slice(0, 10),
				inputTokens: todayRaw.input,
				outputTokens: todayRaw.output,
				cacheCreateTokens: todayRaw.cacheCreate,
				cacheReadTokens: todayRaw.cacheRead,
				dollars: todayRaw.dollars,
			}
		: undefined;

	const thisWeek: DailyTotal | undefined = weekRaw
		? {
				date: "this week",
				inputTokens: weekRaw.input,
				outputTokens: weekRaw.output,
				cacheCreateTokens: weekRaw.cacheCreate,
				cacheReadTokens: weekRaw.cacheRead,
				dollars: weekRaw.dollars,
			}
		: undefined;

	const text = formatCostSummary({
		session: {
			inputTokens: stats.inputTokens,
			outputTokens: stats.outputTokens,
			cacheReadTokens: stats.cacheReadTokens,
			cacheWriteTokens: stats.cacheWriteTokens,
			dollars: stats.dollars,
			pricingKnown: stats.pricingKnown,
		},
		today,
		thisWeek,
	});

	const lines = text.split("\n");
	return ok(...lines);
}

/**
 * WS19: /tokens slash command — per-source-bucket token breakdown.
 *
 * Buckets: system, repomap, chat-history, files, tool-results, cave-mode-savings
 *
 * The session's messages are bucketed heuristically because we don't have a
 * live provenance registry wired into interactive-mode yet. The buckets are:
 *
 *   system        — first user message with role instructs the model about its persona / system prompt
 *   repomap       — messages tagged as repomap injections (WS8 produces these)
 *   files         — @-file blocks embedded in user messages
 *   tool-results  — toolResult messages
 *   chat-history  — remaining user + assistant messages
 *   (no cave-mode-savings bucket shown when empty)
 *
 * Usage:
 *   /tokens
 *
 * Output: formatted token breakdown table + cache hit rate.
 */

import { formatTokenBuckets, type TokenBucket } from "../cost-formatter.js";

export interface TokensCommandContext {
	/** Accumulated session token stats. */
	stats: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
		/** Total $ spent. 0 means unknown pricing. */
		dollars: number;
	};
	/** Raw session messages for bucketing. Optional — omit to skip bucket breakdown. */
	messages?: Array<{
		role: string;
		/** Text size approximation (chars / 4 = tokens). */
		charLength?: number;
		/** Whether this was a repomap injection (WS8). */
		isRepomap?: boolean;
		/** Whether this was a system-prompt injection. */
		isSystem?: boolean;
		/** Whether this was a file attachment. */
		isFileAttachment?: boolean;
	}>;
	/** Cave mode savings (tokens saved by compression). Optional. */
	caveModeTokensSaved?: number;
}

export interface TokensCommandResult {
	lines: string[];
	errors: number;
}

function ok(...lines: string[]): TokensCommandResult {
	return { lines, errors: 0 };
}

/**
 * Run /tokens — produces a bucket breakdown + cache stats.
 */
export function runTokensCommand(ctx: TokensCommandContext): TokensCommandResult {
	const { stats } = ctx;
	const totalInput = stats.inputTokens;
	const totalOutput = stats.outputTokens;
	const totalCacheRead = stats.cacheReadTokens;
	const totalCacheWrite = stats.cacheWriteTokens;

	const totalTokens = totalInput + totalOutput + totalCacheRead + totalCacheWrite;

	if (totalTokens === 0) {
		return ok("No tokens recorded yet in this session.");
	}

	const lines: string[] = [];

	// Build buckets from messages if available
	const buckets: TokenBucket[] = buildBuckets(ctx, totalInput, totalOutput);

	lines.push(formatTokenBuckets(buckets, totalInput + totalOutput));

	// Cache stats
	lines.push("");
	const totalInputTokens = totalInput + totalCacheRead; // total that went into context
	const hitRate = totalInputTokens > 0 ? (totalCacheRead / totalInputTokens) * 100 : 0;
	lines.push(`Cache hit rate: ${hitRate.toFixed(1)}%`);
	lines.push(`  Cache reads:  ${totalCacheRead.toLocaleString()} tokens`);
	lines.push(`  Cache writes: ${totalCacheWrite.toLocaleString()} tokens`);

	// Total spend
	if (stats.dollars > 0) {
		lines.push("");
		lines.push(`Total session cost: $${stats.dollars.toFixed(4)}`);
	}

	return ok(...lines);
}

function buildBuckets(ctx: TokensCommandContext, totalInput: number, totalOutput: number): TokenBucket[] {
	// If we have detailed messages, try to bucket them
	if (ctx.messages && ctx.messages.length > 0) {
		const msgs = ctx.messages;

		let systemTokens = 0;
		let repomapTokens = 0;
		let filesTokens = 0;
		let toolResultTokens = 0;
		let chatHistoryTokens = 0;

		for (const msg of msgs) {
			// Approximate tokens from charLength (4 chars per token heuristic)
			const approxTokens = msg.charLength ? Math.ceil(msg.charLength / 4) : 0;

			if (msg.isSystem) {
				systemTokens += approxTokens;
			} else if (msg.isRepomap) {
				repomapTokens += approxTokens;
			} else if (msg.isFileAttachment) {
				filesTokens += approxTokens;
			} else if (msg.role === "toolResult") {
				toolResultTokens += approxTokens;
			} else {
				chatHistoryTokens += approxTokens;
			}
		}

		const buckets: TokenBucket[] = [
			{ name: "system", tokens: systemTokens },
			{ name: "repomap", tokens: repomapTokens },
			{ name: "chat-history", tokens: chatHistoryTokens },
			{ name: "files", tokens: filesTokens },
			{ name: "tool-results", tokens: toolResultTokens },
		];

		if (ctx.caveModeTokensSaved && ctx.caveModeTokensSaved > 0) {
			buckets.push({ name: "cave-mode-savings", tokens: ctx.caveModeTokensSaved });
		}

		return buckets;
	}

	// Fallback: just show input / output as two buckets
	return [
		{ name: "input", tokens: totalInput },
		{ name: "output", tokens: totalOutput },
	];
}

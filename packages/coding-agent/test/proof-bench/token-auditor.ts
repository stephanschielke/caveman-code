/**
 * Token auditor — external recount of every live row's input tokens via the
 * free Anthropic `count_tokens` endpoint.
 *
 * Ground truth order (highest precedence first):
 *   1. provider `response.usage` — what cave reports
 *   2. `count_tokens` recount — what we audit against here
 *
 * If |reported − recount| / reported exceeds `tolerancePct` (default 2%), the
 * row fails audit and preflight blocks publication. Out-of-tolerance rows
 * usually signal a parsing bug or a missing system-prompt segment.
 */

export const DEFAULT_TOLERANCE_PCT = 2;

export interface AuditInput {
	/** Transcript turns to recount. System message goes in `system` below, not here. */
	messages: Array<{ role: "user" | "assistant"; content: string }>;
	/** Optional system prompt (Anthropic recounts it separately). */
	system?: string;
	/** Input tokens reported by cave for this run (sum over all turns in the session). */
	cliReportedInputTokens: number;
	/** Anthropic model id — must be the one actually used at runtime. */
	model: string;
	/** Anthropic API key. */
	apiKey: string;
	/** Override tolerance (default: 2%). */
	tolerancePct?: number;
}

export interface AuditResult {
	recountInputTokens: number;
	cliReportedInputTokens: number;
	deltaPct: number;
	withinTolerance: boolean;
	tolerancePct: number;
}

/**
 * Anthropic count_tokens response shape (trimmed to what we use).
 */
interface CountTokensResponse {
	input_tokens: number;
}

async function callCountTokens(input: AuditInput): Promise<number> {
	const body: Record<string, unknown> = {
		model: input.model,
		messages: input.messages,
	};
	if (input.system) body.system = input.system;

	const resp = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": input.apiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify(body),
	});
	if (!resp.ok) {
		const text = await resp.text().catch(() => "<no body>");
		throw new Error(`count_tokens ${resp.status}: ${text.slice(0, 200)}`);
	}
	const json = (await resp.json()) as CountTokensResponse;
	if (typeof json.input_tokens !== "number") {
		throw new Error(`count_tokens missing input_tokens: ${JSON.stringify(json).slice(0, 200)}`);
	}
	return json.input_tokens;
}

export async function auditLiveRun(
	input: AuditInput,
	fetchImpl: typeof callCountTokens = callCountTokens,
): Promise<AuditResult> {
	const tolerancePct = input.tolerancePct ?? DEFAULT_TOLERANCE_PCT;
	const recount = await fetchImpl(input);
	const delta =
		input.cliReportedInputTokens === 0
			? 0
			: Math.abs(recount - input.cliReportedInputTokens) / input.cliReportedInputTokens;
	const deltaPct = delta * 100;
	return {
		recountInputTokens: recount,
		cliReportedInputTokens: input.cliReportedInputTokens,
		deltaPct,
		withinTolerance: deltaPct <= tolerancePct,
		tolerancePct,
	};
}

/**
 * Pure delta computation, exposed for unit tests and for preflight to re-check
 * audit rows read back from results.json without hitting the network.
 */
export function computeDelta(recount: number, reported: number): number {
	if (reported === 0) return 0;
	return (Math.abs(recount - reported) / reported) * 100;
}

export function isWithinTolerance(deltaPct: number, tolerancePct: number = DEFAULT_TOLERANCE_PCT): boolean {
	return deltaPct <= tolerancePct;
}

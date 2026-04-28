/**
 * WS16: Stable JSONL event stream for `cave exec --json`.
 *
 * One JSON object per line on stdout. Schema is frozen — CI tools depend on it.
 */

import { writeRawStdout } from "../../core/output-guard.js";

// ---------------------------------------------------------------------------
// Event type definitions (stable public API)
// ---------------------------------------------------------------------------

export interface SessionStartEvent {
	type: "session.start";
	session_id: string;
	cwd: string;
}

export interface MessageUserEvent {
	type: "message.user";
	content: string;
}

export interface CostInfo {
	input_tokens?: number;
	output_tokens?: number;
	total_cost_usd?: number;
}

export interface MessageAssistantEvent {
	type: "message.assistant";
	content: string;
	cost?: CostInfo;
}

export interface ToolCallEvent {
	type: "tool.call";
	name: string;
	input: unknown;
	id: string;
}

export interface ToolResultEvent {
	type: "tool.result";
	id: string;
	ok: boolean;
	output: string;
}

export interface SessionEndEvent {
	type: "session.end";
	exit: number;
	cost?: CostInfo;
}

export interface ErrorEvent {
	type: "error";
	code: string;
	message: string;
}

export type ExecEvent =
	| SessionStartEvent
	| MessageUserEvent
	| MessageAssistantEvent
	| ToolCallEvent
	| ToolResultEvent
	| SessionEndEvent
	| ErrorEvent;

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Write a single JSONL event to stdout.
 * Uses writeRawStdout so it bypasses the stdout-redirect guard used in
 * non-json print mode.
 */
export function emitEvent(event: ExecEvent): void {
	writeRawStdout(`${JSON.stringify(event)}\n`);
}

/**
 * Extract CostInfo from an AgentSessionEvent cost payload, if present.
 * Uses duck-typing so we don't import internal session types.
 */
export function extractCost(event: Record<string, unknown>): CostInfo | undefined {
	const msg = (event.message ?? event) as Record<string, unknown>;
	const usage = msg.usage as Record<string, unknown> | undefined;
	if (!usage) return undefined;
	return {
		input_tokens: typeof usage.inputTokens === "number" ? usage.inputTokens : undefined,
		output_tokens: typeof usage.outputTokens === "number" ? usage.outputTokens : undefined,
		total_cost_usd: typeof usage.cost === "number" ? usage.cost : undefined,
	};
}

/**
 * Translate an internal AgentSessionEvent (raw from session.subscribe) into
 * zero or more ExecEvents for the stable stream.
 *
 * We map only the high-signal events; noisy intermediates (message_update,
 * streaming deltas) are suppressed to keep CI logs readable.
 */
export function translateAgentEvent(raw: Record<string, unknown>): ExecEvent[] {
	const t = raw.type as string | undefined;
	if (!t) return [];

	switch (t) {
		case "agent_start":
			// suppress — session.start is emitted separately
			return [];

		case "message_end": {
			const msg = raw.message as Record<string, unknown> | undefined;
			if (!msg) return [];
			const role = msg.role as string | undefined;
			if (role === "user") {
				// Extract first text content block
				const content = extractTextContent(msg);
				if (content !== undefined) {
					return [{ type: "message.user", content }];
				}
				return [];
			}
			if (role === "assistant") {
				const content = extractTextContent(msg);
				if (content !== undefined) {
					return [
						{
							type: "message.assistant",
							content,
							cost: extractCost(raw),
						},
					];
				}
				return [];
			}
			return [];
		}

		case "tool_execution_start": {
			const id = raw.toolCallId as string | undefined;
			const name = raw.toolName as string | undefined;
			if (!id || !name) return [];
			return [{ type: "tool.call", name, input: raw.args ?? {}, id }];
		}

		case "tool_execution_end": {
			const id = raw.toolCallId as string | undefined;
			if (!id) return [];
			const isError = !!raw.isError;
			const result = raw.result;
			const output =
				typeof result === "string"
					? result
					: typeof result === "object" && result !== null && "output" in result
						? String((result as Record<string, unknown>).output)
						: JSON.stringify(result);
			return [{ type: "tool.result", id, ok: !isError, output }];
		}

		default:
			return [];
	}
}

function extractTextContent(msg: Record<string, unknown>): string | undefined {
	const content = msg.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (typeof block === "object" && block !== null && (block as Record<string, unknown>).type === "text") {
				const text = (block as Record<string, unknown>).text;
				if (typeof text === "string") parts.push(text);
			}
		}
		return parts.length > 0 ? parts.join("") : undefined;
	}
	return undefined;
}

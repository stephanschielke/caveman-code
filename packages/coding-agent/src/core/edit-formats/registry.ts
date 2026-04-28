/**
 * WS8: edit-format registry + per-model default selection.
 *
 * Defaults seeded from Aider's published ablation results
 * (https://aider.chat/docs/leaderboards). Once `proof-bench/` ships
 * cave-specific ablations the defaults below should be regenerated from
 * that data — see TODO(ws8-ablation).
 *
 * Selection rules (most specific wins):
 *   1. exact match on `model` id
 *   2. prefix match (e.g. "claude-opus" → matches "claude-opus-4-7")
 *   3. provider family fallback
 *   4. global default (`diff` — Aider's most-tested format)
 */

import { diffFencedFormat, diffFormat } from "./diff.js";
import { editorDiffFormat, editorWholeFormat } from "./editor.js";
import type { EditFormat, EditFormatName } from "./types.js";
import { udiffFormat } from "./udiff.js";
import { wholeFormat } from "./whole.js";

export const ALL_EDIT_FORMATS: Record<EditFormatName, EditFormat> = {
	whole: wholeFormat,
	diff: diffFormat,
	"diff-fenced": diffFencedFormat,
	udiff: udiffFormat,
	"editor-diff": editorDiffFormat,
	"editor-whole": editorWholeFormat,
};

export function getEditFormat(name: EditFormatName): EditFormat {
	return ALL_EDIT_FORMATS[name];
}

/**
 * Default edit format per model. Sourced from Aider's published
 * ablation numbers (Apache-2.0, https://aider.chat/docs/leaderboards).
 *
 * TODO(ws8-ablation): regenerate once `proof-bench/` includes a
 * cave-specific edit-format ablation pass.
 */
export const EDIT_FORMAT_DEFAULTS: ReadonlyArray<{ matcher: string | RegExp; format: EditFormatName }> = [
	// Anthropic Claude family — diff is reliable across the line.
	{ matcher: /^claude-opus-4/i, format: "diff" },
	{ matcher: /^claude-sonnet-4/i, format: "diff" },
	{ matcher: /^claude-haiku-4/i, format: "diff" },
	{ matcher: /^claude-3-7-sonnet/i, format: "diff" },
	{ matcher: /^claude-3-5-sonnet/i, format: "diff" },
	{ matcher: /^claude-3-5-haiku/i, format: "whole" },
	{ matcher: /^claude-3-opus/i, format: "diff" },
	// OpenAI — udiff is the leaderboard winner for GPT-4 family.
	{ matcher: /^o1$/i, format: "diff" },
	{ matcher: /^o1-/i, format: "diff" },
	{ matcher: /^o3-/i, format: "diff" },
	{ matcher: /^gpt-5/i, format: "diff" },
	{ matcher: /^gpt-4\.?5/i, format: "udiff" },
	{ matcher: /^gpt-4o/i, format: "udiff" },
	{ matcher: /^gpt-4-turbo/i, format: "udiff" },
	{ matcher: /^gpt-4/i, format: "diff" },
	{ matcher: /^gpt-3\.5/i, format: "whole" },
	// Gemini — likes single-fence wrappers.
	{ matcher: /^gemini-2/i, format: "diff-fenced" },
	{ matcher: /^gemini-1\.5/i, format: "diff-fenced" },
	// DeepSeek family — udiff per Aider's published runs.
	{ matcher: /^deepseek/i, format: "diff" },
	// Open / local — `whole` is safest for small models.
	{ matcher: /^llama/i, format: "whole" },
	{ matcher: /^mistral/i, format: "whole" },
	{ matcher: /^qwen/i, format: "diff" },
];

/** Pick the default edit format for a model id. */
export function selectEditFormatFor(modelId: string): EditFormatName {
	for (const rule of EDIT_FORMAT_DEFAULTS) {
		if (typeof rule.matcher === "string") {
			if (rule.matcher === modelId) return rule.format;
		} else if (rule.matcher.test(modelId)) {
			return rule.format;
		}
	}
	return "diff"; // Aider's most-tested default
}

/** Validate user-supplied --edit-format string. */
export function isValidEditFormat(name: string): name is EditFormatName {
	return name in ALL_EDIT_FORMATS;
}

/** Pretty-print the defaults table for `cave debug edit-formats`. */
export function formatDefaultsTable(): string {
	const lines: string[] = ["Edit format defaults (matcher → format):", ""];
	for (const rule of EDIT_FORMAT_DEFAULTS) {
		const m = typeof rule.matcher === "string" ? rule.matcher : rule.matcher.source;
		lines.push(`  ${m.padEnd(32)}  ${rule.format}`);
	}
	lines.push("");
	lines.push("Override per-call: --edit-format=<whole|diff|diff-fenced|udiff|editor-diff|editor-whole>");
	lines.push("Source: Aider published leaderboards (Apache-2.0). TODO(ws8-ablation): regen from proof-bench.");
	return lines.join("\n");
}

/**
 * WS8: `whole` edit format — model returns full file bodies.
 *
 * Wire format (each file):
 *
 *   path/to/file.ext
 *   ```ext
 *   <complete file contents>
 *   ```
 *
 * Highest reliability for small files; most token-expensive. Default for
 * weak/local models that can't follow SEARCH/REPLACE reliably.
 */

import type { EditFormat, FileEdit, ParseEditsResult } from "./types.js";

const SYSTEM_PROMPT = `You are emitting file edits in the WHOLE format.

For every file you change, output the path on its own line, then the
COMPLETE new file contents inside a fenced code block. The file path must
appear directly above the fence. Example:

src/foo.ts
\`\`\`ts
export function foo() {
  return 1;
}
\`\`\`

Rules:
- Always output the FULL file. Do not truncate or use ellipses.
- Do not include diff markers (no \`-\`/\`+\`/\`@@\`).
- Multiple files: repeat the path-then-fence pattern.`;

const FENCE_RE = /(^|\n)(?<path>[^\n]+?)\n```(?<lang>[^\n]*)\n(?<body>[\s\S]*?)\n```/g;

export function parseWhole(reply: string): ParseEditsResult {
	const edits: FileEdit[] = [];
	const warnings: string[] = [];
	const prose: string[] = [];
	let cursor = 0;

	for (const match of reply.matchAll(FENCE_RE)) {
		if (!match.groups) continue;
		const start = match.index ?? 0;
		const path = match.groups.path.trim();
		// Reject blank/markdown-heading paths
		if (!path || path.startsWith("#") || path.includes(" ")) {
			warnings.push(`whole: skipping fence with non-path label "${path}"`);
			continue;
		}
		// Capture leading prose
		if (start > cursor) prose.push(reply.slice(cursor, start));
		edits.push({ file: path, mode: "whole", content: match.groups.body });
		cursor = start + match[0].length;
	}
	if (cursor < reply.length) prose.push(reply.slice(cursor));

	return { edits, prose: prose.join("").trim(), warnings };
}

export const wholeFormat: EditFormat = {
	name: "whole",
	systemPromptFragment: SYSTEM_PROMPT,
	parse: parseWhole,
};

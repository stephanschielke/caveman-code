// WS8: edit-format parser + selection tests.

import { describe, expect, it } from "vitest";
import {
	ALL_EDIT_FORMATS,
	formatDefaultsTable,
	getEditFormat,
	isValidEditFormat,
	parseDiff,
	parseDiffFenced,
	parseUdiff,
	parseWhole,
	selectEditFormatFor,
} from "../edit-formats/index.js";

describe("selectEditFormatFor", () => {
	it("selects diff for Claude Sonnet/Opus", () => {
		expect(selectEditFormatFor("claude-sonnet-4-6")).toBe("diff");
		expect(selectEditFormatFor("claude-opus-4-7")).toBe("diff");
	});

	it("selects whole for Claude 3.5 Haiku", () => {
		expect(selectEditFormatFor("claude-3-5-haiku-20241022")).toBe("whole");
	});

	it("selects udiff for GPT-4o family", () => {
		expect(selectEditFormatFor("gpt-4o-2024-11-20")).toBe("udiff");
		expect(selectEditFormatFor("gpt-4-turbo")).toBe("udiff");
	});

	it("selects diff-fenced for Gemini", () => {
		expect(selectEditFormatFor("gemini-2.0-flash")).toBe("diff-fenced");
	});

	it("falls back to diff for unknown models", () => {
		expect(selectEditFormatFor("totally-made-up-model")).toBe("diff");
	});

	it("selects whole for small open models", () => {
		expect(selectEditFormatFor("llama-3.1-8b-instruct")).toBe("whole");
	});
});

describe("isValidEditFormat", () => {
	it("accepts all 6 formats", () => {
		expect(isValidEditFormat("whole")).toBe(true);
		expect(isValidEditFormat("diff")).toBe(true);
		expect(isValidEditFormat("diff-fenced")).toBe(true);
		expect(isValidEditFormat("udiff")).toBe(true);
		expect(isValidEditFormat("editor-diff")).toBe(true);
		expect(isValidEditFormat("editor-whole")).toBe(true);
	});

	it("rejects invalid format names", () => {
		expect(isValidEditFormat("garbage")).toBe(false);
		expect(isValidEditFormat("")).toBe(false);
	});
});

describe("getEditFormat", () => {
	it("returns the correct format object", () => {
		expect(getEditFormat("whole").name).toBe("whole");
		expect(getEditFormat("diff").name).toBe("diff");
	});

	it("includes a non-empty system prompt for every format", () => {
		for (const name of Object.keys(ALL_EDIT_FORMATS)) {
			expect(ALL_EDIT_FORMATS[name as keyof typeof ALL_EDIT_FORMATS].systemPromptFragment.length)
				.toBeGreaterThan(20);
		}
	});
});

describe("parseWhole", () => {
	it("extracts a single file edit", () => {
		const reply = "Sure, here is the file:\n\nsrc/foo.ts\n```ts\nexport const x = 1;\n```\n\nDone.";
		const result = parseWhole(reply);
		expect(result.edits.length).toBe(1);
		expect(result.edits[0].file).toBe("src/foo.ts");
		expect(result.edits[0].mode).toBe("whole");
		expect(result.edits[0].content).toContain("export const x = 1");
	});

	it("extracts multiple files", () => {
		const reply = "src/a.ts\n```ts\nexport const a = 1;\n```\n\nsrc/b.ts\n```ts\nexport const b = 2;\n```";
		const result = parseWhole(reply);
		expect(result.edits.length).toBe(2);
	});

	it("preserves prose around edits", () => {
		const reply = "Here is the change.\n\nsrc/a.ts\n```ts\nexport const a = 1;\n```\nDone.";
		const result = parseWhole(reply);
		expect(result.prose).toContain("Here is the change");
	});
});

describe("parseDiff (SEARCH/REPLACE)", () => {
	it("extracts a single SEARCH/REPLACE block", () => {
		const reply = `src/foo.ts
<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE`;
		const result = parseDiff(reply);
		expect(result.edits.length).toBe(1);
		expect(result.edits[0].file).toBe("src/foo.ts");
		expect(result.edits[0].mode).toBe("patch");
		expect(result.edits[0].before).toBe("const x = 1;");
		expect(result.edits[0].after).toBe("const x = 2;");
	});

	it("warns on malformed block (missing tail)", () => {
		const reply = `src/foo.ts
<<<<<<< SEARCH
const x = 1;
=======
const x = 2;`;
		const result = parseDiff(reply);
		expect(result.edits.length).toBe(0);
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	it("handles new-file (empty SEARCH)", () => {
		const reply = `src/new.ts
<<<<<<< SEARCH
=======
export const newThing = 1;
>>>>>>> REPLACE`;
		const result = parseDiff(reply);
		expect(result.edits.length).toBe(1);
		expect(result.edits[0].before).toBe("");
		expect(result.edits[0].after).toContain("newThing");
	});
});

describe("parseDiffFenced", () => {
	it("extracts SEARCH/REPLACE inside a fence", () => {
		const reply = "Sure thing:\n\n```\nsrc/foo.ts\n<<<<<<< SEARCH\nconst x = 1;\n=======\nconst x = 2;\n>>>>>>> REPLACE\n```\n";
		const result = parseDiffFenced(reply);
		expect(result.edits.length).toBe(1);
		expect(result.edits[0].file).toBe("src/foo.ts");
		expect(result.edits[0].after).toBe("const x = 2;");
	});
});

describe("parseUdiff", () => {
	it("extracts a hunk", () => {
		const reply = `\`\`\`diff
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
 export function foo() {
-  return 1;
+  return 2;
 }
\`\`\``;
		const result = parseUdiff(reply);
		expect(result.edits.length).toBe(1);
		expect(result.edits[0].file).toBe("src/foo.ts");
		expect(result.edits[0].udiff).toContain("@@");
		expect(result.edits[0].udiff).toContain("+  return 2;");
	});

	it("captures multiple files", () => {
		const reply = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-old
+new`;
		const result = parseUdiff(reply);
		expect(result.edits.length).toBe(2);
		expect(result.edits.map((e) => e.file).sort()).toEqual(["src/a.ts", "src/b.ts"]);
	});
});

describe("formatDefaultsTable", () => {
	it("includes 'diff' as the global fallback note", () => {
		const t = formatDefaultsTable();
		expect(t).toContain("Override per-call");
		expect(t).toContain("ws8-ablation");
	});
});

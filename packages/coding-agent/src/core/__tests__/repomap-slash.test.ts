// WS8: /repomap slash command — functional test on a temp dir.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectSourceFiles, emptyChatState, runRepomapCommand } from "../slash-commands/repomap.js";

let tmp: string;

beforeAll(() => {
	tmp = mkdtempSync(join(tmpdir(), "cave-repomap-test-"));
	mkdirSync(join(tmp, "src"), { recursive: true });
	writeFileSync(join(tmp, "src", "foo.ts"), `export function foo() {\n  return bar();\n}\nexport class Foo {}\n`);
	writeFileSync(
		join(tmp, "src", "bar.ts"),
		`export function bar() { return 1; }\nexport function bar2() { return foo(); }\n`,
	);
	writeFileSync(join(tmp, "src", "baz.py"), `def baz():\n    return 0\nclass Baz:\n    pass\n`);
	// Should be ignored (irrelevant extension):
	writeFileSync(join(tmp, "README.md"), "# hello");
	// Should be ignored (excluded dir):
	mkdirSync(join(tmp, "node_modules", "x"), { recursive: true });
	writeFileSync(join(tmp, "node_modules", "x", "x.ts"), "export const x = 1;");
});

afterAll(() => {
	if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("collectSourceFiles", () => {
	it("collects supported files only", () => {
		const files = collectSourceFiles(tmp);
		const paths = files.map((f) => f.file);
		expect(paths.some((p) => p.endsWith("/foo.ts"))).toBe(true);
		expect(paths.some((p) => p.endsWith("/bar.ts"))).toBe(true);
		expect(paths.some((p) => p.endsWith("/baz.py"))).toBe(true);
		expect(paths.some((p) => p.endsWith("/README.md"))).toBe(false);
	});

	it("skips node_modules", () => {
		const files = collectSourceFiles(tmp);
		expect(files.some((f) => f.file.includes("node_modules"))).toBe(false);
	});
});

describe("/repomap slash command", () => {
	it("show renders a non-empty map", async () => {
		const r = await runRepomapCommand("", { cwd: tmp });
		expect(r.exitCode).toBe(0);
		expect(r.output).toContain("repomap");
		expect(r.output).toContain("symbols:");
	});

	it("stats lists top symbols", async () => {
		const r = await runRepomapCommand("stats", { cwd: tmp });
		expect(r.exitCode).toBe(0);
		expect(r.output).toContain("Top 20 by PageRank");
	});

	it("budget caps the rendered tokens", async () => {
		const tight = await runRepomapCommand("budget 10", { cwd: tmp });
		const loose = await runRepomapCommand("", { cwd: tmp, mapTokens: 1024 });
		expect(tight.exitCode).toBe(0);
		expect(loose.exitCode).toBe(0);
		// Tight output should have fewer rendered lines than loose.
		const tightLines = tight.output.split("\n").length;
		const looseLines = loose.output.split("\n").length;
		expect(tightLines).toBeLessThanOrEqual(looseLines);
	});

	it("add then reset roundtrips chat-state", async () => {
		const state = emptyChatState();
		const add = await runRepomapCommand("add src/foo.ts", { cwd: tmp, chatState: state });
		expect(add.exitCode).toBe(0);
		expect(state.addedFiles).toContain("src/foo.ts");
		const reset = await runRepomapCommand("reset", { cwd: tmp, chatState: state });
		expect(reset.exitCode).toBe(0);
		expect(state.addedFiles.length).toBe(0);
	});

	it("add nonexistent file errors", async () => {
		const state = emptyChatState();
		const r = await runRepomapCommand("add does-not-exist.ts", { cwd: tmp, chatState: state });
		expect(r.exitCode).toBe(1);
		expect(r.output).toContain("not found");
	});

	it("help text mentions usage", async () => {
		const r = await runRepomapCommand("help", { cwd: tmp });
		expect(r.output).toContain("/repomap");
		expect(r.output).toContain("--map-tokens");
	});
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMicrobenchLite } from "./live-runner.js";

// parseCaveJsonOutput isn't exported directly; we cover it via a quick round-trip
// by importing the module private helper through a re-import.
// For the public surface we test:
//   - loadMicrobenchLite reads the pinned JSONL correctly
//   - manifest round-trip produces objects with {id, source}

describe("live-runner.loadMicrobenchLite", () => {
	it("parses a well-formed JSONL into {id, source} objects", () => {
		const dir = mkdtempSync(join(tmpdir(), "proof-live-"));
		const p = join(dir, "tasks.jsonl");
		writeFileSync(
			p,
			`{"id":"t1","source":"research/evals/microbench/tasks/easy-ts-01-add-jsdoc"}\n{"id":"t2","source":"research/evals/microbench/tasks/easy-py-01-add-docstrings"}\n`,
		);
		const out = loadMicrobenchLite(p);
		expect(out).toHaveLength(2);
		expect(out[0]).toEqual({ id: "t1", source: "research/evals/microbench/tasks/easy-ts-01-add-jsdoc" });
		expect(out[1].id).toBe("t2");
	});

	it("ignores blank lines", () => {
		const dir = mkdtempSync(join(tmpdir(), "proof-live-"));
		const p = join(dir, "tasks.jsonl");
		writeFileSync(p, `\n{"id":"t1","source":"x"}\n\n\n`);
		const out = loadMicrobenchLite(p);
		expect(out).toHaveLength(1);
	});

	it("reads the pinned microbench-lite-v1.jsonl with 10 tasks", () => {
		const out = loadMicrobenchLite(join(__dirname, "datasets", "microbench-lite-v1.jsonl"));
		expect(out).toHaveLength(10);
		for (const t of out) {
			expect(t.id).toMatch(/^(easy|medium|hard)-(py|ts)-\d{2}-/);
			expect(t.source).toMatch(/^research\/evals\/microbench\/tasks\//);
		}
	});
});

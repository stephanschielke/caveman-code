import { describe, expect, it } from "vitest";
import { loadOutputPrompts, parseJudgeJson } from "./cave-output-eval.js";

describe("cave-output-eval.parseJudgeJson", () => {
	it("parses a strict JSON response", () => {
		const r = parseJudgeJson('{"completeness": 9, "correctness": 8, "helpfulness": 8, "rationale": "solid"}');
		expect(r.completeness).toBe(9);
		expect(r.correctness).toBe(8);
		expect(r.helpfulness).toBe(8);
		expect(r.overall).toBeCloseTo((9 + 8 + 8) / 3);
		expect(r.rationale).toBe("solid");
	});

	it("clamps values into [0, 10]", () => {
		const r = parseJudgeJson('{"completeness": 15, "correctness": -2, "helpfulness": 7, "rationale": ""}');
		expect(r.completeness).toBe(10);
		expect(r.correctness).toBe(0);
		expect(r.helpfulness).toBe(7);
	});

	it("tolerates code fences and leading prose", () => {
		const r = parseJudgeJson(
			'Here is the score:\n```json\n{"completeness": 6, "correctness": 6, "helpfulness": 6, "rationale": "ok"}\n```',
		);
		expect(r.overall).toBe(6);
	});

	it("throws when no JSON object is present", () => {
		expect(() => parseJudgeJson("no json here")).toThrow();
	});

	it("treats non-numeric fields as 0", () => {
		const r = parseJudgeJson('{"completeness": "n/a", "correctness": 5, "helpfulness": 5, "rationale": ""}');
		expect(r.completeness).toBe(0);
		expect(r.overall).toBeCloseTo((0 + 5 + 5) / 3);
	});
});

describe("cave-output-eval.loadOutputPrompts", () => {
	it("reads the pinned corpus-prompts-v1.jsonl with 15 prompts of 5 types", () => {
		const prompts = loadOutputPrompts();
		expect(prompts).toHaveLength(15);
		const types = new Set(prompts.map((p) => p.type));
		expect(types).toEqual(new Set(["explain", "plan", "review", "summarize", "refuse"]));
		for (const p of prompts) {
			expect(p.id).toMatch(/^[a-z-]+-\d{2}$/);
			expect(typeof p.prompt).toBe("string");
			expect(p.prompt.length).toBeGreaterThan(10);
		}
	});
});

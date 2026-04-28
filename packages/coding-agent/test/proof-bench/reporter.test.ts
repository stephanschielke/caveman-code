import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReporterInput } from "./reporter.js";
import { emitResults, hashDatasets, hashManifest } from "./reporter.js";

function baseInput(): ReporterInput {
	return {
		schemaVersion: "1.0.0",
		manifestHash: "a".repeat(64),
		codeSha: "abc1234",
		datasetHash: "b".repeat(64),
		ranAt: "2026-04-20T00:00:00Z",
		costUsd: 2.4,
		costCapUsd: 5,
		platform: { os: "darwin", arch: "arm64", node: "v22.0.0", caveVersion: "0.65.2" },
		live: [
			{
				config: "A-baseline",
				taskId: "t1",
				seed: 0,
				passed: true,
				tokens: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, total: 1200 },
				turns: 3,
				cost: 0.05,
				durationMs: 5000,
				audit: { recount: 1005, deltaPct: 0.5, withinTolerance: true, tolerancePct: 2 },
			},
			{
				config: "F-cave-full",
				taskId: "t1",
				seed: 0,
				passed: true,
				tokens: { input: 600, output: 180, cacheRead: 300, cacheWrite: 100, total: 780 },
				turns: 3,
				cost: 0.03,
				durationMs: 4000,
				audit: { recount: 602, deltaPct: 0.33, withinTolerance: true, tolerancePct: 2 },
			},
		],
		replay: [
			{
				config: "replay-no-flint",
				sessionPath: "/tmp/s1.jsonl",
				tokensOriginal: 10000,
				tokensReplay: 6000,
				deltaPct: -40,
			},
			{
				config: "replay-no-stone",
				sessionPath: "/tmp/s1.jsonl",
				tokensOriginal: 10000,
				tokensReplay: 4500,
				deltaPct: -55,
			},
			{
				config: "replay-no-dedup",
				sessionPath: "/tmp/s1.jsonl",
				tokensOriginal: 10000,
				tokensReplay: 4800,
				deltaPct: -52,
			},
			{
				config: "replay-no-compaction",
				sessionPath: "/tmp/s1.jsonl",
				tokensOriginal: 10000,
				tokensReplay: 4400,
				deltaPct: -56,
			},
		],
		replayBaselines: [{ sessionPath: "/tmp/s1.jsonl", tokensOriginal: 10000, tokensAllLayersOn: 4000 }],
		layerIsolation: [
			{ fixture: "a.txt", layer: "ansi-strip", before: 1000, after: 990, savedPct: 1 },
			{ fixture: "a.txt", layer: "flint-budget", before: 1000, after: 300, savedPct: 70 },
			{ fixture: "b.txt", layer: "flint-budget", before: 2000, after: 500, savedPct: 75 },
		],
		outputEval: [
			{ promptId: "p1", intensity: "off", outputTokens: 200, qualityScore: 9, judgeRuns: 2, accepted: true },
			{ promptId: "p1", intensity: "full", outputTokens: 80, qualityScore: 8.5, judgeRuns: 2, accepted: true },
		],
		preflight: {
			passed: true,
			checks: [
				{ name: "pass@1 gap", ok: true, detail: "ok" },
				{ name: "token audit", ok: true, detail: "ok" },
			],
		},
	};
}

describe("reporter.emitResults", () => {
	it("writes results.md, results.json, waterfall.txt", () => {
		const dir = mkdtempSync(join(tmpdir(), "proof-reporter-"));
		const { md, jsonPath, waterfallPath } = emitResults(baseInput(), dir);
		expect(existsSync(join(dir, "results.md"))).toBe(true);
		expect(existsSync(jsonPath)).toBe(true);
		expect(existsSync(waterfallPath)).toBe(true);
		// md contains headline
		expect(md).toContain("CAVE Compression Proof");
		expect(md).toContain("A-baseline");
		expect(md).toContain("F-cave-full");
		expect(md).toContain("Preflight");
	});

	it("emits a parseable results.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "proof-reporter-"));
		emitResults(baseInput(), dir);
		const json = JSON.parse(readFileSync(join(dir, "results.json"), "utf-8"));
		expect(json.manifestHash).toBe("a".repeat(64));
		expect(json.live).toHaveLength(2);
	});

	it("waterfall shows the strongest layer first", () => {
		const dir = mkdtempSync(join(tmpdir(), "proof-reporter-"));
		emitResults(baseInput(), dir);
		const waterfall = readFileSync(join(dir, "waterfall.txt"), "utf-8");
		const firstLayerLine = waterfall.split("\n").find((l) => l.includes("flint-budget"));
		expect(firstLayerLine).toBeDefined();
		// flint-budget should be before ansi-strip in ordering
		expect(waterfall.indexOf("flint-budget")).toBeLessThan(waterfall.indexOf("ansi-strip"));
	});

	it("reports live cache-read column", () => {
		const dir = mkdtempSync(join(tmpdir(), "proof-reporter-"));
		const { md } = emitResults(baseInput(), dir);
		expect(md).toContain("cache-read");
	});

	it("replay attribution uses the baseline (not min(replay)) to order layers", () => {
		// Baseline = 4000 tokens, replays range 4400→6000.
		// Attribution per layer = (replay - baseline) / original = 4% to 20%.
		// Order by magnitude: flint (20%) > dedup (8%) > stone (5%) > compaction (4%).
		const dir = mkdtempSync(join(tmpdir(), "proof-reporter-"));
		const { md } = emitResults(baseInput(), dir);
		expect(md.indexOf("`flint`")).toBeLessThan(md.indexOf("`dedup`"));
		expect(md.indexOf("`dedup`")).toBeLessThan(md.indexOf("`stone`"));
	});

	it("replay attribution gracefully reports 'no data' without baselines", () => {
		const dir = mkdtempSync(join(tmpdir(), "proof-reporter-"));
		const input = baseInput();
		delete input.replayBaselines;
		const { md } = emitResults(input, dir);
		expect(md).toContain("## Layer attribution");
		// The attribution table should be absent / 'no data'
		expect(md).toMatch(/_No replay sessions available._|\| Layer \| Mean Δ%.*\n\|[-: ]+\|[-: ]+\|[-: ]+\|\n\n/);
	});
});

describe("reporter.hashDatasets and hashManifest", () => {
	it("hashes the pinned datasets directory reproducibly", () => {
		const path = join(__dirname, "datasets");
		const h1 = hashDatasets(path);
		const h2 = hashDatasets(path);
		expect(h1).toBe(h2);
		expect(h1).toMatch(/^[a-f0-9]{64}$/);
	});

	it("hashes the manifest.json file", () => {
		const path = join(__dirname, "manifest.json");
		const h = hashManifest(path);
		expect(h).toMatch(/^[a-f0-9]{64}$/);
	});
});

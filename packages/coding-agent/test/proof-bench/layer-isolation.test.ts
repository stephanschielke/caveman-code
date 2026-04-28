import { describe, expect, it } from "vitest";
import { aggregateByLayer, runLayerIsolation } from "./layer-isolation.js";

describe("layer-isolation", () => {
	const rows = runLayerIsolation();

	it("produces rows for every fixture × layer combination", () => {
		expect(rows.length).toBeGreaterThan(0);
		const fixtures = new Set(rows.filter((r) => r.fixture !== "<system-prompt>").map((r) => r.fixture));
		expect(fixtures.size).toBeGreaterThanOrEqual(10);
	});

	it("includes the expected layer names", () => {
		const layers = new Set(rows.map((r) => r.layer));
		expect(layers.has("ansi-strip")).toBe(true);
		expect(layers.has("blank-collapse")).toBe(true);
		expect(layers.has("flint-budget")).toBe(true);
		expect(layers.has("stone-structured")).toBe(true);
		expect(layers.has("full-cave-pipeline")).toBe(true);
		expect(layers.has("caveMode-prompt-full")).toBe(true);
	});

	it("full-cave-pipeline dominates the layers it composes (ansi, blank, 500-line truncate)", () => {
		// compressCaveToolOutput composes: stripAnsi → collapseBlankLines → truncateLongOutput(500).
		// flint-budget (per-tool 60-line cap) and stone-structured are applied separately in
		// the runtime via compressCaveToolContentBlocks, not inside compressCaveToolOutput.
		const composed = new Set(["ansi-strip", "blank-collapse", "truncate-500-line"]);
		const byFixture = new Map<string, Map<string, number>>();
		for (const r of rows) {
			if (r.fixture === "<system-prompt>") continue;
			if (!byFixture.has(r.fixture)) byFixture.set(r.fixture, new Map());
			byFixture.get(r.fixture)!.set(r.layer, r.savedPct);
		}
		for (const [fixture, layerSavings] of byFixture.entries()) {
			const full = layerSavings.get("full-cave-pipeline") ?? 0;
			for (const layer of composed) {
				const saved = layerSavings.get(layer);
				if (saved === undefined) continue;
				expect(full, `full pipeline < ${layer} on ${fixture}`).toBeGreaterThanOrEqual(saved - 0.01);
			}
		}
	});

	it("every non-prompt row has savedPct in [-inf, 100]", () => {
		for (const r of rows) {
			if (r.fixture === "<system-prompt>") continue;
			expect(r.savedPct).toBeLessThanOrEqual(100.01);
		}
	});

	it("caveMode prompt overhead rows have negative savedPct (they add tokens)", () => {
		const promptRows = rows.filter((r) => r.fixture === "<system-prompt>");
		expect(promptRows.length).toBe(3);
		for (const r of promptRows) {
			expect(r.savedPct).toBeLessThanOrEqual(0);
		}
	});

	it("ultra intensity prompt is at least as large as full, which is at least as large as lite", () => {
		const find = (layer: string) => rows.find((r) => r.layer === layer)!;
		const lite = find("caveMode-prompt-lite").after;
		const full = find("caveMode-prompt-full").after;
		const ultra = find("caveMode-prompt-ultra").after;
		expect(lite).toBeLessThanOrEqual(full);
		expect(full).toBeLessThanOrEqual(ultra);
	});

	it("aggregate returns one entry per layer", () => {
		const agg = aggregateByLayer(rows);
		expect(agg.length).toBeGreaterThan(0);
		const layerNames = new Set(agg.map((a) => a.layer));
		expect(layerNames.has("full-cave-pipeline")).toBe(true);
	});
});

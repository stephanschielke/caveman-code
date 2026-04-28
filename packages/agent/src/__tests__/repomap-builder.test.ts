// WS8: repomap builder + personalized PageRank tests.

import { describe, expect, it } from "vitest";
import {
	buildRepomap,
	dynamicMapTokens,
	pagerank,
	personalizationFromChat,
} from "../repomap/index.js";
import { buildSymbolGraph } from "../repomap/symbol-graph.js";
import { parseFile } from "../repomap/parser.js";

const FILES = [
	{
		file: "/repo/foo.ts",
		source: `export function foo() { return bar(); }\nexport class Foo {}\n`,
	},
	{
		file: "/repo/bar.ts",
		source: `export function bar() { return 1; }\nexport function bar2() { return foo(); }\n`,
	},
	{
		file: "/repo/baz.ts",
		source: `export function baz() { return 0; }\n`,
	},
];

describe("personalizationFromChat", () => {
	it("returns empty map for undefined input", () => {
		expect(personalizationFromChat(undefined).size).toBe(0);
	});

	it("assigns weight 10 to added files and 0.5 to mentioned", () => {
		const m = personalizationFromChat({
			addedFiles: ["/repo/foo.ts"],
			mentionedFiles: ["/repo/bar.ts"],
		});
		expect(m.get("/repo/foo.ts")).toBe(10);
		expect(m.get("/repo/bar.ts")).toBe(0.5);
	});

	it("custom weights override defaults", () => {
		const m = personalizationFromChat({
			addedFiles: ["/repo/foo.ts"],
			weights: new Map([["/repo/foo.ts", 42]]),
		});
		expect(m.get("/repo/foo.ts")).toBe(42);
	});
});

describe("buildRepomap", () => {
	it("produces a deterministic rendered map", async () => {
		const a = await buildRepomap({ files: FILES, tokenBudget: 256, workdir: "/repo" });
		const b = await buildRepomap({ files: FILES, tokenBudget: 256, workdir: "/repo" });
		expect(a.rendered).toEqual(b.rendered);
		expect(a.usedTokens).toEqual(b.usedTokens);
	});

	it("respects token budget", async () => {
		const tight = await buildRepomap({ files: FILES, tokenBudget: 5, workdir: "/repo" });
		const loose = await buildRepomap({ files: FILES, tokenBudget: 1024, workdir: "/repo" });
		expect(tight.selected.length).toBeLessThanOrEqual(loose.selected.length);
		expect(tight.usedTokens).toBeLessThanOrEqual(5 + 8); // small slack for last symbol
	});

	it("personalization promotes added files in the ranking", async () => {
		const baseline = await buildRepomap({ files: FILES, tokenBudget: 1024, workdir: "/repo" });
		const personalized = await buildRepomap({
			files: FILES,
			tokenBudget: 1024,
			workdir: "/repo",
			chatState: { addedFiles: ["/repo/baz.ts"] },
		});
		// Find the first symbol from baz.ts in each ranking.
		const findBaz = (r: typeof baseline.ranked) =>
			r.findIndex((s) => s.node.file === "/repo/baz.ts");
		const baseIdx = findBaz(baseline.ranked);
		const persIdx = findBaz(personalized.ranked);
		expect(persIdx).toBeLessThanOrEqual(baseIdx);
	});

	it("graph nodes scale with file count", async () => {
		const result = await buildRepomap({ files: FILES, tokenBudget: 1024, workdir: "/repo" });
		expect(result.graph.nodes.size).toBeGreaterThanOrEqual(4);
	});

	it("rebuild on identical input is byte-identical", async () => {
		const out1 = await buildRepomap({ files: FILES, tokenBudget: 512, workdir: "/repo" });
		const out2 = await buildRepomap({ files: FILES, tokenBudget: 512, workdir: "/repo" });
		expect(out1.rendered).toBe(out2.rendered);
		expect(out1.selected.length).toBe(out2.selected.length);
	});
});

describe("pagerank determinism + convergence", () => {
	it("runs 1000 identical calls and returns the identical first-place node", () => {
		const parsed = FILES.map((f) => parseFile(f.file, f.source));
		const sources = new Map(FILES.map((f) => [f.file, f.source] as const));
		const graph = buildSymbolGraph(parsed, sources);
		const baseline = pagerank(graph);
		const winner = baseline[0]?.node.id;
		for (let i = 0; i < 1000; i++) {
			const r = pagerank(graph);
			expect(r[0]?.node.id).toBe(winner);
			expect(r.length).toBe(baseline.length);
		}
	});

	it("converges before iteration cap (low epsilon)", () => {
		const parsed = FILES.map((f) => parseFile(f.file, f.source));
		const sources = new Map(FILES.map((f) => [f.file, f.source] as const));
		const graph = buildSymbolGraph(parsed, sources);
		// Compare result at 50 iter vs 200 iter — should be effectively equal.
		const r50 = pagerank(graph, { iterations: 50, epsilon: 1e-9 });
		const r200 = pagerank(graph, { iterations: 200, epsilon: 1e-9 });
		expect(r50.length).toBe(r200.length);
		for (let i = 0; i < Math.min(5, r50.length); i++) {
			expect(r50[i].node.id).toBe(r200[i].node.id);
		}
	});

	it("personalization vector shifts ranking towards weighted nodes", () => {
		const parsed = FILES.map((f) => parseFile(f.file, f.source));
		const sources = new Map(FILES.map((f) => [f.file, f.source] as const));
		const graph = buildSymbolGraph(parsed, sources);

		// Use a heavy weight on baz.ts. Aider says 10x added vs 1x other.
		const personalization = new Map<string, number>([["/repo/baz.ts", 100]]);
		const ranked = pagerank(graph, { personalization });
		// Top-1 should now belong to baz.ts (only file with weight)
		expect(ranked[0].node.file).toBe("/repo/baz.ts");
	});
});

describe("dynamicMapTokens", () => {
	it("returns default when files are pinned", () => {
		expect(dynamicMapTokens({ hasFilesInChat: true })).toBe(1024);
	});

	it("expands when no files are pinned", () => {
		expect(dynamicMapTokens({ hasFilesInChat: false })).toBe(2048);
	});

	it("respects custom budgets", () => {
		expect(
			dynamicMapTokens({ hasFilesInChat: false, defaultBudget: 500, expandedBudget: 5000 }),
		).toBe(5000);
	});
});

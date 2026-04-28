// WS8: small perf microbench for repomap rebuild on a synthetic repo.
//
// Not a true benchmark — vitest just records a wall-time budget so a future
// regression triggers a CI failure. The threshold is generous (~5s on a
// laptop for 100 files * 50 symbols each).

import { describe, expect, it } from "vitest";
import { buildRepomap } from "../repomap/index.js";

function syntheticFile(idx: number, symbolCount: number): { file: string; source: string } {
	const lines: string[] = [];
	for (let i = 0; i < symbolCount; i++) {
		lines.push(`export function fn_${idx}_${i}() { return ${i}; }`);
	}
	for (let i = 0; i < Math.max(1, symbolCount / 5); i++) {
		lines.push(`export class C_${idx}_${i} {}`);
	}
	return { file: `/repo/src/file_${idx}.ts`, source: lines.join("\n") };
}

describe("repomap perf microbench", () => {
	it("builds a 100-file repomap in under 5s", async () => {
		const files = Array.from({ length: 100 }, (_, i) => syntheticFile(i, 50));
		const t0 = Date.now();
		const result = await buildRepomap({ files, tokenBudget: 4096, workdir: "/repo" });
		const elapsed = Date.now() - t0;
		expect(result.graph.nodes.size).toBeGreaterThan(0);
		expect(elapsed).toBeLessThan(5000);
	});

	it("personalization run does not blow up perf", async () => {
		const files = Array.from({ length: 50 }, (_, i) => syntheticFile(i, 30));
		const addedFiles = files.slice(0, 5).map((f) => f.file);
		const t0 = Date.now();
		await buildRepomap({
			files,
			tokenBudget: 2048,
			workdir: "/repo",
			chatState: { addedFiles },
		});
		const elapsed = Date.now() - t0;
		expect(elapsed).toBeLessThan(3000);
	});
});

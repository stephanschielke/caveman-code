import { describe, expect, it } from "vitest";
import {
	checkCostCap,
	checkIsoQualityIntersection,
	checkOutputQualityGap,
	checkPassAtOneGap,
	checkSchema,
	checkSeedCount,
	checkTokenAudit,
	type LiveRow,
	type PreflightInput,
	runPreflight,
} from "./preflight.js";

const baseManifest = {
	costCapUsd: 5,
	seedsPerConfig: 2,
	tolerances: {
		passAtOneGapPp: 2,
		tokenAuditDeltaPct: 2,
		outputQualityGap: 1,
		minIsoQualityIntersection: 7,
	},
};

function liveRow(overrides: Partial<LiveRow> = {}): LiveRow {
	return {
		config: "A-baseline",
		taskId: "t1",
		seed: 0,
		passed: true,
		tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
		audit: { deltaPct: 0.5, withinTolerance: true, tolerancePct: 2 },
		...overrides,
	};
}

function inputWith(
	live: LiveRow[],
	outputEval: PreflightInput["results"]["outputEval"] = [],
	extra: Partial<PreflightInput["results"]> = {},
): PreflightInput {
	return {
		results: { live, outputEval, costUsd: 0, ...extra },
		manifest: baseManifest,
	};
}

describe("preflight.checkPassAtOneGap", () => {
	it("passes when every config matches baseline", () => {
		const live: LiveRow[] = [];
		for (const config of ["A-baseline", "F-cave-full"]) {
			for (let seed = 0; seed < 2; seed++) {
				for (let t = 0; t < 10; t++) {
					live.push(liveRow({ config, taskId: `t${t}`, seed, passed: true }));
				}
			}
		}
		const r = checkPassAtOneGap(inputWith(live));
		expect(r.ok).toBe(true);
	});

	it("fails when a caveman config passes too many fewer tasks", () => {
		const live: LiveRow[] = [];
		for (let t = 0; t < 10; t++) live.push(liveRow({ config: "A-baseline", taskId: `t${t}`, passed: true }));
		// F regresses all 10
		for (let t = 0; t < 10; t++) live.push(liveRow({ config: "F-cave-full", taskId: `t${t}`, passed: false }));
		const r = checkPassAtOneGap(inputWith(live));
		expect(r.ok).toBe(false);
		expect(r.detail).toContain("F-cave-full");
	});

	it("fails when A-baseline is missing", () => {
		const live = [liveRow({ config: "F-cave-full" })];
		expect(checkPassAtOneGap(inputWith(live)).ok).toBe(false);
	});
});

describe("preflight.checkTokenAudit", () => {
	it("passes when every row is within tolerance", () => {
		const r = checkTokenAudit(
			inputWith([
				liveRow({ audit: { deltaPct: 1.5, withinTolerance: true, tolerancePct: 2 } }),
				liveRow({ taskId: "t2", audit: { deltaPct: 0.2, withinTolerance: true, tolerancePct: 2 } }),
			]),
		);
		expect(r.ok).toBe(true);
	});

	it("fails when any row exceeds tolerance", () => {
		const r = checkTokenAudit(
			inputWith([liveRow({ audit: { deltaPct: 3, withinTolerance: false, tolerancePct: 2 } })]),
		);
		expect(r.ok).toBe(false);
	});

	it("fails when no rows carry audit info", () => {
		const r = checkTokenAudit(inputWith([liveRow({ audit: undefined })]));
		expect(r.ok).toBe(false);
		expect(r.detail).toContain("no audit entries");
	});
});

describe("preflight.checkIsoQualityIntersection", () => {
	it("passes when ≥ min tasks pass in every config", () => {
		const live: LiveRow[] = [];
		for (const config of ["A-baseline", "F-cave-full"]) {
			for (let t = 0; t < 10; t++) live.push(liveRow({ config, taskId: `t${t}`, passed: true }));
		}
		const r = checkIsoQualityIntersection(inputWith(live));
		expect(r.ok).toBe(true);
	});

	it("fails below min intersection", () => {
		const live: LiveRow[] = [];
		for (let t = 0; t < 10; t++) live.push(liveRow({ config: "A-baseline", taskId: `t${t}`, passed: true }));
		for (let t = 0; t < 10; t++) live.push(liveRow({ config: "F-cave-full", taskId: `t${t}`, passed: t < 3 }));
		const r = checkIsoQualityIntersection(inputWith(live));
		expect(r.ok).toBe(false);
	});
});

describe("preflight.checkOutputQualityGap", () => {
	it("passes when every accepted intensity is within 1pt of off", () => {
		const r = checkOutputQualityGap(
			inputWith(
				[],
				[
					{ promptId: "p1", intensity: "off", outputTokens: 200, qualityScore: 9 },
					{ promptId: "p1", intensity: "full", outputTokens: 80, qualityScore: 8.5, accepted: true },
				],
			),
		);
		expect(r.ok).toBe(true);
	});

	it("fails when an accepted intensity regresses > 1pt", () => {
		const r = checkOutputQualityGap(
			inputWith(
				[],
				[
					{ promptId: "p1", intensity: "off", outputTokens: 200, qualityScore: 9 },
					{ promptId: "p1", intensity: "full", outputTokens: 80, qualityScore: 7, accepted: true },
				],
			),
		);
		expect(r.ok).toBe(false);
		expect(r.detail).toContain("p1@full");
	});

	it("ignores rejected intensities even if they regressed", () => {
		const r = checkOutputQualityGap(
			inputWith(
				[],
				[
					{ promptId: "p1", intensity: "off", outputTokens: 200, qualityScore: 9 },
					{ promptId: "p1", intensity: "ultra", outputTokens: 30, qualityScore: 3, accepted: false },
				],
			),
		);
		expect(r.ok).toBe(true);
	});
});

describe("preflight.checkSeedCount", () => {
	it("fails when a config has fewer seeds than required", () => {
		const r = checkSeedCount(inputWith([liveRow({ config: "F-cave-full", seed: 0 })]));
		expect(r.ok).toBe(false);
		expect(r.detail).toContain("F-cave-full");
	});

	it("passes when every config has required seed count", () => {
		const live: LiveRow[] = [];
		for (const config of ["A-baseline", "F-cave-full"]) {
			for (let seed = 0; seed < 2; seed++) {
				live.push(liveRow({ config, seed }));
			}
		}
		expect(checkSeedCount(inputWith(live)).ok).toBe(true);
	});
});

describe("preflight.checkCostCap", () => {
	it("passes within cap", () => {
		const r = checkCostCap(inputWith([], [], { costUsd: 2 }));
		expect(r.ok).toBe(true);
	});

	it("fails when over cap", () => {
		const r = checkCostCap(inputWith([], [], { costUsd: 7 }));
		expect(r.ok).toBe(false);
	});
});

describe("preflight.checkSchema", () => {
	const trivialSchema = {
		type: "object",
		required: ["live"],
		properties: { live: { type: "array" } },
	};

	it("passes valid objects", () => {
		expect(checkSchema({ live: [] }, trivialSchema).ok).toBe(true);
	});

	it("fails missing required field", () => {
		expect(checkSchema({}, trivialSchema).ok).toBe(false);
	});
});

describe("preflight.runPreflight", () => {
	it("green path produces passed=true", () => {
		const live: LiveRow[] = [];
		for (const config of ["A-baseline", "F-cave-full"]) {
			for (let seed = 0; seed < 2; seed++) {
				for (let t = 0; t < 10; t++) live.push(liveRow({ config, taskId: `t${t}`, seed, passed: true }));
			}
		}
		const report = runPreflight({
			input: inputWith(live, [
				{ promptId: "p1", intensity: "off", outputTokens: 100, qualityScore: 9 },
				{ promptId: "p1", intensity: "full", outputTokens: 40, qualityScore: 8.5, accepted: true },
			]),
		});
		expect(report.passed).toBe(true);
	});

	it("any single failure flips passed=false", () => {
		const report = runPreflight({
			input: inputWith([liveRow({ audit: { deltaPct: 5, withinTolerance: false, tolerancePct: 2 } })]),
		});
		expect(report.passed).toBe(false);
		const audit = report.checks.find((c) => c.name === "token audit");
		expect(audit?.ok).toBe(false);
	});
});

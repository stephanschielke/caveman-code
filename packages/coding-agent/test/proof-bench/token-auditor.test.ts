import { describe, expect, it } from "vitest";
import { auditLiveRun, computeDelta, DEFAULT_TOLERANCE_PCT, isWithinTolerance } from "./token-auditor.js";

describe("token-auditor", () => {
	describe("computeDelta", () => {
		it("returns 0 when reported is 0", () => {
			expect(computeDelta(100, 0)).toBe(0);
		});

		it("computes percent delta symmetrically around reported", () => {
			expect(computeDelta(100, 100)).toBe(0);
			expect(computeDelta(102, 100)).toBeCloseTo(2);
			expect(computeDelta(98, 100)).toBeCloseTo(2);
			expect(computeDelta(110, 100)).toBeCloseTo(10);
		});
	});

	describe("isWithinTolerance", () => {
		it("default tolerance is 2%", () => {
			expect(DEFAULT_TOLERANCE_PCT).toBe(2);
			expect(isWithinTolerance(1.9)).toBe(true);
			expect(isWithinTolerance(2)).toBe(true);
			expect(isWithinTolerance(2.01)).toBe(false);
		});

		it("honors custom tolerance", () => {
			expect(isWithinTolerance(4.9, 5)).toBe(true);
			expect(isWithinTolerance(5.01, 5)).toBe(false);
		});
	});

	describe("auditLiveRun", () => {
		it("flags within-tolerance when recount is close to reported", async () => {
			const result = await auditLiveRun(
				{
					messages: [{ role: "user", content: "hi" }],
					cliReportedInputTokens: 100,
					model: "claude-haiku-4-5",
					apiKey: "test",
				},
				async () => 101,
			);
			expect(result.recountInputTokens).toBe(101);
			expect(result.deltaPct).toBeCloseTo(1);
			expect(result.withinTolerance).toBe(true);
			expect(result.tolerancePct).toBe(2);
		});

		it("flags out-of-tolerance when recount diverges > 2%", async () => {
			const result = await auditLiveRun(
				{
					messages: [{ role: "user", content: "hi" }],
					cliReportedInputTokens: 100,
					model: "claude-haiku-4-5",
					apiKey: "test",
				},
				async () => 110,
			);
			expect(result.deltaPct).toBeCloseTo(10);
			expect(result.withinTolerance).toBe(false);
		});

		it("treats zero reported tokens as zero delta (degenerate empty session)", async () => {
			const result = await auditLiveRun(
				{
					messages: [],
					cliReportedInputTokens: 0,
					model: "claude-haiku-4-5",
					apiKey: "test",
				},
				async () => 0,
			);
			expect(result.deltaPct).toBe(0);
			expect(result.withinTolerance).toBe(true);
		});

		it("propagates network failures without swallowing", async () => {
			await expect(
				auditLiveRun(
					{
						messages: [{ role: "user", content: "hi" }],
						cliReportedInputTokens: 100,
						model: "claude-haiku-4-5",
						apiKey: "test",
					},
					async () => {
						throw new Error("boom");
					},
				),
			).rejects.toThrow("boom");
		});
	});
});

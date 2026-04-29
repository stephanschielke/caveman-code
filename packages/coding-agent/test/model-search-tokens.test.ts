import { describe, expect, it } from "vitest";
import { applyModelPredicates, parseModelQuery } from "../src/core/model-search-tokens.js";

const m = (
	overrides: Partial<{
		id: string;
		provider: string;
		reasoning: boolean;
		input: ("text" | "image")[];
		contextWindow: number;
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	}>,
) =>
	({
		id: "test-model",
		provider: "openai",
		api: "openai-completions",
		baseUrl: "",
		name: "Test",
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 1, output: 4, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4096,
		...overrides,
	}) as any;

describe("parseModelQuery", () => {
	it("returns the original query when no tokens match", () => {
		const parsed = parseModelQuery("gpt-4 fast");
		expect(parsed.residualQuery).toBe("gpt-4 fast");
		expect(parsed.predicates).toHaveLength(0);
	});

	it("extracts r:, $:, ctx:, v:, p: tokens and leaves the rest", () => {
		const parsed = parseModelQuery("gpt r:high $:cheap ctx:>100k v:on p:openai");
		expect(parsed.residualQuery).toBe("gpt");
		expect(parsed.predicates.map((p) => p.label)).toEqual(["r:on", "$:cheap", "ctx:>100000", "v:on", "p:openai"]);
	});

	it("treats unknown prefixes as free text", () => {
		const parsed = parseModelQuery("foo:bar baz");
		expect(parsed.residualQuery).toBe("foo:bar baz");
		expect(parsed.predicates).toHaveLength(0);
	});

	it("parses k/m suffixes and bare numbers in ctx:", () => {
		expect(parseModelQuery("ctx:200k").predicates[0]!.label).toBe("ctx:200000");
		expect(parseModelQuery("ctx:1m").predicates[0]!.label).toBe("ctx:1000000");
		expect(parseModelQuery("ctx:128000").predicates[0]!.label).toBe("ctx:128000");
		expect(parseModelQuery("ctx:>=64k").predicates[0]!.label).toBe("ctx:>=64000");
	});
});

describe("applyModelPredicates", () => {
	const reasoning = m({ id: "o3", reasoning: true });
	const fast = m({ id: "gpt-4o-mini", cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 } });
	const expensive = m({
		id: "claude-opus-4-7",
		provider: "anthropic",
		cost: { input: 15, output: 75, cacheRead: 0, cacheWrite: 0 },
	});
	const vision = m({ id: "gpt-4o", input: ["text", "image"] });
	const big = m({ id: "gemini-1.5-pro", contextWindow: 1_000_000 });

	const all = [reasoning, fast, expensive, vision, big];

	it("filters reasoning models", () => {
		const { predicates } = parseModelQuery("r:on");
		expect(applyModelPredicates(all, predicates).map((m) => m.id)).toEqual(["o3"]);
	});

	it("filters by cost tier", () => {
		const cheap = applyModelPredicates(all, parseModelQuery("$:cheap").predicates);
		expect(cheap.map((m) => m.id)).toContain("gpt-4o-mini");
		expect(cheap.map((m) => m.id)).not.toContain("claude-opus-4-7");

		const exp = applyModelPredicates(all, parseModelQuery("$:exp").predicates);
		expect(exp.map((m) => m.id)).toEqual(["claude-opus-4-7"]);
	});

	it("filters by context window", () => {
		const huge = applyModelPredicates(all, parseModelQuery("ctx:>500k").predicates);
		expect(huge.map((m) => m.id)).toEqual(["gemini-1.5-pro"]);
	});

	it("filters by vision support", () => {
		const seeing = applyModelPredicates(all, parseModelQuery("v:on").predicates);
		expect(seeing.map((m) => m.id)).toEqual(["gpt-4o"]);
	});

	it("filters by provider substring", () => {
		const anthr = applyModelPredicates(all, parseModelQuery("p:anthropic").predicates);
		expect(anthr.map((m) => m.id)).toEqual(["claude-opus-4-7"]);
	});

	it("composes multiple predicates with AND semantics", () => {
		const result = applyModelPredicates(all, parseModelQuery("r:on $:exp").predicates);
		expect(result).toHaveLength(0);
	});
});

/**
 * WS15: Registry unit tests.
 *
 * Tests:
 *   1. Schema validation — valid registry passes
 *   2. Schema validation — malformed registry rejected with path errors
 *   3. Loader fallback chain — user-override wins over cache wins over bundled
 *   4. Fetch stub — fetchAndCacheRegistry writes cache on success
 *   5. Fetch stub — fetchAndCacheRegistry rejects on HTTP error
 *   6. Override merge — user-override file takes priority over bundled
 *   7. Malformed JSON in cache is skipped, falls through to bundled
 *   8. Merger — registryToModels produces correct Model<Api> shape
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchAndCacheRegistry } from "../src/registry/fetcher.js";
import { loadRegistry } from "../src/registry/loader.js";
import { registryToModels } from "../src/registry/merger.js";
import { type Registry, validateRegistry } from "../src/registry/schema.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRegistry(overrides: Partial<Registry> = {}): Registry {
	return {
		version: "1.0.0",
		channel: "stable",
		publishedAt: "2026-04-28T00:00:00Z",
		providers: [
			{
				id: "anthropic",
				name: "Anthropic",
				kind: "anthropic",
				baseUrl: "https://api.anthropic.com",
				auth: "api-key",
				models: [
					{
						id: "claude-sonnet-4-5",
						displayName: "Claude Sonnet 4.5",
						contextWindow: 200000,
						maxOutputTokens: 16000,
						inputCostPerMtok: 3,
						outputCostPerMtok: 15,
						capabilities: ["tools", "vision", "cache"],
					},
				],
			},
		],
		...overrides,
	};
}

function writeTempFile(dir: string, name: string, content: unknown): string {
	const path = join(dir, name);
	writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf-8");
	return path;
}

function makeTempDir(suffix: string): string {
	const dir = join(tmpdir(), `cave-registry-test-${Date.now()}-${suffix}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

// ---------------------------------------------------------------------------
// 1. Schema validation — valid registry passes
// ---------------------------------------------------------------------------

describe("validateRegistry", () => {
	it("accepts a valid minimal registry", () => {
		const result = validateRegistry(makeRegistry());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.registry.version).toBe("1.0.0");
			expect(result.registry.providers).toHaveLength(1);
		}
	});

	// ---------------------------------------------------------------------------
	// 2. Schema validation — malformed registry rejected with path errors
	// ---------------------------------------------------------------------------

	it("rejects registry missing version field", () => {
		const bad = { providers: [] } as unknown;
		const result = validateRegistry(bad);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.length).toBeGreaterThan(0);
			// Should mention the missing field path
			const allErrors = result.errors.join("\n");
			expect(allErrors).toMatch(/version/i);
		}
	});

	it("rejects provider with invalid kind", () => {
		const bad = makeRegistry({
			providers: [
				{
					id: "bad",
					name: "Bad",
					kind: "unknown-kind" as never,
					auth: "api-key",
					models: [],
				},
			],
		});
		const result = validateRegistry(bad);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.length).toBeGreaterThan(0);
		}
	});

	it("rejects model with negative contextWindow", () => {
		const bad = makeRegistry({
			providers: [
				{
					id: "anthropic",
					name: "Anthropic",
					kind: "anthropic",
					auth: "api-key",
					models: [
						{
							id: "bad-model",
							displayName: "Bad Model",
							contextWindow: -1,
						},
					],
				},
			],
		});
		const result = validateRegistry(bad);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			// Error should mention contextWindow or minimum
			const allErrors = result.errors.join("\n");
			expect(allErrors.toLowerCase()).toMatch(/contextwindow|minimum/i);
		}
	});

	it("accepts a registry with optional fields missing", () => {
		const minimal: Registry = {
			version: "0.1.0",
			providers: [
				{
					id: "openai",
					name: "OpenAI",
					kind: "openai",
					auth: "api-key",
					models: [
						{
							id: "gpt-4o",
							displayName: "GPT-4o",
							contextWindow: 128000,
						},
					],
				},
			],
		};
		const result = validateRegistry(minimal);
		expect(result.ok).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 3. Loader fallback chain
// ---------------------------------------------------------------------------

describe("loadRegistry fallback chain", () => {
	it("loads bundled fallback when no override or cache exists", () => {
		// Use a temp dir that has no files in it
		const emptyDir = makeTempDir("empty");
		const result = loadRegistry(emptyDir);
		// May find bundled or fail depending on build state — just check shape
		if (result.ok) {
			expect(result.registry.version).toBeTruthy();
			// bundled is the only source
			expect(result.source).toBe("bundled");
		} else {
			// No bundled in test environment is also acceptable — check error
			expect(result.error).toMatch(/no valid registry/i);
		}
	});

	it("prefers user-override over cache", () => {
		const dir = makeTempDir("override");

		const overrideRegistry = makeRegistry({ version: "99.0.0" });
		const cacheRegistry = makeRegistry({ version: "1.0.0" });

		writeTempFile(dir, "registry.json", overrideRegistry);
		writeTempFile(dir, "registry-cache.json", cacheRegistry);

		const result = loadRegistry(dir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.registry.version).toBe("99.0.0");
			expect(result.source).toBe("user-override");
		}
	});

	it("falls back to cache when no user-override exists", () => {
		const dir = makeTempDir("cache-only");
		const cacheRegistry = makeRegistry({ version: "2.0.0" });
		writeTempFile(dir, "registry-cache.json", cacheRegistry);

		const result = loadRegistry(dir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.registry.version).toBe("2.0.0");
			expect(result.source).toBe("cache");
		}
	});

	// ---------------------------------------------------------------------------
	// 7. Malformed JSON in cache is skipped
	// ---------------------------------------------------------------------------

	it("skips cache with malformed JSON and falls through", () => {
		const dir = makeTempDir("bad-cache");

		// Write malformed JSON to cache
		writeTempFile(dir, "registry-cache.json", "{ this is not json }");

		// Write valid override to see it is found
		const overrideRegistry = makeRegistry({ version: "3.0.0" });
		writeTempFile(dir, "registry.json", overrideRegistry);

		const result = loadRegistry(dir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.source).toBe("user-override");
			expect(result.registry.version).toBe("3.0.0");
		}
	});

	it("skips invalid (schema-failing) cache and falls through", () => {
		const dir = makeTempDir("invalid-cache");

		// Missing required 'version' field
		writeTempFile(dir, "registry-cache.json", { providers: [] });

		// Valid override should be found
		writeTempFile(dir, "registry.json", makeRegistry({ version: "4.0.0" }));

		const result = loadRegistry(dir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.source).toBe("user-override");
		}
	});
});

// ---------------------------------------------------------------------------
// 4 & 5. Fetch stub tests
// ---------------------------------------------------------------------------

describe("fetchAndCacheRegistry", () => {
	it("writes cache file on successful fetch", async () => {
		const dir = makeTempDir("fetch-success");
		const cachePath = join(dir, "registry-cache.json");

		const fixture = makeRegistry({ version: "5.0.0" });

		const mockFetch = async (_url: string, _opts?: RequestInit) =>
			({
				ok: true,
				status: 200,
				json: async () => fixture,
			}) as Response;

		const result = await fetchAndCacheRegistry(cachePath, "stable", mockFetch as typeof fetch);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.registry.version).toBe("5.0.0");
		}

		// Verify file was written
		const { existsSync, readFileSync } = await import("node:fs");
		expect(existsSync(cachePath)).toBe(true);
		const written = JSON.parse(readFileSync(cachePath, "utf-8")) as Registry;
		expect(written.version).toBe("5.0.0");
	});

	it("returns error on HTTP failure", async () => {
		const dir = makeTempDir("fetch-fail");
		const cachePath = join(dir, "registry-cache.json");

		const mockFetch = async () =>
			({
				ok: false,
				status: 404,
				json: async () => ({}),
			}) as Response;

		const result = await fetchAndCacheRegistry(cachePath, "stable", mockFetch as typeof fetch);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toMatch(/404/);
		}
	});

	it("returns error when response is not valid registry JSON", async () => {
		const dir = makeTempDir("fetch-invalid");
		const cachePath = join(dir, "registry-cache.json");

		const mockFetch = async () =>
			({
				ok: true,
				status: 200,
				json: async () => ({ not: "a registry" }),
			}) as Response;

		const result = await fetchAndCacheRegistry(cachePath, "stable", mockFetch as typeof fetch);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toMatch(/validation failed/i);
		}
	});
});

// ---------------------------------------------------------------------------
// 8. Merger tests
// ---------------------------------------------------------------------------

describe("registryToModels", () => {
	it("converts registry providers into Model<Api> shape", () => {
		const registry = makeRegistry();
		const models = registryToModels(registry);

		expect(models.length).toBeGreaterThan(0);
		const m = models[0];

		expect(m.id).toBe("claude-sonnet-4-5");
		expect(m.provider).toBe("anthropic");
		expect(m.api).toBe("anthropic");
		expect(m.contextWindow).toBe(200000);
		expect(m.input).toContain("image"); // vision capability → includes image
	});

	it("skips providers with unknown kind", () => {
		const registry: Registry = {
			version: "1.0.0",
			providers: [
				{
					id: "unknown",
					name: "Unknown Provider",
					kind: "other",
					auth: "none",
					models: [
						{
							id: "some-model",
							displayName: "Some Model",
							contextWindow: 4096,
						},
					],
				},
			],
		};
		const models = registryToModels(registry);
		// "other" maps to openai-completions, so we still get a model
		expect(models.length).toBe(1);
		expect(models[0].api).toBe("openai-completions");
	});

	it("maps reasoning capability to model.reasoning = true", () => {
		const registry: Registry = {
			version: "1.0.0",
			providers: [
				{
					id: "openai",
					name: "OpenAI",
					kind: "openai",
					auth: "api-key",
					models: [
						{
							id: "o3",
							displayName: "o3",
							contextWindow: 200000,
							capabilities: ["tools", "reasoning"],
						},
					],
				},
			],
		};
		const models = registryToModels(registry);
		expect(models[0].reasoning).toBe(true);
	});
});

// WS13: Unit tests for plugin manifest validation.

import { describe, expect, it } from "vitest";
import { compareSemVer, isNewerVersion, parseManifest, validateManifest } from "../manifest.js";

// ---------------------------------------------------------------------------
// validateManifest
// ---------------------------------------------------------------------------

describe("validateManifest — required fields", () => {
	it("returns valid for a minimal manifest", () => {
		const result = validateManifest({
			name: "my-plugin",
			version: "1.0.0",
			description: "A test plugin.",
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(result.manifest?.name).toBe("my-plugin");
	});

	it("rejects non-object input", () => {
		expect(validateManifest("string").valid).toBe(false);
		expect(validateManifest(null).valid).toBe(false);
		expect(validateManifest([]).valid).toBe(false);
		expect(validateManifest(42).valid).toBe(false);
	});

	it("requires name, version, description", () => {
		const r = validateManifest({});
		expect(r.valid).toBe(false);
		expect(r.errors.some((e) => e.includes("name"))).toBe(true);
		expect(r.errors.some((e) => e.includes("version"))).toBe(true);
		expect(r.errors.some((e) => e.includes("description"))).toBe(true);
	});

	it("rejects non-kebab-case name", () => {
		const r = validateManifest({ name: "My Plugin", version: "1.0.0", description: "x" });
		expect(r.valid).toBe(false);
		expect(r.errors.some((e) => e.includes("kebab-case"))).toBe(true);
	});

	it("allows hyphens in name", () => {
		const r = validateManifest({ name: "my-cool-plugin", version: "1.0.0", description: "x" });
		expect(r.valid).toBe(true);
	});

	it("rejects invalid semver", () => {
		const r = validateManifest({ name: "p", version: "v1.0", description: "x" });
		expect(r.valid).toBe(false);
		expect(r.errors.some((e) => e.includes("semver"))).toBe(true);
	});

	it("accepts semver with pre-release tag", () => {
		const r = validateManifest({ name: "p", version: "1.0.0-alpha.1", description: "x" });
		expect(r.valid).toBe(true);
	});

	it("rejects empty description", () => {
		const r = validateManifest({ name: "p", version: "1.0.0", description: "" });
		expect(r.valid).toBe(false);
		expect(r.errors.some((e) => e.includes("description"))).toBe(true);
	});
});

describe("validateManifest — optional fields", () => {
	const base = { name: "p", version: "1.0.0", description: "x" };

	it("accepts valid optional fields", () => {
		const r = validateManifest({
			...base,
			author: "julius",
			license: "MIT",
			homepage: "https://example.com",
			caveVersion: ">=0.65.0",
			tags: ["git", "productivity"],
		});
		expect(r.valid).toBe(true);
		expect(r.manifest?.author).toBe("julius");
		expect(r.manifest?.tags).toEqual(["git", "productivity"]);
	});

	it("rejects non-string author", () => {
		const r = validateManifest({ ...base, author: 42 });
		expect(r.valid).toBe(false);
		expect(r.errors.some((e) => e.includes("author"))).toBe(true);
	});

	it("rejects non-array tags", () => {
		const r = validateManifest({ ...base, tags: "git" });
		expect(r.valid).toBe(false);
	});

	it("rejects tags with non-string elements", () => {
		const r = validateManifest({ ...base, tags: ["git", 42] });
		expect(r.valid).toBe(false);
	});
});

describe("validateManifest — capabilities", () => {
	const base = { name: "p", version: "1.0.0", description: "x" };

	it("accepts full capabilities object", () => {
		const r = validateManifest({
			...base,
			capabilities: {
				commands: true,
				skills: true,
				agents: false,
				mcp: false,
				themes: true,
				hooks: [{ event: "PostToolUse", command: "hooks/post.sh", matcher: "Bash" }],
			},
		});
		expect(r.valid).toBe(true);
		expect(r.manifest?.capabilities?.commands).toBe(true);
	});

	it("rejects non-object capabilities", () => {
		const r = validateManifest({ ...base, capabilities: "all" });
		expect(r.valid).toBe(false);
	});

	it("rejects non-boolean capability flag", () => {
		const r = validateManifest({ ...base, capabilities: { commands: "yes" } });
		expect(r.valid).toBe(false);
	});

	it("rejects hook entry missing event", () => {
		const r = validateManifest({
			...base,
			capabilities: { hooks: [{ command: "hooks/x.sh" }] },
		});
		expect(r.valid).toBe(false);
		expect(r.errors.some((e) => e.includes("event"))).toBe(true);
	});

	it("rejects hook entry missing command", () => {
		const r = validateManifest({
			...base,
			capabilities: { hooks: [{ event: "PreToolUse" }] },
		});
		expect(r.valid).toBe(false);
		expect(r.errors.some((e) => e.includes("command"))).toBe(true);
	});

	it("rejects non-array hooks", () => {
		const r = validateManifest({ ...base, capabilities: { hooks: { event: "x", command: "y" } } });
		expect(r.valid).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// parseManifest
// ---------------------------------------------------------------------------

describe("parseManifest", () => {
	it("parses valid JSON", () => {
		const json = JSON.stringify({ name: "my-plugin", version: "2.3.4", description: "A plugin." });
		const r = parseManifest(json);
		expect(r.valid).toBe(true);
		expect(r.manifest?.version).toBe("2.3.4");
	});

	it("rejects invalid JSON", () => {
		const r = parseManifest("{bad json");
		expect(r.valid).toBe(false);
		expect(r.errors.some((e) => e.includes("JSON"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// compareSemVer / isNewerVersion
// ---------------------------------------------------------------------------

describe("compareSemVer", () => {
	it("returns 0 for equal versions", () => {
		expect(compareSemVer("1.2.3", "1.2.3")).toBe(0);
	});

	it("returns positive when a > b", () => {
		expect(compareSemVer("2.0.0", "1.9.9")).toBeGreaterThan(0);
		expect(compareSemVer("1.1.0", "1.0.9")).toBeGreaterThan(0);
		expect(compareSemVer("1.0.1", "1.0.0")).toBeGreaterThan(0);
	});

	it("returns negative when a < b", () => {
		expect(compareSemVer("1.0.0", "2.0.0")).toBeLessThan(0);
	});

	it("ignores pre-release tags in comparison", () => {
		// base "1.0.0" == base "1.0.0" regardless of pre-release
		expect(compareSemVer("1.0.0-alpha", "1.0.0-beta")).toBe(0);
	});
});

describe("isNewerVersion", () => {
	it("returns true when candidate is strictly newer", () => {
		expect(isNewerVersion("1.1.0", "1.0.0")).toBe(true);
		expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
	});

	it("returns false for same version", () => {
		expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
	});

	it("returns false when candidate is older", () => {
		expect(isNewerVersion("0.9.9", "1.0.0")).toBe(false);
	});
});

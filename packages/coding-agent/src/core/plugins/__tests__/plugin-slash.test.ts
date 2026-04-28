// WS13: Unit tests for /plugin slash command.

import { describe, expect, it } from "vitest";
import { PLUGIN_SLASH_COMMAND, parsePluginSlash, runPluginSlashCommand } from "../../slash-commands/plugin.js";

// ---------------------------------------------------------------------------
// PLUGIN_SLASH_COMMAND metadata
// ---------------------------------------------------------------------------

describe("PLUGIN_SLASH_COMMAND metadata", () => {
	it("has name = 'plugin'", () => {
		expect(PLUGIN_SLASH_COMMAND.name).toBe("plugin");
	});

	it("has a non-empty description", () => {
		expect(PLUGIN_SLASH_COMMAND.description.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// parsePluginSlash
// ---------------------------------------------------------------------------

describe("parsePluginSlash", () => {
	it("defaults to help when no verb", () => {
		expect(parsePluginSlash("/plugin")).toEqual({ verb: "help", args: [] });
		expect(parsePluginSlash("/plugin ")).toEqual({ verb: "help", args: [] });
	});

	it("parses verb and args", () => {
		expect(parsePluginSlash("/plugin search git")).toEqual({ verb: "search", args: ["git"] });
		expect(parsePluginSlash("/plugin install alice/my-plugin")).toEqual({
			verb: "install",
			args: ["alice/my-plugin"],
		});
		expect(parsePluginSlash("/plugin marketplace add https://example.com/p.json")).toEqual({
			verb: "marketplace",
			args: ["add", "https://example.com/p.json"],
		});
	});

	it("handles multi-word queries for search", () => {
		const { verb, args } = parsePluginSlash("/plugin search git tools");
		expect(verb).toBe("search");
		expect(args).toEqual(["git", "tools"]);
	});
});

// ---------------------------------------------------------------------------
// runPluginSlashCommand — pure/offline paths
// ---------------------------------------------------------------------------

describe("runPluginSlashCommand — help", () => {
	it("returns help text for /plugin", async () => {
		const result = await runPluginSlashCommand("/plugin", { cwd: process.cwd() });
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("search");
		expect(result.output).toContain("install");
		expect(result.output).toContain("list");
	});

	it("returns help text for /plugin help", async () => {
		const result = await runPluginSlashCommand("/plugin help", { cwd: process.cwd() });
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("/plugin");
	});
});

describe("runPluginSlashCommand — list (no plugins installed)", () => {
	it("reports no installed plugins gracefully", async () => {
		// This runs against real HOME but installed registry is typically empty in CI
		const result = await runPluginSlashCommand("/plugin list", { cwd: process.cwd() });
		expect(result.exitCode).toBe(0);
		// Either shows "No plugins installed" or lists plugins — both are valid
		expect(result.output.length).toBeGreaterThan(0);
	});
});

describe("runPluginSlashCommand — search with empty marketplaces", () => {
	it("returns 0 and a helpful message when no plugins found", async () => {
		const result = await runPluginSlashCommand("/plugin search xyzzy-nonexistent", {
			cwd: process.cwd(),
		});
		expect(result.exitCode).toBe(0);
		// Should not throw; output may indicate no results
		expect(result.output.length).toBeGreaterThan(0);
	});
});

describe("runPluginSlashCommand — install validation", () => {
	it("rejects install with no ref", async () => {
		const result = await runPluginSlashCommand("/plugin install", { cwd: process.cwd() });
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("owner/name");
	});

	it("rejects install with ref that has no slash", async () => {
		const result = await runPluginSlashCommand("/plugin install myplugin", { cwd: process.cwd() });
		expect(result.exitCode).toBe(1);
	});
});

describe("runPluginSlashCommand — marketplace add validation", () => {
	it("rejects marketplace add with no URL", async () => {
		const result = await runPluginSlashCommand("/plugin marketplace add", { cwd: process.cwd() });
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("URL");
	});
});

describe("runPluginSlashCommand — create hint", () => {
	it("returns scaffold instructions for /plugin create", async () => {
		const result = await runPluginSlashCommand("/plugin create", { cwd: process.cwd() });
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("plugin-creator");
	});
});

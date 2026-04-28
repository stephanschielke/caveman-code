// WS13: Unit tests for plugin install plan and upgrade detection.

import { describe, expect, it } from "vitest";
import { buildInstallPlan, detectUpgrades, resolveDownloadUrl } from "../installer.js";
import type { InstalledPluginRecord, MarketplaceEntry } from "../marketplace.js";

// ---------------------------------------------------------------------------
// resolveDownloadUrl
// ---------------------------------------------------------------------------

describe("resolveDownloadUrl", () => {
	it("uses entry.url when provided", () => {
		const entry: MarketplaceEntry = {
			ref: "alice/plugin",
			name: "plugin",
			description: "test",
			url: "https://example.com/plugin.zip",
		};
		expect(resolveDownloadUrl(entry)).toBe("https://example.com/plugin.zip");
	});

	it("derives GitHub archive URL from owner/repo ref", () => {
		const entry: MarketplaceEntry = {
			ref: "alice/my-plugin",
			name: "my-plugin",
			description: "test",
		};
		const url = resolveDownloadUrl(entry);
		expect(url).toContain("alice");
		expect(url).toContain("my-plugin");
		expect(url).toMatch(/codeload\.github\.com|github\.com/);
	});

	it("supports ref with @branch suffix", () => {
		const entry: MarketplaceEntry = {
			ref: "alice/plugin@develop",
			name: "plugin",
			description: "test",
		};
		const url = resolveDownloadUrl(entry);
		expect(url).toContain("develop");
	});
});

// ---------------------------------------------------------------------------
// buildInstallPlan
// ---------------------------------------------------------------------------

describe("buildInstallPlan", () => {
	const entry: MarketplaceEntry = {
		ref: "alice/git-helper",
		name: "git-helper",
		description: "Git utilities",
		version: "1.0.0",
	};

	it("produces a plan for a fresh install (isUpgrade=false)", () => {
		const plan = buildInstallPlan(entry, []);
		expect(plan.ref).toBe("alice/git-helper");
		expect(plan.owner).toBe("alice");
		expect(plan.name).toBe("git-helper");
		expect(plan.isUpgrade).toBe(false);
		expect(plan.currentVersion).toBeUndefined();
		expect(plan.targetDir).toContain("alice");
		expect(plan.targetDir).toContain("git-helper");
		expect(plan.downloadUrl).toBeTruthy();
	});

	it("marks isUpgrade=true when plugin is already installed", () => {
		const installed: InstalledPluginRecord[] = [
			{
				ref: "alice/git-helper",
				name: "git-helper",
				version: "0.9.0",
				installedAt: new Date().toISOString(),
				path: "/fake/alice/git-helper",
			},
		];
		const plan = buildInstallPlan(entry, installed);
		expect(plan.isUpgrade).toBe(true);
		expect(plan.currentVersion).toBe("0.9.0");
	});

	it("uses the entry url for downloadUrl when provided", () => {
		const withUrl: MarketplaceEntry = { ...entry, url: "https://cdn.example.com/plugin.zip" };
		const plan = buildInstallPlan(withUrl, []);
		expect(plan.downloadUrl).toBe("https://cdn.example.com/plugin.zip");
	});
});

// ---------------------------------------------------------------------------
// detectUpgrades
// ---------------------------------------------------------------------------

describe("detectUpgrades", () => {
	const installed: InstalledPluginRecord[] = [
		{
			ref: "alice/git-helper",
			name: "git-helper",
			version: "1.0.0",
			installedAt: new Date().toISOString(),
			path: "/fake/alice/git-helper",
		},
		{
			ref: "bob/formatter",
			name: "formatter",
			version: "2.0.0",
			installedAt: new Date().toISOString(),
			path: "/fake/bob/formatter",
		},
	];

	it("detects a plugin with a newer available version", () => {
		const marketplaceEntries: MarketplaceEntry[] = [
			{ ref: "alice/git-helper", name: "git-helper", description: "...", version: "1.1.0" },
			{ ref: "bob/formatter", name: "formatter", description: "...", version: "2.0.0" },
		];
		const candidates = detectUpgrades(installed, marketplaceEntries);
		expect(candidates).toHaveLength(1);
		expect(candidates[0].ref).toBe("alice/git-helper");
		expect(candidates[0].currentVersion).toBe("1.0.0");
		expect(candidates[0].availableVersion).toBe("1.1.0");
	});

	it("returns empty array when all plugins are up to date", () => {
		const marketplaceEntries: MarketplaceEntry[] = [
			{ ref: "alice/git-helper", name: "git-helper", description: "...", version: "1.0.0" },
			{ ref: "bob/formatter", name: "formatter", description: "...", version: "2.0.0" },
		];
		const candidates = detectUpgrades(installed, marketplaceEntries);
		expect(candidates).toHaveLength(0);
	});

	it("skips installed plugins not in the marketplace", () => {
		const candidates = detectUpgrades(installed, []);
		expect(candidates).toHaveLength(0);
	});

	it("skips marketplace entries without a version", () => {
		const marketplaceEntries: MarketplaceEntry[] = [
			{ ref: "alice/git-helper", name: "git-helper", description: "..." },
		];
		const candidates = detectUpgrades(installed, marketplaceEntries);
		expect(candidates).toHaveLength(0);
	});

	it("detects multiple upgrades at once", () => {
		const marketplaceEntries: MarketplaceEntry[] = [
			{ ref: "alice/git-helper", name: "git-helper", description: "...", version: "2.0.0" },
			{ ref: "bob/formatter", name: "formatter", description: "...", version: "3.0.0" },
		];
		const candidates = detectUpgrades(installed, marketplaceEntries);
		expect(candidates).toHaveLength(2);
	});
});

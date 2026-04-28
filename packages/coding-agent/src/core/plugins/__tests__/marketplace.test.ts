// WS13: Unit tests for marketplace fetch, cache, and search.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	addRemoteMarketplace,
	fetchAllMarketplaces,
	findEntryByRef,
	type InstalledPluginRecord,
	personalMarketplacePath,
	readInstalledRegistry,
	removeInstalledRecord,
	repoMarketplacePath,
	searchMarketplaces,
	upsertInstalledRecord,
} from "../marketplace.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let fakeHome: string;
let fakeCwd: string;
let HOME_BACKUP: string | undefined;

beforeEach(() => {
	fakeHome = mkdtempSync(join(tmpdir(), "cave-mp-home-"));
	fakeCwd = mkdtempSync(join(tmpdir(), "cave-mp-cwd-"));
	HOME_BACKUP = process.env.HOME;
	process.env.HOME = fakeHome;
});

afterEach(() => {
	rmSync(fakeHome, { recursive: true, force: true });
	rmSync(fakeCwd, { recursive: true, force: true });
	if (HOME_BACKUP === undefined) delete process.env.HOME;
	else process.env.HOME = HOME_BACKUP;
});

function _writeMarketplace(path: string, data: object): void {
	const dir = join(path, "..");
	mkdirSync(dir, { recursive: true });
	writeFileSync(path, JSON.stringify(data), "utf8");
}

// ---------------------------------------------------------------------------
// fetchAllMarketplaces
// ---------------------------------------------------------------------------

describe("fetchAllMarketplaces — local scopes", () => {
	it("returns empty entries when no marketplace files exist", async () => {
		const results = await fetchAllMarketplaces({ cwd: fakeCwd, offline: true });
		expect(results).toHaveLength(2); // repo + personal (no remotes)
		for (const r of results) {
			expect(r.entries).toHaveLength(0);
		}
	});

	it("reads repo-scope marketplace from .cave/plugins/marketplace.json", async () => {
		const mp = repoMarketplacePath(fakeCwd);
		mkdirSync(join(mp, ".."), { recursive: true });
		writeFileSync(
			mp,
			JSON.stringify({
				plugins: [{ ref: "owner/my-plugin", name: "my-plugin", description: "Test plugin" }],
			}),
			"utf8",
		);

		const results = await fetchAllMarketplaces({ cwd: fakeCwd, offline: true });
		const repo = results.find((r) => r.scope === "repo");
		expect(repo?.entries).toHaveLength(1);
		expect(repo?.entries[0].ref).toBe("owner/my-plugin");
	});

	it("reads personal-scope marketplace from ~/.cave/plugins/marketplace.json", async () => {
		const mp = personalMarketplacePath();
		mkdirSync(join(mp, ".."), { recursive: true });
		writeFileSync(
			mp,
			JSON.stringify({
				plugins: [
					{ ref: "alice/tool-a", name: "tool-a", description: "Tool A" },
					{ ref: "bob/tool-b", name: "tool-b", description: "Tool B" },
				],
			}),
			"utf8",
		);

		const results = await fetchAllMarketplaces({ cwd: fakeCwd, offline: true });
		const personal = results.find((r) => r.scope === "personal");
		expect(personal?.entries).toHaveLength(2);
	});

	it("merges repo and personal entries independently", async () => {
		const repoMp = repoMarketplacePath(fakeCwd);
		mkdirSync(join(repoMp, ".."), { recursive: true });
		writeFileSync(
			repoMp,
			JSON.stringify({ plugins: [{ ref: "r/plugin", name: "plugin", description: "Repo" }] }),
			"utf8",
		);

		const personalMp = personalMarketplacePath();
		mkdirSync(join(personalMp, ".."), { recursive: true });
		writeFileSync(
			personalMp,
			JSON.stringify({
				plugins: [{ ref: "p/plugin", name: "plugin", description: "Personal" }],
			}),
			"utf8",
		);

		const results = await fetchAllMarketplaces({ cwd: fakeCwd, offline: true });
		const repoScope = results.find((r) => r.scope === "repo");
		const personalScope = results.find((r) => r.scope === "personal");
		expect(repoScope?.entries[0].ref).toBe("r/plugin");
		expect(personalScope?.entries[0].ref).toBe("p/plugin");
	});
});

// ---------------------------------------------------------------------------
// searchMarketplaces
// ---------------------------------------------------------------------------

describe("searchMarketplaces", () => {
	const fakeMarketplaces = [
		{
			scope: "personal" as const,
			origin: "/fake",
			entries: [
				{ ref: "alice/git-helper", name: "git-helper", description: "Git utilities", tags: ["git", "vcs"] },
				{ ref: "bob/ai-tools", name: "ai-tools", description: "AI workflow tools", tags: ["ai"] },
				{ ref: "carol/formatter", name: "formatter", description: "Code formatter", tags: ["format"] },
			],
		},
	];

	it("returns all entries when query is empty", () => {
		const results = searchMarketplaces(fakeMarketplaces, "");
		expect(results).toHaveLength(3);
	});

	it("matches by name", () => {
		const results = searchMarketplaces(fakeMarketplaces, "git");
		expect(results).toHaveLength(1);
		expect(results[0].ref).toBe("alice/git-helper");
	});

	it("matches by tag", () => {
		const results = searchMarketplaces(fakeMarketplaces, "ai");
		expect(results.some((e) => e.ref === "bob/ai-tools")).toBe(true);
	});

	it("matches by description", () => {
		const results = searchMarketplaces(fakeMarketplaces, "Code formatter");
		expect(results).toHaveLength(1);
		expect(results[0].ref).toBe("carol/formatter");
	});

	it("is case-insensitive", () => {
		const results = searchMarketplaces(fakeMarketplaces, "GIT");
		expect(results).toHaveLength(1);
	});

	it("deduplicates entries with same ref across multiple marketplaces", () => {
		const duplicated = [
			{ scope: "repo" as const, origin: "/a", entries: [{ ref: "x/y", name: "y", description: "dup" }] },
			{ scope: "personal" as const, origin: "/b", entries: [{ ref: "x/y", name: "y", description: "dup" }] },
		];
		const results = searchMarketplaces(duplicated, "");
		expect(results).toHaveLength(1);
	});

	it("returns empty array when no match", () => {
		const results = searchMarketplaces(fakeMarketplaces, "nonexistent-xyz");
		expect(results).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// findEntryByRef
// ---------------------------------------------------------------------------

describe("findEntryByRef", () => {
	const marketplaces = [
		{
			scope: "personal" as const,
			origin: "/x",
			entries: [{ ref: "alice/tool", name: "tool", description: "desc" }],
		},
	];

	it("finds an entry by ref", () => {
		const found = findEntryByRef(marketplaces, "alice/tool");
		expect(found?.ref).toBe("alice/tool");
	});

	it("returns undefined for unknown ref", () => {
		expect(findEntryByRef(marketplaces, "nobody/unknown")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// addRemoteMarketplace
// ---------------------------------------------------------------------------

describe("addRemoteMarketplace", () => {
	it("adds a new remote URL and persists to disk", () => {
		const url = "https://example.com/plugins.json";
		const { added, path } = addRemoteMarketplace(url);
		expect(added).toBe(true);
		expect(existsSync(path)).toBe(true);
	});

	it("does not duplicate an already-registered URL", () => {
		const url = "https://example.com/plugins.json";
		addRemoteMarketplace(url);
		const { added } = addRemoteMarketplace(url);
		expect(added).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Installed registry
// ---------------------------------------------------------------------------

describe("installed plugin registry", () => {
	it("reads empty registry when file does not exist", () => {
		const records = readInstalledRegistry();
		expect(records).toEqual([]);
	});

	it("upserts and retrieves a record", () => {
		const record: InstalledPluginRecord = {
			ref: "alice/git-helper",
			name: "git-helper",
			version: "1.0.0",
			installedAt: new Date().toISOString(),
			path: "/fake/path",
		};
		upsertInstalledRecord(record);
		const records = readInstalledRegistry();
		expect(records).toHaveLength(1);
		expect(records[0].ref).toBe("alice/git-helper");
	});

	it("replaces an existing record on upsert", () => {
		const base: InstalledPluginRecord = {
			ref: "alice/git-helper",
			name: "git-helper",
			version: "1.0.0",
			installedAt: new Date().toISOString(),
			path: "/fake/path",
		};
		upsertInstalledRecord(base);
		upsertInstalledRecord({ ...base, version: "2.0.0" });
		const records = readInstalledRegistry();
		expect(records).toHaveLength(1);
		expect(records[0].version).toBe("2.0.0");
	});

	it("removes a record by ref", () => {
		const record: InstalledPluginRecord = {
			ref: "alice/git-helper",
			name: "git-helper",
			version: "1.0.0",
			installedAt: new Date().toISOString(),
			path: "/fake/path",
		};
		upsertInstalledRecord(record);
		removeInstalledRecord("alice/git-helper");
		expect(readInstalledRegistry()).toHaveLength(0);
	});
});

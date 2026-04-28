/**
 * WS13: Plugin installer — download, validate, and wire up a plugin bundle.
 *
 * Install flow:
 *   1. Resolve the plugin source URL from a marketplace entry or direct ref.
 *   2. Download and extract the archive into a temp directory.
 *   3. Read and validate `.cave-plugin/plugin.json`.
 *   4. Copy the validated bundle into ~/.cave/plugins/<owner>/<name>/.
 *   5. Wire up sub-directories: commands/, skills/, agents/, hooks/, .mcp.json.
 *   6. Register the install in the installed-plugins registry.
 *
 * Download strategy:
 *   - If `url` in the marketplace entry points directly to a `.zip` → use it.
 *   - Otherwise assume a GitHub ref ("owner/repo[@ref]") and derive the
 *     tarball URL from the GitHub archive endpoint.
 */

import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { type PluginManifest, parseManifest } from "./manifest.js";
import {
	type InstalledPluginRecord,
	installedPluginDir,
	type MarketplaceEntry,
	upsertInstalledRecord,
} from "./marketplace.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallPlan {
	/** Resolved plugin ref (owner/name). */
	ref: string;
	/** Owner part of the ref. */
	owner: string;
	/** Name part of the ref. */
	name: string;
	/** Resolved download URL. */
	downloadUrl: string;
	/** Target installation directory. */
	targetDir: string;
	/** Whether this is an upgrade over an existing install. */
	isUpgrade: boolean;
	/** Currently installed version (if isUpgrade). */
	currentVersion?: string;
}

export interface InstallResult {
	success: boolean;
	ref: string;
	version: string;
	installedPath: string;
	wired: WiredCapabilities;
	errors: string[];
}

export interface WiredCapabilities {
	commands: boolean;
	skills: boolean;
	agents: boolean;
	themes: boolean;
	hooks: boolean;
	mcp: boolean;
}

export interface UpgradeCandidate {
	ref: string;
	currentVersion: string;
	availableVersion: string;
	downloadUrl: string;
}

// ---------------------------------------------------------------------------
// URL resolution
// ---------------------------------------------------------------------------

const GITHUB_ARCHIVE_TEMPLATE = "https://codeload.github.com/{owner}/{repo}/zip/refs/heads/main";

/**
 * Derive a download URL from a marketplace entry.
 * Precedence: entry.url → GitHub archive for the ref.
 */
export function resolveDownloadUrl(entry: MarketplaceEntry): string {
	if (entry.url) return entry.url;

	// Parse "owner/repo" or "owner/repo@ref"
	const [ownerRepo, ref] = entry.ref.split("@");
	const parts = (ownerRepo ?? "").split("/");
	const owner = parts[0] ?? "";
	const repo = parts[1] ?? owner; // fall back to owner if single segment

	if (ref) {
		return `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${ref}`;
	}
	return GITHUB_ARCHIVE_TEMPLATE.replace("{owner}", owner).replace("{repo}", repo);
}

/**
 * Build an install plan for a plugin, checking whether it is already installed.
 */
export function buildInstallPlan(entry: MarketplaceEntry, installedRegistry: InstalledPluginRecord[]): InstallPlan {
	const [ownerRepo] = entry.ref.split("@");
	const parts = (ownerRepo ?? "").split("/");
	const owner = parts[0] ?? "unknown";
	const name = parts[1] ?? entry.name ?? parts[0];

	const existing = installedRegistry.find((r) => r.ref === entry.ref);
	const targetDir = installedPluginDir(owner, name);

	return {
		ref: entry.ref,
		owner,
		name,
		downloadUrl: resolveDownloadUrl(entry),
		targetDir,
		isUpgrade: existing !== undefined,
		currentVersion: existing?.version,
	};
}

// ---------------------------------------------------------------------------
// Download helpers (Node 18+ native fetch + streams)
// ---------------------------------------------------------------------------

async function downloadToFile(url: string, destPath: string): Promise<void> {
	const res = await fetch(url, {
		headers: { "User-Agent": "cave-cli/plugin-installer" },
		signal: AbortSignal.timeout(60_000),
	});
	if (!res.ok) {
		throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
	}
	if (!res.body) {
		throw new Error("Response body is empty");
	}
	const dest = createWriteStream(destPath);
	await pipeline(res.body as unknown as NodeJS.ReadableStream, dest);
}

// ---------------------------------------------------------------------------
// Archive extraction
// ---------------------------------------------------------------------------

async function extractZip(zipPath: string, destDir: string): Promise<void> {
	// Use extract-zip which is already in the deps
	const extractZipFn = (await import("extract-zip")).default;
	await extractZipFn(zipPath, { dir: destDir });
}

/**
 * Find the plugin manifest inside an extracted directory tree.
 * GitHub archives wrap everything in a "<repo>-<branch>/" prefix, so we scan
 * one level deep for `.cave-plugin/plugin.json`.
 */
async function findManifestPath(extractDir: string): Promise<string | null> {
	// Direct path
	const direct = join(extractDir, ".cave-plugin", "plugin.json");
	if (existsSync(direct)) return direct;

	// One level deep (GitHub archive wraps in subdirectory)
	const entries = await readdir(extractDir);
	for (const entry of entries) {
		const candidate = join(extractDir, entry, ".cave-plugin", "plugin.json");
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/**
 * Return the root directory of the extracted plugin (may be one level down).
 */
async function findPluginRoot(extractDir: string, _manifest: PluginManifest): Promise<string> {
	const direct = join(extractDir, ".cave-plugin", "plugin.json");
	if (existsSync(direct)) return extractDir;

	const entries = await readdir(extractDir);
	for (const entry of entries) {
		const candidate = join(extractDir, entry, ".cave-plugin", "plugin.json");
		if (existsSync(candidate)) return join(extractDir, entry);
	}
	return extractDir;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * Copy a sub-directory from the plugin root into the target if it exists.
 */
async function wireSubDir(pluginRoot: string, targetRoot: string, subDir: string): Promise<boolean> {
	const src = join(pluginRoot, subDir);
	const dst = join(targetRoot, subDir);
	try {
		const s = await stat(src);
		if (!s.isDirectory()) return false;
		await mkdir(dst, { recursive: true });
		await cp(src, dst, { recursive: true });
		return true;
	} catch {
		return false;
	}
}

/**
 * Copy .mcp.json from the plugin root to the target if it exists.
 */
async function wireMcpJson(pluginRoot: string, targetRoot: string): Promise<boolean> {
	const src = join(pluginRoot, ".mcp.json");
	if (!existsSync(src)) return false;
	const dst = join(targetRoot, ".mcp.json");
	await mkdir(targetRoot, { recursive: true });
	// Read + write to avoid stream API usage
	writeFileSync(dst, readFileSync(src, "utf8"), "utf8");
	return true;
}

// ---------------------------------------------------------------------------
// Install (online)
// ---------------------------------------------------------------------------

/**
 * Download, validate, and install a plugin.
 * Requires network access.
 */
export async function installPlugin(plan: InstallPlan): Promise<InstallResult> {
	const errors: string[] = [];

	// Create a temp working directory
	const tmpDir = mkdtempSync(join(tmpdir(), "cave-plugin-"));
	const zipPath = join(tmpDir, "plugin.zip");
	const extractDir = join(tmpDir, "extracted");

	try {
		mkdirSync(extractDir, { recursive: true });

		// Download
		await downloadToFile(plan.downloadUrl, zipPath);

		// Extract
		await extractZip(zipPath, extractDir);

		// Find manifest
		const manifestPath = await findManifestPath(extractDir);
		if (!manifestPath) {
			return {
				success: false,
				ref: plan.ref,
				version: "unknown",
				installedPath: plan.targetDir,
				wired: { commands: false, skills: false, agents: false, themes: false, hooks: false, mcp: false },
				errors: ["No .cave-plugin/plugin.json found in archive"],
			};
		}

		const manifestJson = readFileSync(manifestPath, "utf8");
		const result = parseManifest(manifestJson);
		if (!result.valid || !result.manifest) {
			return {
				success: false,
				ref: plan.ref,
				version: "unknown",
				installedPath: plan.targetDir,
				wired: { commands: false, skills: false, agents: false, themes: false, hooks: false, mcp: false },
				errors: [`Invalid plugin manifest: ${result.errors.join("; ")}`],
			};
		}

		const manifest = result.manifest;
		const pluginRoot = await findPluginRoot(extractDir, manifest);

		// Install target directory
		mkdirSync(plan.targetDir, { recursive: true });
		await cp(pluginRoot, plan.targetDir, { recursive: true });

		// Wire capabilities
		const wired: WiredCapabilities = {
			commands: await wireSubDir(plan.targetDir, plan.targetDir, "commands"),
			skills: await wireSubDir(plan.targetDir, plan.targetDir, "skills"),
			agents: await wireSubDir(plan.targetDir, plan.targetDir, "agents"),
			themes: await wireSubDir(plan.targetDir, plan.targetDir, "themes"),
			hooks: (manifest.capabilities?.hooks?.length ?? 0) > 0,
			mcp: await wireMcpJson(plan.targetDir, plan.targetDir),
		};

		// Register in installed registry
		const record: InstalledPluginRecord = {
			ref: plan.ref,
			name: manifest.name,
			version: manifest.version,
			installedAt: new Date().toISOString(),
			path: plan.targetDir,
		};
		upsertInstalledRecord(record);

		return {
			success: true,
			ref: plan.ref,
			version: manifest.version,
			installedPath: plan.targetDir,
			wired,
			errors,
		};
	} catch (e) {
		errors.push(e instanceof Error ? e.message : String(e));
		return {
			success: false,
			ref: plan.ref,
			version: "unknown",
			installedPath: plan.targetDir,
			wired: { commands: false, skills: false, agents: false, themes: false, hooks: false, mcp: false },
			errors,
		};
	} finally {
		// Always clean up temp directory
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	}
}

// ---------------------------------------------------------------------------
// Upgrade detection
// ---------------------------------------------------------------------------

import { isNewerVersion } from "./manifest.js";

/**
 * Compare currently installed plugins against marketplace entries.
 * Returns candidates that have a newer version available.
 */
export function detectUpgrades(
	installed: InstalledPluginRecord[],
	marketplaceEntries: MarketplaceEntry[],
): UpgradeCandidate[] {
	const candidates: UpgradeCandidate[] = [];

	for (const record of installed) {
		const entry = marketplaceEntries.find((e) => e.ref === record.ref);
		if (!entry?.version) continue;

		if (isNewerVersion(entry.version, record.version)) {
			candidates.push({
				ref: record.ref,
				currentVersion: record.version,
				availableVersion: entry.version,
				downloadUrl: resolveDownloadUrl(entry),
			});
		}
	}

	return candidates;
}

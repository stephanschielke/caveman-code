/**
 * WS13: Plugin loader — discover and surface installed plugin capabilities.
 *
 * After a plugin is installed under ~/.cave/plugins/<owner>/<name>/, this
 * module collects the sub-directories and integration points so the rest of
 * cave can wire them up at startup:
 *
 *   commands/  → additional slash/CLI command markdown files
 *   skills/    → additional skill directories (like ~/.cave/skills/)
 *   agents/    → additional agent markdown files
 *   themes/    → additional theme JSON files
 *   hooks/     → hook entries from manifest.capabilities.hooks
 *   .mcp.json  → additional MCP server definitions to merge
 */

import { existsSync, readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type PluginManifest, parseManifest } from "./manifest.js";
import { type InstalledPluginRecord, readInstalledRegistry } from "./marketplace.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadedPlugin {
	record: InstalledPluginRecord;
	manifest: PluginManifest;
	/** Absolute paths to command markdown files found in commands/. */
	commandPaths: string[];
	/** Absolute paths to skill directories found in skills/. */
	skillDirs: string[];
	/** Absolute paths to agent markdown files found in agents/. */
	agentPaths: string[];
	/** Absolute paths to theme JSON files found in themes/. */
	themePaths: string[];
	/** Absolute path to .mcp.json if present. */
	mcpJsonPath?: string;
}

export interface LoadPluginsResult {
	loaded: LoadedPlugin[];
	errors: Array<{ ref: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collectFiles(dir: string, exts: string[]): Promise<string[]> {
	if (!existsSync(dir)) return [];
	try {
		const entries = await readdir(dir);
		const files: string[] = [];
		for (const entry of entries) {
			const full = join(dir, entry);
			const s = await stat(full).catch(() => null);
			if (!s) continue;
			if (s.isFile() && exts.some((ext) => entry.endsWith(ext))) {
				files.push(full);
			}
		}
		return files;
	} catch {
		return [];
	}
}

async function collectSubDirs(dir: string): Promise<string[]> {
	if (!existsSync(dir)) return [];
	try {
		const entries = await readdir(dir);
		const dirs: string[] = [];
		for (const entry of entries) {
			const full = join(dir, entry);
			const s = await stat(full).catch(() => null);
			if (s?.isDirectory()) dirs.push(full);
		}
		return dirs;
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load all installed plugins, resolving their capabilities into typed paths.
 * Skips plugins with invalid manifests (records the error instead of throwing).
 */
export async function loadInstalledPlugins(): Promise<LoadPluginsResult> {
	const records = readInstalledRegistry();
	const loaded: LoadedPlugin[] = [];
	const errors: Array<{ ref: string; error: string }> = [];

	for (const record of records) {
		if (!existsSync(record.path)) {
			errors.push({ ref: record.ref, error: `install directory not found: ${record.path}` });
			continue;
		}

		const manifestPath = join(record.path, ".cave-plugin", "plugin.json");
		if (!existsSync(manifestPath)) {
			errors.push({ ref: record.ref, error: "missing .cave-plugin/plugin.json" });
			continue;
		}

		let manifest: PluginManifest;
		try {
			const json = readFileSync(manifestPath, "utf8");
			const result = parseManifest(json);
			if (!result.valid || !result.manifest) {
				errors.push({
					ref: record.ref,
					error: `invalid manifest: ${result.errors.join("; ")}`,
				});
				continue;
			}
			manifest = result.manifest;
		} catch (e) {
			errors.push({
				ref: record.ref,
				error: `failed to read manifest: ${e instanceof Error ? e.message : String(e)}`,
			});
			continue;
		}

		const commandPaths = await collectFiles(join(record.path, "commands"), [".md"]);
		const skillDirs = await collectSubDirs(join(record.path, "skills"));
		const agentPaths = await collectFiles(join(record.path, "agents"), [".md"]);
		const themePaths = await collectFiles(join(record.path, "themes"), [".json"]);
		const mcpJsonPath = join(record.path, ".mcp.json");

		loaded.push({
			record,
			manifest,
			commandPaths,
			skillDirs,
			agentPaths,
			themePaths,
			mcpJsonPath: existsSync(mcpJsonPath) ? mcpJsonPath : undefined,
		});
	}

	return { loaded, errors };
}

/**
 * Collect all skill directories from all loaded plugins.
 * Used during startup to augment the skills discovery path list.
 */
export function collectPluginSkillDirs(loaded: LoadedPlugin[]): string[] {
	return loaded.flatMap((p) => p.skillDirs);
}

/**
 * Collect all command paths from all loaded plugins.
 */
export function collectPluginCommandPaths(loaded: LoadedPlugin[]): string[] {
	return loaded.flatMap((p) => p.commandPaths);
}

/**
 * Collect all .mcp.json paths from loaded plugins.
 */
export function collectPluginMcpPaths(loaded: LoadedPlugin[]): string[] {
	return loaded.flatMap((p) => (p.mcpJsonPath ? [p.mcpJsonPath] : []));
}

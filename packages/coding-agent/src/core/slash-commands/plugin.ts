/**
 * WS13: `/plugin` slash command — interactive-mode mirror of `cave plugin`.
 *
 * Subcommands:
 *   /plugin                          → help
 *   /plugin search [query]           → search marketplaces
 *   /plugin install <owner/name>     → install a plugin
 *   /plugin list                     → list installed plugins
 *   /plugin upgrade                  → upgrade all installed plugins
 *   /plugin marketplace add <url>    → register a remote marketplace
 *   /plugin marketplace list         → show configured marketplaces
 *   /plugin create                   → scaffold a new plugin manifest (hint)
 *   /plugin help                     → show this help
 */

import { buildInstallPlan, detectUpgrades, installPlugin } from "../plugins/installer.js";
import {
	addRemoteMarketplace,
	fetchAllMarketplaces,
	findEntryByRef,
	type MarketplaceEntry,
	readInstalledRegistry,
	searchMarketplaces,
} from "../plugins/marketplace.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginSlashResult {
	exitCode: number;
	output: string;
}

function ok(output: string): PluginSlashResult {
	return { exitCode: 0, output };
}

function err(output: string): PluginSlashResult {
	return { exitCode: 1, output };
}

// ---------------------------------------------------------------------------
// Metadata (for interactive mode registration)
// ---------------------------------------------------------------------------

export const PLUGIN_SLASH_COMMAND = {
	name: "plugin",
	description: "Manage plugins (search, install, list, upgrade, marketplace). See /plugin help.",
} as const;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parsePluginSlash(line: string): { verb: string; args: string[] } {
	const trimmed = line.replace(/^\/plugin\s*/, "").trim();
	if (!trimmed) return { verb: "help", args: [] };
	const parts = trimmed.split(/\s+/);
	return { verb: parts[0] ?? "help", args: parts.slice(1) };
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function formatHelp(): string {
	return [
		"/plugin — Plugin Marketplace (WS13)",
		"",
		"Usage:",
		"  /plugin search [query]          Search all marketplaces",
		"  /plugin install <owner/name>    Download and install a plugin",
		"  /plugin list                    Show installed plugins",
		"  /plugin upgrade                 Upgrade all installed plugins",
		"  /plugin marketplace add <url>   Register a remote marketplace URL",
		"  /plugin marketplace list        List configured marketplaces",
		"  /plugin create                  Scaffold a new plugin manifest",
		"  /plugin help                    Show this help",
		"",
		"Examples:",
		"  /plugin search git",
		"  /plugin install cave-community/git-tools",
		"  /plugin marketplace add https://example.com/plugins.json",
	].join("\n");
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function runSearch(args: string[], cwd: string): Promise<PluginSlashResult> {
	const query = args.join(" ");
	const marketplaces = await fetchAllMarketplaces({ cwd });
	const entries = searchMarketplaces(marketplaces, query);

	const warnings = marketplaces
		.filter((m) => m.error)
		.map((m) => `Warning [${m.scope}]: ${m.error}`)
		.join("\n");

	if (entries.length === 0) {
		const msg = query
			? `No plugins found matching "${query}".`
			: "No plugins found. Add a marketplace: /plugin marketplace add <url>";
		return ok([warnings, msg].filter(Boolean).join("\n"));
	}

	const lines = [warnings].filter(Boolean);
	lines.push(`Found ${entries.length} plugin(s):\n`);
	for (const entry of entries) {
		const tags = entry.tags?.length ? ` [${entry.tags.join(", ")}]` : "";
		const ver = entry.version ? ` v${entry.version}` : "";
		lines.push(`  ${entry.ref}${ver}${tags}`);
		lines.push(`    ${entry.description}`);
	}
	return ok(lines.join("\n"));
}

async function runInstall(args: string[], cwd: string): Promise<PluginSlashResult> {
	const ref = args[0] ?? "";
	if (!ref || !ref.includes("/")) {
		return err('Specify a plugin as "owner/name". Example: /plugin install cave-community/git-tools');
	}

	const marketplaces = await fetchAllMarketplaces({ cwd });
	let entry = findEntryByRef(marketplaces, ref);

	if (!entry) {
		entry = {
			ref,
			name: ref.split("/")[1] ?? ref,
			description: "(direct install)",
		} satisfies MarketplaceEntry;
	}

	const installed = readInstalledRegistry();
	const plan = buildInstallPlan(entry, installed);
	const result = await installPlugin(plan);

	if (!result.success) {
		return err(`Install failed for ${ref}:\n${result.errors.map((e) => `  ${e}`).join("\n")}`);
	}

	const wiredList = Object.entries(result.wired)
		.filter(([, v]) => v)
		.map(([k]) => k)
		.join(", ");

	const lines = [`Installed ${result.ref} v${result.version}`, `  Path: ${result.installedPath}`];
	if (wiredList) lines.push(`  Capabilities: ${wiredList}`);
	return ok(lines.join("\n"));
}

function runList(): PluginSlashResult {
	const installed = readInstalledRegistry();
	if (installed.length === 0) {
		return ok("No plugins installed. Run: /plugin install <owner/name>");
	}
	const lines = [`Installed plugins (${installed.length}):\n`];
	for (const rec of installed) {
		const date = new Date(rec.installedAt).toLocaleDateString();
		lines.push(`  ${rec.ref} v${rec.version}  (installed ${date})`);
		lines.push(`    ${rec.path}`);
	}
	return ok(lines.join("\n"));
}

async function runUpgrade(cwd: string): Promise<PluginSlashResult> {
	const installed = readInstalledRegistry();
	if (installed.length === 0) return ok("No plugins installed.");

	const marketplaces = await fetchAllMarketplaces({ cwd });
	const allEntries = marketplaces.flatMap((m) => m.entries);
	const candidates = detectUpgrades(installed, allEntries);

	if (candidates.length === 0) return ok("All plugins are up to date.");

	const lines: string[] = [`${candidates.length} upgrade(s) available:\n`];
	for (const cand of candidates) {
		lines.push(`  ${cand.ref}: v${cand.currentVersion} → v${cand.availableVersion}`);
		const entry = findEntryByRef(marketplaces, cand.ref);
		if (!entry) {
			lines.push("    Skipped — no marketplace entry found");
			continue;
		}
		const plan = buildInstallPlan(entry, installed);
		const result = await installPlugin(plan);
		lines.push(result.success ? `    Upgraded to v${result.version}` : `    Failed: ${result.errors.join("; ")}`);
	}
	return ok(lines.join("\n"));
}

async function runMarketplace(args: string[], cwd: string): Promise<PluginSlashResult> {
	const sub = args[0];
	switch (sub) {
		case "add": {
			const url = args[1];
			if (!url) return err("Specify a URL: /plugin marketplace add <url>");
			const { added, path } = addRemoteMarketplace(url);
			return ok(added ? `Added remote marketplace: ${url}\n  Saved to: ${path}` : `Already registered: ${url}`);
		}
		case "list":
		case undefined: {
			const marketplaces = await fetchAllMarketplaces({ cwd, offline: true });
			const lines = ["Configured marketplace sources:\n"];
			for (const mp of marketplaces) {
				const indicator = mp.entries.length > 0 ? "✓" : "○";
				const errStr = mp.error ? ` (${mp.error})` : "";
				lines.push(`  ${indicator} [${mp.scope}] ${mp.origin}${errStr}`);
				lines.push(`     ${mp.entries.length} plugin(s) listed`);
			}
			return ok(lines.join("\n"));
		}
		default:
			return err(`Unknown marketplace subcommand: ${sub}. Available: add, list`);
	}
}

function runCreate(): PluginSlashResult {
	return ok(
		[
			"To scaffold a new plugin, invoke the plugin-creator skill:",
			"",
			'  Type "@plugin-creator" in a new conversation, or run:',
			"  cave --skill ~/.cave/skills/plugin-creator <your request>",
			"",
			"The skill will generate .cave-plugin/plugin.json and the directory",
			"structure for commands/, skills/, agents/, and hooks.",
		].join("\n"),
	);
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

/**
 * Handle a `/plugin ...` slash command invocation.
 * `line` is the full slash command text including the `/plugin` prefix.
 */
export async function runPluginSlashCommand(line: string, ctx: { cwd: string }): Promise<PluginSlashResult> {
	const { verb, args } = parsePluginSlash(line);

	switch (verb) {
		case "search":
			return runSearch(args, ctx.cwd);
		case "install":
		case "add":
			return runInstall(args, ctx.cwd);
		case "list":
		case "ls":
			return runList();
		case "upgrade":
		case "update":
			return runUpgrade(ctx.cwd);
		case "marketplace":
		case "market":
			return runMarketplace(args, ctx.cwd);
		case "create":
		case "scaffold":
			return runCreate();
		default:
			return ok(formatHelp());
	}
}

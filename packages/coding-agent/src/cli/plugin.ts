/**
 * WS13: `cave plugin <subcommand>` CLI handler.
 *
 * Subcommands:
 *   cave plugin search [query]              — search all marketplaces
 *   cave plugin install <owner/name>        — install a plugin
 *   cave plugin list                        — list installed plugins
 *   cave plugin upgrade                     — upgrade all installed plugins
 *   cave plugin marketplace add <url>       — register a remote marketplace
 *   cave plugin marketplace list            — list configured marketplaces
 *   cave plugin help                        — this help text
 */

import chalk from "chalk";
import { buildInstallPlan, detectUpgrades, installPlugin } from "../core/plugins/installer.js";
import {
	addRemoteMarketplace,
	fetchAllMarketplaces,
	findEntryByRef,
	type MarketplaceEntry,
	readInstalledRegistry,
	searchMarketplaces,
} from "../core/plugins/marketplace.js";

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp(): void {
	console.log(`cave plugin — Plugin Marketplace (WS13)

Usage:
  cave plugin search [query]           Search all marketplaces (empty = list all)
  cave plugin install <owner/name>     Download and install a plugin
  cave plugin list                     Show installed plugins
  cave plugin upgrade                  Re-check and upgrade installed plugins
  cave plugin marketplace add <url>    Register a remote marketplace URL
  cave plugin marketplace list         List configured marketplace sources
  cave plugin help                     Show this help

Marketplace scopes (resolution order):
  repo     .cave/plugins/marketplace.json   (project-local)
  personal ~/.cave/plugins/marketplace.json (user-global)
  remote   URLs registered via marketplace add

Plugin directory structure (.cave-plugin/plugin.json):
  commands/   — additional slash commands (markdown files)
  skills/     — additional skill directories
  agents/     — additional agent definitions
  themes/     — additional theme JSON files
  hooks       — hook entries in capabilities.hooks
  .mcp.json   — additional MCP server definitions

Scaffold a new plugin: /plugin create (interactive mode)
`);
}

// ---------------------------------------------------------------------------
// Subcommand: search
// ---------------------------------------------------------------------------

async function runSearch(query: string, cwd: string): Promise<number> {
	const marketplaces = await fetchAllMarketplaces({ cwd });
	const entries = searchMarketplaces(marketplaces, query);

	const sourceErrors = marketplaces.filter((m) => m.error);
	if (sourceErrors.length > 0) {
		for (const s of sourceErrors) {
			console.error(chalk.yellow(`Warning [${s.scope}] ${s.origin}: ${s.error}`));
		}
	}

	if (entries.length === 0) {
		const msg = query ? `No plugins found matching "${query}".` : "No plugins found in configured marketplaces.";
		console.log(msg);
		console.log("Add a marketplace: cave plugin marketplace add <url>");
		return 0;
	}

	console.log(chalk.bold(`Found ${entries.length} plugin(s):\n`));
	for (const entry of entries) {
		const tags = entry.tags?.length ? chalk.dim(` [${entry.tags.join(", ")}]`) : "";
		const ver = entry.version ? chalk.dim(` v${entry.version}`) : "";
		console.log(`  ${chalk.cyan(entry.ref)}${ver}${tags}`);
		console.log(`    ${entry.description}`);
	}
	return 0;
}

// ---------------------------------------------------------------------------
// Subcommand: install
// ---------------------------------------------------------------------------

async function runInstall(ref: string, cwd: string): Promise<number> {
	if (!ref || !ref.includes("/")) {
		console.error(chalk.red('Error: specify a plugin as "owner/name"'));
		return 1;
	}

	console.log(`Resolving ${chalk.cyan(ref)}...`);

	// Fetch marketplaces to find the entry (provides version + url)
	const marketplaces = await fetchAllMarketplaces({ cwd });
	let entry = findEntryByRef(marketplaces, ref);

	// If not in a marketplace, construct a minimal entry from the ref itself
	if (!entry) {
		const parts = ref.split("/");
		entry = {
			ref,
			name: parts[1] ?? ref,
			description: "(direct install — no marketplace entry found)",
		} satisfies MarketplaceEntry;
		console.log(chalk.yellow(`Warning: "${ref}" not found in any marketplace; attempting direct GitHub install.`));
	}

	const installed = readInstalledRegistry();
	const plan = buildInstallPlan(entry, installed);

	if (plan.isUpgrade) {
		console.log(`Upgrading from v${plan.currentVersion}...`);
	} else {
		console.log(`Installing into ${plan.targetDir}...`);
	}

	const result = await installPlugin(plan);

	if (!result.success) {
		for (const e of result.errors) {
			console.error(chalk.red(`Error: ${e}`));
		}
		return 1;
	}

	const wiredList = Object.entries(result.wired)
		.filter(([, v]) => v)
		.map(([k]) => k)
		.join(", ");

	console.log(chalk.green(`Installed ${result.ref} v${result.version}`));
	console.log(`  Path: ${result.installedPath}`);
	if (wiredList) console.log(`  Capabilities: ${wiredList}`);
	return 0;
}

// ---------------------------------------------------------------------------
// Subcommand: list
// ---------------------------------------------------------------------------

function runList(): number {
	const installed = readInstalledRegistry();
	if (installed.length === 0) {
		console.log("No plugins installed. Run: cave plugin install <owner/name>");
		return 0;
	}
	console.log(chalk.bold(`Installed plugins (${installed.length}):\n`));
	for (const rec of installed) {
		const date = new Date(rec.installedAt).toLocaleDateString();
		console.log(`  ${chalk.cyan(rec.ref)} v${rec.version}  (installed ${date})`);
		console.log(`    ${rec.path}`);
	}
	return 0;
}

// ---------------------------------------------------------------------------
// Subcommand: upgrade
// ---------------------------------------------------------------------------

async function runUpgrade(cwd: string): Promise<number> {
	const installed = readInstalledRegistry();
	if (installed.length === 0) {
		console.log("No plugins installed.");
		return 0;
	}

	console.log("Checking for updates...");
	const marketplaces = await fetchAllMarketplaces({ cwd });
	const allEntries = marketplaces.flatMap((m) => m.entries);
	const candidates = detectUpgrades(installed, allEntries);

	if (candidates.length === 0) {
		console.log("All plugins are up to date.");
		return 0;
	}

	console.log(chalk.bold(`${candidates.length} upgrade(s) available:\n`));
	let hasError = false;

	for (const cand of candidates) {
		console.log(`  ${chalk.cyan(cand.ref)}: v${cand.currentVersion} → v${cand.availableVersion}`);
		const entry = findEntryByRef(marketplaces, cand.ref);
		if (!entry) {
			console.error(chalk.yellow(`  Skipping — no marketplace entry found`));
			continue;
		}

		const plan = buildInstallPlan(entry, installed);
		const result = await installPlugin(plan);
		if (result.success) {
			console.log(chalk.green(`  Upgraded to v${result.version}`));
		} else {
			console.error(chalk.red(`  Failed: ${result.errors.join("; ")}`));
			hasError = true;
		}
	}

	return hasError ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Subcommand: marketplace
// ---------------------------------------------------------------------------

async function runMarketplace(args: string[], cwd: string): Promise<number> {
	const sub = args[0];
	switch (sub) {
		case "add": {
			const url = args[1];
			if (!url) {
				console.error(chalk.red("Error: specify a URL: cave plugin marketplace add <url>"));
				return 1;
			}
			const { added, path } = addRemoteMarketplace(url);
			if (added) {
				console.log(chalk.green(`Added remote marketplace: ${url}`));
				console.log(`  Saved to: ${path}`);
			} else {
				console.log(`Remote marketplace already registered: ${url}`);
			}
			return 0;
		}
		case "list":
		case undefined: {
			const marketplaces = await fetchAllMarketplaces({ cwd, offline: true });
			console.log(chalk.bold("Configured marketplace sources:\n"));
			for (const mp of marketplaces) {
				const indicator = mp.entries.length > 0 ? chalk.green("✓") : chalk.dim("○");
				const errStr = mp.error ? chalk.red(` (${mp.error})`) : "";
				console.log(`  ${indicator} [${mp.scope}] ${mp.origin}${errStr}`);
				console.log(`     ${mp.entries.length} plugin(s) listed`);
			}
			return 0;
		}
		default:
			console.error(chalk.red(`Unknown marketplace subcommand: ${sub}`));
			console.error("Available: add, list");
			return 1;
	}
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

/**
 * Entry point for `cave plugin <args>`.
 * Returns true when the "plugin" subcommand was handled (even if it errored),
 * false when the first arg is not "plugin".
 */
export async function handlePluginCommand(args: string[]): Promise<boolean> {
	if (args.length === 0 || args[0] !== "plugin") return false;

	const sub = args[1];
	const rest = args.slice(2);
	const cwd = process.cwd();

	try {
		let exit = 0;
		switch (sub) {
			case "search":
				exit = await runSearch(rest.join(" "), cwd);
				break;
			case "install":
			case "add":
				exit = await runInstall(rest[0] ?? "", cwd);
				break;
			case "list":
			case "ls":
				exit = runList();
				break;
			case "upgrade":
			case "update":
				exit = await runUpgrade(cwd);
				break;
			case "marketplace":
			case "market":
				exit = await runMarketplace(rest, cwd);
				break;
			case "help":
			case "--help":
			case "-h":
			case undefined:
				printHelp();
				break;
			default:
				console.error(chalk.red(`Unknown plugin subcommand: ${sub}`));
				printHelp();
				exit = 1;
		}
		if (exit !== 0) process.exitCode = exit;
	} catch (err) {
		console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
		process.exitCode = 1;
	}

	return true;
}

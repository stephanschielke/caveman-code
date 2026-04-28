/**
 * WS13: Plugin marketplace — fetch, cache, and search plugin listings.
 *
 * Three marketplace scopes (resolved in order):
 *   1. repo   — .cave/plugins/marketplace.json   (project-local)
 *   2. personal — ~/.cave/plugins/marketplace.json (user-global)
 *   3. remote — arbitrary URL list stored in personal marketplace config
 *
 * Marketplace JSON format:
 * {
 *   "plugins": [
 *     {
 *       "ref": "user/plugin-name",        // GitHub-style owner/repo
 *       "name": "plugin-name",            // display name
 *       "description": "...",
 *       "tags": ["productivity", "git"],
 *       "version": "1.2.0",              // latest version in marketplace
 *       "url": "https://..."             // optional direct download URL
 *     }
 *   ],
 *   "remotes": ["https://example.com/cave-plugins.json"]  // chained remotes
 * }
 *
 * Cache lives alongside the marketplace file as <filename>.cache.json with a
 * 24-hour TTL. Remote marketplaces are cached in ~/.cave/plugins/cache/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME } from "../../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single marketplace entry (a plugin advertised in a marketplace). */
export interface MarketplaceEntry {
	/** GitHub-style "owner/repo" reference. */
	ref: string;
	/** Short plugin name (kebab-case). */
	name: string;
	/** Short description. */
	description: string;
	/** Search tags. */
	tags?: string[];
	/** Advertised latest version. */
	version?: string;
	/** Direct download or manifest URL override. */
	url?: string;
}

/** Shape of a marketplace JSON file on disk or at a remote URL. */
export interface MarketplaceFile {
	plugins: MarketplaceEntry[];
	/** Additional remote URLs to fetch and merge. */
	remotes?: string[];
}

/** A marketplace source with its resolved entries. */
export interface ResolvedMarketplace {
	scope: "repo" | "personal" | "remote";
	/** Filesystem path (if local) or URL (if remote). */
	origin: string;
	entries: MarketplaceEntry[];
	error?: string;
}

/** Options for fetching marketplaces. */
export interface MarketplaceFetchOptions {
	/** Project working directory (for repo-scope discovery). */
	cwd: string;
	/** Skip remote HTTP fetches (e.g. --offline). */
	offline?: boolean;
	/** Maximum age of cached remote responses in milliseconds. Defaults to 24h. */
	cacheTtlMs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLUGINS_SUBDIR = "plugins";
const MARKETPLACE_FILENAME = "marketplace.json";
const CACHE_SUFFIX = ".cache.json";
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** ~/.cave/plugins/marketplace.json */
export function personalMarketplacePath(): string {
	return join(homedir(), CONFIG_DIR_NAME, PLUGINS_SUBDIR, MARKETPLACE_FILENAME);
}

/** <cwd>/.cave/plugins/marketplace.json */
export function repoMarketplacePath(cwd: string): string {
	return join(cwd, `.${CONFIG_DIR_NAME.replace(/^\./, "")}`, PLUGINS_SUBDIR, MARKETPLACE_FILENAME);
}

/** Installed plugin root: ~/.cave/plugins/<owner>/<name>/ */
export function installedPluginDir(owner: string, name: string): string {
	return join(homedir(), CONFIG_DIR_NAME, PLUGINS_SUBDIR, owner, name);
}

/** Cache directory for remote marketplace responses. */
function remoteCacheDir(): string {
	return join(homedir(), CONFIG_DIR_NAME, PLUGINS_SUBDIR, "cache");
}

// ---------------------------------------------------------------------------
// Local file helpers
// ---------------------------------------------------------------------------

function readMarketplaceFile(path: string): MarketplaceFile | null {
	if (!existsSync(path)) return null;
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<MarketplaceFile>;
		return {
			plugins: Array.isArray(raw.plugins) ? (raw.plugins as MarketplaceEntry[]) : [],
			remotes: Array.isArray(raw.remotes) ? (raw.remotes as string[]) : [],
		};
	} catch {
		return null;
	}
}

function writeMarketplaceFile(path: string, data: MarketplaceFile): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Remote fetch + cache
// ---------------------------------------------------------------------------

function cachePathForUrl(url: string): string {
	const safe = url.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 180);
	return join(remoteCacheDir(), `${safe}${CACHE_SUFFIX}`);
}

interface CacheEntry {
	fetchedAt: number;
	data: MarketplaceFile;
}

function readCache(cachePath: string, ttlMs: number): MarketplaceFile | null {
	if (!existsSync(cachePath)) return null;
	try {
		const entry = JSON.parse(readFileSync(cachePath, "utf8")) as CacheEntry;
		if (Date.now() - entry.fetchedAt > ttlMs) return null; // expired
		return entry.data;
	} catch {
		return null;
	}
}

function writeCache(cachePath: string, data: MarketplaceFile): void {
	const dir = dirname(cachePath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const entry: CacheEntry = { fetchedAt: Date.now(), data };
	writeFileSync(cachePath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

async function fetchRemoteMarketplace(
	url: string,
	cacheTtlMs: number,
): Promise<{ data: MarketplaceFile | null; error?: string }> {
	const cachePath = cachePathForUrl(url);
	const cached = readCache(cachePath, cacheTtlMs);
	if (cached) return { data: cached };

	try {
		const res = await fetch(url, {
			headers: { Accept: "application/json", "User-Agent": "cave-cli/plugin-marketplace" },
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) {
			return { data: null, error: `HTTP ${res.status} from ${url}` };
		}
		const raw = (await res.json()) as Partial<MarketplaceFile>;
		const data: MarketplaceFile = {
			plugins: Array.isArray(raw.plugins) ? (raw.plugins as MarketplaceEntry[]) : [],
			remotes: Array.isArray(raw.remotes) ? (raw.remotes as string[]) : [],
		};
		writeCache(cachePath, data);
		return { data };
	} catch (e) {
		return {
			data: null,
			error: `fetch failed: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch and merge all marketplace scopes (repo, personal, remote).
 * Remote URLs are fetched from the `remotes` list in the personal marketplace.
 */
export async function fetchAllMarketplaces(opts: MarketplaceFetchOptions): Promise<ResolvedMarketplace[]> {
	const ttl = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
	const results: ResolvedMarketplace[] = [];

	// 1. Repo scope
	const repoPath = repoMarketplacePath(opts.cwd);
	const repoFile = readMarketplaceFile(repoPath);
	results.push({
		scope: "repo",
		origin: repoPath,
		entries: repoFile?.plugins ?? [],
		error: repoFile === null && existsSync(repoPath) ? "failed to parse repo marketplace" : undefined,
	});

	// 2. Personal scope
	const personalPath = personalMarketplacePath();
	const personalFile = readMarketplaceFile(personalPath);
	results.push({
		scope: "personal",
		origin: personalPath,
		entries: personalFile?.plugins ?? [],
		error: personalFile === null && existsSync(personalPath) ? "failed to parse personal marketplace" : undefined,
	});

	// 3. Remote scopes (from personal remotes list)
	if (!opts.offline) {
		const remotes = personalFile?.remotes ?? [];
		for (const url of remotes) {
			const { data, error } = await fetchRemoteMarketplace(url, ttl);
			results.push({
				scope: "remote",
				origin: url,
				entries: data?.plugins ?? [],
				error,
			});
		}
	}

	return results;
}

/**
 * Search across all marketplaces for plugins matching a query string.
 * Matches against name, description, and tags (case-insensitive).
 */
export function searchMarketplaces(marketplaces: ResolvedMarketplace[], query: string): MarketplaceEntry[] {
	const q = query.toLowerCase().trim();
	const seen = new Set<string>();
	const matches: MarketplaceEntry[] = [];

	for (const mp of marketplaces) {
		for (const entry of mp.entries) {
			if (seen.has(entry.ref)) continue;
			seen.add(entry.ref);

			if (!q) {
				matches.push(entry);
				continue;
			}

			const haystack = [entry.name, entry.description, entry.ref, ...(entry.tags ?? [])].join(" ").toLowerCase();

			if (haystack.includes(q)) {
				matches.push(entry);
			}
		}
	}

	return matches;
}

/**
 * Append a remote URL to the personal marketplace and persist.
 * No-ops if the URL is already registered.
 */
export function addRemoteMarketplace(url: string): { added: boolean; path: string } {
	const path = personalMarketplacePath();
	const existing = readMarketplaceFile(path) ?? { plugins: [], remotes: [] };
	const remotes = existing.remotes ?? [];

	if (remotes.includes(url)) {
		return { added: false, path };
	}

	remotes.push(url);
	writeMarketplaceFile(path, { plugins: existing.plugins, remotes });
	return { added: true, path };
}

/**
 * Find the marketplace entry for a plugin ref ("owner/name") across all resolved
 * marketplaces. Returns the first match found.
 */
export function findEntryByRef(marketplaces: ResolvedMarketplace[], ref: string): MarketplaceEntry | undefined {
	for (const mp of marketplaces) {
		const found = mp.entries.find((e) => e.ref === ref);
		if (found) return found;
	}
	return undefined;
}

/**
 * List all installed plugins. Reads the installed-plugins registry from
 * ~/.cave/plugins/installed.json.
 */
export interface InstalledPluginRecord {
	ref: string;
	name: string;
	version: string;
	installedAt: string;
	path: string;
}

const INSTALLED_REGISTRY_PATH = join(homedir(), CONFIG_DIR_NAME, PLUGINS_SUBDIR, "installed.json");

export function readInstalledRegistry(): InstalledPluginRecord[] {
	if (!existsSync(INSTALLED_REGISTRY_PATH)) return [];
	try {
		const raw = JSON.parse(readFileSync(INSTALLED_REGISTRY_PATH, "utf8"));
		return Array.isArray(raw) ? (raw as InstalledPluginRecord[]) : [];
	} catch {
		return [];
	}
}

export function writeInstalledRegistry(records: InstalledPluginRecord[]): void {
	const dir = dirname(INSTALLED_REGISTRY_PATH);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(INSTALLED_REGISTRY_PATH, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

export function upsertInstalledRecord(record: InstalledPluginRecord): void {
	const existing = readInstalledRegistry().filter((r) => r.ref !== record.ref);
	writeInstalledRegistry([...existing, record]);
}

export function removeInstalledRecord(ref: string): void {
	const existing = readInstalledRegistry().filter((r) => r.ref !== ref);
	writeInstalledRegistry(existing);
}

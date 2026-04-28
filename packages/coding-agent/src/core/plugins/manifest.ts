/**
 * WS13: Plugin manifest schema and validator.
 *
 * The manifest lives at `.cave-plugin/plugin.json` inside a plugin repository.
 * It declares the plugin's identity, version, capabilities, and optional
 * sub-directories for commands/, skills/, agents/, hooks/, and .mcp.json.
 *
 * Schema is deliberately minimal and forward-compatible — unknown keys are
 * preserved but not acted upon (safe to ignore).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A semantic-version string: "<major>.<minor>.<patch>" */
export type SemVer = string;

/** GitHub-style reference: "<owner>/<repo>[@<ref>]" */
export type PluginRef = string;

/** A single hook entry (mirrors the hooks config shape). */
export interface PluginHookEntry {
	/** Lifecycle event name (e.g. "PreToolUse", "PostToolUse"). */
	event: string;
	/** Shell command to execute (run from the plugin root). */
	command: string;
	/** Optional glob matcher for the tool name. */
	matcher?: string;
}

/** What a plugin bundle may contain. */
export interface PluginCapabilities {
	/** Sub-directory containing markdown command files (e.g. commands/). */
	commands?: boolean;
	/** Sub-directory containing skill directories (e.g. skills/). */
	skills?: boolean;
	/** Sub-directory containing agent markdown files (e.g. agents/). */
	agents?: boolean;
	/** Hooks entries to register (mirrors hooks config schema). */
	hooks?: PluginHookEntry[];
	/** Whether the plugin ships a .mcp.json file. */
	mcp?: boolean;
	/** Whether the plugin ships a themes/ directory. */
	themes?: boolean;
}

/** Full plugin manifest (`.cave-plugin/plugin.json`). */
export interface PluginManifest {
	/** Unique plugin name (kebab-case, no slashes). */
	name: string;
	/** Semantic version string. */
	version: SemVer;
	/** Short human-readable description. */
	description: string;
	/** Author display name or GitHub handle. */
	author?: string;
	/** License identifier (e.g. "MIT"). */
	license?: string;
	/** Homepage or repository URL. */
	homepage?: string;
	/** Minimum cave version required (semver range). */
	caveVersion?: string;
	/** Plugin capabilities / what it ships. */
	capabilities?: PluginCapabilities;
	/** Plugin display tags for marketplace search. */
	tags?: string[];
	/** Canonical source (resolved during install; may differ from marketplace entry). */
	source?: string;
}

/** Result of manifest validation. */
export interface ManifestValidationResult {
	valid: boolean;
	manifest: PluginManifest | null;
	errors: string[];
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+].+)?$/;
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isString(v: unknown): v is string {
	return typeof v === "string";
}

function isObject(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a raw JSON object as a `PluginManifest`.
 * Returns all validation errors found (not just the first).
 */
export function validateManifest(raw: unknown): ManifestValidationResult {
	const errors: string[] = [];

	if (!isObject(raw)) {
		return {
			valid: false,
			manifest: null,
			errors: ["manifest must be a JSON object"],
		};
	}

	// Required: name
	if (!isString(raw.name) || raw.name.trim() === "") {
		errors.push("manifest.name is required and must be a non-empty string");
	} else if (!NAME_RE.test(raw.name)) {
		errors.push(`manifest.name "${raw.name}" must be kebab-case (a-z0-9 and hyphens)`);
	}

	// Required: version
	if (!isString(raw.version) || raw.version.trim() === "") {
		errors.push("manifest.version is required and must be a non-empty string");
	} else if (!SEMVER_RE.test(raw.version)) {
		errors.push(`manifest.version "${raw.version}" must be a semver string (e.g. "1.0.0")`);
	}

	// Required: description
	if (!isString(raw.description) || raw.description.trim() === "") {
		errors.push("manifest.description is required and must be a non-empty string");
	}

	// Optional: author
	if (raw.author !== undefined && !isString(raw.author)) {
		errors.push("manifest.author must be a string");
	}

	// Optional: license
	if (raw.license !== undefined && !isString(raw.license)) {
		errors.push("manifest.license must be a string");
	}

	// Optional: homepage
	if (raw.homepage !== undefined && !isString(raw.homepage)) {
		errors.push("manifest.homepage must be a string");
	}

	// Optional: caveVersion
	if (raw.caveVersion !== undefined && !isString(raw.caveVersion)) {
		errors.push("manifest.caveVersion must be a string");
	}

	// Optional: tags
	if (raw.tags !== undefined) {
		if (!Array.isArray(raw.tags) || !raw.tags.every(isString)) {
			errors.push("manifest.tags must be an array of strings");
		}
	}

	// Optional: capabilities
	if (raw.capabilities !== undefined) {
		if (!isObject(raw.capabilities)) {
			errors.push("manifest.capabilities must be an object");
		} else {
			const caps = raw.capabilities;
			for (const boolKey of ["commands", "skills", "agents", "mcp", "themes"] as const) {
				if (caps[boolKey] !== undefined && typeof caps[boolKey] !== "boolean") {
					errors.push(`manifest.capabilities.${boolKey} must be a boolean`);
				}
			}
			if (caps.hooks !== undefined) {
				if (!Array.isArray(caps.hooks)) {
					errors.push("manifest.capabilities.hooks must be an array");
				} else {
					for (let i = 0; i < caps.hooks.length; i++) {
						const h = caps.hooks[i];
						if (!isObject(h)) {
							errors.push(`manifest.capabilities.hooks[${i}] must be an object`);
						} else {
							if (!isString(h.event) || h.event.trim() === "") {
								errors.push(`manifest.capabilities.hooks[${i}].event is required`);
							}
							if (!isString(h.command) || h.command.trim() === "") {
								errors.push(`manifest.capabilities.hooks[${i}].command is required`);
							}
						}
					}
				}
			}
		}
	}

	if (errors.length > 0) {
		return { valid: false, manifest: null, errors };
	}

	// Build typed manifest — preserve unknown keys via cast
	const manifest: PluginManifest = {
		name: (raw.name as string).trim(),
		version: (raw.version as string).trim(),
		description: (raw.description as string).trim(),
	};
	if (isString(raw.author)) manifest.author = raw.author;
	if (isString(raw.license)) manifest.license = raw.license;
	if (isString(raw.homepage)) manifest.homepage = raw.homepage;
	if (isString(raw.caveVersion)) manifest.caveVersion = raw.caveVersion;
	if (isString(raw.source)) manifest.source = raw.source;
	if (Array.isArray(raw.tags)) manifest.tags = raw.tags as string[];
	if (isObject(raw.capabilities)) {
		manifest.capabilities = raw.capabilities as PluginCapabilities;
	}

	return { valid: true, manifest, errors: [] };
}

/**
 * Parse and validate a plugin manifest from a JSON string.
 */
export function parseManifest(json: string): ManifestValidationResult {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch (e) {
		return {
			valid: false,
			manifest: null,
			errors: [`JSON parse error: ${e instanceof Error ? e.message : String(e)}`],
		};
	}
	return validateManifest(raw);
}

/**
 * Compare two semver strings. Returns negative if a < b, 0 if equal, positive if a > b.
 * Simple integer comparison — no pre-release tag ordering.
 */
export function compareSemVer(a: SemVer, b: SemVer): number {
	const parse = (s: SemVer): [number, number, number] => {
		const base = s.split(/[-+]/)[0];
		const parts = base.split(".").map(Number);
		return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
	};
	const [aMaj, aMin, aPat] = parse(a);
	const [bMaj, bMin, bPat] = parse(b);
	if (aMaj !== bMaj) return aMaj - bMaj;
	if (aMin !== bMin) return aMin - bMin;
	return aPat - bPat;
}

/**
 * Returns true when `candidate` is strictly newer than `installed`.
 */
export function isNewerVersion(candidate: SemVer, installed: SemVer): boolean {
	return compareSemVer(candidate, installed) > 0;
}

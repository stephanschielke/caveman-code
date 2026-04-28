/**
 * Ablation matrix — 4 live configs + 4 replay ablations.
 *
 * Lives in one place so live-runner, replay-runner, reporter, and preflight
 * all agree on the exact grid being published. Edits here must match
 * manifest.json; preflight will refuse to publish if they diverge.
 */

import type { CaveModeSettings, Settings } from "../../src/core/settings-manager.js";

export type LiveConfigId = "A-baseline" | "D-output-only" | "F-cave-full" | "G-cave-ultra";

export type ReplayConfigId = "replay-no-flint" | "replay-no-stone" | "replay-no-dedup" | "replay-no-compaction";

export type ConfigId = LiveConfigId | ReplayConfigId;

export interface LiveConfig {
	id: LiveConfigId;
	mode: "live";
	settings: Pick<Settings, "caveMode">;
	purpose: string;
}

export type ReplayLayer = "flint" | "stone" | "dedup" | "compaction";

export interface ReplayConfig {
	id: ReplayConfigId;
	mode: "replay";
	disables: ReplayLayer[];
	base: CaveModeSettings;
	purpose: string;
}

const F_CAVE_FULL_CAVE_MODE: CaveModeSettings = {
	enabled: true,
	intensity: "full",
	toolCompression: true,
	mlCompression: false,
};

export const LIVE_CONFIGS: readonly LiveConfig[] = [
	{
		id: "A-baseline",
		mode: "live",
		settings: {
			caveMode: {
				enabled: false,
				toolCompression: false,
				mlCompression: false,
			},
		},
		purpose: "Absolute floor — all compression disabled.",
	},
	{
		id: "D-output-only",
		mode: "live",
		settings: {
			caveMode: {
				enabled: true,
				intensity: "full",
				toolCompression: false,
				mlCompression: false,
			},
		},
		purpose: "Isolates the caveman generation-style prompt injection.",
	},
	{
		id: "F-cave-full",
		mode: "live",
		settings: { caveMode: F_CAVE_FULL_CAVE_MODE },
		purpose: "Published default — output mode + full tool compression.",
	},
	{
		id: "G-cave-ultra",
		mode: "live",
		settings: {
			caveMode: {
				enabled: true,
				intensity: "ultra",
				toolCompression: true,
				mlCompression: true,
			},
		},
		purpose: "Ceiling — everything on, including LLMLingua ML compression.",
	},
] as const;

export const REPLAY_CONFIGS: readonly ReplayConfig[] = [
	{
		id: "replay-no-flint",
		mode: "replay",
		disables: ["flint"],
		base: F_CAVE_FULL_CAVE_MODE,
		purpose: "vs F-cave-full — isolates Flint Chipper per-tool line budget.",
	},
	{
		id: "replay-no-stone",
		mode: "replay",
		disables: ["stone"],
		base: F_CAVE_FULL_CAVE_MODE,
		purpose: "vs F-cave-full — isolates Stone Tablet JSON/XML compression.",
	},
	{
		id: "replay-no-dedup",
		mode: "replay",
		disables: ["dedup"],
		base: F_CAVE_FULL_CAVE_MODE,
		purpose: "vs F-cave-full — isolates read-deduplication cache.",
	},
	{
		id: "replay-no-compaction",
		mode: "replay",
		disables: ["compaction"],
		base: F_CAVE_FULL_CAVE_MODE,
		purpose: "vs F-cave-full — isolates history-compaction savings.",
	},
] as const;

export const ALL_CONFIGS: readonly (LiveConfig | ReplayConfig)[] = [...LIVE_CONFIGS, ...REPLAY_CONFIGS];

export function getLiveConfig(id: LiveConfigId): LiveConfig {
	const c = LIVE_CONFIGS.find((x) => x.id === id);
	if (!c) throw new Error(`Unknown live config: ${id}`);
	return c;
}

export function getReplayConfig(id: ReplayConfigId): ReplayConfig {
	const c = REPLAY_CONFIGS.find((x) => x.id === id);
	if (!c) throw new Error(`Unknown replay config: ${id}`);
	return c;
}

/**
 * Serialize a live config into the JSON content that would be written to
 * <agentDir>/settings.json to drive `cave` under that ablation.
 *
 * The benchmark writes this to a temp dir and sets CAVE_CODING_AGENT_DIR
 * so the cave binary loads it as global settings.
 */
export function renderSettingsJson(config: LiveConfig): string {
	return `${JSON.stringify(config.settings, null, 2)}\n`;
}

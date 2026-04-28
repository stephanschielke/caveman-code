import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	ALL_CONFIGS,
	getLiveConfig,
	getReplayConfig,
	LIVE_CONFIGS,
	REPLAY_CONFIGS,
	renderSettingsJson,
} from "./ablation-matrix.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "manifest.json"), "utf-8")) as {
	liveConfigs: Array<{ id: string; settings: { caveMode: unknown } }>;
	replayConfigs: Array<{ id: string }>;
};

describe("ablation-matrix", () => {
	it("exposes exactly 4 live configs and 4 replay configs", () => {
		expect(LIVE_CONFIGS).toHaveLength(4);
		expect(REPLAY_CONFIGS).toHaveLength(4);
		expect(ALL_CONFIGS).toHaveLength(8);
	});

	it("every live config has a caveMode block", () => {
		for (const c of LIVE_CONFIGS) {
			expect(c.settings.caveMode).toBeDefined();
		}
	});

	it("A-baseline has everything disabled", () => {
		const a = getLiveConfig("A-baseline");
		expect(a.settings.caveMode?.enabled).toBe(false);
		expect(a.settings.caveMode?.toolCompression).toBe(false);
		expect(a.settings.caveMode?.mlCompression).toBe(false);
	});

	it("F-cave-full is the published default (full intensity, tool compression on, ML off)", () => {
		const f = getLiveConfig("F-cave-full");
		expect(f.settings.caveMode?.enabled).toBe(true);
		expect(f.settings.caveMode?.intensity).toBe("full");
		expect(f.settings.caveMode?.toolCompression).toBe(true);
		expect(f.settings.caveMode?.mlCompression).toBe(false);
	});

	it("G-cave-ultra has ML compression enabled", () => {
		const g = getLiveConfig("G-cave-ultra");
		expect(g.settings.caveMode?.intensity).toBe("ultra");
		expect(g.settings.caveMode?.mlCompression).toBe(true);
	});

	it("every replay config disables exactly one layer", () => {
		for (const c of REPLAY_CONFIGS) {
			expect(c.disables).toHaveLength(1);
		}
		const layers = new Set(REPLAY_CONFIGS.flatMap((c) => c.disables));
		expect(layers).toEqual(new Set(["flint", "stone", "dedup", "compaction"]));
	});

	it("replay configs all share the F-cave-full base caveMode", () => {
		for (const c of REPLAY_CONFIGS) {
			expect(c.base.enabled).toBe(true);
			expect(c.base.intensity).toBe("full");
			expect(c.base.toolCompression).toBe(true);
			expect(c.base.mlCompression).toBe(false);
		}
	});

	it("renderSettingsJson produces valid parseable JSON", () => {
		for (const c of LIVE_CONFIGS) {
			const json = renderSettingsJson(c);
			expect(() => JSON.parse(json)).not.toThrow();
			const parsed = JSON.parse(json);
			expect(parsed.caveMode).toEqual(c.settings.caveMode);
		}
	});

	it("matches the manifest.json config list (no drift)", () => {
		const manifestLiveIds = manifest.liveConfigs.map((c) => c.id).sort();
		const codeLiveIds = LIVE_CONFIGS.map((c) => c.id).sort();
		expect(codeLiveIds).toEqual(manifestLiveIds);

		const manifestReplayIds = manifest.replayConfigs.map((c) => c.id).sort();
		const codeReplayIds = REPLAY_CONFIGS.map((c) => c.id).sort();
		expect(codeReplayIds).toEqual(manifestReplayIds);

		for (const m of manifest.liveConfigs) {
			const c = getLiveConfig(m.id as never);
			expect(c.settings.caveMode).toEqual(m.settings.caveMode);
		}
	});

	it("rejects unknown config ids", () => {
		expect(() => getLiveConfig("nope" as never)).toThrow();
		expect(() => getReplayConfig("nope" as never)).toThrow();
	});
});

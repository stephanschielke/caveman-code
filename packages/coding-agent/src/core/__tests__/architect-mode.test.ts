// WS8: architect chat-mode tests.

import { describe, expect, it } from "vitest";
import {
	ArchitectModeRouter,
	buildArchitectProfile,
	defaultArchitectState,
	toggleArchitectMode,
} from "../chat-modes/architect.js";
import { runArchitectCommand } from "../slash-commands/architect.js";

describe("toggleArchitectMode", () => {
	it("starts disabled by default", () => {
		expect(defaultArchitectState().enabled).toBe(false);
	});

	it("turns on", () => {
		const r = toggleArchitectMode(defaultArchitectState(), "on");
		expect(r.state.enabled).toBe(true);
		expect(r.message).toContain("ON");
	});

	it("turns off", () => {
		const start = toggleArchitectMode(defaultArchitectState(), "on").state;
		const r = toggleArchitectMode(start, "off");
		expect(r.state.enabled).toBe(false);
	});

	it("toggle flips state", () => {
		const a = toggleArchitectMode(defaultArchitectState(), "toggle").state;
		const b = toggleArchitectMode(a, "toggle").state;
		expect(a.enabled).toBe(true);
		expect(b.enabled).toBe(false);
	});

	it("status does not change state", () => {
		const start = defaultArchitectState();
		const r = toggleArchitectMode(start, "status");
		expect(r.state.enabled).toBe(start.enabled);
		expect(r.message).toContain("OFF");
	});
});

describe("buildArchitectProfile", () => {
	it("uses the base profile's plan and cheap-edit by default", () => {
		const p = buildArchitectProfile({});
		// plan from default profile
		expect(p.roles.plan.model).toMatch(/opus|sonnet|haiku/);
		// edit should come from cheapTier of default
		expect(p.roles.edit.model).toMatch(/haiku|sonnet/);
		expect(p.roles.plan.retention).toBe("long");
		expect(p.roles.edit.retention).toBe("short");
	});

	it("respects explicit architect/editor model overrides", () => {
		const p = buildArchitectProfile({
			architectModel: "custom-architect",
			editorModel: "custom-editor",
		});
		expect(p.roles.plan.model).toBe("custom-architect");
		expect(p.roles.edit.model).toBe("custom-editor");
	});
});

describe("ArchitectModeRouter", () => {
	it("routes plan to architect model", () => {
		const r = new ArchitectModeRouter({
			architectModel: "test-arch",
			editorModel: "test-edit",
		});
		expect(r.route({ role: "plan" }).model).toBe("test-arch");
		expect(r.route({ role: "edit" }).model).toBe("test-edit");
	});

	it("downgrades edit role at 90% session cap", () => {
		const r = new ArchitectModeRouter({
			architectModel: "arch",
			editorModel: "edit",
		});
		// Default cheap tier for edit is claude-haiku-4-5 (from DEFAULT_PROFILE).
		const decision = r.route({
			role: "edit",
			sessionCostDollars: 9.5,
			sessionCapDollars: 10,
		});
		expect(decision.profile).toBe("architect:downgrade");
	});

	it("plan role is never downgraded", () => {
		const r = new ArchitectModeRouter({ architectModel: "arch", editorModel: "edit" });
		const decision = r.route({
			role: "plan",
			sessionCostDollars: 9.5,
			sessionCapDollars: 10,
		});
		expect(decision.profile).toBe("architect");
		expect(decision.model).toBe("arch");
	});
});

describe("runArchitectCommand", () => {
	it("toggles on", async () => {
		const r = await runArchitectCommand("on");
		expect(r.exitCode).toBe(0);
		expect(r.state.enabled).toBe(true);
	});

	it("toggles off", async () => {
		const start = await runArchitectCommand("on");
		const r = await runArchitectCommand("off", { state: start.state });
		expect(r.state.enabled).toBe(false);
	});

	it("set editorFormat=editor-whole", async () => {
		const r = await runArchitectCommand("set editorFormat=editor-whole");
		expect(r.exitCode).toBe(0);
		expect(r.state.config.editorFormat).toBe("editor-whole");
	});

	it("set editorFormat with invalid value rejects", async () => {
		const r = await runArchitectCommand("set editorFormat=garbage");
		expect(r.exitCode).toBe(1);
		expect(r.output).toContain("invalid editorFormat");
	});

	it("help text mentions architect/editor split", async () => {
		const r = await runArchitectCommand("help");
		expect(r.output).toContain("architect/editor");
	});
});

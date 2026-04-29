import { Container, getKeybindings, type OverlayHandle, Spacer, Text, type TUI } from "@cave/tui";
import type { PromptVerb } from "@cave/agent";
import type { PromptOptions, PromptUI } from "../../../core/permission-prompt.js";
import { theme } from "../theme/theme.js";

const VERBS: ReadonlyArray<{ verb: PromptVerb; label: string; key: string }> = [
	{ verb: "allow_once", label: "Allow once", key: "1" },
	{ verb: "allow_session", label: "Allow this session", key: "2" },
	{ verb: "allow_always", label: "Allow always", key: "3" },
	{ verb: "deny", label: "Deny", key: "4" },
];

const PREVIEW_MAX_LINES = 10;

export interface ApprovalPromptInternalOptions {
	summary: string;
	commandPreview?: string;
	reason?: string;
	danger?: boolean;
	defaultVerb: PromptVerb;
	onChoose: (verb: PromptVerb) => void;
}

export class ApprovalPromptComponent extends Container {
	private selectedIndex: number;
	private listContainer: Container;

	constructor(private readonly opts: ApprovalPromptInternalOptions) {
		super();
		this.selectedIndex = Math.max(
			0,
			VERBS.findIndex((v) => v.verb === opts.defaultVerb),
		);
		const borderColor = opts.danger ? "error" : "warning";
		const titleText = `${opts.danger ? "⛔" : "⚠"}  ${theme.bold(opts.summary)}`;

		this.addChild(new Text(theme.fg(borderColor, doubleBorderTop()), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(titleText, 1, 0));
		this.addChild(new Spacer(1));

		const previewLines = this.formatPreview(opts.commandPreview);
		for (const line of previewLines) {
			this.addChild(new Text(theme.fg("text", line), 3, 0));
		}
		if (previewLines.length > 0) this.addChild(new Spacer(1));

		if (opts.reason) {
			this.addChild(new Text(`${theme.fg("dim", "▸ reason:")} ${theme.fg("muted", opts.reason)}`, 1, 0));
			this.addChild(new Spacer(1));
		}

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg(
					"dim",
					"↑/↓ select · Enter confirm · 1-4 quick · ^C deny",
				),
				1,
				0,
			),
		);
		this.addChild(new Text(theme.fg(borderColor, doubleBorderBottom()), 0, 0));

		this.updateList();
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.up")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			this.selectedIndex = Math.min(VERBS.length - 1, this.selectedIndex + 1);
			this.updateList();
			return;
		}
		if (kb.matches(data, "tui.select.confirm")) {
			this.opts.onChoose(VERBS[this.selectedIndex].verb);
			return;
		}
		// 1-4 quick keys
		for (const verb of VERBS) {
			if (data === verb.key) {
				this.opts.onChoose(verb.verb);
				return;
			}
		}
		if (data === "\x03" || kb.matches(data, "tui.select.cancel")) {
			// Ctrl+C or Esc → instant deny
			this.opts.onChoose("deny");
		}
	}

	private updateList(): void {
		this.listContainer.clear();
		for (let i = 0; i < VERBS.length; i++) {
			const v = VERBS[i];
			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? theme.fg("accent", "▸ ") : "  ";
			const num = `${v.key}.`;
			const label = isSelected ? theme.fg("accent", v.label) : theme.fg("text", v.label);
			this.listContainer.addChild(new Text(`${prefix}${theme.fg("dim", num)} ${label}`, 1, 0));
		}
	}

	private formatPreview(preview: string | undefined): string[] {
		if (!preview) return [];
		const lines = preview.split("\n");
		if (lines.length <= PREVIEW_MAX_LINES) return lines;
		const head = lines.slice(0, PREVIEW_MAX_LINES);
		head.push(`… +${lines.length - PREVIEW_MAX_LINES} more lines`);
		return head;
	}
}

function doubleBorderTop(): string {
	return "╔════════════════════════════════════════════════╗";
}

function doubleBorderBottom(): string {
	return "╚════════════════════════════════════════════════╝";
}

/**
 * PromptUI implementation that drives the ApprovalPromptComponent through the
 * TUI overlay stack. Wire one of these into PermissionSession when it lands in
 * the interactive runtime.
 */
export class ApprovalPromptUI implements PromptUI {
	constructor(private readonly tui: TUI) {}

	chooseVerb(opts: PromptOptions): Promise<PromptVerb> {
		return new Promise((resolve) => {
			let handle: OverlayHandle | null = null;
			const finish = (verb: PromptVerb): void => {
				handle?.hide();
				resolve(verb);
			};
			const component = new ApprovalPromptComponent({
				summary: opts.summary,
				commandPreview: opts.commandPreview,
				reason: opts.reason,
				danger: opts.danger,
				defaultVerb: opts.defaultVerb,
				onChoose: finish,
			});
			handle = this.tui.showOverlay(component, { anchor: "center" });
			handle.focus();
		});
	}
}

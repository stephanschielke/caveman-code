import { getKeybindings } from "../keybindings.js";
import { matchesKey } from "../keys.js";
import type { Component } from "../tui.js";
import { truncateToWidth } from "../utils.js";

export interface GroupedSelectGroup<T> {
	id: string;
	header: string;
	items: T[];
	initiallyCollapsed?: boolean;
	emptyHint?: string;
	disabled?: boolean;
}

export interface GroupedSelectListOptions<T> {
	maxVisible: number;
	renderHeader: (group: GroupedSelectGroup<T>, isSelected: boolean, expanded: boolean) => string;
	renderItem: (item: T, group: GroupedSelectGroup<T>, isSelected: boolean) => string;
	renderEmpty?: (group: GroupedSelectGroup<T>) => string;
	noMatch?: string;
}

interface HeaderRow {
	kind: "header";
	groupIndex: number;
}
interface ItemRow<T> {
	kind: "item";
	groupIndex: number;
	itemIndex: number;
	item: T;
}
interface EmptyRow {
	kind: "empty";
	groupIndex: number;
}
type Row<T> = HeaderRow | ItemRow<T> | EmptyRow;

export type GroupedSelection<T> =
	| { kind: "header"; group: GroupedSelectGroup<T> }
	| { kind: "item"; group: GroupedSelectGroup<T>; item: T };

export class GroupedSelectList<T> implements Component {
	private groups: GroupedSelectGroup<T>[] = [];
	private folded: Set<string> = new Set();
	private seen: Set<string> = new Set();
	private rows: Row<T>[] = [];
	private selectedIndex = 0;
	private scrollOffset = 0;

	public onSelect?: (selection: GroupedSelection<T>) => void;
	public onCancel?: () => void;
	public onSelectionChange?: (selection: GroupedSelection<T> | null) => void;
	public onToggleGroup?: (group: GroupedSelectGroup<T>, expanded: boolean) => void;

	constructor(private options: GroupedSelectListOptions<T>) {}

	setGroups(groups: GroupedSelectGroup<T>[], preserveSelection: boolean = false): void {
		const previousSelection = preserveSelection ? this.currentSelection() : null;
		const previouslyFolded = new Set(this.folded);
		this.groups = groups;
		// Carry over fold state for already-known groups; only apply
		// `initiallyCollapsed` the first time a group id appears.
		this.folded = new Set();
		for (const g of groups) {
			if (this.seen.has(g.id)) {
				if (previouslyFolded.has(g.id)) this.folded.add(g.id);
			} else {
				this.seen.add(g.id);
				if (g.initiallyCollapsed) this.folded.add(g.id);
			}
		}
		this.flatten();
		if (previousSelection) {
			this.restoreSelection(previousSelection);
		} else {
			this.selectedIndex = this.firstSelectableIndex();
		}
		this.notifyChange();
	}

	private flatten(): void {
		const rows: Row<T>[] = [];
		for (let g = 0; g < this.groups.length; g++) {
			const group = this.groups[g]!;
			rows.push({ kind: "header", groupIndex: g });
			if (this.folded.has(group.id) || group.disabled) continue;
			if (group.items.length === 0) {
				if (group.emptyHint) rows.push({ kind: "empty", groupIndex: g });
				continue;
			}
			for (let i = 0; i < group.items.length; i++) {
				rows.push({ kind: "item", groupIndex: g, itemIndex: i, item: group.items[i]! });
			}
		}
		this.rows = rows;
		if (this.selectedIndex >= rows.length) {
			this.selectedIndex = Math.max(0, rows.length - 1);
		}
	}

	private firstSelectableIndex(): number {
		for (let i = 0; i < this.rows.length; i++) {
			if (this.rows[i]!.kind !== "empty") return i;
		}
		return 0;
	}

	currentSelection(): GroupedSelection<T> | null {
		const row = this.rows[this.selectedIndex];
		if (!row) return null;
		const group = this.groups[row.groupIndex];
		if (!group) return null;
		if (row.kind === "header") return { kind: "header", group };
		if (row.kind === "item") return { kind: "item", group, item: row.item };
		return null;
	}

	private restoreSelection(target: GroupedSelection<T>): void {
		// Try exact match first, then fall back to header of the same group, then top.
		for (let i = 0; i < this.rows.length; i++) {
			const row = this.rows[i]!;
			const group = this.groups[row.groupIndex]!;
			if (
				target.kind === "item" &&
				row.kind === "item" &&
				group.id === target.group.id &&
				row.item === target.item
			) {
				this.selectedIndex = i;
				return;
			}
			if (target.kind === "header" && row.kind === "header" && group.id === target.group.id) {
				this.selectedIndex = i;
				return;
			}
		}
		for (let i = 0; i < this.rows.length; i++) {
			const row = this.rows[i]!;
			if (row.kind === "header" && this.groups[row.groupIndex]?.id === target.group.id) {
				this.selectedIndex = i;
				return;
			}
		}
		this.selectedIndex = this.firstSelectableIndex();
	}

	private notifyChange(): void {
		this.onSelectionChange?.(this.currentSelection());
	}

	getRows(): number {
		return this.rows.length;
	}

	getMaxVisible(): number {
		return this.options.maxVisible;
	}

	isExpanded(groupId: string): boolean {
		return !this.folded.has(groupId);
	}

	toggleGroup(groupId: string): void {
		const group = this.groups.find((g) => g.id === groupId);
		if (!group || group.disabled) return;
		if (this.folded.has(groupId)) this.folded.delete(groupId);
		else this.folded.add(groupId);
		const previous = this.currentSelection();
		this.flatten();
		if (previous) this.restoreSelection(previous);
		this.onToggleGroup?.(group, !this.folded.has(groupId));
		this.notifyChange();
	}

	expandGroup(groupId: string): void {
		if (!this.folded.has(groupId)) return;
		this.toggleGroup(groupId);
	}

	collapseGroup(groupId: string): void {
		if (this.folded.has(groupId)) return;
		this.toggleGroup(groupId);
	}

	expandAll(): void {
		this.folded.clear();
		const previous = this.currentSelection();
		this.flatten();
		if (previous) this.restoreSelection(previous);
		this.notifyChange();
	}

	collapseAll(): void {
		for (const g of this.groups) this.folded.add(g.id);
		const previous = this.currentSelection();
		this.flatten();
		if (previous) this.restoreSelection(previous);
		this.notifyChange();
	}

	moveBy(delta: number): void {
		if (this.rows.length === 0) return;
		let i = this.selectedIndex;
		const step = delta > 0 ? 1 : -1;
		const total = Math.abs(delta);
		for (let k = 0; k < total; k++) {
			let next = i + step;
			// Skip empty rows when navigating with arrow keys.
			while (this.rows[next]?.kind === "empty") next += step;
			if (next < 0) next = this.rows.length - 1;
			if (next >= this.rows.length) next = 0;
			while (this.rows[next]?.kind === "empty") next += step;
			if (next < 0) next = this.rows.length - 1;
			if (next >= this.rows.length) next = 0;
			i = next;
		}
		if (i !== this.selectedIndex) {
			this.selectedIndex = i;
			this.notifyChange();
		}
	}

	moveToFirstOfGroup(groupIndex: number): void {
		for (let i = 0; i < this.rows.length; i++) {
			if (this.rows[i]!.groupIndex === groupIndex && this.rows[i]!.kind === "header") {
				this.selectedIndex = i;
				this.notifyChange();
				return;
			}
		}
	}

	getSelectedGroupIndex(): number | null {
		const row = this.rows[this.selectedIndex];
		return row ? row.groupIndex : null;
	}

	currentRowKind(): "header" | "item" | "empty" | null {
		return this.rows[this.selectedIndex]?.kind ?? null;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.rows.length === 0) {
			return [this.options.noMatch ?? "  No matches"];
		}

		const maxVisible = Math.max(1, this.options.maxVisible);
		// Keep the selected row centered when there are more rows than fit on screen.
		const half = Math.floor(maxVisible / 2);
		const desiredOffset = Math.max(0, Math.min(this.selectedIndex - half, this.rows.length - maxVisible));
		this.scrollOffset = Math.max(0, desiredOffset);
		const start = this.scrollOffset;
		const end = Math.min(start + maxVisible, this.rows.length);

		const out: string[] = [];
		for (let i = start; i < end; i++) {
			const row = this.rows[i]!;
			const group = this.groups[row.groupIndex]!;
			const selected = i === this.selectedIndex;
			let line: string;
			if (row.kind === "header") {
				const expanded = !this.folded.has(group.id) && !group.disabled;
				line = this.options.renderHeader(group, selected, expanded);
			} else if (row.kind === "item") {
				line = this.options.renderItem(row.item, group, selected);
			} else {
				line = this.options.renderEmpty?.(group) ?? "";
			}
			out.push(truncateToWidth(line, Math.max(1, width), ""));
		}

		if (start > 0 || end < this.rows.length) {
			out.push(truncateToWidth(`  (${this.selectedIndex + 1}/${this.rows.length})`, Math.max(1, width), ""));
		}

		return out;
	}

	handleInput(keyData: string): boolean {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up")) {
			this.moveBy(-1);
			return true;
		}
		if (kb.matches(keyData, "tui.select.down")) {
			this.moveBy(1);
			return true;
		}
		if (kb.matches(keyData, "tui.select.pageUp")) {
			this.moveBy(-Math.max(1, Math.floor(this.options.maxVisible / 2)));
			return true;
		}
		if (kb.matches(keyData, "tui.select.pageDown")) {
			this.moveBy(Math.max(1, Math.floor(this.options.maxVisible / 2)));
			return true;
		}
		if (matchesKey(keyData, "left")) {
			const row = this.rows[this.selectedIndex];
			if (row) {
				const group = this.groups[row.groupIndex];
				if (group) {
					if (this.folded.has(group.id) || row.kind !== "header") {
						this.moveToFirstOfGroup(row.groupIndex);
					}
					this.collapseGroup(group.id);
				}
			}
			return true;
		}
		if (matchesKey(keyData, "right")) {
			const row = this.rows[this.selectedIndex];
			if (row) {
				const group = this.groups[row.groupIndex];
				if (group) {
					if (this.folded.has(group.id)) {
						this.expandGroup(group.id);
						this.moveBy(1);
					} else if (row.kind === "header" && group.items.length > 0) {
						this.moveBy(1);
					}
				}
			}
			return true;
		}
		if (kb.matches(keyData, "tui.select.confirm")) {
			const sel = this.currentSelection();
			if (!sel) return true;
			if (sel.kind === "header") {
				if (!sel.group.disabled) this.toggleGroup(sel.group.id);
				return true;
			}
			this.onSelect?.(sel);
			return true;
		}
		if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancel?.();
			return true;
		}
		return false;
	}
}

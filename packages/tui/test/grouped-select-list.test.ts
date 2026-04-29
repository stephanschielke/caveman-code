import assert from "node:assert";
import { describe, it } from "node:test";
import { type GroupedSelectGroup, GroupedSelectList } from "../src/components/grouped-select-list.js";

interface Item {
	id: string;
}

const fixture = (): GroupedSelectGroup<Item>[] => [
	{
		id: "alpha",
		header: "Alpha",
		items: [{ id: "a1" }, { id: "a2" }],
	},
	{
		id: "beta",
		header: "Beta",
		items: [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
		initiallyCollapsed: true,
	},
	{
		id: "gamma",
		header: "Gamma",
		items: [],
		emptyHint: "no items",
	},
];

const buildList = () => {
	const list = new GroupedSelectList<Item>({
		maxVisible: 20,
		renderHeader: (g, _sel, expanded) => `${expanded ? "▼" : "▶"} ${g.header} (${g.items.length})`,
		renderItem: (item, _g, sel) => `${sel ? "→" : " "} ${item.id}`,
		renderEmpty: (g) => `  ${g.emptyHint}`,
	});
	list.setGroups(fixture());
	return list;
};

describe("GroupedSelectList", () => {
	it("renders group headers and items, respecting initiallyCollapsed", () => {
		const list = buildList();
		const lines = list.render(80);
		const text = lines.join("\n");
		assert.match(text, /▼ Alpha \(2\)/);
		assert.match(text, /a1/);
		assert.match(text, /▶ Beta \(3\)/);
		assert.doesNotMatch(text, /b1/, "collapsed group should not show items");
		assert.match(text, /▼ Gamma \(0\)/);
		assert.match(text, /no items/);
	});

	it("expands a collapsed group when right is pressed on its header", () => {
		const list = buildList();
		// Move down past Alpha header + items to land on Beta header (row 3).
		list.moveBy(3);
		assert.equal(list.currentSelection()?.kind, "header");
		assert.equal(list.handleInput("\x1b[C"), true); // right arrow
		const text = list.render(80).join("\n");
		assert.match(text, /b1/);
	});

	it("collapses an expanded group when left is pressed", () => {
		const list = buildList();
		list.expandGroup("beta");
		// Move to one of Beta's items.
		while (list.currentSelection()?.kind !== "item" || list.currentSelection()?.group.id !== "beta") {
			list.moveBy(1);
		}
		assert.equal(list.handleInput("\x1b[D"), true); // left arrow
		const text = list.render(80).join("\n");
		assert.doesNotMatch(text, /b1/);
	});

	it("preserves user fold state when groups are reset", () => {
		const list = buildList();
		list.expandGroup("beta");
		// Re-set with the same groups; the user's expansion of Beta must survive.
		list.setGroups(fixture(), true);
		const text = list.render(80).join("\n");
		assert.match(text, /b1/);
	});

	it("emits onSelect for items but not for headers", () => {
		const list = buildList();
		const seen: string[] = [];
		list.onSelect = (sel) => {
			if (sel.kind === "item") seen.push(sel.item.id);
		};
		list.handleInput("\r"); // confirm on Alpha header — should toggle, not emit
		assert.deepEqual(seen, []);
		// Expand Alpha back, move to a1, confirm.
		list.expandGroup("alpha");
		while (list.currentRowKind() !== "item") list.moveBy(1);
		list.handleInput("\r");
		assert.deepEqual(seen, ["a1"]);
	});

	it("skips empty rows during arrow navigation", () => {
		const list = buildList();
		// Walk forward several steps; we should never land on the 'empty' row.
		const visited: string[] = [];
		for (let i = 0; i < 8; i++) {
			const sel = list.currentSelection();
			visited.push(sel ? `${sel.kind}:${sel.kind === "item" ? sel.item.id : sel.group.id}` : "null");
			list.moveBy(1);
		}
		// 'empty' would correspond to no selection (we render it but don't select);
		// kind should always be 'header' or 'item'.
		for (const tag of visited) assert.notEqual(tag, "null");
	});
});

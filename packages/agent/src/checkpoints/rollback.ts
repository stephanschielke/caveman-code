/**
 * WS17: Rollback — restore project files from a shadow-git checkpoint.
 *
 * `rollback(N)` steps back N snapshots (default 1).
 * `rollback(N, { file })` restricts to a single file path.
 * `rollbackList()` returns the last 20 entries for display.
 *
 * The user's real .git is never touched; we only use the shadow bare repo and
 * write files directly to the project cwd via checkout-index.
 */

import type { CheckpointIndex, CheckpointIndexEntry } from "./index-file.js";
import type { Snapshotter } from "./snapshotter.js";

export interface RollbackOptions {
	/** File path filter (repo-relative or absolute — caller normalizes). */
	file?: string;
}

export interface RollbackResult {
	status: "ok" | "not_found" | "error";
	restoredFiles: string[];
	entry?: CheckpointIndexEntry;
	error?: string;
	durationMs: number;
}

export interface RollbackListEntry {
	id: number;
	ts: string;
	reason: string;
	fileCount: number;
	commit: string;
}

/**
 * Roll back N steps from the most-recent snapshot.
 *
 * @param steps   How many snapshots to go back (1 = most recent).
 * @param index   The checkpoint index for this project.
 * @param snapshotter  The snapshotter bound to the shadow repo + project root.
 * @param options Optional file filter.
 */
export async function rollback(
	steps: number,
	index: CheckpointIndex,
	snapshotter: Snapshotter,
	options: RollbackOptions = {},
): Promise<RollbackResult> {
	const t0 = Date.now();
	const n = Math.max(1, Math.floor(steps));

	const entry = index.nthFromLast(n);
	if (!entry) {
		return {
			status: "not_found",
			restoredFiles: [],
			error: `No snapshot found ${n} step(s) back (total: ${index.entries().length})`,
			durationMs: Date.now() - t0,
		};
	}

	try {
		const filePaths = options.file ? [options.file] : [];
		const restored = await snapshotter.restore(entry.commit, filePaths);
		return {
			status: "ok",
			restoredFiles: restored,
			entry,
			durationMs: Date.now() - t0,
		};
	} catch (err) {
		return {
			status: "error",
			restoredFiles: [],
			entry,
			error: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - t0,
		};
	}
}

/**
 * Return the last 20 snapshot entries formatted for display.
 */
export function rollbackList(index: CheckpointIndex, limit = 20): RollbackListEntry[] {
	const entries = index.tail(limit);
	// Return newest first for CLI display
	return [...entries].reverse().map((e) => ({
		id: e.id,
		ts: e.ts,
		reason: e.reason,
		fileCount: e.files.length,
		commit: e.commit.slice(0, 12),
	}));
}

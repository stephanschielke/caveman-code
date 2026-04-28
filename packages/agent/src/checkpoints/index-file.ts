/**
 * WS17: Persistent index for shadow-git checkpoints.
 *
 * Stored at ~/.cave/checkpoints/<repo-hash>/index.json.
 * Each entry records the snapshot metadata and the git commit SHA in the
 * shadow bare repo so rollback can materialise files without scanning git log.
 *
 * Concurrency: the index file is written atomically (tmp-rename) so a crash
 * mid-write cannot corrupt it.  Lock-based serialization is enforced by
 * CheckpointManager; this class is not itself thread-safe.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Reason a snapshot was taken. */
export type SnapshotReasonTag = "pre-write" | "pre-edit" | "pre-bash" | `manual:${string}`;

export interface CheckpointIndexEntry {
	/** Monotonically-increasing integer (1-based). */
	id: number;
	/** ISO-8601 UTC timestamp of snapshot creation. */
	ts: string;
	/** The agent session ID active at snapshot time. */
	sessionId: string;
	/** What triggered the snapshot. */
	reason: SnapshotReasonTag;
	/** Repo-relative paths captured in this snapshot. */
	files: string[];
	/** Full 40-char git commit SHA in the shadow repo. */
	commit: string;
}

export interface CheckpointIndexFile {
	/** Must stay 1 for now; bump for breaking schema changes. */
	version: 1;
	/** Absolute path of the project root that this index covers. */
	projectRoot: string;
	entries: CheckpointIndexEntry[];
}

/** Max checkpoints retained per repo. */
export const MAX_SNAPSHOTS = 100;
/** Max age (ms) for GC — 7 days. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class CheckpointIndex {
	private data: CheckpointIndexFile;
	private readonly filePath: string;

	constructor(
		readonly shadowDir: string,
		private readonly projectRoot: string,
	) {
		this.filePath = join(shadowDir, "index.json");
		this.data = this.load();
	}

	private load(): CheckpointIndexFile {
		if (!existsSync(this.filePath)) {
			return { version: 1, projectRoot: this.projectRoot, entries: [] };
		}
		try {
			const raw = readFileSync(this.filePath, "utf-8");
			const parsed = JSON.parse(raw) as CheckpointIndexFile;
			// Forward-compat guard
			if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
				return { version: 1, projectRoot: this.projectRoot, entries: [] };
			}
			return parsed;
		} catch {
			return { version: 1, projectRoot: this.projectRoot, entries: [] };
		}
	}

	/** Append a new entry, run GC, then persist. */
	push(entry: Omit<CheckpointIndexEntry, "id">): CheckpointIndexEntry {
		const nextId = (this.data.entries[this.data.entries.length - 1]?.id ?? 0) + 1;
		const full: CheckpointIndexEntry = { id: nextId, ...entry };
		this.data.entries.push(full);
		this.gc();
		this.save();
		return full;
	}

	entries(): ReadonlyArray<CheckpointIndexEntry> {
		return this.data.entries;
	}

	/** Return the last N entries (most-recent last). */
	tail(n: number): CheckpointIndexEntry[] {
		return this.data.entries.slice(-n);
	}

	/** Find by numeric id. */
	findById(id: number): CheckpointIndexEntry | undefined {
		return this.data.entries.find((e) => e.id === id);
	}

	/** Find the Nth-from-last entry (steps=1 → most recent). */
	nthFromLast(steps: number): CheckpointIndexEntry | undefined {
		const entries = this.data.entries;
		const idx = entries.length - steps;
		return idx >= 0 ? entries[idx] : undefined;
	}

	private gc(): void {
		const now = Date.now();
		const cutoff = now - MAX_AGE_MS;

		// Prune by age first
		this.data.entries = this.data.entries.filter((e) => new Date(e.ts).getTime() >= cutoff);

		// Then prune to max count, keeping the newest
		if (this.data.entries.length > MAX_SNAPSHOTS) {
			this.data.entries = this.data.entries.slice(-MAX_SNAPSHOTS);
		}
	}

	private save(): void {
		const dir = dirname(this.filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const tmp = `${this.filePath}.tmp.${process.pid}`;
		writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf-8");
		renameSync(tmp, this.filePath);
	}
}

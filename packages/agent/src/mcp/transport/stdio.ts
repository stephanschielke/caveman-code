// stdio.ts — stdio MCP transport.
//
// Spawns the configured command as a subprocess and speaks JSON-RPC 2.0 over
// stdin/stdout. Implements the minimum slice of the MCP protocol cave needs
// today: `initialize`, `tools/list`, `tools/call`. Newline-delimited JSON
// (the LSP-style "Content-Length:" framing is also valid per the spec but
// optional; the simpler ndjson framing is what `pi-mcp-adapter` and the
// official @modelcontextprotocol/sdk default to for stdio servers).
//
// Reference: https://modelcontextprotocol.io/specification (2025-06)

import { Buffer } from "node:buffer";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { McpRemoteTool, McpServerConfig, McpTransport } from "../types.js";

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number | string;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

interface PendingCall {
	resolve: (result: unknown) => void;
	reject: (err: Error) => void;
	timeout: NodeJS.Timeout;
}

export interface StdioTransportOptions {
	requestTimeoutMs?: number;
	connectTimeoutMs?: number;
}

export class StdioTransport implements McpTransport {
	readonly kind = "stdio" as const;
	private child?: ChildProcessWithoutNullStreams;
	private buffer = "";
	private nextId = 1;
	private pending = new Map<number | string, PendingCall>();
	private connected = false;
	private readonly requestTimeoutMs: number;
	private readonly connectTimeoutMs: number;

	constructor(
		private readonly config: McpServerConfig,
		options: StdioTransportOptions = {},
	) {
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
		this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
	}

	async connect(): Promise<void> {
		if (this.connected) return;
		if (!this.config.command) {
			throw new Error(`mcp(stdio:${this.config.name}): config.command is required`);
		}

		const child = spawn(this.config.command, this.config.args ?? [], {
			env: { ...process.env, ...(this.config.env ?? {}) },
			cwd: this.config.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		}) as ChildProcessWithoutNullStreams;

		this.child = child;

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			if (this.config.debug) process.stderr.write(`[mcp:${this.config.name}] ${chunk}`);
		});
		child.on("error", (err) => this.fatal(err));
		child.on("exit", (code, signal) => {
			this.fatal(new Error(`mcp(stdio:${this.config.name}): process exited code=${code} signal=${signal}`));
		});

		await new Promise<void>((resolve, reject) => {
			const t = setTimeout(
				() => reject(new Error(`mcp(stdio:${this.config.name}): connect timeout`)),
				this.connectTimeoutMs,
			);
			const onSpawn = () => {
				clearTimeout(t);
				resolve();
			};
			child.once("spawn", onSpawn);
			child.once("error", (err) => {
				clearTimeout(t);
				reject(err);
			});
		});

		await this.request("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: { tools: {} },
			clientInfo: { name: "cave", version: "v2" },
		});
		this.notify("notifications/initialized", {});

		this.connected = true;
	}

	async listTools(): Promise<McpRemoteTool[]> {
		if (!this.connected) throw new Error(`mcp(stdio:${this.config.name}): not connected`);
		const result = (await this.request("tools/list", {})) as { tools?: Array<Record<string, unknown>> };
		const tools = result.tools ?? [];
		return tools.map((t) => {
			const name = String(t.name ?? "");
			return {
				name,
				namespacedName: `mcp__${this.config.name}__${name}`,
				server: this.config.name,
				title: typeof t.title === "string" ? t.title : undefined,
				description: typeof t.description === "string" ? t.description : undefined,
				inputSchema: t.inputSchema,
			};
		});
	}

	async callTool(name: string, args: unknown): Promise<unknown> {
		if (!this.connected) throw new Error(`mcp(stdio:${this.config.name}): not connected`);
		return this.request("tools/call", { name, arguments: args ?? {} });
	}

	async close(): Promise<void> {
		this.connected = false;
		const c = this.child;
		this.child = undefined;
		for (const [, p] of this.pending) {
			clearTimeout(p.timeout);
			p.reject(new Error(`mcp(stdio:${this.config.name}): closed`));
		}
		this.pending.clear();
		if (c) {
			try {
				c.stdin.end();
			} catch {
				/* ignore */
			}
			try {
				c.kill();
			} catch {
				/* ignore */
			}
		}
	}

	isConnected(): boolean {
		return this.connected;
	}

	private onStdout(chunk: string): void {
		this.buffer += chunk;
		let idx = this.buffer.indexOf("\n");
		while (idx !== -1) {
			const line = this.buffer.slice(0, idx).trim();
			this.buffer = this.buffer.slice(idx + 1);
			if (line.length > 0) this.handleLine(line);
			idx = this.buffer.indexOf("\n");
		}
	}

	private handleLine(line: string): void {
		let msg: JsonRpcResponse | null = null;
		try {
			msg = JSON.parse(line) as JsonRpcResponse;
		} catch {
			if (this.config.debug) {
				process.stderr.write(`[mcp:${this.config.name}] non-json: ${line}\n`);
			}
			return;
		}
		if (!msg || typeof msg !== "object") return;
		if (msg.id === undefined || msg.id === null) return;
		const p = this.pending.get(msg.id);
		if (!p) return;
		this.pending.delete(msg.id);
		clearTimeout(p.timeout);
		if (msg.error) {
			p.reject(new Error(`mcp(stdio:${this.config.name}): ${msg.error.message}`));
		} else {
			p.resolve(msg.result);
		}
	}

	private request(method: string, params: unknown): Promise<unknown> {
		const id = this.nextId++;
		const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
		return new Promise<unknown>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`mcp(stdio:${this.config.name}): request timeout (${method})`));
			}, this.requestTimeoutMs);
			this.pending.set(id, { resolve, reject, timeout });
			this.write(req);
		});
	}

	private notify(method: string, params: unknown): void {
		const msg = { jsonrpc: "2.0" as const, method, params };
		this.write(msg);
	}

	private write(obj: unknown): void {
		const line = `${JSON.stringify(obj)}\n`;
		const c = this.child;
		if (!c) {
			throw new Error(`mcp(stdio:${this.config.name}): not spawned`);
		}
		c.stdin.write(Buffer.from(line, "utf8"));
	}

	private fatal(err: Error): void {
		this.connected = false;
		for (const [, p] of this.pending) {
			clearTimeout(p.timeout);
			p.reject(err);
		}
		this.pending.clear();
	}
}

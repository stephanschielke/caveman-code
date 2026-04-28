// client.ts — Cave MCP client.
//
// Wires transports + config discovery + tool namespacing into a single object
// the coding-agent surface can hand a list of tools to. Three responsibilities:
//
//   1. Connect & manage server transports (stdio / inproc / http).
//   2. Aggregate remote tools under the `mcp__<server>__<tool>` namespace.
//   3. Defer schemas behind ToolSearch by default (Anthropic pattern) — a
//      single always-on `mcp_tool_search` tool, full schemas pulled lazily.
//
// Original v1 surface (McpServerConfig, McpClient, McpClientRegistry) is
// preserved for back-compat with existing callers.

import type { McpTool } from "./serve.js";
import { createTransport, createInProcessTransport } from "./transport/index.js";
import type { McpRemoteTool, McpServerConfig, McpSettings, McpTransport } from "./types.js";

export type { McpServerConfig } from "./types.js";

export interface McpClientRegistry {
	loadConfig(servers: McpServerConfig[]): void;
	registeredTools(): McpTool[];
	forward(toolName: string, args: unknown): Promise<unknown>;
}

export interface McpHandlerMap {
	[toolName: string]: (args: unknown) => Promise<unknown> | unknown;
}

export interface ServerSurface {
	name: string;
	tools: McpTool[];
}

/**
 * Original v1 client (kept for back-compat). Pure in-memory; the synchronous
 * variant used by tests and code paths that pre-resolve handlers.
 */
export class McpClient implements McpClientRegistry {
	private servers = new Map<string, ServerSurface>();
	private handlers = new Map<string, (args: unknown) => Promise<unknown> | unknown>();

	constructor(private readonly handlerFactory?: (server: McpServerConfig) => ServerSurface) {}

	loadConfig(servers: McpServerConfig[]): void {
		for (const server of servers) {
			const surface = this.handlerFactory?.(server) ?? { name: server.name, tools: [] };
			this.servers.set(surface.name, surface);
			for (const tool of surface.tools) {
				this.handlers.set(tool.name, tool.call);
			}
		}
	}

	registeredTools(): McpTool[] {
		const out: McpTool[] = [];
		for (const s of this.servers.values()) out.push(...s.tools);
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}

	async forward(toolName: string, args: unknown): Promise<unknown> {
		const h = this.handlers.get(toolName);
		if (!h) throw new McpServerMissingError(`mcp: no server for tool ${toolName}`);
		return h(args);
	}
}

export class McpServerMissingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpServerMissingError";
	}
}

// ----------------------------------------------------------------------------
// v2: McpHub — transport-backed multiplexer.
// ----------------------------------------------------------------------------

interface ConnectedServer {
	config: McpServerConfig;
	transport: McpTransport;
	tools: McpRemoteTool[];
	lastUsed: number;
	error?: string;
}

export interface McpHubOptions {
	settings?: McpSettings;
	transportFactory?: (config: McpServerConfig) => McpTransport;
	idleTimeoutMs?: number;
}

export interface McpHubEvents {
	onConnect?(name: string): void;
	onDisconnect?(name: string, reason?: string): void;
	onToolCall?(namespacedName: string, server: string): void;
}

/**
 * Multi-server MCP client. Owns transports, exposes the union of remote tools
 * via the `mcp__<server>__<tool>` namespace, and provides ToolSearch.
 */
export class McpHub {
	private readonly servers = new Map<string, ConnectedServer>();
	private readonly settings: McpSettings;
	private readonly transportFactory: (c: McpServerConfig) => McpTransport;
	private readonly idleTimeoutMs: number;
	private events: McpHubEvents = {};

	constructor(options: McpHubOptions = {}) {
		this.settings = options.settings ?? {};
		this.transportFactory = options.transportFactory ?? createTransport;
		this.idleTimeoutMs = options.idleTimeoutMs ?? (this.settings.idleTimeout ?? 10) * 60_000;
	}

	setEvents(events: McpHubEvents): void {
		this.events = events;
	}

	addInProcess(name: string, tools: McpTool[]): void {
		const config: McpServerConfig = { name, transport: "inproc" };
		const transport = createInProcessTransport(name, tools);
		this.servers.set(name, { config, transport, tools: [], lastUsed: Date.now() });
	}

	addServer(config: McpServerConfig): void {
		const transport = this.transportFactory(config);
		this.servers.set(config.name, { config, transport, tools: [], lastUsed: Date.now() });
	}

	async removeServer(name: string): Promise<void> {
		const s = this.servers.get(name);
		if (!s) return;
		try {
			await s.transport.close();
		} catch {
			/* ignore */
		}
		this.servers.delete(name);
		this.events.onDisconnect?.(name, "removed");
	}

	listServers(): string[] {
		return [...this.servers.keys()];
	}

	getServerConfig(name: string): McpServerConfig | undefined {
		return this.servers.get(name)?.config;
	}

	async connect(name: string): Promise<void> {
		const s = this.servers.get(name);
		if (!s) throw new Error(`mcp: server not registered: ${name}`);
		if (!s.transport.isConnected()) {
			await s.transport.connect();
			this.events.onConnect?.(name);
		}
		s.tools = await s.transport.listTools();
		s.lastUsed = Date.now();
		s.error = undefined;
	}

	async connectAll(): Promise<Array<{ name: string; error?: string }>> {
		const results: Array<{ name: string; error?: string }> = [];
		await Promise.all(
			[...this.servers.keys()].map(async (name) => {
				try {
					await this.connect(name);
					results.push({ name });
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					const s = this.servers.get(name);
					if (s) s.error = msg;
					results.push({ name, error: msg });
				}
			}),
		);
		return results;
	}

	async listAllTools(): Promise<McpRemoteTool[]> {
		const out: McpRemoteTool[] = [];
		for (const s of this.servers.values()) {
			if (!s.transport.isConnected()) {
				try {
					await this.connect(s.config.name);
				} catch (err) {
					s.error = err instanceof Error ? err.message : String(err);
					continue;
				}
			}
			const exclude = new Set(s.config.excludeTools ?? []);
			for (const t of s.tools) {
				if (exclude.has(t.name)) continue;
				out.push(t);
			}
		}
		out.sort((a, b) => a.namespacedName.localeCompare(b.namespacedName));
		return out;
	}

	async callNamespaced(namespacedName: string, args: unknown): Promise<unknown> {
		const parsed = parseNamespacedName(namespacedName);
		if (!parsed) throw new Error(`mcp: not a namespaced tool: ${namespacedName}`);
		const s = this.servers.get(parsed.server);
		if (!s) throw new McpServerMissingError(`mcp: no server: ${parsed.server}`);
		if (!s.transport.isConnected()) await this.connect(parsed.server);
		s.lastUsed = Date.now();
		this.events.onToolCall?.(namespacedName, parsed.server);
		return s.transport.callTool(parsed.tool, args);
	}

	/**
	 * Return a token-thin always-on tool slice: a single mcp_tool_search tool
	 * users invoke to discover full tool schemas. Anthropic ToolSearch pattern.
	 */
	buildToolSearchTool(): McpTool<{ query?: string; server?: string; limit?: number }, unknown> {
		const search = async (
			args: { query?: string; server?: string; limit?: number } | undefined,
		): Promise<unknown> => {
			const q = (args?.query ?? "").toLowerCase();
			const server = args?.server;
			const limit = Math.max(1, Math.min(50, args?.limit ?? 20));
			const all = await this.listAllTools();
			const filtered = all.filter((t) => {
				if (server && t.server !== server) return false;
				if (!q) return true;
				const hay = `${t.name} ${t.description ?? ""} ${t.title ?? ""}`.toLowerCase();
				return hay.includes(q);
			});
			return {
				results: filtered.slice(0, limit).map((t) => ({
					name: t.namespacedName,
					server: t.server,
					description: t.description ?? "",
					inputSchema: t.inputSchema,
				})),
				total: filtered.length,
			};
		};
		return {
			name: "mcp_tool_search",
			description:
				"Search MCP tools across all configured servers. Returns name, server, description, and input schema. Use before calling an mcp__server__tool tool whose schema you don't already have.",
			schema: {
				type: "object",
				properties: {
					query: { type: "string", description: "Substring match against name + description." },
					server: { type: "string", description: "Restrict to a single server." },
					limit: { type: "number", description: "Max results (default 20, max 50)." },
				},
			},
			call: search,
		};
	}

	async sweepIdle(now = Date.now()): Promise<string[]> {
		if (this.idleTimeoutMs <= 0) return [];
		const swept: string[] = [];
		for (const [name, s] of this.servers) {
			if (!s.transport.isConnected()) continue;
			if (now - s.lastUsed < this.idleTimeoutMs) continue;
			try {
				await s.transport.close();
				swept.push(name);
				this.events.onDisconnect?.(name, "idle");
			} catch {
				/* ignore */
			}
		}
		return swept;
	}

	async closeAll(): Promise<void> {
		await Promise.all(
			[...this.servers.values()].map(async (s) => {
				try {
					await s.transport.close();
				} catch {
					/* ignore */
				}
			}),
		);
	}

	async healthCheck(): Promise<
		Array<{ name: string; transport: string; reachable: boolean; tools: number; error?: string }>
	> {
		const out: Array<{ name: string; transport: string; reachable: boolean; tools: number; error?: string }> = [];
		for (const [name, s] of this.servers) {
			let reachable = s.transport.isConnected();
			let error: string | undefined = s.error;
			let tools = s.tools.length;
			if (!reachable) {
				try {
					await this.connect(name);
					reachable = true;
					tools = s.tools.length;
				} catch (err) {
					error = err instanceof Error ? err.message : String(err);
				}
			}
			out.push({ name, transport: s.transport.kind, reachable, tools, error });
		}
		return out;
	}
}

/** Parse `mcp__<server>__<tool>` into its parts. */
export function parseNamespacedName(name: string): { server: string; tool: string } | undefined {
	if (!name.startsWith("mcp__")) return undefined;
	const rest = name.slice("mcp__".length);
	const idx = rest.indexOf("__");
	if (idx < 0) return undefined;
	return { server: rest.slice(0, idx), tool: rest.slice(idx + 2) };
}

/** Build the canonical namespaced name. */
export function buildNamespacedName(server: string, tool: string): string {
	return `mcp__${server}__${tool}`;
}

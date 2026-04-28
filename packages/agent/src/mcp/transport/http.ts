// http.ts — Streamable HTTP MCP transport. STUB.
//
// TODO(ws2-http): implement against the MCP Streamable HTTP spec
// (https://modelcontextprotocol.io/specification/transports#streamable-http).
// SSE is being deprecated mid-2026, so we target Streamable HTTP only.
//
// The on-disk shape (URL + headers + auth/oauth/bearer) is already finalized
// in McpServerConfig and matches Claude Code/Codex format. The pieces we need:
//   1. POST {url} with the JSON-RPC body, optional bearer / OAuth Authorization.
//   2. If response is text/event-stream, fold "data:"-prefixed events into a
//      response stream; if application/json, treat as a single response.
//   3. Reuse the OAuth + PKCE machinery in `mcp-auth.ts` (also a stub).
//
// For now we throw on connect with an actionable message so callers fail
// loud rather than silently hanging.

import type { McpRemoteTool, McpServerConfig, McpTransport } from "../types.js";

export class HttpTransport implements McpTransport {
	readonly kind = "http" as const;
	private connected = false;

	constructor(private readonly config: McpServerConfig) {}

	async connect(): Promise<void> {
		// TODO(ws2-http): implement Streamable HTTP transport.
		throw new Error(
			`mcp(http:${this.config.name}): HTTP transport is not yet implemented in this build. ` +
				`Tracking issue: WS2 Streamable HTTP follow-up.`,
		);
	}

	async listTools(): Promise<McpRemoteTool[]> {
		throw new Error(`mcp(http:${this.config.name}): not connected`);
	}

	async callTool(_name: string, _args: unknown): Promise<unknown> {
		throw new Error(`mcp(http:${this.config.name}): not connected`);
	}

	async close(): Promise<void> {
		this.connected = false;
	}

	isConnected(): boolean {
		return this.connected;
	}
}

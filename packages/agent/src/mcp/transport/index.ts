// transport/index.ts — transport factory.

import type { McpTool } from "../serve.js";
import type { McpServerConfig, McpTransport, McpTransportKind } from "../types.js";
import { HttpTransport } from "./http.js";
import { InProcessTransport } from "./inproc.js";
import { StdioTransport } from "./stdio.js";

export function detectTransportKind(config: McpServerConfig): McpTransportKind {
	if (config.transport) return config.transport;
	if (config.url) return "http";
	if (config.command) return "stdio";
	throw new Error(`mcp(${config.name}): cannot determine transport — set "command" or "url"`);
}

/** Create a transport from a server config. */
export function createTransport(config: McpServerConfig): McpTransport {
	const kind = detectTransportKind(config);
	switch (kind) {
		case "stdio":
			return new StdioTransport(config);
		case "http":
			return new HttpTransport(config);
		case "inproc":
			throw new Error(`mcp(${config.name}): inproc transport requires createInProcessTransport()`);
	}
}

/** Build an in-process transport from a tool list (for cave's own surface). */
export function createInProcessTransport(serverName: string, tools: McpTool[]): McpTransport {
	return new InProcessTransport(serverName, tools);
}

export { HttpTransport, InProcessTransport, StdioTransport };

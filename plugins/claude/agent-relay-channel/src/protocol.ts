// Claude Code does not register a channel server that negotiates MCP
// revision 2026-07-28 (it cannot carry channel notifications), so this server
// never agrees to anything newer than the last revision before it. The pinned
// SDK already stops at 2025-11-25; the clamp keeps that true if the SDK is
// ever bumped.

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InitializeRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export const PROTOCOL_CEILING = "2025-11-25";

export function clampProtocol(version: string): string {
  // Revisions are ISO dates; anything else (drafts) is treated as newer.
  return /^\d{4}-\d{2}-\d{2}$/.test(version) && version <= PROTOCOL_CEILING ? version : PROTOCOL_CEILING;
}

export function pinProtocol(server: Server): void {
  const original = (server as unknown as { _oninitialize: (request: unknown) => Promise<{ protocolVersion: string }> })
    ._oninitialize.bind(server);
  server.setRequestHandler(InitializeRequestSchema, async (request) => {
    const result = await original(request);
    return { ...result, protocolVersion: clampProtocol(result.protocolVersion) };
  });
}

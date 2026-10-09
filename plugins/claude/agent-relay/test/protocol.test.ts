import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { PROTOCOL_CEILING, clampProtocol, pinProtocol } from "../src/protocol.ts";

async function negotiate(requested: string) {
  const server = new Server({ name: "t", version: "0" }, { capabilities: { experimental: { "claude/channel": {} }, tools: {} } });
  pinProtocol(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await b.start();
  const reply = new Promise<any>((resolve) => {
    b.onmessage = (message) => resolve(message);
  });
  await b.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: requested, capabilities: {}, clientInfo: { name: "c", version: "0" } },
  });
  return (await reply).result;
}

describe("protocol pin", () => {
  test("a client asking for 2026-07-28 gets the pre-2026-07-28 ceiling", async () => {
    const result = await negotiate("2026-07-28");
    expect(result.protocolVersion).toBe(PROTOCOL_CEILING);
    expect(result.capabilities.experimental["claude/channel"]).toEqual({});
    expect(result.capabilities.experimental["claude/channel/permission"]).toBeUndefined();
  });

  test("older revisions are echoed", async () => {
    expect((await negotiate("2025-06-18")).protocolVersion).toBe("2025-06-18");
  });

  test("the clamp refuses newer and draft revisions", () => {
    expect(clampProtocol("2026-07-28")).toBe(PROTOCOL_CEILING);
    expect(clampProtocol("DRAFT-2026-v1")).toBe(PROTOCOL_CEILING);
    expect(clampProtocol("2024-11-05")).toBe("2024-11-05");
  });

  test("the pinned SDK itself stops before 2026-07-28", () => {
    expect(LATEST_PROTOCOL_VERSION < "2026-07-28").toBe(true);
  });

  test("an SDK client completes the handshake", async () => {
    const server = new Server({ name: "t", version: "0" }, { capabilities: { experimental: { "claude/channel": {} } } });
    pinProtocol(server);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "c", version: "0" });
    await client.connect(b);
    expect(client.getServerCapabilities()?.experimental?.["claude/channel"]).toEqual({});
  });
});

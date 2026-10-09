#!/usr/bin/env bun
// Agent Relay channel for Claude Code.
//
// Pushes relay messages addressed to this session's relay agent into the
// running Claude Code session as channel events, and gives Claude a reply
// tool that answers on the relay. Inbound messages come from Relaycast over
// its WebSocket, gated by pairing and a sender allowlist. When the Agent
// Relay desktop has already registered this session, the desktop delivers
// through Claude Code's cross-session inbox and this channel stays quiet.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { RelayCast } from "@relaycast/sdk";
import { isAgentName } from "./src/access.ts";
import { createChannel, fromRelayEvent, instructions, type InboundMessage } from "./src/channel.ts";
import { desktopSession, desktopSocket, inboundMode, shouldDeliver } from "./src/desktop.ts";
import { resolveIdentity, workspaceTag } from "./src/identity.ts";
import { pinProtocol } from "./src/protocol.ts";

const STATE_DIR =
  process.env.AGENT_RELAY_CHANNEL_STATE_DIR ??
  path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "channels/agent-relay");
const IDENTITY_FILE = path.join(STATE_DIR, "identity.json");

function log(line: string) {
  process.stderr.write(`[agent-relay channel] ${line}\n`);
}

// Settings come from AGENT_RELAY_CHANNEL_* variables, then <state dir>/.env.
// The plain RELAY_* variables are deliberately ignored: a session started by
// an Agent Relay broker carries its own identity there, and registering under
// that name would rotate the broker's token.
function loadSettings(): Record<string, string> {
  const settings: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(path.join(STATE_DIR, ".env"), "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) settings[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("AGENT_RELAY_CHANNEL_") && value) settings[key] = value;
  }
  return settings;
}

function defaultAgentName(): string {
  const directory = path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 32) || "session";
  const hash = createHash("sha256").update(`${os.hostname()}:${process.cwd()}`).digest("hex").slice(0, 6);
  return `claude-${directory}-${hash}`;
}

// Shut down cleanly even if Claude Code goes away during the slow startup
// steps below (the desktop check, registration): later steps check this.
let shuttingDown = false;
let agent: ReturnType<RelayCast["as"]> | undefined;
const shutdown = async () => {
  shuttingDown = true;
  try {
    await agent?.disconnect();
  } catch {}
  process.exit(0);
};
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const settings = loadSettings();
const workspaceKey = settings.AGENT_RELAY_CHANNEL_WORKSPACE_KEY;
const agentName = settings.AGENT_RELAY_CHANNEL_AGENT_NAME ?? defaultAgentName();
const baseUrl = settings.AGENT_RELAY_CHANNEL_BASE_URL;
const mode = inboundMode(settings.AGENT_RELAY_CHANNEL_INBOUND);
// Who may reach this session is decided per relay identity (workspace and
// agent name), so approving an agent for one project's session does not let
// it into another's.
const ACCESS_FILE = path.join(
  STATE_DIR,
  "access",
  `${workspaceKey ? workspaceTag(workspaceKey) : "unconfigured"}-${isAgentName(agentName) ? agentName : "invalid"}.json`,
);

// Decided after Claude Code is connected: the desktop check can take tens of
// seconds, longer than Claude Code waits for a server to start.
let desktop: Awaited<ReturnType<typeof desktopSession>>;
let delivering = false;
let note: string | undefined = "Checking whether the Agent Relay desktop already delivers to this session…";

const mcp = new Server(
  { name: "agent-relay", version: "0.1.0" },
  {
    capabilities: {
      // Registers the channel listener. Permission relay is deliberately not
      // declared: a peer agent must never approve tool use in this session.
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: instructions(agentName, true),
  },
);
pinProtocol(mcp);

let lastError: string | undefined;
// The WebSocket's state, as its events report it; status shows this rather
// than what was true at startup.
let connected = false;

const channel = createChannel({
  self: agentName,
  accessFile: ACCESS_FILE,
  log,
  relay: {
    async dm(to, text) {
      if (!agent) throw new Error("not connected to Agent Relay");
      const sent = (await agent.dm(to, text)) as { id?: string; message?: { id?: string } };
      return { id: sent?.id ?? sent?.message?.id };
    },
    async threadReply(parentId, text) {
      if (!agent) throw new Error("not connected to Agent Relay");
      const sent = (await agent.reply(parentId, text)) as { id?: string };
      return { id: sent?.id };
    },
  },
  notify: (event) =>
    mcp.notification({ method: "notifications/claude/channel", params: { content: event.content, meta: event.meta } }),
});

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Answer an Agent Relay message that arrived in this session as a <channel> event. Pass its message_id and your text.",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "The message_id attribute of the <channel> tag being answered" },
          text: { type: "string", description: "Plain-text reply" },
        },
        required: ["message_id", "text"],
      },
    },
    {
      name: "status",
      description: "Show this channel's relay agent name, whether it is delivering, and why not.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  try {
    if (request.params.name === "reply") {
      return { content: [{ type: "text", text: await channel.reply(args.message_id, args.text) }] };
    }
    if (request.params.name === "status") {
      const text = JSON.stringify(
        { agent: agentName, delivering, connected, note, error: lastError, access_file: ACCESS_FILE, desktop: desktop ?? null },
        null,
        2,
      );
      return { content: [{ type: "text", text }] };
    }
    throw new Error(`unknown tool: ${request.params.name}`);
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
});

await mcp.connect(new StdioServerTransport());

desktop = await desktopSession(desktopSocket());
if (shuttingDown) await new Promise(() => {});
delivering = shouldDeliver(mode, desktop) && Boolean(workspaceKey) && isAgentName(agentName);
note = undefined;
if (!workspaceKey) {
  note = "The channel is not configured yet (no workspace key); run /agent-relay:configure.";
} else if (!isAgentName(agentName)) {
  note = `The configured agent name "${agentName}" is not valid; run /agent-relay:configure.`;
} else if (!shouldDeliver(mode, desktop)) {
  note =
    mode === "never"
      ? "Inbound delivery is turned off (AGENT_RELAY_CHANNEL_INBOUND=never)."
      : `The Agent Relay desktop already delivers this session's messages${desktop?.address ? ` as ${desktop.address}` : ""}, through Claude Code's cross-session inbox, so this channel does not deliver them again.`;
}

if (delivering && workspaceKey) {
  try {
    const relay = new RelayCast({ apiKey: workspaceKey, baseUrl });
    const identity = await resolveIdentity(
      {
        me: (token) => relay.agents.me(token) as Promise<{ id: string; name: string }>,
        // autoJoinGeneral: false keeps #general's traffic out of this session.
        register: (name) =>
          relay.agents.register({ name, type: "agent", autoJoinGeneral: false }) as Promise<{
            id: string;
            name: string;
            token: string;
          }>,
        recover: (name, expectedAgentId) =>
          relay.agents.recover({ name, expectedAgentId, reason: "Claude Code channel restart" }) as Promise<{
            token?: string;
            agentToken?: string;
            agentId?: string;
          }>,
      },
      IDENTITY_FILE,
      workspaceKey,
      agentName,
    );
    if (shuttingDown) await new Promise(() => {});
    agent = relay.as(identity.token);
    // The SDK attaches event handlers to a live WebSocket, so connect first.
    agent.connect();
    const forward = (message: InboundMessage) =>
      channel.receive(message).catch((error) => log(`could not deliver ${message.messageId}: ${String(error)}`));
    agent.on.dmReceived((event) => {
      const message = fromRelayEvent("dm", event);
      if (message) forward(message);
      else log("ignored a dm.received event without a sender, id or text");
    });
    agent.on.threadReply((event) => {
      const message = fromRelayEvent("thread", event);
      if (message) forward(message);
    });
    agent.on.connected(() => {
      connected = true;
      lastError = undefined;
      log(`connected to Agent Relay as ${agentName}`);
    });
    agent.on.disconnected(() => {
      connected = false;
    });
    agent.on.permanentlyDisconnected(() => {
      connected = false;
      delivering = false;
      lastError = "disconnected from Agent Relay; restart the session to reconnect";
      log(lastError);
    });
  } catch (error) {
    delivering = false;
    agent = undefined;
    lastError = `could not connect to Agent Relay: ${error instanceof Error ? error.message : String(error)}`;
    log(lastError);
  }
} else if (note) {
  log(note);
}


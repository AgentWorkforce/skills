import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveAccess, loadAccess } from "../src/access.ts";
import { type ChannelEvent, createChannel, instructions, pairingMessage } from "../src/channel.ts";

function setup(allow: string[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-channel-"));
  const accessFile = path.join(dir, "access.json");
  saveAccess(accessFile, { dmPolicy: "pairing", allow, ids: {}, pending: {} });
  const events: ChannelEvent[] = [];
  const sent: { to: string; text: string; thread?: boolean }[] = [];
  const channel = createChannel({
    self: "me",
    accessFile,
    relay: {
      async dm(to, text) {
        sent.push({ to, text });
        return { id: `m${sent.length}` };
      },
      async threadReply(parent, text) {
        sent.push({ to: parent, text, thread: true });
        return { id: `t${sent.length}` };
      },
    },
    notify: async (event) => {
      events.push(event);
    },
  });
  return { channel, events, sent, accessFile };
}

const dm = (over: Partial<Parameters<ReturnType<typeof createChannel>["receive"]>[0]> = {}) => ({
  kind: "dm" as const,
  messageId: "1",
  sender: "alice",
  text: "hello",
  conversationId: "dm_1",
  ...over,
});

describe("channel", () => {
  test("an allowlisted sender's message becomes a channel event", async () => {
    const { channel, events } = setup(["alice"]);
    expect(await channel.receive(dm())).toBe("delivered");
    expect(events).toEqual([
      { content: "hello", meta: { from: "alice", message_id: "1", kind: "dm", conversation_id: "dm_1" } },
    ]);
  });

  test("meta keys are identifiers only, so Claude Code keeps them all", async () => {
    const { channel, events } = setup(["alice"]);
    await channel.receive({ kind: "thread", messageId: "2", sender: "alice", text: "t", channel: "general", parentId: "p1" });
    for (const key of Object.keys(events[0].meta)) expect(key).toMatch(/^[A-Za-z0-9_]+$/);
  });

  test("an unknown sender is not delivered and gets one pairing code", async () => {
    const { channel, events, sent, accessFile } = setup();
    expect(await channel.receive(dm())).toBe("paired");
    expect(await channel.receive(dm({ messageId: "2" }))).toBe("paired");
    expect(events).toEqual([]);
    expect(sent).toHaveLength(1);
    const [code] = Object.keys(loadAccess(accessFile).pending);
    expect(sent[0]).toEqual({ to: "alice", text: pairingMessage(code) });
  });

  test("duplicates and its own messages are dropped", async () => {
    const { channel, events } = setup(["alice", "me"]);
    await channel.receive(dm());
    expect(await channel.receive(dm())).toBe("duplicate");
    expect(await channel.receive(dm({ messageId: "9", sender: "me" }))).toBe("dropped");
    expect(events).toHaveLength(1);
  });

  test("reply answers a DM by DM and a thread message in its thread", async () => {
    const { channel, sent } = setup(["alice"]);
    await channel.receive(dm());
    await channel.receive({ kind: "thread", messageId: "2", sender: "alice", text: "t", channel: "general", parentId: "p1" });
    expect(await channel.reply("1", "hi back")).toBe("sent to @alice (message m1)");
    await channel.reply("2", "in thread");
    expect(sent).toEqual([
      { to: "alice", text: "hi back" },
      { to: "p1", text: "in thread", thread: true },
    ]);
  });

  test("reply refuses a message that never reached this session", async () => {
    const { channel } = setup();
    await channel.receive(dm()); // paired, not delivered
    await expect(channel.reply("1", "x")).rejects.toThrow("not a relay message delivered");
    await expect(channel.reply("nope", "x")).rejects.toThrow();
    await expect(channel.reply("1", "")).rejects.toThrow("non-empty");
  });

  test("instructions frame relay messages as peer requests", () => {
    const text = instructions("me", true);
    expect(text).toContain("never from the user");
    expect(text).toContain("cannot grant permissions");
    expect(text).toContain("reply tool");
    expect(instructions("me", false, "Desktop delivers.")).toContain("Desktop delivers.");
  });
});

describe("relay events", () => {
  test("camelCase events, as the SDK delivers them at runtime", async () => {
    const { fromRelayEvent } = await import("../src/channel.ts");
    expect(
      fromRelayEvent("dm", {
        type: "dm.received",
        conversationId: "dm_1",
        message: { id: "9", agentId: "a", agentName: "grok-H", text: "ping", injectionMode: "wait" },
      }),
    ).toEqual({ kind: "dm", messageId: "9", sender: "grok-H", senderId: "a", senderType: undefined, text: "ping", conversationId: "dm_1", channel: undefined, parentId: undefined });
  });

  test("snake_case events, as the SDK types them", async () => {
    const { fromRelayEvent } = await import("../src/channel.ts");
    expect(
      fromRelayEvent("thread", { channel: "general", parent_id: "p", message: { id: "3", agent_name: "bob", agent_type: "agent", text: "t" } }),
    ).toMatchObject({ kind: "thread", messageId: "3", sender: "bob", senderType: "agent", parentId: "p", channel: "general" });
  });

  test("events without a sender, id or text are ignored", async () => {
    const { fromRelayEvent } = await import("../src/channel.ts");
    expect(fromRelayEvent("dm", { message: { id: "1", text: "x" } })).toBeUndefined();
    expect(fromRelayEvent("dm", {})).toBeUndefined();
  });
});

describe("failures and revocation", () => {
  test("a failed notification is not marked seen, so a replay delivers it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-channel-"));
    const accessFile = path.join(dir, "access.json");
    saveAccess(accessFile, { dmPolicy: "pairing", allow: ["alice"], ids: {}, pending: {} });
    let fail = true;
    const events: ChannelEvent[] = [];
    const channel = createChannel({
      self: "me",
      accessFile,
      relay: { dm: async () => ({}), threadReply: async () => ({}) },
      notify: async (event) => {
        if (fail) throw new Error("transport closed");
        events.push(event);
      },
    });
    await expect(channel.receive(dm())).rejects.toThrow("transport closed");
    await expect(channel.reply("1", "x")).rejects.toThrow("not a relay message delivered");
    fail = false;
    expect(await channel.receive(dm())).toBe("delivered");
    expect(events).toHaveLength(1);
  });

  test("a pairing code whose DM failed is withdrawn, and the next message gets a new one", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-channel-"));
    const accessFile = path.join(dir, "access.json");
    let fail = true;
    const sent: string[] = [];
    const channel = createChannel({
      self: "me",
      accessFile,
      relay: {
        dm: async (_to, text) => {
          if (fail) throw new Error("offline");
          sent.push(text);
          return {};
        },
        threadReply: async () => ({}),
      },
      notify: async () => {},
    });
    expect(await channel.receive(dm())).toBe("paired");
    expect(loadAccess(accessFile).pending).toEqual({});
    fail = false;
    expect(await channel.receive(dm({ messageId: "2" }))).toBe("paired");
    const codes = Object.keys(loadAccess(accessFile).pending);
    expect(codes).toHaveLength(1);
    expect(sent).toEqual([pairingMessage(codes[0])]);
  });

  test("reply refuses a sender removed after its message arrived", async () => {
    const { channel, sent, accessFile } = setup(["alice"]);
    await channel.receive(dm());
    saveAccess(accessFile, { ...loadAccess(accessFile), allow: [] });
    await expect(channel.reply("1", "x")).rejects.toThrow("no longer allowed");
    saveAccess(accessFile, { ...loadAccess(accessFile), allow: ["alice"], dmPolicy: "disabled" });
    await expect(channel.reply("1", "x")).rejects.toThrow("no longer allowed");
    expect(sent).toEqual([]);
  });

  test("pairing keeps a concurrent edit to access.json", async () => {
    const { channel, accessFile } = setup(["bob"]);
    await channel.receive(dm());
    const after = loadAccess(accessFile);
    expect(after.allow).toEqual(["bob"]);
    expect(Object.values(after.pending).map((entry) => entry.sender)).toEqual(["alice"]);
  });
});

test("a message delivered before its sender was pinned stays answerable", async () => {
  const { channel, sent, accessFile } = setup(["alice"]);
  await channel.receive(dm()); // no sender id on the event
  saveAccess(accessFile, { ...loadAccess(accessFile), ids: Object.assign(Object.create(null), { alice: "id-1" }) });
  expect(await channel.reply("1", "still here")).toContain("sent to @alice");
  expect(sent).toEqual([{ to: "alice", text: "still here" }]);
});

// Runs the plugin under Bun, as OpenCode does, against a fake OpenCode
// server, and talks to its Unix socket. Skipped where Bun is not installed.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const index = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");
// The plugin opens its socket only on Unix (it needs process.getuid) and under Bun.
const bun = typeof process.getuid === "function" && spawnSync("bun", ["--version"]).status === 0;

function underBun(script, argv = [], env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ar-oc-bun-"));
  const out = execFileSync("bun", ["-e", script, "--", ...argv], {
    env: { PATH: process.env.PATH, HOME: home, ...env },
    encoding: "utf8",
    timeout: 20000,
  });
  return JSON.parse(out.trim().split("\n").pop());
}

const prelude = `
  const { server: AgentRelay } = (await import(${JSON.stringify(index)})).default;
  const prompts = [];
  const fake = async (request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/prompt_async")) { prompts.push(await request.json()); return new Response(null, { status: 204 }); }
    return Response.json({ id: "ses_abcd1234", directory: "/w" });
  };
  const client = { _client: { getConfig: () => ({ baseUrl: "http://opencode.internal", fetch: fake, headers: {} }) } };
  const hooks = await AgentRelay({ client, directory: "/w" });
  const socket = (await import("node:path")).join(process.env.HOME, ".agentworkforce/desktop/opencode", process.pid + ".sock");
  const post = (body) => fetch("http://x/session/ses_abcd1234/prompt_async", { method: "POST", unix: socket, body }).then((r) => r.status);
`;

test("a held session takes one msg_relay_ prompt; null and arrays are 400", { skip: !bun }, () => {
  const result = underBun(`${prelude}
    await hooks.event({ event: { type: "session.created", properties: { info: { id: "ses_abcd1234", directory: "/w" } } } });
    const statuses = [
      await post("null"),
      await post("[]"),
      await post("7"),
      await post(JSON.stringify({ messageID: "msg_relay_" + "a".repeat(32), parts: [{ type: "text", text: "hi" }] })),
    ];
    console.log(JSON.stringify({ statuses, prompts: prompts.length }));
    process.exit(0);`);
  assert.deepEqual(result, { statuses: [400, 400, 400, 204], prompts: 1 });
});

test("a session the process does not hold is 404", { skip: !bun }, () => {
  const result = underBun(`${prelude}
    console.log(JSON.stringify({ status: await post("null") }));
    process.exit(0);`);
  assert.deepEqual(result, { status: 404 });
});

const held = `${prelude}
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const record = JSON.parse((await import("node:fs")).readFileSync(socket.replace(/sock$/, "json"), "utf8"));
  console.log(JSON.stringify(record.sessions.map((session) => session.id)));
  process.exit(0);`;

test("--session <id> holds that session", { skip: !bun }, () => {
  assert.deepEqual(underBun(held, ["--session", "ses_abcd1234"]), ["ses_abcd1234"]);
});

test("--session <id> --fork never holds the source session", { skip: !bun }, () => {
  assert.deepEqual(underBun(held, ["--session", "ses_abcd1234", "--fork"]), []);
  assert.deepEqual(underBun(held, ["--session", "ses_abcd1234", "--fork=true"]), []);
  assert.deepEqual(underBun(held, ["--session", "ses_abcd1234", "--fork=false"]), ["ses_abcd1234"]);
});

test("the dispose hook tears the instance down", { skip: !bun }, () => {
  const result = underBun(`${prelude}
    const fs = await import("node:fs");
    const before = fs.existsSync(socket);
    await hooks.dispose();
    const after = [fs.existsSync(socket), fs.existsSync(socket.replace(/sock$/, "json")), process.listenerCount("exit")];
    const next = Object.keys(await (await import(${JSON.stringify(index)} + "?copy=d")).default.server({ client, directory: "/w" }));
    console.log(JSON.stringify({ before, after, next }));
    process.exit(0);`);
  assert.deepEqual(result, { before: true, after: [false, false, 0], next: ["shell.env", "dispose", "event"] });
});

test("disposing the instance releases the claim for the next load", { skip: !bun }, () => {
  const result = underBun(`${prelude}
    const before = Object.keys(await (await import(${JSON.stringify(index)} + "?copy=b")).default.server({ client, directory: "/w" }));
    await hooks.event({ event: { type: "server.instance.disposed", properties: {} } });
    const after = Object.keys(await (await import(${JSON.stringify(index)} + "?copy=c")).default.server({ client, directory: "/w" }));
    console.log(JSON.stringify({ before, after }));
    process.exit(0);`);
  assert.deepEqual(result, { before: [], after: ["shell.env", "dispose", "event"] });
});

test("disposing stops the listener and removes the socket and record", { skip: !bun }, () => {
  const result = underBun(`${prelude}
    const fs = await import("node:fs");
    await hooks.event({ event: { type: "session.created", properties: { info: { id: "ses_abcd1234", directory: "/w" } } } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const before = [fs.existsSync(socket), fs.existsSync(socket.replace(/sock$/, "json"))];
    await hooks.event({ event: { type: "server.instance.disposed", properties: {} } });
    await hooks.event({ event: { type: "session.created", properties: { info: { id: "ses_efgh5678", directory: "/w" } } } });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const after = [fs.existsSync(socket), fs.existsSync(socket.replace(/sock$/, "json"))];
    let refused = false;
    try { await post("null"); } catch { refused = true; }
    console.log(JSON.stringify({ before, after, refused, exitHooks: process.listenerCount("exit") }));
    process.exit(0);`);
  assert.deepEqual(result, { before: [true, true], after: [false, false], refused: true, exitHooks: 0 });
});

test("the V2 definition uses public APIs and preserves the desktop protocol", { skip: !bun }, () => {
  const result = underBun(`
    const plugin = (await import(${JSON.stringify(index)} + "?v2=1")).default;
    const prompts = [];
    let shellHook;
    let shellDisposed = false;
    const context = {
      location: { directory: "/w", workspaceID: "ws_abcd", project: { id: "prj_abcd", directory: "/w", canonical: "/w" } },
      shell: { hook: async (name, callback) => { shellHook = callback; return { dispose: async () => { shellDisposed = true; } }; } },
      session: {
        get: async ({ sessionID }) => ({
          id: sessionID, projectID: "prj_abcd", title: "V2 session",
          location: { directory: "/w" }, time: { created: 1, updated: 2 },
        }),
        context: async () => [
          { id: "msg_relay_" + "a".repeat(32), type: "user", text: "hello", time: { created: 3 } },
          { id: "msg_answer1234", type: "assistant", finish: "stop", time: { created: 4, completed: 5 }, content: [
            { type: "text", text: "hi" },
            { type: "tool", id: "tool_1", name: "websearch", executed: true, state: { status: "completed", input: {}, content: [{ type: "text", text: "done" }] }, time: { created: 4, completed: 5 } },
          ] },
        ],
        prompt: async (input) => { prompts.push(input); },
      },
      event: {
        subscribe: async function* ({ signal }) {
          yield { type: "session.created", created: 1, data: { sessionID: "ses_abcd1234", projectID: "prj_abcd", location: { directory: "/w" }, title: "V2 session" } };
          yield { type: "session.execution.started", created: 2, location: { directory: "/w" }, data: { sessionID: "ses_abcd1234" } };
          await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        },
      },
    };
    const cleanup = await plugin.setup(context);
    const path = await import("node:path");
    const fs = await import("node:fs");
    const socket = path.join(process.env.HOME, ".agentworkforce/desktop/opencode", process.pid + ".sock");
    const call = (pathname, options) => fetch("http://x" + pathname, { ...options, unix: socket });
    const waitForSession = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (fs.existsSync(socket)) {
          try {
            const response = await call("/session/ses_abcd1234");
            if (response.status === 200) return response.json();
          } catch {}
        }
        await Bun.sleep(20);
      }
      throw new Error("timed out waiting for the V2 session endpoint");
    };
    let observed;
    try {
      const session = await waitForSession();
      const status = await (await call("/session/status")).json();
      const messages = await (await call("/session/ses_abcd1234/message")).json();
      const exact = await (await call("/session/ses_abcd1234/message/msg_answer1234")).json();
      const accepted = await call("/session/ses_abcd1234/prompt_async", {
        method: "POST",
        body: JSON.stringify({ messageID: "msg_relay_" + "b".repeat(32), parts: [{ type: "text", text: "from relay" }] }),
      });
      const env = { OPENCODE_SESSION_ID: "ses_abcd1234" };
      await shellHook({ env });
      let secondHooks = 0;
      const second = await plugin.setup({
        ...context,
        location: { ...context.location, directory: "/other" },
        shell: { hook: async () => { secondHooks++; return { dispose: async () => {} }; } },
      });
      observed = {
        shape: [plugin.id, typeof plugin.setup, typeof plugin.server],
        session: [session.id, session.directory, session.workspaceID],
        status: status.ses_abcd1234.type,
        user: [messages[0].info.role, messages[0].parts[0].text],
        answer: [exact.info.parentID, exact.parts[0].text, exact.parts[1].metadata.providerExecuted, exact.parts.at(-1).type],
        accepted: accepted.status,
        prompt: prompts[0],
        env,
        second: [second === undefined, secondHooks],
      };
    } finally {
      await cleanup();
    }
    observed.cleaned = [shellDisposed, fs.existsSync(socket)];
    console.log(JSON.stringify(observed));
    process.exit(0);
  `);
  assert.deepEqual(result, {
    shape: ["agent-relay", "function", "function"],
    session: ["ses_abcd1234", "/w", "ws_abcd"],
    status: "busy",
    user: ["user", "hello"],
    answer: ["msg_relay_" + "a".repeat(32), "hi", true, "step-finish"],
    accepted: 204,
    prompt: {
      sessionID: "ses_abcd1234",
      id: "msg_relay_" + "b".repeat(32),
      text: "from relay",
      delivery: "steer",
    },
    env: { OPENCODE_SESSION_ID: "ses_abcd1234", AGENT_RELAY_OPENCODE_SESSION: "ses_abcd1234" },
    second: [true, 0],
    cleaned: [true, false],
  });
});

test("a failed V2 steer does not overwrite an event-derived busy status", { skip: !bun }, () => {
  const result = underBun(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const plugin = (await import(${JSON.stringify(index)} + "?v2=failed-steer")).default;
    const context = {
      location: { directory: "/w", project: { id: "prj_abcd", directory: "/w", canonical: "/w" } },
      shell: { hook: async () => ({ dispose: async () => {} }) },
      session: {
        get: async ({ sessionID }) => ({ id: sessionID, projectID: "prj_abcd", location: { directory: "/w" }, time: { created: 1, updated: 2 } }),
        context: async () => [],
        prompt: async () => { throw Object.assign(new Error("steer rejected"), { status: 409 }); },
      },
      event: { subscribe: async function* ({ signal }) {
        yield { type: "session.created", created: 1, data: { sessionID: "ses_abcd1234", projectID: "prj_abcd", location: { directory: "/w" } } };
        yield { type: "session.execution.started", created: 2, data: { sessionID: "ses_abcd1234" } };
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      } },
    };
    const cleanup = await plugin.setup(context);
    const socket = path.join(process.env.HOME, ".agentworkforce/desktop/opencode", process.pid + ".sock");
    const call = (pathname, options) => fetch("http://x" + pathname, { ...options, unix: socket });
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (fs.existsSync(socket)) {
          try { if ((await call("/session/ses_abcd1234")).status === 200) break; } catch {}
        }
        await Bun.sleep(20);
      }
      const before = await (await call("/session/status")).json();
      const rejected = await call("/session/ses_abcd1234/prompt_async", {
        method: "POST",
        body: JSON.stringify({ messageID: "msg_relay_" + "d".repeat(32), parts: [{ type: "text", text: "steer" }] }),
      });
      const after = await (await call("/session/status")).json();
      console.log(JSON.stringify({ before, rejected: rejected.status, after }));
    } finally {
      await cleanup();
    }
    process.exit(0);
  `);
  assert.deepEqual(result, {
    before: { ses_abcd1234: { type: "busy" } },
    rejected: 409,
    after: { ses_abcd1234: { type: "busy" } },
  });
});

test("concurrent failed V2 steers clear only their own pending status", { skip: !bun }, () => {
  const result = underBun(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const plugin = (await import(${JSON.stringify(index)} + "?v2=concurrent-failed-steers")).default;
    const rejectors = [];
    const context = {
      location: { directory: "/w", project: { id: "prj_abcd", directory: "/w", canonical: "/w" } },
      shell: { hook: async () => ({ dispose: async () => {} }) },
      session: {
        get: async ({ sessionID }) => ({ id: sessionID, projectID: "prj_abcd", location: { directory: "/w" }, time: { created: 1, updated: 2 } }),
        context: async () => [],
        prompt: () => new Promise((_, reject) => rejectors.push(reject)),
      },
      event: { subscribe: async function* ({ signal }) {
        yield { type: "session.created", created: 1, data: { sessionID: "ses_abcd1234", projectID: "prj_abcd", location: { directory: "/w" } } };
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      } },
    };
    const cleanup = await plugin.setup(context);
    const socket = path.join(process.env.HOME, ".agentworkforce/desktop/opencode", process.pid + ".sock");
    const call = (pathname, options) => fetch("http://x" + pathname, { ...options, unix: socket });
    const post = (suffix) => call("/session/ses_abcd1234/prompt_async", {
      method: "POST",
      body: JSON.stringify({ messageID: "msg_relay_" + suffix.repeat(32), parts: [{ type: "text", text: "steer" }] }),
    });
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (fs.existsSync(socket)) {
          try { if ((await call("/session/ses_abcd1234")).status === 200) break; } catch {}
        }
        await Bun.sleep(20);
      }
      const idle = await (await call("/session/status")).json();
      const first = post("e");
      for (let attempt = 0; attempt < 100 && rejectors.length < 1; attempt++) await Bun.sleep(10);
      const second = post("f");
      for (let attempt = 0; attempt < 100 && rejectors.length < 2; attempt++) await Bun.sleep(10);
      if (rejectors.length !== 2) throw new Error("timed out waiting for concurrent steers");
      const busy = await (await call("/session/status")).json();
      const error = () => Object.assign(new Error("steer rejected"), { status: 409 });
      rejectors[0](error());
      const firstRejected = await first;
      const afterFirst = await (await call("/session/status")).json();
      rejectors[1](error());
      const secondRejected = await second;
      const after = await (await call("/session/status")).json();
      console.log(JSON.stringify({
        idle,
        busy,
        firstRejected: firstRejected.status,
        afterFirst,
        secondRejected: secondRejected.status,
        after,
      }));
    } finally {
      await cleanup();
    }
    process.exit(0);
  `);
  assert.deepEqual(result, {
    idle: { ses_abcd1234: { type: "idle" } },
    busy: { ses_abcd1234: { type: "busy" } },
    firstRejected: 409,
    afterFirst: { ses_abcd1234: { type: "busy" } },
    secondRejected: 409,
    after: { ses_abcd1234: { type: "idle" } },
  });
});

test("an older failed V2 steer cannot clear a newer pending steer", { skip: !bun }, () => {
  const result = underBun(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const plugin = (await import(${JSON.stringify(index)} + "?v2=interleaved-failed-steers")).default;
    const queued = [];
    const waiters = [];
    const rejectors = [];
    const emit = (event) => (waiters.shift()?.(event) ?? queued.push(event));
    const context = {
      location: { directory: "/w", project: { id: "prj_abcd", directory: "/w", canonical: "/w" } },
      shell: { hook: async () => ({ dispose: async () => {} }) },
      session: {
        get: async ({ sessionID }) => ({ id: sessionID, projectID: "prj_abcd", location: { directory: "/w" }, time: { created: 1, updated: 2 } }),
        context: async () => [],
        prompt: () => new Promise((_, reject) => rejectors.push(reject)),
      },
      event: { subscribe: async function* ({ signal }) {
        while (!signal.aborted) {
          const event = queued.shift() ?? await new Promise((resolve) => {
            waiters.push(resolve);
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          if (!event) return;
          yield event;
        }
      } },
    };
    const cleanup = await plugin.setup(context);
    const socket = path.join(process.env.HOME, ".agentworkforce/desktop/opencode", process.pid + ".sock");
    const call = (pathname, options) => fetch("http://x" + pathname, { ...options, unix: socket });
    const post = (suffix) => call("/session/ses_abcd1234/prompt_async", {
      method: "POST",
      body: JSON.stringify({ messageID: "msg_relay_" + suffix.repeat(32), parts: [{ type: "text", text: "steer" }] }),
    });
    const status = async () => (await (await call("/session/status")).json()).ses_abcd1234.type;
    try {
      emit({ type: "session.created", created: 1, data: { sessionID: "ses_abcd1234", projectID: "prj_abcd", location: { directory: "/w" } } });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (fs.existsSync(socket)) {
          try { if ((await call("/session/ses_abcd1234")).status === 200) break; } catch {}
        }
        await Bun.sleep(20);
      }
      const first = post("1");
      for (let attempt = 0; attempt < 100 && rejectors.length < 1; attempt++) await Bun.sleep(10);
      emit({ type: "session.execution.succeeded", created: 2, data: { sessionID: "ses_abcd1234" } });
      for (let attempt = 0; attempt < 100 && await status() !== "idle"; attempt++) await Bun.sleep(10);
      const second = post("2");
      for (let attempt = 0; attempt < 100 && rejectors.length < 2; attempt++) await Bun.sleep(10);
      if (rejectors.length !== 2) throw new Error("timed out waiting for interleaved steers");
      const error = () => Object.assign(new Error("steer rejected"), { status: 409 });
      rejectors[0](error());
      const rejectedFirst = await first;
      const afterFirst = await status();
      rejectors[1](error());
      const rejectedSecond = await second;
      const afterSecond = await status();
      console.log(JSON.stringify({ rejected: [rejectedFirst.status, rejectedSecond.status], afterFirst, afterSecond }));
    } finally {
      await cleanup();
    }
    process.exit(0);
  `);
  assert.deepEqual(result, { rejected: [409, 409], afterFirst: "busy", afterSecond: "idle" });
});

test("a failed V2 shell hook releases the claim for the next load", { skip: !bun }, () => {
  const result = underBun(`
    const failing = (await import(${JSON.stringify(index)} + "?v2=shell-failure")).default;
    const valid = (await import(${JSON.stringify(index)} + "?v2=after-shell-failure")).default;
    let rejected = false;
    try {
      await failing.setup({
        location: { directory: "/w" },
        shell: { hook: async () => { throw new Error("hook unavailable"); } },
      });
    } catch { rejected = true; }
    let hooks = 0;
    const cleanup = await valid.setup({
      location: { directory: "/w", project: { id: "prj_abcd", directory: "/w", canonical: "/w" } },
      shell: { hook: async () => { hooks++; return { dispose: async () => {} }; } },
      session: {
        get: async ({ sessionID }) => ({ id: sessionID, projectID: "prj_abcd", location: { directory: "/w" }, time: {} }),
        context: async () => [],
        prompt: async () => {},
      },
      event: { subscribe: async function* ({ signal }) {
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      } },
    });
    const loaded = typeof cleanup === "function";
    await cleanup();
    console.log(JSON.stringify({ rejected, hooks, loaded }));
    process.exit(0);
  `);
  assert.deepEqual(result, { rejected: true, hooks: 1, loaded: true });
});

test("an unavailable private runtime stays shell-only and releases the V2 claim", { skip: !bun }, () => {
  const result = underBun(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const runtime = path.join(process.env.HOME, ".agentworkforce/desktop/opencode");
    fs.mkdirSync(runtime, { recursive: true, mode: 0o755 });
    fs.chmodSync(runtime, 0o755);
    let hooks = 0, subscriptions = 0, disposals = 0;
    const context = {
      location: { directory: "/tmp", project: { id: "prj_abcd", directory: "/tmp", canonical: "/tmp" } },
      shell: { hook: async () => { hooks++; return { dispose: async () => { disposals++; } }; } },
      session: {},
      event: { subscribe: () => { subscriptions++; throw new Error("must not subscribe"); } },
    };
    const first = (await import(${JSON.stringify(index)} + "?v2=unavailable-a")).default;
    const second = (await import(${JSON.stringify(index)} + "?v2=unavailable-b")).default;
    const cleanupA = await first.setup(context);
    const cleanupB = await second.setup(context);
    await cleanupA();
    await cleanupB();
    console.log(JSON.stringify({ hooks, subscriptions, disposals }));
    process.exit(0);
  `);
  assert.deepEqual(result, { hooks: 2, subscriptions: 0, disposals: 2 });
});

test("V2 --continue discovers an idle resumed session through the public CLI", { skip: !bun }, () => {
  const cliSource = `#!/bin/sh
[ "$AGENT_RELAY_MANAGED_SESSION_MARKER" = 1 ] || exit 9
[ "$6" = 1000 ] || exit 8
printf '%s\\n' '[{"id":"ses_archived1","title":"Archived","updated":11,"created":1,"projectId":"prj_abcd","directory":"/tmp"},{"id":"ses_child123","title":"Child","updated":10,"created":1,"projectId":"prj_abcd","directory":"/tmp"},{"id":"ses_continue1","title":"Resumed","updated":9,"created":1,"projectId":"prj_abcd","directory":"/tmp"}]'
`;
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "ar-oc-cli-"));
  fs.writeFileSync(path.join(bin, "opencode"), cliSource);
  fs.chmodSync(path.join(bin, "opencode"), 0o755);
  const result = underBun(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const plugin = (await import(${JSON.stringify(index)} + "?v2=continue")).default;
    const sessions = {
      ses_continue1: { id: "ses_continue1", title: "Resumed", projectID: "prj_abcd", location: { directory: "/tmp" }, time: { created: 1, updated: 9 } },
      ses_child123: { id: "ses_child123", parentID: "ses_continue1", title: "Child", projectID: "prj_abcd", location: { directory: "/tmp" }, time: { created: 1, updated: 10 } },
      ses_archived1: { id: "ses_archived1", title: "Archived", projectID: "prj_abcd", location: { directory: "/tmp" }, time: { created: 1, updated: 11, archived: 12 } },
    };
    const context = {
      location: { directory: "/tmp", project: { id: "prj_abcd", directory: "/tmp", canonical: "/tmp" } },
      shell: { hook: async () => ({ dispose: async () => {} }) },
      session: { get: async ({ sessionID }) => sessions[sessionID], context: async () => [], prompt: async () => {} },
      event: { subscribe: async function* ({ signal }) { await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true })); } },
    };
    const cleanup = await plugin.setup(context);
    const runtime = path.join(process.env.HOME, ".agentworkforce/desktop/opencode");
    const recordPath = path.join(runtime, process.pid + ".json");
    const socket = path.join(runtime, process.pid + ".sock");
    let record;
    let idle;
    let busy;
    let accepted;
    try {
      for (let attempt = 0; attempt < 120; attempt++) {
        try {
          record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
          if (record.sessions.some((session) => session.id === "ses_continue1")) break;
        } catch {}
        await Bun.sleep(50);
      }
      if (!record?.sessions.some((session) => session.id === "ses_continue1")) {
        throw new Error("timed out waiting for resumed session discovery");
      }
      idle = await (await fetch("http://x/session/status", { unix: socket })).json();
      accepted = await fetch("http://x/session/ses_continue1/prompt_async", {
        method: "POST",
        unix: socket,
        body: JSON.stringify({ messageID: "msg_relay_" + "c".repeat(32), parts: [{ type: "text", text: "resume" }] }),
      });
      busy = await (await fetch("http://x/session/status", { unix: socket })).json();
    } finally {
      await cleanup();
    }
    console.log(JSON.stringify({ sessions: record.sessions, idle, accepted: accepted.status, busy }));
    process.exit(0);
  `, ["--continue"], { PATH: bin + ":" + process.env.PATH });
  assert.deepEqual(result, {
    sessions: [{ id: "ses_continue1", title: "Resumed", directory: "/tmp", updated: 9 }],
    idle: { ses_continue1: { type: "idle" } },
    accepted: 204,
    busy: { ses_continue1: { type: "busy" } },
  });
});

test("V2 --continue never falls back when the newest session cannot be verified", { skip: !bun }, () => {
  const cliSource = `#!/bin/sh
[ "$AGENT_RELAY_MANAGED_SESSION_MARKER" = 1 ] || exit 9
[ "$6" = 1000 ] || exit 8
printf '%s\\n' '[{"id":"ses_newest12","title":"Newest","updated":10,"created":1,"projectId":"prj_abcd","directory":"/tmp"},{"id":"ses_older123","title":"Older","updated":9,"created":1,"projectId":"prj_abcd","directory":"/tmp"}]'
`;
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "ar-oc-cli-fail-"));
  fs.writeFileSync(path.join(bin, "opencode"), cliSource);
  fs.chmodSync(path.join(bin, "opencode"), 0o755);
  const result = underBun(`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const plugin = (await import(${JSON.stringify(index)} + "?v2=continue-fail")).default;
    const calls = [];
    const context = {
      location: { directory: "/tmp", project: { id: "prj_abcd", directory: "/tmp", canonical: "/tmp" } },
      shell: { hook: async () => ({ dispose: async () => {} }) },
      session: {
        get: async ({ sessionID }) => {
          calls.push(sessionID);
          if (sessionID === "ses_newest12") throw new Error("transient lookup failure");
          return { id: sessionID, title: "Older", projectID: "prj_abcd", location: { directory: "/tmp" }, time: { created: 1, updated: 9 } };
        },
        context: async () => [],
        prompt: async () => {},
      },
      event: { subscribe: async function* ({ signal }) { await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true })); } },
    };
    const cleanup = await plugin.setup(context);
    try {
      for (let attempt = 0; attempt < 120 && calls.length === 0; attempt++) await Bun.sleep(50);
      if (calls.length === 0) throw new Error("timed out waiting for resumed session verification");
      await Bun.sleep(50);
      const record = JSON.parse(fs.readFileSync(path.join(process.env.HOME, ".agentworkforce/desktop/opencode", process.pid + ".json"), "utf8"));
      console.log(JSON.stringify({ calls, sessions: record.sessions }));
    } finally {
      await cleanup();
    }
    process.exit(0);
  `, ["--continue"], { PATH: bin + ":" + process.env.PATH });
  assert.deepEqual(result, { calls: ["ses_newest12"], sessions: [] });
});

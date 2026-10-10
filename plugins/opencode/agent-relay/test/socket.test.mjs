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

function underBun(script, argv = []) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ar-oc-bun-"));
  const out = execFileSync("bun", ["-e", script, "--", ...argv], {
    env: { PATH: process.env.PATH, HOME: home },
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
          { id: "msg_answer1234", type: "assistant", finish: "stop", time: { created: 4, completed: 5 }, content: [{ type: "text", text: "hi" }] },
        ],
        prompt: async (input) => { prompts.push(input); },
      },
      event: {
        subscribe: async function* ({ signal }) {
          yield { type: "session.created", created: 1, data: { sessionID: "ses_abcd1234", projectID: "prj_abcd", location: { directory: "/w" }, title: "V2 session" } };
          yield { type: "session.status", created: 2, data: { sessionID: "ses_abcd1234", status: { type: "idle" } } };
          await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        },
      },
    };
    const cleanup = await plugin.setup(context);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const path = await import("node:path");
    const fs = await import("node:fs");
    const socket = path.join(process.env.HOME, ".agentworkforce/desktop/opencode", process.pid + ".sock");
    const call = (pathname, options) => fetch("http://x" + pathname, { ...options, unix: socket });
    const session = await (await call("/session/ses_abcd1234")).json();
    const status = await (await call("/session/status")).json();
    const messages = await (await call("/session/ses_abcd1234/message")).json();
    const exact = await (await call("/session/ses_abcd1234/message/msg_answer1234")).json();
    const accepted = await call("/session/ses_abcd1234/prompt_async", {
      method: "POST",
      body: JSON.stringify({ messageID: "msg_relay_" + "b".repeat(32), parts: [{ type: "text", text: "from relay" }] }),
    });
    const env = { OPENCODE_SESSION_ID: "ses_abcd1234" };
    await shellHook({ env });
    await cleanup();
    console.log(JSON.stringify({
      shape: [plugin.id, typeof plugin.setup, typeof plugin.server],
      session: [session.id, session.directory, session.workspaceID],
      status: status.ses_abcd1234.type,
      user: [messages[0].info.role, messages[0].parts[0].text],
      answer: [exact.info.parentID, exact.parts[0].text, exact.parts.at(-1).type],
      accepted: accepted.status,
      prompt: prompts[0],
      env,
      cleaned: [shellDisposed, fs.existsSync(socket)],
    }));
    process.exit(0);
  `);
  assert.deepEqual(result, {
    shape: ["agent-relay", "function", "function"],
    session: ["ses_abcd1234", "/w", "ws_abcd"],
    status: "idle",
    user: ["user", "hello"],
    answer: ["msg_relay_" + "a".repeat(32), "hi", "step-finish"],
    accepted: 204,
    prompt: {
      sessionID: "ses_abcd1234",
      id: "msg_relay_" + "b".repeat(32),
      text: "from relay",
      delivery: "steer",
    },
    env: { OPENCODE_SESSION_ID: "ses_abcd1234", AGENT_RELAY_OPENCODE_SESSION: "ses_abcd1234" },
    cleaned: [true, false],
  });
});

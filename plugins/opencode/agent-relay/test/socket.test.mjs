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
const bun = spawnSync("bun", ["--version"]).status === 0;

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
  const { AgentRelay } = await import(${JSON.stringify(index)});
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
});

test("disposing the instance releases the claim for the next load", { skip: !bun }, () => {
  const result = underBun(`${prelude}
    const before = Object.keys(await (await import(${JSON.stringify(index)} + "?copy=b")).AgentRelay({ client, directory: "/w" }));
    await hooks.event({ event: { type: "server.instance.disposed", properties: {} } });
    const after = Object.keys(await (await import(${JSON.stringify(index)} + "?copy=c")).AgentRelay({ client, directory: "/w" }));
    console.log(JSON.stringify({ before, after }));
    process.exit(0);`);
  assert.deepEqual(result, { before: [], after: ["shell.env", "event"] });
});

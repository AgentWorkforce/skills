// Runs the plugin in a fresh Node process per case (no Bun, so it never opens
// a socket) to check when it stays out of the way.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const index = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");

// Loads the plugin `times` times in one process and reports the hook names
// each call returned.
function run({ files = {}, env = {}, times = 1 }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ar-opencode-"));
  const plugins = path.join(home, ".config", "opencode", "plugins");
  fs.mkdirSync(plugins, { recursive: true });
  for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(plugins, name), contents);
  const script = `
    const { AgentRelay } = await import(${JSON.stringify(index)});
    const out = [];
    for (let i = 0; i < ${times}; i++) out.push(Object.keys(await AgentRelay({ client: {}, directory: "/w" })));
    console.log(JSON.stringify(out));`;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { PATH: process.env.PATH, HOME: home, ...env },
    encoding: "utf8",
  });
  return JSON.parse(stdout);
}

test("serves when the desktop's copy is not installed", () => {
  assert.deepEqual(run({}), [["shell.env"]]);
});

test("stays out when the desktop's copy is installed", () => {
  const desktop = "// Agent Relay for OpenCode.\n// edits are overwritten. AGENT_RELAY_OPENCODE_PLUGIN=2\n";
  assert.deepEqual(run({ files: { "agent-relay.js": desktop } }), [[]]);
});

test("serves when someone else's agent-relay.js is there", () => {
  assert.deepEqual(run({ files: { "agent-relay.js": "export const Mine = async () => ({});\n" } }), [["shell.env"]]);
});

test("stays out when the desktop's OpenCode setting was turned off", () => {
  assert.deepEqual(run({ files: { "agent-relay.js.off": "" } }), [[]]);
});

test("follows XDG_CONFIG_HOME like OpenCode and the desktop", () => {
  const xdg = fs.mkdtempSync(path.join(os.tmpdir(), "ar-xdg-"));
  fs.mkdirSync(path.join(xdg, "opencode", "plugins"), { recursive: true });
  fs.writeFileSync(path.join(xdg, "opencode", "plugins", "agent-relay.js.off"), "");
  assert.deepEqual(run({ env: { XDG_CONFIG_HOME: xdg } }), [[]]);
});

test("a second copy in the same process stays out", () => {
  assert.deepEqual(run({ times: 2 }), [["shell.env"], []]);
});

test("a session the relay launched itself is left alone", () => {
  assert.deepEqual(run({ env: { AGENT_RELAY_MANAGED_SESSION_MARKER: "x" } }), [[]]);
});

test("the shell hook tags only valid session ids", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ar-opencode-"));
  const script = `
    const { AgentRelay } = await import(${JSON.stringify(index)});
    const hooks = await AgentRelay({ client: {}, directory: "/w" });
    const ok = { env: {} }, bad = { env: {} }, none = {};
    await hooks["shell.env"]({ sessionID: "ses_abcd1234" }, ok);
    await hooks["shell.env"]({ sessionID: "../etc" }, bad);
    await hooks["shell.env"]({ sessionID: "ses_abcd1234" }, none);
    console.log(JSON.stringify([ok.env, bad.env, none.env]));`;
  const out = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { PATH: process.env.PATH, HOME: home },
      encoding: "utf8",
    }),
  );
  assert.deepEqual(out, [
    { AGENT_RELAY_OPENCODE_SESSION: "ses_abcd1234" },
    {},
    { AGENT_RELAY_OPENCODE_SESSION: "ses_abcd1234" },
  ]);
});

test("index.js keeps the desktop's allow-list", () => {
  const source = fs.readFileSync(index, "utf8");
  assert.match(source, /msg_relay_\[0-9a-f\]\{32\}/);
  assert.ok(source.includes("prompt_async"));
  assert.ok(!source.includes("/abort"));
  assert.ok(!/__RUNTIME__|__VERSION__/.test(source));
  // A copy of this file in the plugins directory must not look like the
  // desktop's, which the desktop would then manage.
  const head = source.split("\n").slice(0, 5).join("\n");
  assert.ok(!head.includes("AGENT_RELAY_OPENCODE_PLUGIN="));
});

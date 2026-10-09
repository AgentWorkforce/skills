import { describe, expect, test } from "bun:test";
import { MAX_PENDING, PAIR_TTL_MS, decide, defaultAccess, loadAccess, pair, saveAccess, updateAccess } from "../src/access.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("access", () => {
  test("an unknown sender gets one pairing code, reused on repeat", () => {
    const access = defaultAccess();
    const first = decide(access, "alice", 1000);
    expect(first.action).toBe("pair");
    const again = decide(access, "alice", 2000);
    expect(again).toEqual({ action: "pair", code: (first as { code: string }).code, fresh: false });
  });

  test("pairing approves the sender, who is then delivered", () => {
    const access = defaultAccess();
    const { code } = decide(access, "alice", 1000) as { code: string };
    expect(pair(access, code.toUpperCase(), 2000)).toBe("alice");
    expect(access.allow).toEqual(["alice"]);
    expect(access.pending).toEqual({});
    expect(access.ids).toEqual({});
    expect(decide(access, "alice", 3000)).toEqual({ action: "deliver" });
  });

  test("codes expire", () => {
    const access = defaultAccess();
    const { code } = decide(access, "alice", 0) as { code: string };
    expect(pair(access, code, PAIR_TTL_MS + 1)).toBeUndefined();
    expect(access.allow).toEqual([]);
  });

  test("pending requests are capped", () => {
    const access = defaultAccess();
    for (let i = 0; i < MAX_PENDING; i++) expect(decide(access, `agent-${i}`, 0).action).toBe("pair");
    expect(decide(access, "one-too-many", 0).action).toBe("drop");
  });

  test("allowlist and disabled policies never issue codes", () => {
    const access = { ...defaultAccess(), dmPolicy: "allowlist" as const, allow: ["bob"] };
    expect(decide(access, "alice").action).toBe("drop");
    expect(decide(access, "bob").action).toBe("deliver");
    access.dmPolicy = "disabled" as never;
    expect(decide(access, "bob").action).toBe("drop");
  });

  test("invalid sender names are dropped", () => {
    expect(decide(defaultAccess(), "../etc").action).toBe("drop");
    expect(decide(defaultAccess(), "").action).toBe("drop");
  });

  test("load is lenient and save is private", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-channel-"));
    try {
    const file = path.join(dir, "state", "access.json");
    expect(loadAccess(file)).toEqual(defaultAccess());
    saveAccess(file, { dmPolicy: "allowlist", allow: ["bob", "bob", "../x"], ids: { bob: "id-b", "../x": "y" }, pending: {} });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(loadAccess(file)).toEqual({ dmPolicy: "allowlist", allow: ["bob"], ids: { bob: "id-b" }, pending: {} });
    fs.writeFileSync(file, "not json");
    expect(loadAccess(file).dmPolicy).toBe("pairing");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("locked updates from several processes keep every edit", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-lock-"));
    try {
      const file = path.join(dir, "access.json");
      const access = new URL("../src/access.ts", import.meta.url).href;
      const writers = Array.from({ length: 6 }, (_, i) =>
        Bun.spawn(["bun", "-e", `const { updateAccess } = await import(${JSON.stringify(access)}); for (let j = 0; j < 10; j++) updateAccess(${JSON.stringify(file)}, (a) => { a.allow.push("agent-${i}-" + j); });`]),
      );
      await Promise.all(writers.map((w) => w.exited));
      expect(loadAccess(file).allow).toHaveLength(60);
      expect(fs.existsSync(`${file}.lock`)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sender ids", () => {
  test("pairing pins the agent id, and the same name from another agent must pair again", () => {
    const access = defaultAccess();
    const { code } = decide(access, "alice", 0, "id-1") as { code: string };
    pair(access, code, 1);
    expect(access.ids).toEqual({ alice: "id-1" });
    expect(decide(access, "alice", 2, "id-1")).toEqual({ action: "deliver" });
    expect(decide(access, "alice", 3, "id-2").action).toBe("pair");
  });

  test("a name allowed by hand is pinned to the first agent id that uses it", () => {
    const access = { ...defaultAccess(), allow: ["bob"] };
    expect(decide(access, "bob", 0, "id-b")).toEqual({ action: "deliver", pin: "id-b" });
    access.ids.bob = "id-b";
    expect(decide(access, "bob", 0, "id-x").action).toBe("pair");
  });
});

test("agents named after Object.prototype keys are paired and pinned like any other", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-proto-"));
  try {
    const file = path.join(dir, "access.json");
    for (const name of ["constructor", "toString", "hasOwnProperty"]) {
      // Allowed by hand: on a plain object, ids[name] would already be a
      // function, so the first message would be refused instead of pinned.
      const byHand = { ...defaultAccess(), allow: [name] };
      expect(decide(byHand, name, 0, "id-1")).toEqual({ action: "deliver", pin: "id-1" });
      const access = defaultAccess();
      const { code } = decide(access, name, 0, "id-p") as { code: string };
      pair(access, code, 1);
      saveAccess(file, access);
      const loaded = loadAccess(file);
      expect(Object.keys(loaded.ids)).toEqual([name]);
      expect(decide(loaded, name, 2, "id-p")).toEqual({ action: "deliver" });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a pinned name without a sender id fails closed", () => {
  const access = { ...defaultAccess(), allow: ["alice"] };
  access.ids.alice = "id-1";
  expect(decide(access, "alice", 0, undefined).action).toBe("drop");
  expect(decide(access, "alice", 0, "id-1").action).toBe("deliver");
});

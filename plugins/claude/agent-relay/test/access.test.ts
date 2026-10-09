import { describe, expect, test } from "bun:test";
import { MAX_PENDING, PAIR_TTL_MS, decide, defaultAccess, loadAccess, pair, saveAccess } from "../src/access.ts";
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
    const file = path.join(dir, "state", "access.json");
    expect(loadAccess(file)).toEqual(defaultAccess());
    saveAccess(file, { dmPolicy: "allowlist", allow: ["bob", "bob", "../x"], pending: {} });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(loadAccess(file)).toEqual({ dmPolicy: "allowlist", allow: ["bob"], pending: {} });
    fs.writeFileSync(file, "not json");
    expect(loadAccess(file).dmPolicy).toBe("pairing");
  });
});

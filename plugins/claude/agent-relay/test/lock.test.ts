import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOCK_STALE_MS, LOCK_WAIT_MS, withFileLock } from "../src/lock.ts";

test("a lock left by a dead process is reclaimed at once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-lock-"));
  try {
    const file = path.join(dir, "state.json");
    const dead = Bun.spawnSync(["bun", "-e", "console.log(process.pid)"]).stdout.toString().trim();
    fs.writeFileSync(`${file}.lock`, dead);
    const started = Date.now();
    expect(withFileLock(file, () => "ran")).toBe("ran");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a waiter outlasts the stale window", () => {
  expect(LOCK_WAIT_MS).toBeGreaterThan(LOCK_STALE_MS);
});

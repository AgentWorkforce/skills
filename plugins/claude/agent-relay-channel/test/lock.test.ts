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

test("a fresh lock is never removed by a reclaimer that inspected an older one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-lock-"));
  try {
    const file = path.join(dir, "state.json");
    const lock = `${file}.lock`;
    // An old lock is inspected, then replaced by a live process's fresh lock.
    fs.writeFileSync(lock, "999999999");
    const staleIno = fs.statSync(lock).ino;
    // Keep the old inode allocated so the fresh lock cannot reuse it.
    fs.linkSync(lock, `${lock}.held`);
    fs.unlinkSync(lock);
    fs.writeFileSync(lock, String(process.pid));
    const { reclaimForTest } = require("../src/lock.ts");
    reclaimForTest(lock, staleIno);
    expect(fs.readFileSync(lock, "utf8")).toBe(String(process.pid));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

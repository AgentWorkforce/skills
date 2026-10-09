// An exclusive lock file around a read-modify-write of a state file, so
// concurrent channel processes (one per Claude Code session) never drop each
// other's changes. The lock holds its owner's pid: a lock left by a process
// that died is reclaimed at once, and any other lock is reclaimable well
// before a waiter gives up (state writes take milliseconds).

import fs from "node:fs";

export const LOCK_STALE_MS = 3_000;
export const LOCK_WAIT_MS = 8_000;
const pause = new Int32Array(new SharedArrayBuffer(4));

function holderDead(lock: string): boolean {
  try {
    const pid = Number(fs.readFileSync(lock, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

export function withFileLock<T>(file: string, run: () => T): T {
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lock, "wx", 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (holderDead(lock) || Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lock);
      } catch {}
      if (Date.now() > deadline) throw new Error(`${file} is locked (${lock})`);
      Atomics.wait(pause, 0, 0, 20);
    }
  }
  try {
    return run();
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {}
  }
}

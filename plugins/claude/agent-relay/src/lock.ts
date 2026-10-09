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

// Removes `lock` only if it is still the lock that was found stale (same
// inode). Reclaimers serialize on a second lock file, so two waiters that both
// saw the same dead owner cannot remove a lock a third process has just taken.
function reclaim(lock: string, staleIno: number): void {
  const guard = `${lock}.reclaim`;
  try {
    fs.closeSync(fs.openSync(guard, "wx", 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") return;
    // A reclaimer that crashed mid-reclaim leaves the guard behind.
    try {
      if (Date.now() - fs.statSync(guard).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(guard);
    } catch {}
    return;
  }
  try {
    if (fs.statSync(lock).ino === staleIno) fs.unlinkSync(lock);
  } catch {
  } finally {
    try {
      fs.unlinkSync(guard);
    } catch {}
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
        const seen = fs.statSync(lock);
        if (holderDead(lock) || Date.now() - seen.mtimeMs > LOCK_STALE_MS) reclaim(lock, seen.ino);
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
export const reclaimForTest = reclaim;

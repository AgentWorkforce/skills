// An exclusive lock file around a read-modify-write of a state file, so
// concurrent channel processes (one per Claude Code session) never drop each
// other's changes.

import fs from "node:fs";

const LOCK_STALE_MS = 10_000;
const pause = new Int32Array(new SharedArrayBuffer(4));

export function withFileLock<T>(file: string, run: () => T): T {
  const lock = `${file}.lock`;
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, "wx", 0o600));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lock);
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

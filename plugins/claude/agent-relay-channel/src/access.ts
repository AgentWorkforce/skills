// Who may push relay messages into this session.
//
// State lives in <state dir>/access.json and is re-read on every inbound
// message, so the /agent-relay-channel:access skill's edits apply without a restart.
// A sender is a relay agent name; the room or conversation is never the key.

import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withFileLock } from "./lock.ts";

export type DmPolicy = "pairing" | "allowlist" | "disabled";

export interface PendingPair {
  sender: string;
  senderId?: string;
  createdAt: number;
}

export interface Access {
  dmPolicy: DmPolicy;
  allow: string[];
  /**
   * The immutable relay agent id each allowed name was approved as. A name
   * re-registered by a different agent does not inherit access.
   */
  ids: Record<string, string>;
  pending: Record<string, PendingPair>;
}

export type Decision =
  | { action: "deliver"; pin?: string }
  | { action: "drop"; reason: string }
  | { action: "pair"; code: string; fresh: boolean };

export const PAIR_TTL_MS = 60 * 60 * 1000;
export const MAX_PENDING = 3;
// No 0/O, 1/l/I: codes are read off one screen and typed into another.
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// Agent names are user-chosen ("__proto__" is a valid one), so maps keyed by
// them have no prototype.
function emptyMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function defaultAccess(): Access {
  return { dmPolicy: "pairing", allow: [], ids: emptyMap(), pending: emptyMap() };
}

export function isAgentName(value: unknown): value is string {
  return typeof value === "string" && AGENT_NAME.test(value);
}

export function loadAccess(file: string): Access {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return defaultAccess();
  }
  const value = (raw ?? {}) as Partial<Access>;
  const own = <T>(map: unknown): [string, T][] =>
    map && typeof map === "object" ? (Object.entries(map) as [string, T][]) : [];
  const dmPolicy: DmPolicy = ["pairing", "allowlist", "disabled"].includes(value.dmPolicy as string)
    ? (value.dmPolicy as DmPolicy)
    : "pairing";
  const allow = Array.isArray(value.allow) ? value.allow.filter(isAgentName) : [];
  const pending = emptyMap<PendingPair>();
  for (const [code, entry] of own<PendingPair>(value.pending)) {
    if (isAgentName(entry?.sender) && typeof entry.createdAt === "number") pending[code] = entry;
  }
  const ids = emptyMap<string>();
  for (const [name, id] of own<unknown>(value.ids)) {
    if (isAgentName(name) && typeof id === "string" && id) ids[name] = id;
  }
  return { dmPolicy, allow: [...new Set(allow)], ids, pending };
}

export function saveAccess(file: string, access: Access): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(access, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/**
 * Re-reads access.json, applies `change` and saves it under an exclusive
 * lock file, so concurrent channel processes (and their pairing codes) do
 * not overwrite each other's edits.
 */
export function updateAccess(file: string, change: (access: Access) => void): Access {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  return withFileLock(file, () => {
    const access = loadAccess(file);
    change(access);
    saveAccess(file, access);
    return access;
  });
}

function newCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

function prune(access: Access, now: number): void {
  for (const [code, entry] of Object.entries(access.pending)) {
    if (now - entry.createdAt > PAIR_TTL_MS) delete access.pending[code];
  }
}

/** Whether `sender` (with its relay agent id, when known) is approved. */
export function isAllowed(access: Access, sender: string, senderId?: string): boolean {
  if (access.dmPolicy === "disabled" || !access.allow.includes(sender)) return false;
  const pinned = access.ids[sender];
  // Once a name is pinned, a message must prove it is that agent.
  return !pinned || pinned === senderId;
}

/**
 * Whether a message that was already delivered may still be answered: the
 * sender is still allowed and the channel on, and the message does not come
 * from an agent id other than the one the name is now pinned to. A message
 * delivered before the name was pinned (no id on it) stays answerable.
 */
export function canReply(access: Access, sender: string, senderId?: string): boolean {
  if (access.dmPolicy === "disabled" || !access.allow.includes(sender)) return false;
  const pinned = access.ids[sender];
  return !pinned || !senderId || pinned === senderId;
}

/**
 * Decides what to do with a message from `sender`, mutating `access` when a
 * pairing code is issued. The caller saves `access` after a "pair" decision,
 * and after a "deliver" decision that carries a `pin` (the first message from
 * a name allowed by hand fixes the agent id it is allowed as).
 */
export function decide(access: Access, sender: string, now = Date.now(), senderId?: string): Decision {
  if (!isAgentName(sender)) return { action: "drop", reason: "invalid sender" };
  if (access.dmPolicy === "disabled") return { action: "drop", reason: "channel disabled" };
  if (isAllowed(access, sender, senderId)) {
    return senderId && !access.ids[sender] ? { action: "deliver", pin: senderId } : { action: "deliver" };
  }
  if (access.allow.includes(sender) && access.ids[sender] && !senderId) {
    return { action: "drop", reason: "message carries no sender id for a pinned agent" };
  }
  if (access.dmPolicy === "allowlist") return { action: "drop", reason: "sender not on the allowlist" };
  prune(access, now);
  const existing = Object.entries(access.pending).find(
    ([, entry]) => entry.sender === sender && (!entry.senderId || !senderId || entry.senderId === senderId),
  );
  if (existing) return { action: "pair", code: existing[0], fresh: false };
  if (Object.keys(access.pending).length >= MAX_PENDING) {
    return { action: "drop", reason: "too many pending pairing requests" };
  }
  let code = newCode();
  while (access.pending[code]) code = newCode();
  access.pending[code] = senderId ? { sender, senderId, createdAt: now } : { sender, createdAt: now };
  return { action: "pair", code, fresh: true };
}

/** Approves a pending code: its sender joins the allowlist. */
export function pair(access: Access, code: string, now = Date.now()): string | undefined {
  prune(access, now);
  const entry = access.pending[code.trim().toLowerCase()];
  if (!entry) return undefined;
  delete access.pending[code.trim().toLowerCase()];
  if (!access.allow.includes(entry.sender)) access.allow.push(entry.sender);
  if (entry.senderId) access.ids[entry.sender] = entry.senderId;
  return entry.sender;
}

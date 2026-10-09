// Who may push relay messages into this session.
//
// State lives in <state dir>/access.json and is re-read on every inbound
// message, so the /agent-relay:access skill's edits apply without a restart.
// A sender is a relay agent name; the room or conversation is never the key.

import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type DmPolicy = "pairing" | "allowlist" | "disabled";

export interface PendingPair {
  sender: string;
  createdAt: number;
}

export interface Access {
  dmPolicy: DmPolicy;
  allow: string[];
  pending: Record<string, PendingPair>;
}

export type Decision =
  | { action: "deliver" }
  | { action: "drop"; reason: string }
  | { action: "pair"; code: string; fresh: boolean };

export const PAIR_TTL_MS = 60 * 60 * 1000;
export const MAX_PENDING = 3;
// No 0/O, 1/l/I: codes are read off one screen and typed into another.
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function defaultAccess(): Access {
  return { dmPolicy: "pairing", allow: [], pending: {} };
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
  const dmPolicy: DmPolicy = ["pairing", "allowlist", "disabled"].includes(value.dmPolicy as string)
    ? (value.dmPolicy as DmPolicy)
    : "pairing";
  const allow = Array.isArray(value.allow) ? value.allow.filter(isAgentName) : [];
  const pending: Record<string, PendingPair> = {};
  for (const [code, entry] of Object.entries(value.pending ?? {})) {
    if (isAgentName(entry?.sender) && typeof entry.createdAt === "number") pending[code] = entry;
  }
  return { dmPolicy, allow: [...new Set(allow)], pending };
}

export function saveAccess(file: string, access: Access): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(access, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
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

/**
 * Decides what to do with a message from `sender`, mutating `access` when a
 * pairing code is issued. The caller saves `access` after a "pair" decision.
 */
export function decide(access: Access, sender: string, now = Date.now()): Decision {
  if (!isAgentName(sender)) return { action: "drop", reason: "invalid sender" };
  if (access.dmPolicy === "disabled") return { action: "drop", reason: "channel disabled" };
  if (access.allow.includes(sender)) return { action: "deliver" };
  if (access.dmPolicy === "allowlist") return { action: "drop", reason: "sender not on the allowlist" };
  prune(access, now);
  const existing = Object.entries(access.pending).find(([, entry]) => entry.sender === sender);
  if (existing) return { action: "pair", code: existing[0], fresh: false };
  if (Object.keys(access.pending).length >= MAX_PENDING) {
    return { action: "drop", reason: "too many pending pairing requests" };
  }
  let code = newCode();
  while (access.pending[code]) code = newCode();
  access.pending[code] = { sender, createdAt: now };
  return { action: "pair", code, fresh: true };
}

/** Approves a pending code: its sender joins the allowlist. */
export function pair(access: Access, code: string, now = Date.now()): string | undefined {
  prune(access, now);
  const entry = access.pending[code.trim().toLowerCase()];
  if (!entry) return undefined;
  delete access.pending[code.trim().toLowerCase()];
  if (!access.allow.includes(entry.sender)) access.allow.push(entry.sender);
  return entry.sender;
}

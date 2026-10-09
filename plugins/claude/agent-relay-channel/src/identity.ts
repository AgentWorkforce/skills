// This channel's own identities on the relay. Each workspace and agent name
// keeps its own token in <state dir>/identity.json (mode 0600), reused across
// restarts, so switching directories or names never strands an agent, and a
// session keeps its name without taking over anyone else's.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withFileLock } from "./lock.ts";

export interface StoredIdentity {
  workspace: string;
  name: string;
  id: string;
  token: string;
}

export interface IdentityApi {
  me(token: string): Promise<{ id: string; name: string }>;
  register(name: string): Promise<{ id: string; name: string; token: string }>;
  recover(name: string, expectedAgentId: string): Promise<{ token?: string; agentToken?: string; agentId?: string; name?: string }>;
}

/** A short, non-reversible tag for the workspace a key belongs to. */
export function workspaceTag(workspaceKey: string): string {
  return createHash("sha256").update(workspaceKey).digest("hex").slice(0, 16);
}

const keyOf = (workspace: string, name: string) => `${workspace}:${name}`;

function isIdentity(value: unknown): value is StoredIdentity {
  return ["workspace", "name", "id", "token"].every((key) => typeof (value as Record<string, unknown>)?.[key] === "string");
}

function readAll(file: string): Record<string, StoredIdentity> {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    const all = Object.create(null) as Record<string, StoredIdentity>;
    for (const entry of Object.values((value?.identities ?? {}) as Record<string, unknown>)) {
      if (isIdentity(entry)) all[keyOf(entry.workspace, entry.name)] = entry;
    }
    return all;
  } catch {
    return {};
  }
}

export function loadIdentity(file: string, workspace: string, name: string): StoredIdentity | undefined {
  return readAll(file)[keyOf(workspace, name)];
}

/**
 * Saves one identity, keeping every other workspace and name's, under an
 * exclusive lock so two sessions registering at once both keep theirs.
 */
export function saveIdentity(file: string, identity: StoredIdentity): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  withFileLock(file, () => {
    const identities = { ...readAll(file), [keyOf(identity.workspace, identity.name)]: identity };
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ identities })}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  });
}

function statusOf(error: unknown): number | undefined {
  const e = error as { status?: number; statusCode?: number };
  return e?.status ?? e?.statusCode;
}

/** Only an authentication failure means a stored token is dead. */
function isAuthFailure(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 401 || status === 403) return true;
  const text = error instanceof Error ? error.message : String(error);
  return status === undefined && /\b(401|403|unauthori[sz]ed|forbidden|invalid token)\b/i.test(text);
}

function isConflict(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: number; statusCode?: number })?.status ?? (error as { statusCode?: number })?.statusCode;
  return status === 409 || /already exists/i.test(text);
}

/** Returns a token for `name`, reusing, registering or recovering it. */
export async function resolveIdentity(
  api: IdentityApi,
  file: string,
  workspaceKey: string,
  name: string,
): Promise<StoredIdentity> {
  const workspace = workspaceTag(workspaceKey);
  const mine = loadIdentity(file, workspace, name);
  if (mine) {
    try {
      const me = await api.me(mine.token);
      if (me.name === name) return mine;
    } catch (error) {
      // A rate limit, server error or network failure says nothing about the
      // token: surface it rather than registering or recovering.
      if (!isAuthFailure(error)) throw error;
    }
  }
  try {
    const created = await api.register(name);
    const identity = { workspace, name: created.name ?? name, id: created.id, token: created.token };
    saveIdentity(file, identity);
    return identity;
  } catch (error) {
    if (!isConflict(error)) throw error;
    if (!mine) {
      throw new Error(
        `The agent name "${name}" is already taken in this workspace, by another agent or by another Claude Code session using this name right now. ` +
          "Two sessions must not share one relay identity (both would receive every message). Choose another AGENT_RELAY_CHANNEL_AGENT_NAME with /agent-relay-channel:configure.",
      );
    }
  }
  // The name is ours (we registered it before) but the stored token no
  // longer works: recover it by its immutable id.
  const recovered = await api.recover(name, mine.id);
  const token = recovered.token ?? recovered.agentToken;
  if (!token) throw new Error(`Could not recover the agent "${name}".`);
  const identity = { workspace, name, id: recovered.agentId ?? mine.id, token };
  saveIdentity(file, identity);
  return identity;
}

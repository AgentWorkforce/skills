// This channel's own identity on the relay. The token is kept in
// <state dir>/identity.json (mode 0600) and reused across restarts, so a
// session keeps its agent name without taking over anyone else's.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

export function loadIdentity(file: string): StoredIdentity | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (["workspace", "name", "id", "token"].every((key) => typeof value?.[key] === "string")) return value;
  } catch {}
  return undefined;
}

export function saveIdentity(file: string, identity: StoredIdentity): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(identity)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
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
  const stored = loadIdentity(file);
  const mine = stored && stored.workspace === workspace && stored.name === name ? stored : undefined;
  if (mine) {
    try {
      const me = await api.me(mine.token);
      if (me.name === name) return mine;
    } catch {}
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
        `The agent name "${name}" is already taken in this workspace. Choose another AGENT_RELAY_CHANNEL_AGENT_NAME with /agent-relay:configure.`,
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

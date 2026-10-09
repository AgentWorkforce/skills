// The Agent Relay desktop, when it runs on this machine. If it has already
// registered this Claude Code session, it delivers relay messages through
// Claude Code's own cross-session inbox, so the channel must not deliver them
// a second time.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function desktopSocket(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates: string[] = [];
  try {
    const pointer = fs
      .readFileSync(path.join(os.homedir(), ".agentworkforce/desktop/relay-socket"), "utf8")
      .split("\n")[0]
      ?.trim();
    if (pointer) candidates.push(pointer);
  } catch {}
  if (process.platform === "linux") {
    if (env.XDG_RUNTIME_DIR) candidates.push(path.join(env.XDG_RUNTIME_DIR, "agent-relay/relay.sock"));
    const uid = process.getuid?.();
    if (uid !== undefined) candidates.push(`/run/user/${uid}/agent-relay/relay.sock`);
  }
  if (process.platform === "darwin") {
    candidates.push(path.join(os.homedir(), "Library/Application Support/com.agentrelay.desktop/run/relay.sock"));
  }
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isSocket();
    } catch {
      return false;
    }
  });
}

export interface DesktopSession {
  registered: boolean;
  address?: string;
}

/**
 * Asks the desktop whether it has registered the calling session. The
 * desktop identifies the caller by walking up from this process to the
 * nearest Claude Code session, which is the session that spawned this server.
 */
export async function desktopSession(
  socket: string | undefined,
  timeoutMs = 5000,
): Promise<DesktopSession | undefined> {
  if (!socket) return undefined;
  try {
    const response = await fetch("http://relay/setup/status", {
      // Bun's fetch speaks HTTP over a Unix socket.
      unix: socket,
      signal: AbortSignal.timeout(timeoutMs),
    } as RequestInit);
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      data?: { session?: { registered?: boolean; address?: string | null } };
    };
    const session = body.data?.session;
    if (!session) return undefined;
    return { registered: session.registered === true, address: session.address ?? undefined };
  } catch {
    return undefined;
  }
}

export type InboundMode = "auto" | "always" | "never";

export function inboundMode(value: string | undefined): InboundMode {
  return value === "always" || value === "never" ? value : "auto";
}

/** Whether this channel should deliver inbound relay messages. */
export function shouldDeliver(mode: InboundMode, desktop: DesktopSession | undefined): boolean {
  if (mode === "never") return false;
  if (mode === "always") return true;
  return !desktop?.registered;
}

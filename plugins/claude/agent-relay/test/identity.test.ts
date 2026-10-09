import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type IdentityApi, loadIdentity, resolveIdentity, saveIdentity, workspaceTag } from "../src/identity.ts";

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ar-id-")), "identity.json");

function api(over: Partial<IdentityApi> = {}): IdentityApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async me(token) {
      calls.push(`me:${token}`);
      if (token === "good") return { id: "a1", name: "me" };
      throw new Error("401");
    },
    async register(name) {
      calls.push(`register:${name}`);
      return { id: "a2", name, token: "fresh" };
    },
    async recover(name, id) {
      calls.push(`recover:${name}:${id}`);
      return { token: "recovered" };
    },
    ...over,
  };
}

describe("identity", () => {
  test("registers once, saves privately, and reuses the token", async () => {
    const f = file();
    const a = api();
    const first = await resolveIdentity(a, f, "rk_live_x", "me");
    expect(first.token).toBe("fresh");
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    expect(loadIdentity(f, workspaceTag("rk_live_x"), "me")?.id).toBe("a2");
    saveIdentity(f, { ...first, token: "good" });
    const second = await resolveIdentity(a, f, "rk_live_x", "me");
    expect(second.token).toBe("good");
    expect(a.calls).toEqual(["register:me", "me:good"]);
  });

  test("a taken name we never owned is refused, not taken over", async () => {
    const a = api({
      async register() {
        throw Object.assign(new Error('Agent "me" already exists in this workspace'), { status: 409 });
      },
    });
    await expect(resolveIdentity(a, file(), "rk_live_x", "me")).rejects.toThrow("already taken");
    expect(a.calls).not.toContain("recover:me:a1");
  });

  test("our own name with a dead token is recovered by id", async () => {
    const f = file();
    saveIdentity(f, { workspace: workspaceTag("rk_live_x"), name: "me", id: "a1", token: "dead" });
    const a = api({
      async register() {
        throw new Error('Agent "me" already exists in this workspace');
      },
    });
    const identity = await resolveIdentity(a, f, "rk_live_x", "me");
    expect(identity).toEqual({ workspace: workspaceTag("rk_live_x"), name: "me", id: "a1", token: "recovered" });
  });

  test("a stored identity from another workspace or name is ignored", async () => {
    const f = file();
    saveIdentity(f, { workspace: workspaceTag("rk_live_other"), name: "me", id: "a1", token: "good" });
    const a = api();
    expect((await resolveIdentity(a, f, "rk_live_x", "me")).token).toBe("fresh");
    expect(a.calls).toEqual(["register:me"]);
  });

  test("the stored file never holds the workspace key", async () => {
    const f = file();
    await resolveIdentity(api(), f, "rk_live_secret", "me");
    expect(fs.readFileSync(f, "utf8")).not.toContain("rk_live_secret");
  });
});

describe("identity per workspace and name", () => {
  test("switching names and back keeps each agent's token", async () => {
    const f = file();
    const tokens: Record<string, string> = {};
    const a: IdentityApi = {
      async me(token) {
        const name = Object.keys(tokens).find((n) => tokens[n] === token);
        if (!name) throw new Error("401");
        return { id: `id-${name}`, name };
      },
      async register(name) {
        if (tokens[name]) throw new Error(`Agent "${name}" already exists in this workspace`);
        tokens[name] = `t-${name}`;
        return { id: `id-${name}`, name, token: tokens[name] };
      },
      async recover() {
        throw new Error("not expected");
      },
    };
    expect((await resolveIdentity(a, f, "rk_live_x", "alice")).token).toBe("t-alice");
    expect((await resolveIdentity(a, f, "rk_live_x", "bob")).token).toBe("t-bob");
    expect((await resolveIdentity(a, f, "rk_live_x", "alice")).token).toBe("t-alice");
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
  });
});

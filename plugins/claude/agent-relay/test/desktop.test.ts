import { describe, expect, test } from "bun:test";
import { desktopSession, inboundMode, shouldDeliver } from "../src/desktop.ts";

describe("desktop coexistence", () => {
  test("auto delivers only when the desktop has not registered this session", () => {
    expect(shouldDeliver("auto", undefined)).toBe(true);
    expect(shouldDeliver("auto", { registered: false, directDelivery: true })).toBe(true);
    expect(shouldDeliver("auto", { registered: true, directDelivery: true, address: "a@h" })).toBe(false);
  });

  test("a registered session the desktop does not deliver to (kept choice) still gets the channel", () => {
    expect(shouldDeliver("auto", { registered: true, directDelivery: false })).toBe(true);
  });

  test("always and never override", () => {
    expect(shouldDeliver("always", { registered: true, directDelivery: true })).toBe(true);
    expect(shouldDeliver("never", undefined)).toBe(false);
  });

  test("unknown modes are auto", () => {
    expect(inboundMode(undefined)).toBe("auto");
    expect(inboundMode("yes")).toBe("auto");
    expect(inboundMode("never")).toBe("never");
  });

  test("a missing socket means no desktop", async () => {
    expect(await desktopSession(undefined)).toBeUndefined();
    expect(await desktopSession("/nonexistent/relay.sock", 500)).toBeUndefined();
  });
});

describe("desktop socket", () => {
  test("reads this session's registration from /setup/status", async () => {
    const dir = (await import("node:fs")).mkdtempSync(`${(await import("node:os")).tmpdir()}/ar-sock-`);
    const socket = `${dir}/relay.sock`;
    const server = Bun.serve({
      unix: socket,
      fetch: (request) =>
        new URL(request.url).pathname === "/setup/status"
          ? Response.json({ ok: true, data: { session: { registered: true, direct_delivery: false, address: "claude-x@host" } } })
          : new Response(null, { status: 404 }),
    });
    try {
      expect(await desktopSession(socket)).toEqual({ registered: true, directDelivery: false, address: "claude-x@host" });
    } finally {
      server.stop(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { runRelay, type RelayHost } from "../src/relay/operation.js";
import type { RelayRequest } from "../src/relay/types.js";

const request: RelayRequest = { workspaceRoot: "x", workspaceId: "w", taskId: "c2c_12345678", iteration: 0, instruction: "PLAN instruction", expectedStates: ["PLAN"] };
const plan = "[C2C]\nPROTOCOL_VERSION: 1\nSTATE: PLAN\nTASK_ID: c2c_12345678\nITERATION: 1\n\nACTIONS:\nDo.\n\nTESTS:\nPass.\n\nSUCCESS_CRITERIA:\nDone.\n";

describe("bounded relay operation", () => {
  it("returns the same instruction when no browser host is available", async () => {
    await expect(runRelay(request, null)).resolves.toMatchObject({ ok: false, kind: "manual", fallbackRequired: true, errorCode: "BROWSER_UNAVAILABLE", instruction: request.instruction });
  });
  it("repairs one malformed response and then returns valid text", async () => {
    const sent: string[] = [];
    const host: RelayHost = { open: async () => "https://chatgpt.com/c/one", sendAndRead: async (text) => { sent.push(text); return sent.length === 1 ? "not a C2C response" : plan; } };
    const result = await runRelay(request, host);
    expect(result).toMatchObject({ ok: true, kind: "browser", text: plan }); expect(sent).toHaveLength(2);
  });
  it("falls back after bounded malformed responses", async () => {
    const host: RelayHost = { open: async () => "https://chatgpt.com/c/one", sendAndRead: async () => "bad" };
    await expect(runRelay(request, host)).resolves.toMatchObject({ ok: false, errorCode: "PROTOCOL_REPAIR_EXHAUSTED", instruction: request.instruction });
  });
  it("recovers a missing session only once", async () => {
    let opens = 0;
    const host: RelayHost = { open: async () => { opens++; throw new Error("SESSION_NOT_FOUND"); }, sendAndRead: async () => plan };
    const result = await runRelay(request, host, "https://chatgpt.com/c/old");
    expect(result).toMatchObject({ ok: false, errorCode: "SESSION_NOT_FOUND", fallbackRequired: true }); expect(opens).toBe(2);
  });
  it("retries a transient browser response at most twice", async () => {
    let attempts = 0;
    const host: RelayHost = { open: async () => "https://chatgpt.com/c/one", sendAndRead: async () => { attempts++; if (attempts < 3) throw new Error("temporary"); return plan; } };
    await expect(runRelay(request, host)).resolves.toMatchObject({ ok: true, text: plan }); expect(attempts).toBe(3);
  });
});

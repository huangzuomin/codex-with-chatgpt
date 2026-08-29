import { describe, expect, it } from "vitest";
import { importTaskMessage } from "../src/task/import.js";
import { TaskStore } from "../src/task/store.js";
import type { TaskSnapshot } from "../src/protocol/types.js";
import { makeTmpDir } from "./helpers.js";

const base = (state: TaskSnapshot["state"] = "INIT"): TaskSnapshot => ({ protocolVersion: 1, taskId: "c2c_12345678", transport: "github", state, iteration: state === "EXECUTED" ? 1 : 0, goal: "x", createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z", repository: null, taskBaseCommit: null, iterationBaseCommit: null, codeHeadCommit: null, declaredChangedFiles: [], tests: { status: "not_run", summary: null, command: null }, reviewFocus: "", lastImported: null, pendingDecision: null, blockedFrom: null });
const msg = (state: string, iteration: number) => `[C2C]\nPROTOCOL_VERSION: 1\nSTATE: ${state}\nTASK_ID: c2c_12345678\nITERATION: ${iteration}\n\nACTIONS:\nDo it.\n\nTESTS:\nRun it.\n\nSUCCESS_CRITERIA:\nIt passes.\n`;

describe("shared task import service", () => {
  it("imports protocol messages through parse, validate, and lifecycle", () => {
    const root = makeTmpDir("import-service"); const store = new TaskStore(root); store.write(base());
    const result = importTaskMessage(store, msg("PLAN", 1));
    expect(result.ok).toBe(true); expect(store.read()?.state).toBe("PLAN");
  });
  it("does not write state when parsing or validation fails", () => {
    const root = makeTmpDir("import-service-fail"); const store = new TaskStore(root); store.write(base());
    const before = JSON.stringify(store.read()); const result = importTaskMessage(store, "STATE: PLAN\nTASK_ID: wrong\nITERATION: 1");
    expect(result.ok).toBe(false); expect(JSON.stringify(store.read())).toBe(before);
  });
});

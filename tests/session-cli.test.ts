import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { cleanup, makeTmpDir } from "./helpers.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(cleanup));
function run(args: string[], root: string, stateDir: string, json = true) {
  return spawnSync(process.execPath, ["--import", "tsx/esm", path.resolve("src/cli/index.ts"), ...args, "-w", root, ...(json ? ["--json"] : [])], { encoding: "utf8", env: { ...process.env, C2C_STATE_DIR: stateDir } });
}
describe("session CLI", () => {
  it("round-trips the canonical session while keeping legacy JSON aliases", () => {
    const root = makeTmpDir("session-cli"); const state = makeTmpDir("session-cli-state"); roots.push(root, state);
    expect(run(["session", "set", "--url", "https://chatgpt.com/c/abc", "--task", "c2c_12345678", "--iteration", "1", "--state", "PLAN"], root, state, false).status).toBe(0);
    const result = run(["session", "get"], root, state); expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).session).toMatchObject({ conversationUrl: "https://chatgpt.com/c/abc", url: "https://chatgpt.com/c/abc", taskId: "c2c_12345678" });
  });
});

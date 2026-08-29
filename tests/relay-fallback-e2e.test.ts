import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TaskStore } from "../src/task/store.js";
import { runRelay } from "../src/relay/operation.js";
import { cleanup, git, makeGitRepo, makeTmpDir } from "./helpers.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(cleanup));
function run(args: string[], root: string, input?: string): Record<string, any> {
  const result = spawnSync(process.execPath, ["--import", "tsx/esm", path.resolve("src/cli/index.ts"), ...args, "--workspace", root, "--json"], { cwd: path.resolve("."), encoding: "utf8", input });
  expect(result.status, result.stderr || result.stdout).toBe(0); return JSON.parse(result.stdout.trim()) as Record<string, any>;
}

describe("Manual Relay fallback E2E", () => {
  it("keeps INIT immutable on unavailable browser, then completes manual import path", async () => {
    const root = makeTmpDir("relay-fallback-e2e"); const bare = makeTmpDir("relay-fallback-e2e-bare"); roots.push(root, bare);
    makeGitRepo(root); git(root, "config", "user.name", "c2c-test"); git(root, "config", "user.email", "test@c2c.local"); git(bare, "init", "--bare"); git(root, "remote", "add", "origin", bare);
    const started = run(["task", "start", "relay fallback", "--transport", "github"], root); const before = fs.readFileSync(path.join(root, ".c2c", "current.json"), "utf8"); const head = git(root, "rev-parse", "HEAD"); const status = git(root, "status", "--porcelain");
    expect(run(["relay", "get", "--browser-capability", "unavailable"], root)).toMatchObject({ effectiveKind: "manual" });
    expect(fs.readFileSync(path.join(root, ".c2c", "current.json"), "utf8")).toBe(before); expect(git(root, "rev-parse", "HEAD")).toBe(head); expect(git(root, "status", "--porcelain")).toBe(status);
    const taskId = String(started.taskId);
    expect(run(["task", "import"], root, `[C2C]\nSTATE: PLAN\nTASK_ID: ${taskId}\nITERATION: 1\nACTIONS: manual\nTESTS: pass\nSUCCESS_CRITERIA: done\n`)).toMatchObject({ state: "PLAN", iteration: 1 });
    fs.mkdirSync(path.join(root, "src"), { recursive: true }); fs.writeFileSync(path.join(root, "src", "relay-fixture.txt"), "manual relay\n");
    const executed = run(["task", "publish", "--changed-files", "src/relay-fixture.txt", "--tests", "1 passed", "--test-command", "node --check src/relay-fixture.txt"], root);
    expect(executed).toMatchObject({ state: "EXECUTED", iteration: 1 });
    const reviewInstruction = String(executed.receipt.instruction);
    const fallback = await runRelay({ workspaceRoot: root, workspaceId: "fixture", taskId, iteration: 1, instruction: reviewInstruction, expectedStates: ["PLAN", "DONE", "BLOCKED"] }, null);
    expect(fallback).toMatchObject({ ok: false, errorCode: "BROWSER_UNAVAILABLE", instruction: reviewInstruction });
    expect(run(["task", "import"], root, `[C2C]\nSTATE: DONE\nTASK_ID: ${taskId}\nITERATION: 1\nSUMMARY: accepted\n`)).toMatchObject({ state: "EXECUTED", acceptedDecision: "DONE" });
    expect(new TaskStore(root).read()).toMatchObject({ state: "EXECUTED", pendingDecision: { state: "DONE" } });
    expect(run(["task", "publish", "--finalize", "passed", "--tests", "1 passed", "--test-command", "node --check src/relay-fixture.txt"], root)).toMatchObject({ state: "DONE", iteration: 1 });
    expect(new TaskStore(root).read()).toMatchObject({ state: "DONE", pendingDecision: null });
    expect(JSON.parse(git(bare, "show", `${String(started.branch)}:.c2c/current.json`))).toMatchObject({ state: "DONE", pendingDecision: null });
  }, 30_000);
});

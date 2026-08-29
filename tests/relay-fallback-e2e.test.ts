import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cleanup, git, makeGitRepo, makeTmpDir } from "./helpers.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(cleanup));
function run(args: string[], root: string, input?: string): Record<string, any> {
  const result = spawnSync(process.execPath, ["--import", "tsx/esm", path.resolve("src/cli/index.ts"), ...args, "--workspace", root, "--json"], { cwd: path.resolve("."), encoding: "utf8", input });
  expect(result.status, result.stderr || result.stdout).toBe(0); return JSON.parse(result.stdout.trim()) as Record<string, any>;
}

describe("Manual Relay fallback E2E", () => {
  it("keeps INIT immutable on unavailable browser, then completes manual import path", () => {
    const root = makeTmpDir("relay-fallback-e2e"); const bare = makeTmpDir("relay-fallback-e2e-bare"); roots.push(root, bare);
    makeGitRepo(root); git(root, "config", "user.name", "c2c-test"); git(root, "config", "user.email", "test@c2c.local"); git(bare, "init", "--bare"); git(root, "remote", "add", "origin", bare);
    const started = run(["task", "start", "relay fallback", "--transport", "github"], root); const before = fs.readFileSync(path.join(root, ".c2c", "current.json"), "utf8"); const head = git(root, "rev-parse", "HEAD"); const status = git(root, "status", "--porcelain");
    expect(run(["relay", "get", "--browser-capability", "unavailable"], root)).toMatchObject({ effectiveKind: "manual" });
    expect(fs.readFileSync(path.join(root, ".c2c", "current.json"), "utf8")).toBe(before); expect(git(root, "rev-parse", "HEAD")).toBe(head); expect(git(root, "status", "--porcelain")).toBe(status);
    const taskId = String(started.taskId);
    expect(run(["task", "import"], root, `[C2C]\nSTATE: PLAN\nTASK_ID: ${taskId}\nITERATION: 1\nACTIONS: manual\nTESTS: pass\nSUCCESS_CRITERIA: done\n`)).toMatchObject({ state: "PLAN", iteration: 1 });
  }, 30_000);
});

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { cleanup, isolateStateDir, makeTmpDir, write } from "./helpers.js";

const cli = path.resolve("bin/c2c.js");

function run(args: string[], stateDir: string) {
  return spawnSync(process.execPath, [cli, "project", ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, C2C_STATE_DIR: stateDir },
  });
}

describe("project CLI", () => {
  it("supports the frozen add, list, show, and remove contract", () => {
    const stateDir = isolateStateDir();
    const root = makeTmpDir("project-cli");
    const sentinel = write(root, "sentinel.txt", "keep");
    try {
      const added = run([
        "add", "--id", "food-city", "--name", "美食之都", "--path", root, "--repo", "org/food-city", "--json",
      ], stateDir);
      expect(added.status).toBe(0);
      expect(JSON.parse(added.stdout)).toMatchObject({
        ok: true,
        project: { id: "food-city", displayName: "美食之都", repo: "org/food-city", enabled: true },
      });

      const listed = run(["list", "--json"], stateDir);
      expect(listed.status).toBe(0);
      expect(JSON.parse(listed.stdout).projects).toEqual([expect.objectContaining({ id: "food-city" })]);

      const shown = run(["show", "food-city", "--json"], stateDir);
      expect(shown.status).toBe(0);
      expect(JSON.parse(shown.stdout).project).toEqual(expect.objectContaining({ id: "food-city" }));

      const removed = run(["remove", "food-city"], stateDir);
      expect(removed.status).toBe(0);
      expect(fs.readFileSync(sentinel, "utf8")).toBe("keep");
      expect(run(["show", "food-city", "--json"], stateDir).status).toBe(1);
    } finally {
      cleanup(stateDir);
      cleanup(root);
      delete process.env.C2C_STATE_DIR;
    }
  });

  it("rejects missing required options and invalid or missing ids", () => {
    const stateDir = isolateStateDir();
    const root = makeTmpDir("project-cli-invalid");
    try {
      expect(run(["add", "--name", "Missing id", "--path", root], stateDir).status).toBe(1);
      expect(run(["add", "--id", "Invalid_ID", "--name", "Bad", "--path", root, "--json"], stateDir).status).toBe(1);
      const missing = run(["show", "missing", "--json"], stateDir);
      expect(missing.status).toBe(1);
      expect(JSON.parse(missing.stdout).error).toMatch(/not registered/i);
    } finally {
      cleanup(stateDir);
      cleanup(root);
      delete process.env.C2C_STATE_DIR;
    }
  });
});

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { cleanup, isolateStateDir, makeTmpDir } from "./helpers.js";

const cli = path.resolve("bin/c2c.js");

function run(args: string[], stateDir: string) {
  return spawnSync(process.execPath, [cli, "projects", ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, C2C_STATE_DIR: stateDir },
  });
}

describe("projects CLI", () => {
  it("registers, selects, lists, and unregisters without deleting the directory", () => {
    const stateDir = isolateStateDir();
    const root = makeTmpDir("project-cli");
    try {
      const added = run(["add", root, "--name", "Demo", "--use", "--json"], stateDir);
      expect(added.status).toBe(0);
      const project = JSON.parse(added.stdout).project;
      expect(project.name).toBe("Demo");

      const listed = run(["list", "--json"], stateDir);
      expect(listed.status).toBe(0);
      expect(JSON.parse(listed.stdout)).toMatchObject({ ok: true, projects: [expect.objectContaining({ id: project.id })] });

      const removed = run(["remove", project.id, "--json"], stateDir);
      expect(removed.status).toBe(1);
      expect(JSON.parse(removed.stdout).error).toMatch(/active/);
      expect(root).toMatch(/project-cli/);
    } finally {
      cleanup(stateDir);
      cleanup(root);
      delete process.env.C2C_STATE_DIR;
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { cleanup, isolateStateDir, makeTmpDir } from "./helpers.js";
import { projectsFile } from "../src/config/paths.js";
import { addProject, removeProject } from "../src/projects/registry.js";
import { WorkspaceRouter } from "../src/projects/router.js";
import { Workspace } from "../src/workspace/manager.js";

describe("WorkspaceRouter", () => {
  let stateDir = "";
  let roots: string[] = [];
  let legacy: Workspace;
  let router: WorkspaceRouter;

  beforeEach(() => {
    stateDir = isolateStateDir();
    roots = [makeTmpDir("router-legacy")];
    legacy = new Workspace(roots[0]);
    router = new WorkspaceRouter(legacy);
  });

  afterEach(() => {
    cleanup(stateDir);
    for (const root of roots) cleanup(root);
    delete process.env.C2C_STATE_DIR;
  });

  function projectRoot(name: string): string {
    const root = makeTmpDir(name);
    roots.push(root);
    return root;
  }

  it("returns the original Bridge workspace when project_id is absent", () => {
    expect(router.resolve()).toBe(legacy);
  });

  it("resolves an enabled registered project through its canonical workspace root", () => {
    const root = projectRoot("router-alpha");
    addProject({ id: "alpha", displayName: "Alpha", workspaceRoot: root });

    const selected = router.resolve("alpha");

    expect(selected.root).toBe(fs.realpathSync.native(root));
    expect(selected).not.toBe(legacy);
  });

  it("fails explicitly for unknown and disabled project ids", () => {
    expect(() => router.resolve("missing")).toThrow(expect.objectContaining({ code: "PROJECT_NOT_FOUND" }));

    const root = projectRoot("router-disabled");
    fs.writeFileSync(projectsFile(), JSON.stringify({
      version: 1,
      projects: {
        disabled: { id: "disabled", displayName: "Disabled", workspaceRoot: root, enabled: false },
      },
    }));
    expect(() => router.resolve("disabled")).toThrow(expect.objectContaining({ code: "PROJECT_DISABLED" }));
  });

  it("observes registry additions and removals without recreating the router", () => {
    const alphaRoot = projectRoot("router-dynamic-alpha");
    const betaRoot = projectRoot("router-dynamic-beta");
    addProject({ id: "alpha", displayName: "Alpha", workspaceRoot: alphaRoot });
    expect(router.resolve("alpha").root).toBe(alphaRoot);

    addProject({ id: "beta", displayName: "Beta", workspaceRoot: betaRoot });
    expect(router.resolve("beta").root).toBe(betaRoot);

    removeProject("beta");
    expect(() => router.resolve("beta")).toThrow(expect.objectContaining({ code: "PROJECT_NOT_FOUND" }));
    expect(router.resolve("alpha").root).toBe(alphaRoot);
  });
});

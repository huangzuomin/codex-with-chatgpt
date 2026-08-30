import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { cleanup, isolateStateDir, makeTmpDir, write } from "./helpers.js";
import { addProject, getProject, listProjects, removeProject } from "../src/projects/registry.js";
import { projectsFile } from "../src/config/paths.js";

describe("project registry", () => {
  let stateDir = "";
  let roots: string[] = [];

  beforeEach(() => {
    stateDir = isolateStateDir();
    roots = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup(stateDir);
    for (const root of roots) cleanup(root);
    delete process.env.C2C_STATE_DIR;
  });

  function workspace(name: string): string {
    const root = makeTmpDir(name);
    roots.push(root);
    return root;
  }

  function add(id: string, root: string, displayName = id) {
    return addProject({ id, displayName, workspaceRoot: root });
  }

  it("returns an empty list when projects.json is missing", () => {
    expect(fs.existsSync(projectsFile())).toBe(false);
    expect(listProjects()).toEqual([]);
  });

  it("adds the frozen project definition and persists its canonical workspace path", () => {
    const root = workspace("registry-valid");
    const project = addProject({ id: "food-city", displayName: "美食之都", workspaceRoot: root, repo: "org/food-city" });

    expect(project).toEqual({
      id: "food-city",
      displayName: "美食之都",
      workspaceRoot: fs.realpathSync.native(root),
      repo: "org/food-city",
      enabled: true,
    });
    expect(JSON.parse(fs.readFileSync(projectsFile(), "utf8"))).toEqual({
      version: 1,
      projects: { "food-city": project },
    });
  });

  it.each(["Uppercase", "_leading", "dash_underscore", "-leading", "a".repeat(65)])(
    "rejects invalid project id %s without normalization",
    (id) => {
      expect(() => add(id, workspace("registry-invalid-id"))).toThrow(/project id/i);
    },
  );

  it("rejects duplicate ids", () => {
    add("same-id", workspace("registry-id-one"));
    expect(() => add("same-id", workspace("registry-id-two"))).toThrow(/already registered/i);
  });

  it("rejects duplicate canonical workspace roots", () => {
    const root = workspace("registry-root");
    add("first", root);
    expect(() => add("second", path.join(root, "."))).toThrow(/workspace.*already registered/i);
  });

  it("rejects nonexistent workspaces and files", () => {
    const root = workspace("registry-invalid-path");
    const file = write(root, "sentinel.txt", "keep");
    expect(() => add("missing", path.join(root, "missing"))).toThrow(/does not exist/i);
    expect(() => add("file", file)).toThrow(/directory/i);
  });

  it("lists projects in deterministic id order and survives reload", () => {
    add("zeta", workspace("registry-zeta"));
    add("alpha", workspace("registry-alpha"));
    expect(listProjects().map((project) => project.id)).toEqual(["alpha", "zeta"]);
    expect(listProjects().map((project) => project.id)).toEqual(["alpha", "zeta"]);
  });

  it("gets an existing project and rejects a missing id", () => {
    const project = add("known", workspace("registry-known"));
    expect(getProject("known")).toEqual(project);
    expect(() => getProject("missing")).toThrow(/not registered/i);
  });

  it("removes only the registry entry and preserves workspace contents", () => {
    const root = workspace("registry-preserve");
    const sentinel = write(root, "sentinel.txt", "must remain unchanged");
    add("removable", root);

    removeProject("removable");

    expect(listProjects()).toEqual([]);
    expect(fs.existsSync(root)).toBe(true);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("must remain unchanged");
  });

  it("rejects removing a missing id", () => {
    expect(() => removeProject("missing")).toThrow(/not registered/i);
  });

  it("rejects invalid JSON and unsupported registry versions", () => {
    fs.writeFileSync(projectsFile(), "not json");
    expect(() => listProjects()).toThrow(/valid json/i);
    fs.writeFileSync(projectsFile(), JSON.stringify({ version: 2, projects: {} }));
    expect(() => listProjects()).toThrow(/unsupported.*version/i);
  });

  it("keeps the previous registry valid when atomic replacement fails", () => {
    add("stable", workspace("registry-stable"));
    const before = fs.readFileSync(projectsFile(), "utf8");
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("simulated rename failure");
    });

    expect(() => add("rejected", workspace("registry-rejected"))).toThrow(/simulated rename failure/i);

    expect(fs.readFileSync(projectsFile(), "utf8")).toBe(before);
    expect(fs.readdirSync(path.dirname(projectsFile())).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(() => JSON.parse(before)).not.toThrow();
  });
});

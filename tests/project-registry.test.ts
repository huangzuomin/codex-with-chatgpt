import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { cleanup, isolateStateDir, makeTmpDir } from "./helpers.js";
import {
  addProject,
  getProject,
  listProjects,
  removeProject,
  setActiveProject,
} from "../src/projects/registry.js";
import { projectsFile } from "../src/config/paths.js";

describe("project registry", () => {
  let stateDir = "";
  let first = "";
  let second = "";

  afterEach(() => {
    if (stateDir) cleanup(stateDir);
    delete process.env.C2C_STATE_DIR;
    if (first) cleanup(first);
    if (second) cleanup(second);
  });

  it("persists canonical projects and an active project outside the workspace", () => {
    stateDir = isolateStateDir();
    first = makeTmpDir("registered-one");
    second = makeTmpDir("registered-two");

    const one = addProject(first, "One");
    const two = addProject(second);
    setActiveProject(two.id);

    expect(listProjects()).toEqual([
      expect.objectContaining({ id: one.id, name: "One", root: fs.realpathSync.native(first) }),
      expect.objectContaining({ id: two.id, name: path.basename(second) }),
    ]);
    expect(getProject(two.id)).toEqual(expect.objectContaining({ id: two.id }));
    expect(JSON.parse(fs.readFileSync(projectsFile(), "utf8")).activeProjectId).toBe(two.id);
    expect(projectsFile().startsWith(stateDir)).toBe(true);
  });

  it("rejects files, missing directories, duplicate roots, and removing the active project", () => {
    stateDir = isolateStateDir();
    first = makeTmpDir("registered-invalid");
    second = path.join(first, "file.txt");
    fs.writeFileSync(second, "not a project");

    expect(() => addProject(second)).toThrow(/directory/i);
    expect(() => addProject(path.join(first, "missing"))).toThrow(/does not exist/i);
    const project = addProject(first);
    expect(() => addProject(first)).toThrow(/already registered/i);
    setActiveProject(project.id);
    expect(() => removeProject(project.id)).toThrow(/active/i);
  });
});

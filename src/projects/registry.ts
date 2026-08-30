import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { projectsFile } from "../config/paths.js";
import { ProjectRegistrySchema, type Project, type ProjectRegistry } from "./types.js";

const emptyRegistry = (): ProjectRegistry => ({ version: 1, activeProjectId: null, projects: [] });

function readRegistry(): ProjectRegistry {
  const file = projectsFile();
  if (!fs.existsSync(file)) return emptyRegistry();
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Project registry is not valid JSON: ${file}`);
  }
  const parsed = ProjectRegistrySchema.safeParse(value);
  if (!parsed.success) throw new Error(`Project registry is invalid: ${file}`);
  return parsed.data;
}

function writeRegistry(registry: ProjectRegistry): void {
  const checked = ProjectRegistrySchema.parse(registry);
  const file = projectsFile();
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(checked, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function canonicalRoot(rootInput: string): string {
  const resolved = path.resolve(rootInput);
  if (!fs.existsSync(resolved)) throw new Error(`Project directory does not exist: ${rootInput}`);
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`Project path is not a directory: ${rootInput}`);
  return fs.realpathSync.native(resolved);
}

function projectId(root: string): string {
  return `project_${createHash("sha256").update(process.platform === "win32" ? root.toLowerCase() : root).digest("hex").slice(0, 12)}`;
}

export function listProjects(): Project[] {
  return readRegistry().projects;
}

export function getProject(id: string): Project | null {
  return readRegistry().projects.find((project) => project.id === id) ?? null;
}

export function addProject(rootInput: string, nameInput?: string): Project {
  const root = canonicalRoot(rootInput);
  const registry = readRegistry();
  if (registry.projects.some((project) => project.root === root)) throw new Error(`Project is already registered: ${root}`);
  const project: Project = {
    id: projectId(root),
    name: nameInput?.trim() || path.basename(root),
    root,
    registeredAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  registry.projects.push(project);
  writeRegistry(registry);
  return project;
}

export function setActiveProject(id: string): Project {
  const registry = readRegistry();
  const project = registry.projects.find((item) => item.id === id);
  if (!project) throw new Error(`Project is not registered: ${id}`);
  project.lastUsedAt = new Date().toISOString();
  registry.activeProjectId = id;
  writeRegistry(registry);
  return project;
}

export function removeProject(id: string): void {
  const registry = readRegistry();
  if (registry.activeProjectId === id) throw new Error("Cannot remove the active project; select another project first");
  const count = registry.projects.length;
  registry.projects = registry.projects.filter((project) => project.id !== id);
  if (registry.projects.length === count) throw new Error(`Project is not registered: ${id}`);
  writeRegistry(registry);
}

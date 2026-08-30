import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { projectsFile } from "../config/paths.js";
import {
  ProjectIdSchema,
  ProjectRegistrySchema,
  type AddProjectInput,
  type ProjectDefinition,
  type ProjectRegistry,
} from "./types.js";

const emptyRegistry = (): ProjectRegistry => ({ version: 1, projects: {} });

function readRegistry(): ProjectRegistry {
  const file = projectsFile();
  if (!fs.existsSync(file)) return emptyRegistry();
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Project registry is not valid JSON: ${file}`);
  }
  if (typeof value === "object" && value !== null && "version" in value && value.version !== 1) {
    throw new Error(`Unsupported project registry version: ${String(value.version)}`);
  }
  const parsed = ProjectRegistrySchema.safeParse(value);
  if (!parsed.success) throw new Error(`Project registry is invalid: ${file}`);
  return parsed.data;
}

function writeRegistry(registry: ProjectRegistry): void {
  const projects = Object.fromEntries(Object.entries(registry.projects).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  const checked = ProjectRegistrySchema.parse({ version: 1, projects });
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

function rootKey(root: string): string {
  return process.platform === "win32" ? root.toLowerCase() : root;
}

function validateProjectId(id: string): string {
  const parsed = ProjectIdSchema.safeParse(id);
  if (!parsed.success) throw new Error("Project id must match ^[a-z0-9][a-z0-9-]{0,63}$");
  return parsed.data;
}

export function listProjects(): ProjectDefinition[] {
  const registry = readRegistry();
  return Object.keys(registry.projects).sort().map((id) => registry.projects[id]);
}

export function getProject(idInput: string): ProjectDefinition {
  const id = validateProjectId(idInput);
  const registry = readRegistry();
  const project = registry.projects[id];
  if (!project) throw new Error(`Project is not registered: ${id}`);
  return project;
}

export function addProject(input: AddProjectInput): ProjectDefinition {
  const id = validateProjectId(input.id);
  if (!input.displayName.trim()) throw new Error("Project display name must not be empty");
  if (input.repo !== undefined && !input.repo.trim()) throw new Error("Project repo must not be empty");
  const workspaceRoot = canonicalRoot(input.workspaceRoot);
  const registry = readRegistry();
  if (registry.projects[id]) throw new Error(`Project id is already registered: ${id}`);
  if (Object.values(registry.projects).some((project) => rootKey(project.workspaceRoot) === rootKey(workspaceRoot))) {
    throw new Error(`Project workspace is already registered: ${workspaceRoot}`);
  }
  const project: ProjectDefinition = {
    id,
    displayName: input.displayName,
    workspaceRoot,
    ...(input.repo === undefined ? {} : { repo: input.repo }),
    enabled: true,
  };
  registry.projects[id] = project;
  writeRegistry(registry);
  return project;
}

export function removeProject(idInput: string): void {
  const id = validateProjectId(idInput);
  const registry = readRegistry();
  if (!registry.projects[id]) throw new Error(`Project is not registered: ${id}`);
  delete registry.projects[id];
  writeRegistry(registry);
}

import { getProject } from "./registry.js";
import { Workspace } from "../workspace/manager.js";

export type ProjectRoutingErrorCode = "PROJECT_NOT_FOUND" | "PROJECT_DISABLED";

export class ProjectRoutingError extends Error {
  constructor(
    public readonly code: ProjectRoutingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectRoutingError";
  }
}

export class WorkspaceRouter {
  constructor(private readonly legacyWorkspace: Workspace) {}

  resolve(projectId?: string): Workspace {
    if (projectId === undefined) return this.legacyWorkspace;

    let project;
    try {
      project = getProject(projectId);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Project is not registered:")) {
        throw new ProjectRoutingError("PROJECT_NOT_FOUND", `Project is not registered: ${projectId}`);
      }
      throw error;
    }
    if (!project.enabled) {
      throw new ProjectRoutingError("PROJECT_DISABLED", `Project is disabled: ${projectId}`);
    }
    return new Workspace(project.workspaceRoot);
  }
}

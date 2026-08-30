import { z } from "zod";

export const ProjectIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Project id must match ^[a-z0-9][a-z0-9-]{0,63}$");

export const ProjectDefinitionSchema = z.object({
  id: ProjectIdSchema,
  displayName: z.string().min(1),
  workspaceRoot: z.string().min(1),
  repo: z.string().min(1).optional(),
  enabled: z.boolean(),
}).strict();

export const ProjectRegistrySchema = z.object({
  version: z.literal(1),
  projects: z.record(ProjectIdSchema, ProjectDefinitionSchema),
}).strict().superRefine((registry, context) => {
  for (const [id, project] of Object.entries(registry.projects)) {
    if (id !== project.id) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["projects", id, "id"], message: "Project key must match project id" });
    }
  }
});

export type ProjectDefinition = z.infer<typeof ProjectDefinitionSchema>;
export type ProjectRegistry = z.infer<typeof ProjectRegistrySchema>;

export interface AddProjectInput {
  id: string;
  displayName: string;
  workspaceRoot: string;
  repo?: string;
}

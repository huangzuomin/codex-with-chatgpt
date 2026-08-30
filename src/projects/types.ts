import { z } from "zod";

export const ProjectSchema = z.object({
  id: z.string().regex(/^project_[0-9a-f]{12}$/),
  name: z.string().min(1),
  root: z.string().min(1),
  registeredAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
});

export const ProjectRegistrySchema = z.object({
  version: z.literal(1),
  activeProjectId: z.string().regex(/^project_[0-9a-f]{12}$/).nullable(),
  projects: z.array(ProjectSchema),
});

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectRegistry = z.infer<typeof ProjectRegistrySchema>;

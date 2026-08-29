import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readJsonIfExists, writeSecureJson } from "../config/paths.js";
import { C2CStateSchema, TaskIdSchema } from "../protocol/types.js";

const ConversationUrl = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "chatgpt.com" && /^\/c\/[^/]+$/.test(url.pathname);
  } catch { return false; }
}, "Only https://chatgpt.com/c/<conversation-id> URLs are allowed.");

const SavedSessionSchema = z.object({
  workspaceId: z.string().min(1), conversationUrl: ConversationUrl, title: z.string().optional(),
  lastTaskId: TaskIdSchema.optional(), lastIteration: z.number().int().nonnegative().optional(),
  lastState: C2CStateSchema.optional(), savedAt: z.string().datetime(),
});
export type SavedSession = z.infer<typeof SavedSessionSchema>;
export type SessionInput = Omit<SavedSession, "workspaceId" | "savedAt">;

export class SessionStore {
  private readonly file: string;
  constructor(private readonly workspaceId: string, stateDir: string) {
    this.file = path.join(stateDir, "sessions", `${workspaceId}.json`);
  }
  read(): SavedSession | null {
    const raw = readJsonIfExists<Record<string, unknown>>(this.file);
    if (!raw) return null;
    const migrated = raw.conversationUrl ? raw : {
      workspaceId: this.workspaceId, conversationUrl: raw.url, title: raw.title,
      lastTaskId: raw.taskId, lastIteration: raw.iteration, lastState: raw.lastState, savedAt: raw.savedAt ?? new Date(0).toISOString(),
    };
    const parsed = SavedSessionSchema.safeParse({ ...migrated, workspaceId: migrated.workspaceId ?? this.workspaceId });
    return parsed.success ? parsed.data : null;
  }
  save(input: SessionInput): SavedSession {
    const saved = SavedSessionSchema.parse({ ...input, workspaceId: this.workspaceId, savedAt: new Date().toISOString() });
    writeSecureJson(this.file, saved);
    return saved;
  }
  clear(): void { fs.rmSync(this.file, { force: true }); }
}

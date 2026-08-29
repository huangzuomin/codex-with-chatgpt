import { parseC2CMessage } from "../protocol/parser.js";
import type { C2CMessage } from "../protocol/types.js";
import { validateImportedMessage } from "../protocol/validator.js";
import { TaskLifecycle } from "./lifecycle.js";
import { TaskStore } from "./store.js";

export type TaskImportResult =
  | { ok: true; snapshot: ReturnType<TaskLifecycle["importMessage"]>["snapshot"]; validation: ReturnType<TaskLifecycle["importMessage"]>["validation"] }
  | { ok: false; code: string; message: string; expectedTemplate?: string };

export function importTaskMessage(store: TaskStore, text: string): TaskImportResult {
  const parsed = parseC2CMessage(text);
  if (!parsed.ok) {
    const diagnostic = parsed.diagnostics.find((item) => item.severity === "error") ?? parsed.diagnostics[0];
    return { ok: false, code: diagnostic?.code ?? "PROTOCOL_PARSE_FAILED", message: diagnostic?.message ?? "Invalid C2C message." };
  }
  const current = store.read();
  if (!current) return { ok: false, code: "TASK_NOT_FOUND", message: "No active C2C task exists." };
  const validation = validateImportedMessage(parsed.message, { taskId: current.taskId, currentState: current.state, currentIteration: current.iteration });
  if (!validation.ok) return { ok: false, code: validation.code, message: validation.message, expectedTemplate: validation.expectedTemplate };
  const imported = new TaskLifecycle(store).importMessage(parsed.message);
  return { ok: true, snapshot: imported.snapshot, validation: imported.validation };
}

export function parseAndValidateTaskMessage(store: TaskStore, message: C2CMessage): TaskImportResult {
  const current = store.read();
  if (!current) return { ok: false, code: "TASK_NOT_FOUND", message: "No active C2C task exists." };
  const validation = validateImportedMessage(message, { taskId: current.taskId, currentState: current.state, currentIteration: current.iteration });
  if (!validation.ok) return { ok: false, code: validation.code, message: validation.message, expectedTemplate: validation.expectedTemplate };
  const imported = new TaskLifecycle(store).importMessage(message);
  return { ok: true, snapshot: imported.snapshot, validation: imported.validation };
}

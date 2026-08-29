import { parseC2CMessage } from "../protocol/parser.js";
import { RELAY_POLICY_LIMITS } from "./policy.js";
import type { RelayRequest, RelayResult } from "./types.js";

export interface RelayHost {
  open(conversationUrl?: string): Promise<string>;
  sendAndRead(instruction: string): Promise<string>;
  recoverSession?(input: { bootPrompt: string; handoff: string }): Promise<string>;
}

const REPAIR = "[C2C] Return exactly one structured response with the requested STATE, TASK_ID, ITERATION, and required sections. Do not add prose.";

export async function runRelay(request: RelayRequest, host: RelayHost | null, conversationUrl?: string): Promise<RelayResult> {
  if (!host) return fallback("BROWSER_UNAVAILABLE", request.instruction);
  let url = conversationUrl ?? "";
  try { url = await host.open(conversationUrl); } catch (error) {
    if (!isSessionMissing(error)) return fallback("NAVIGATION_FAILED", request.instruction);
    if (!host.recoverSession || !request.bootPrompt || !request.handoff || RELAY_POLICY_LIMITS.sessionRecoveryAttempts < 1) return fallback("SESSION_NOT_FOUND", request.instruction);
    let recovered = false;
    for (let attempt = 0; attempt < RELAY_POLICY_LIMITS.sessionRecoveryAttempts; attempt++) {
      try { url = await host.recoverSession({ bootPrompt: request.bootPrompt, handoff: request.handoff }); recovered = true; break; } catch { /* bounded recovery */ }
    }
    if (!recovered) return fallback("SESSION_NOT_FOUND", request.instruction);
  }
  let retries = 0;
  let text: string;
  for (;;) {
    try { text = await host.sendAndRead(request.instruction); break; } catch {
      if (retries >= RELAY_POLICY_LIMITS.browserRetries) return fallback("RESPONSE_TIMEOUT", request.instruction);
      retries++;
    }
  }
  const classification = classify(text, request);
  if (classification === "valid") return { ok: true, kind: "browser", text, conversationUrl: url };
  if (classification === "semantic_error") return fallback("RESPONSE_MALFORMED", request.instruction);
  for (let attempt = 0; attempt < RELAY_POLICY_LIMITS.protocolRepairAttempts; attempt++) {
    try { text = await host.sendAndRead(REPAIR); } catch { return fallback("RESPONSE_MALFORMED", request.instruction); }
    const repaired = classify(text, request);
    if (repaired === "valid") return { ok: true, kind: "browser", text, conversationUrl: url };
    if (repaired === "semantic_error") break;
  }
  return fallback("PROTOCOL_REPAIR_EXHAUSTED", request.instruction);
}

type ResponseClassification = "valid" | "syntax_error" | "semantic_error";
function classify(text: string, request: RelayRequest): ResponseClassification {
  const parsed = parseC2CMessage(text);
  if (!parsed.ok) return "syntax_error";
  const message = parsed.message;
  const expectedIteration = message.state === "PLAN" ? request.iteration + 1 : request.iteration;
  if (message.taskId !== request.taskId || message.iteration !== expectedIteration || !request.expectedStates.includes(message.state as "PLAN" | "DONE" | "BLOCKED")) return "semantic_error";
  if (message.state === "PLAN" && !(message.sections.ACTIONS?.trim() && message.sections.TESTS?.trim() && message.sections.SUCCESS_CRITERIA?.trim())) return "syntax_error";
  if (message.state === "BLOCKED" && !message.sections.REASON?.trim()) return "syntax_error";
  return "valid";
}

function fallback(errorCode: "BROWSER_UNAVAILABLE" | "NAVIGATION_FAILED" | "SESSION_NOT_FOUND" | "RESPONSE_TIMEOUT" | "RESPONSE_MALFORMED" | "PROTOCOL_REPAIR_EXHAUSTED", instruction: string): RelayResult {
  return { ok: false, kind: "manual", fallbackRequired: true, errorCode, instruction };
}

function isSessionMissing(error: unknown): boolean { return error instanceof Error && error.message === "SESSION_NOT_FOUND"; }

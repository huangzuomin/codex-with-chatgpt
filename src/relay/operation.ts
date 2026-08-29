import { parseC2CMessage } from "../protocol/parser.js";
import type { RelayRequest, RelayResult } from "./types.js";

export interface RelayHost {
  open(conversationUrl?: string): Promise<string>;
  sendAndRead(instruction: string): Promise<string>;
}

const REPAIR = "[C2C] Return exactly one structured response with the requested STATE, TASK_ID, ITERATION, and required sections. Do not add prose.";

export async function runRelay(request: RelayRequest, host: RelayHost | null, conversationUrl?: string): Promise<RelayResult> {
  if (!host) return fallback("BROWSER_UNAVAILABLE", request.instruction);
  let url: string;
  try { url = await host.open(conversationUrl); } catch (error) {
    if (!isSessionMissing(error)) return fallback("NAVIGATION_FAILED", request.instruction);
    try { url = await host.open(); } catch { return fallback("SESSION_NOT_FOUND", request.instruction); }
  }
  let retries = 0;
  let text: string;
  for (;;) {
    try { text = await host.sendAndRead(request.instruction); break; } catch {
      if (retries >= 2) return fallback("RESPONSE_TIMEOUT", request.instruction);
      retries++;
    }
  }
    if (validShape(text, request)) return { ok: true, kind: "browser", text, conversationUrl: url };
    if (retries === 0) {
      try { text = await host.sendAndRead(REPAIR); } catch { return fallback("RESPONSE_MALFORMED", request.instruction); }
      if (validShape(text, request)) return { ok: true, kind: "browser", text, conversationUrl: url };
    }
    return fallback("PROTOCOL_REPAIR_EXHAUSTED", request.instruction);
}

function validShape(text: string, request: RelayRequest): boolean {
  const parsed = parseC2CMessage(text);
  if (!parsed.ok) return false;
  const message = parsed.message;
  const expectedIteration = message.state === "PLAN" ? request.iteration + 1 : request.iteration;
  if (message.taskId !== request.taskId || message.iteration !== expectedIteration || !request.expectedStates.includes(message.state as "PLAN" | "DONE" | "BLOCKED")) return false;
  if (message.state === "PLAN") return Boolean(message.sections.ACTIONS?.trim() && message.sections.TESTS?.trim() && message.sections.SUCCESS_CRITERIA?.trim());
  if (message.state === "BLOCKED") return Boolean(message.sections.REASON?.trim());
  return true;
}

function fallback(errorCode: "BROWSER_UNAVAILABLE" | "NAVIGATION_FAILED" | "SESSION_NOT_FOUND" | "RESPONSE_TIMEOUT" | "RESPONSE_MALFORMED" | "PROTOCOL_REPAIR_EXHAUSTED", instruction: string): RelayResult {
  return { ok: false, kind: "manual", fallbackRequired: true, errorCode, instruction };
}

function isSessionMissing(error: unknown): boolean { return error instanceof Error && error.message === "SESSION_NOT_FOUND"; }

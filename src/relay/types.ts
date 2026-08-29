export type RelayMode = "auto" | "manual" | "browser";
export type RelayKind = "manual" | "browser";

export type RelayFailureCode =
  | "BROWSER_UNAVAILABLE"
  | "NAVIGATION_FAILED"
  | "SESSION_NOT_FOUND"
  | "LOGIN_REQUIRED"
  | "RESPONSE_TIMEOUT"
  | "RESPONSE_MALFORMED"
  | "PROTOCOL_REPAIR_EXHAUSTED";

export interface RelayPolicyState {
  browserRetries: number;
  protocolRepairAttempts: number;
  sessionRecoveryAttempts: number;
  fallbackRequired: boolean;
}

export interface RelayRequest {
  workspaceRoot: string;
  workspaceId: string;
  taskId: string;
  iteration: number;
  instruction: string;
  expectedStates: Array<"PLAN" | "DONE" | "BLOCKED">;
}

export type RelayResult =
  | { ok: true; kind: RelayKind; text: string; conversationUrl?: string }
  | { ok: false; kind: RelayKind; fallbackRequired: true; errorCode: RelayFailureCode; instruction: string };

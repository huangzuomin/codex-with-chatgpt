import type { RelayPolicyState } from "./types.js";

export type RelayPolicyEvent = "browser_retry" | "protocol_repair" | "session_recovery";

export function initialRelayPolicy(): RelayPolicyState {
  return { browserRetries: 0, protocolRepairAttempts: 0, sessionRecoveryAttempts: 0, fallbackRequired: false };
}

export function nextRelayPolicy(state: RelayPolicyState, event: RelayPolicyEvent): RelayPolicyState {
  const next = { ...state };
  if (event === "browser_retry") next.browserRetries++;
  if (event === "protocol_repair") next.protocolRepairAttempts++;
  if (event === "session_recovery") next.sessionRecoveryAttempts++;
  next.fallbackRequired = next.browserRetries > 2 || next.protocolRepairAttempts > 1 || next.sessionRecoveryAttempts > 1;
  return next;
}

import type { RelayPolicyLimits, RelayPolicyState } from "./types.js";

export type RelayPolicyEvent = "browser_retry" | "protocol_repair" | "session_recovery";

export const RELAY_POLICY_LIMITS: RelayPolicyLimits = Object.freeze({ browserRetries: 2, protocolRepairAttempts: 1, sessionRecoveryAttempts: 1 });

export function initialRelayPolicy(): RelayPolicyState {
  return { browserRetries: 0, protocolRepairAttempts: 0, sessionRecoveryAttempts: 0, fallbackRequired: false };
}

export function nextRelayPolicy(state: RelayPolicyState, event: RelayPolicyEvent): RelayPolicyState {
  const next = { ...state };
  if (event === "browser_retry") next.browserRetries++;
  if (event === "protocol_repair") next.protocolRepairAttempts++;
  if (event === "session_recovery") next.sessionRecoveryAttempts++;
  next.fallbackRequired = next.browserRetries > RELAY_POLICY_LIMITS.browserRetries || next.protocolRepairAttempts > RELAY_POLICY_LIMITS.protocolRepairAttempts || next.sessionRecoveryAttempts > RELAY_POLICY_LIMITS.sessionRecoveryAttempts;
  return next;
}

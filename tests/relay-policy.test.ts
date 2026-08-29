import { describe, expect, it } from "vitest";
import { initialRelayPolicy, nextRelayPolicy } from "../src/relay/policy.js";

describe("relay policy", () => {
  it("allows browser retries up to two then requires manual fallback", () => {
    let state = initialRelayPolicy();
    state = nextRelayPolicy(state, "browser_retry");
    expect(state.browserRetries).toBe(1);
    state = nextRelayPolicy(state, "browser_retry");
    expect(state.browserRetries).toBe(2);
    expect(nextRelayPolicy(state, "browser_retry").fallbackRequired).toBe(true);
  });

  it("caps repair and session recovery at one", () => {
    let state = initialRelayPolicy();
    state = nextRelayPolicy(state, "protocol_repair");
    expect(state.protocolRepairAttempts).toBe(1);
    expect(nextRelayPolicy(state, "protocol_repair").fallbackRequired).toBe(true);
    state = initialRelayPolicy();
    state = nextRelayPolicy(state, "session_recovery");
    expect(state.sessionRecoveryAttempts).toBe(1);
    expect(nextRelayPolicy(state, "session_recovery").fallbackRequired).toBe(true);
  });
});

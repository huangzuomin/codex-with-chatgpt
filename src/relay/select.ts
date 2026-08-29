import type { RelayKind, RelayMode } from "./types.js";

export function selectRelay(input: { mode: RelayMode; browserAvailable: boolean }): RelayKind {
  if (input.mode === "manual") return "manual";
  return input.browserAvailable ? "browser" : "manual";
}

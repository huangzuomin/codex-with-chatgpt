import { describe, expect, it } from "vitest";
import { selectRelay } from "../src/relay/select.js";

describe("relay selection", () => {
  it.each([
    ["manual", true, "manual"],
    ["manual", false, "manual"],
    ["browser", true, "browser"],
    ["browser", false, "manual"],
    ["auto", true, "browser"],
    ["auto", false, "manual"],
  ] as const)("selects %s with capability=%s as %s", (mode, browserAvailable, expected) => {
    expect(selectRelay({ mode, browserAvailable })).toBe(expected);
  });
});

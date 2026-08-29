import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cleanup, makeTmpDir } from "./helpers.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(cleanup));
const run = (args: string[], root: string) => spawnSync(process.execPath, ["--import", "tsx/esm", path.resolve("src/cli/index.ts"), ...args, "--workspace", root, "--json"], { encoding: "utf8" });

describe("relay CLI", () => {
  it("reports safe manual fallback when browser capability is unavailable", () => {
    const root = makeTmpDir("relay-cli"); roots.push(root);
    const result = run(["relay", "get", "--browser-capability", "unavailable"], root);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ requestedMode: "auto", effectiveKind: "manual", fallbackRequired: false, browserRetries: 0 });
  });
  it("persists only an explicit relay mode change", () => {
    const root = makeTmpDir("relay-cli-set"); roots.push(root);
    const result = run(["relay", "set", "manual"], root);
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ mode: "manual" });
    expect(JSON.parse(fs.readFileSync(path.join(root, ".c2c.json"), "utf8"))).toMatchObject({ relay: { mode: "manual" } });
  });
});

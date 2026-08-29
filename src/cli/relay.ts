import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { getStateDir } from "../config/paths.js";
import { selectRelay } from "../relay/select.js";
import { initialRelayPolicy } from "../relay/policy.js";
import type { RelayMode } from "../relay/types.js";
import { SessionStore } from "../session/store.js";
import { Workspace } from "../workspace/manager.js";

export function registerRelayCommands(program: Command, emitSuccess: (data: Record<string, unknown>, json: boolean) => void): void {
  const relay = program.command("relay").description("Select the ChatGPT control relay");
  relay.command("get").option("-w, --workspace <path>").option("--browser-capability <capability>", "available | unavailable", "unavailable").option("--json", "machine-readable output", false)
    .action((opts: { workspace?: string; browserCapability: string; json: boolean }) => {
      const workspace = new Workspace(path.resolve(opts.workspace ?? process.cwd()));
      const mode = workspace.projectConfig.relay?.mode ?? "auto";
      const browserAvailable = opts.browserCapability === "available";
      if (opts.browserCapability !== "available" && opts.browserCapability !== "unavailable") throw new Error("Unknown browser capability.");
      const effectiveKind = selectRelay({ mode, browserAvailable });
      const policy = initialRelayPolicy();
      const saved = new SessionStore(workspace.id, getStateDir()).read();
      emitSuccess({ requestedMode: mode, effectiveKind, ...policy, fallbackRequired: mode === "browser" && !browserAvailable, savedSession: saved ? { conversationUrl: saved.conversationUrl, title: saved.title } : null }, opts.json);
    });
  relay.command("set").argument("<mode>", "auto | manual | browser").option("-w, --workspace <path>").option("--json", "machine-readable output", false)
    .action((mode: string, opts: { workspace?: string; json: boolean }) => {
      if (mode !== "auto" && mode !== "manual" && mode !== "browser") throw new Error("Unknown relay mode.");
      const root = path.resolve(opts.workspace ?? process.cwd());
      const configPath = path.join(root, ".c2c.json");
      const current = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown> : {};
      fs.writeFileSync(configPath, `${JSON.stringify({ ...current, relay: { ...((current.relay ?? {}) as Record<string, unknown>), mode: mode as RelayMode } }, null, 2)}\n`, "utf8");
      emitSuccess({ mode }, opts.json);
    });
}

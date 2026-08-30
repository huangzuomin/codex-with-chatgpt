import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { adminFetch, ensureBridge, stopBridge } from "../src/process/daemon.js";
import { detectTunnelBinaries } from "../src/tunnel/detect.js";
import { readLastEndpoint, writeLastEndpoint } from "../src/config/endpoint.js";
import { Workspace } from "../src/workspace/manager.js";
import { cleanup, isolateStateDir, makeTmpDir } from "./helpers.js";

vi.mock("../src/process/daemon.js", () => ({
  adminFetch: vi.fn(),
  ensureBridge: vi.fn(),
  stopBridge: vi.fn(),
}));

vi.mock("../src/tunnel/detect.js", () => ({
  detectTunnelBinaries: vi.fn(),
}));

const mockedAdminFetch = vi.mocked(adminFetch);
const mockedEnsureBridge = vi.mocked(ensureBridge);
const mockedStopBridge = vi.mocked(stopBridge);
const mockedDetectTunnelBinaries = vi.mocked(detectTunnelBinaries);

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const originalStateDir = process.env.C2C_STATE_DIR;
const cleanupDirs: string[] = [];

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  if (originalStateDir === undefined) delete process.env.C2C_STATE_DIR;
  else process.env.C2C_STATE_DIR = originalStateDir;
  vi.clearAllMocks();
  while (cleanupDirs.length) cleanup(cleanupDirs.pop()!);
});

describe("restart --tunnel endpoint persistence", () => {
  it("replaces an old saved endpoint with the actual endpoint serving the restarted bridge", async () => {
    cleanupDirs.push(isolateStateDir());
    const root = makeTmpDir("restart-cli");
    cleanupDirs.push(root);
    const workspace = new Workspace(root);
    const oldPublicUrl = "https://old.trycloudflare.com";
    const activePublicUrl = "https://active.trycloudflare.com";
    writeLastEndpoint({
      workspaceId: workspace.id,
      port: 41000,
      publicUrl: oldPublicUrl,
      mcpUrl: `${oldPublicUrl}/mcp`,
      connectorName: "Codex with ChatGPT · Restart Test",
    });

    const runtime = {
      service: "codex-with-chatgpt",
      version: "0.1.0",
      workspaceId: workspace.id,
      workspaceRoot: workspace.root,
      pid: 12345,
      port: 42000,
      adminToken: "test-admin-token",
      publicUrl: activePublicUrl,
      startedAt: new Date().toISOString(),
    };
    const info = {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceRoot: workspace.root,
      port: runtime.port,
      publicUrl: activePublicUrl,
      tunnel: { running: true, url: activePublicUrl, provider: "cloudflare-quick" },
      tokenCount: 0,
      pairingActive: false,
      pid: runtime.pid,
      startedAt: runtime.startedAt,
    };
    mockedStopBridge.mockResolvedValue(true);
    mockedEnsureBridge.mockResolvedValue({ runtime, spawned: true });
    mockedDetectTunnelBinaries.mockReturnValue({ cloudflared: "cloudflared", wrangler: null });
    mockedAdminFetch.mockResolvedValue(info);

    process.argv = [process.execPath, "src/cli/index.ts", "restart", "--tunnel", "-w", root];
    vi.resetModules();
    await import("../src/cli/index.js");
    await vi.waitFor(() => expect(mockedAdminFetch).toHaveBeenCalled(), { timeout: 2_000 });

    expect(readLastEndpoint(workspace.id)).toMatchObject({
      port: runtime.port,
      publicUrl: activePublicUrl,
      mcpUrl: `${activePublicUrl}/mcp`,
      connectorName: "Codex with ChatGPT · Restart Test",
    });
  });
});

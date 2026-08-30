import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startBridge, type Bridge } from "../src/bridge/server.js";
import { appendExecutionRecord } from "../src/execution/records.js";
import { addProject, removeProject } from "../src/projects/registry.js";
import { projectsFile } from "../src/config/paths.js";
import { makeTmpDir, cleanup, write, makeGitRepo, git, isolateStateDir } from "./helpers.js";

let root: string;
let bridge: Bridge;
let client: Client;
let accessToken: string;
let stateDir: string;
const projectRoots: Record<string, string> = {};

function textOf(result: { content?: unknown }): string {
  const content = result.content as { type: string; text: string }[];
  return content?.[0]?.text ?? "";
}

function jsonOf<T = Record<string, unknown>>(result: { content?: unknown }): T {
  return JSON.parse(textOf(result)) as T;
}

beforeAll(async () => {
  stateDir = isolateStateDir();
  root = makeTmpDir("mcp-ws");
  makeGitRepo(root);
  write(root, "package.json", JSON.stringify({ name: "demo", scripts: { test: "vitest run" }, dependencies: { react: "^19.0.0" } }));
  write(root, ".env", "API_KEY=supersecret\n");
  // an uncommitted change so git_diff has content
  write(root, "src/index.ts", "export const answer = 43; // changed\n");

  for (const id of ["alpha", "beta", "gamma"]) {
    const projectRoot = makeTmpDir(`mcp-${id}`);
    projectRoots[id] = projectRoot;
    makeGitRepo(projectRoot);
    write(projectRoot, "shared.txt", `${id} content\n`);
    write(projectRoot, `${id}-only.txt`, `needle-${id}\n`);
    write(projectRoot, "scoped.txt", `${id}-base\n`);
    git(projectRoot, "add", "shared.txt", `${id}-only.txt`, "scoped.txt");
    git(projectRoot, "commit", "-m", `add ${id} fixtures`);
    write(projectRoot, "scoped.txt", `${id}-dirty\n`);
    addProject({ id, displayName: id.toUpperCase(), workspaceRoot: projectRoot, repo: `local/${id}` });
  }
  write(projectRoots.beta, "beta-untracked.txt", "beta status marker\n");

  bridge = await startBridge({
    workspaceRoot: root,
    port: 0,
    persistRuntime: false,
    authStoreFile: path.join(makeTmpDir("auth"), "store.json"),
  });
  const tokens = bridge.authStore.issueTokens({
    clientId: "it-client",
    scopes: ["workspace.read", "workspace.search", "git.read", "execution.read"],
    resource: `${bridge.localBaseUrl()}/mcp`,
  });
  accessToken = tokens.accessToken;

  client = new Client({ name: "c2c-test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${bridge.localBaseUrl()}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  });
  await client.connect(transport);
});

afterAll(async () => {
  await client.close();
  await bridge.close();
  cleanup(root);
  for (const projectRoot of Object.values(projectRoots)) cleanup(projectRoot);
  cleanup(stateDir);
  delete process.env.C2C_STATE_DIR;
});

describe("MCP tools over Streamable HTTP", () => {
  it("lists projects_list and all eight project-aware read-only tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "execution_summary",
      "git_diff",
      "git_status",
      "list_directory",
      "projects_list",
      "read_file",
      "search_workspace",
      "test_status",
      "workspace_info",
    ]);
    for (const tool of tools.filter((item) => item.name !== "projects_list")) {
      const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      expect(properties).toHaveProperty("project_id");
    }
    // no write tools in V1
    for (const forbidden of ["write_file", "delete_file", "execute_shell", "git_commit", "install_package"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("workspace_info returns identity and project detection", async () => {
    const result = await client.callTool({ name: "workspace_info", arguments: {} });
    const info = jsonOf<{ workspaceId: string; projectType: string; frameworks: string[]; git: { isRepo: boolean; branch: string } }>(result);
    expect(info.workspaceId).toBe(bridge.workspace.id);
    expect(info.projectType).toBe("node");
    expect(info.frameworks).toContain("React");
    expect(info.git.isRepo).toBe(true);
    expect(info.git.branch).toBe("main");
  });

  it("projects_list returns deterministic safe metadata without local paths", async () => {
    const result = await client.callTool({ name: "projects_list", arguments: {} });
    const data = jsonOf<{ projects: { id: string; displayName: string; repo?: string; enabled: boolean }[] }>(result);
    expect(data.projects.map((project) => project.id)).toEqual(["alpha", "beta", "gamma"]);
    expect(data.projects[0]).toEqual({ id: "alpha", displayName: "ALPHA", repo: "local/alpha", enabled: true });
    expect(textOf(result)).not.toContain(projectRoots.alpha);
    expect(textOf(result)).not.toContain("workspaceRoot");
  });

  it("routes workspace_info, read_file, list_directory, and search_workspace by project_id", async () => {
    const info = jsonOf<{ workspaceId: string; workspaceName: string }>(
      await client.callTool({ name: "workspace_info", arguments: { project_id: "alpha" } })
    );
    expect(info.workspaceId).not.toBe(bridge.workspace.id);

    const alpha = jsonOf<{ content: string }>(
      await client.callTool({ name: "read_file", arguments: { project_id: "alpha", path: "shared.txt" } })
    );
    const beta = jsonOf<{ content: string }>(
      await client.callTool({ name: "read_file", arguments: { project_id: "beta", path: "shared.txt" } })
    );
    expect(alpha.content).toBe("alpha content");
    expect(beta.content).toBe("beta content");

    const listing = jsonOf<{ entries: { path: string }[] }>(
      await client.callTool({ name: "list_directory", arguments: { project_id: "alpha", path: "." } })
    );
    expect(listing.entries.some((entry) => entry.path === "alpha-only.txt")).toBe(true);
    expect(listing.entries.some((entry) => entry.path === "beta-only.txt")).toBe(false);

    const search = jsonOf<{ matches: { path: string; text: string }[] }>(
      await client.callTool({ name: "search_workspace", arguments: { project_id: "beta", query: "needle-beta" } })
    );
    expect(search.matches).toEqual([expect.objectContaining({ path: "beta-only.txt", text: "needle-beta" })]);
  });

  it("routes git_status and git_diff, including path resolution, by project_id", async () => {
    const status = jsonOf<{ untracked: string[] }>(
      await client.callTool({ name: "git_status", arguments: { project_id: "beta" } })
    );
    expect(status.untracked).toContain("beta-untracked.txt");

    const betaDiff = jsonOf<{ diff: string }>(
      await client.callTool({ name: "git_diff", arguments: { project_id: "beta", mode: "unstaged" } })
    );
    expect(betaDiff.diff).toContain("beta-dirty");
    expect(betaDiff.diff).not.toContain("alpha-dirty");

    const gammaPathDiff = jsonOf<{ diff: string }>(
      await client.callTool({
        name: "git_diff",
        arguments: { project_id: "gamma", mode: "unstaged", path: "scoped.txt" },
      })
    );
    expect(gammaPathDiff.diff).toContain("gamma-dirty");
    expect(gammaPathDiff.diff).not.toContain("beta-dirty");
  });

  it("uses the selected workspace id for test_status and execution_summary", async () => {
    const alphaWorkspaceId = jsonOf<{ workspaceId: string }>(
      await client.callTool({ name: "workspace_info", arguments: { project_id: "alpha" } })
    ).workspaceId;
    const gammaWorkspaceId = jsonOf<{ workspaceId: string }>(
      await client.callTool({ name: "workspace_info", arguments: { project_id: "gamma" } })
    ).workspaceId;
    appendExecutionRecord(alphaWorkspaceId, {
      taskId: "alpha_task",
      iteration: 1,
      changedFiles: [],
      tests: "alpha passed",
      exitStatus: "ok",
      timestamp: new Date().toISOString(),
    });
    appendExecutionRecord(gammaWorkspaceId, {
      taskId: "gamma_task",
      iteration: 1,
      changedFiles: [],
      tests: "gamma passed",
      exitStatus: "ok",
      timestamp: new Date().toISOString(),
    });

    const status = jsonOf<{ tests: string }>(
      await client.callTool({ name: "test_status", arguments: { project_id: "alpha" } })
    );
    const summary = jsonOf<{ records: { taskId: string }[] }>(
      await client.callTool({ name: "execution_summary", arguments: { project_id: "gamma", limit: 5 } })
    );
    expect(status.tests).toBe("alpha passed");
    expect(summary.records[0].taskId).toBe("gamma_task");
  });

  it("rejects unknown projects and cross-project traversal", async () => {
    const unknown = await client.callTool({ name: "read_file", arguments: { project_id: "missing", path: "shared.txt" } });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain("PROJECT_NOT_FOUND");

    const escapePath = path.join(path.relative(projectRoots.alpha, projectRoots.beta), "shared.txt");
    const traversal = await client.callTool({
      name: "read_file",
      arguments: { project_id: "alpha", path: escapePath },
    });
    expect(traversal.isError).toBe(true);
    expect(textOf(traversal)).toContain("PATH_OUTSIDE_WORKSPACE");
    expect(textOf(traversal)).not.toContain("beta content");
  });

  it("rejects a disabled registered project through MCP", async () => {
    const disabledRoot = makeTmpDir("mcp-disabled");
    projectRoots.disabled = disabledRoot;
    write(disabledRoot, "shared.txt", "disabled content\n");
    const registry = JSON.parse(fs.readFileSync(projectsFile(), "utf8")) as {
      version: 1;
      projects: Record<string, unknown>;
    };
    registry.projects.disabled = {
      id: "disabled",
      displayName: "DISABLED",
      workspaceRoot: disabledRoot,
      enabled: false,
    };
    fs.writeFileSync(projectsFile(), JSON.stringify(registry));

    const result = await client.callTool({
      name: "read_file",
      arguments: { project_id: "disabled", path: "shared.txt" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("PROJECT_DISABLED");

    delete registry.projects.disabled;
    fs.writeFileSync(projectsFile(), JSON.stringify(registry));
  });

  it("read_file returns hello.txt", async () => {
    const result = await client.callTool({ name: "read_file", arguments: { path: "hello.txt" } });
    const file = jsonOf<{ content: string; totalLines: number }>(result);
    expect(file.content).toContain("Hello from Codex with ChatGPT!");
  });

  it("read_file denies .env with ACCESS_DENIED_SENSITIVE_FILE and no content", async () => {
    const result = await client.callTool({ name: "read_file", arguments: { path: ".env" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("ACCESS_DENIED_SENSITIVE_FILE");
    expect(textOf(result)).not.toContain("supersecret");
  });

  it("read_file denies paths outside the workspace", async () => {
    const result = await client.callTool({ name: "read_file", arguments: { path: "../../etc/hosts" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("PATH_OUTSIDE_WORKSPACE");
  });

  it("list_directory lists the tree", async () => {
    const result = await client.callTool({ name: "list_directory", arguments: { path: ".", depth: 2 } });
    const listing = jsonOf<{ entries: { path: string }[] }>(result);
    const paths = listing.entries.map((entry) => entry.path);
    expect(paths).toContain("hello.txt");
    expect(paths).toContain("src/index.ts");
    expect(paths).not.toContain(".env");
  });

  it("search_workspace finds matches", async () => {
    const result = await client.callTool({ name: "search_workspace", arguments: { query: "answer" } });
    const search = jsonOf<{ matches: { path: string; line: number }[] }>(result);
    expect(search.matches.some((match) => match.path === "src/index.ts")).toBe(true);
  });

  it("git_status reports the dirty file", async () => {
    const result = await client.callTool({ name: "git_status", arguments: {} });
    const status = jsonOf<{ isRepo: boolean; unstaged: { path: string }[] }>(result);
    expect(status.isRepo).toBe(true);
    expect(status.unstaged.some((entry) => entry.path === "src/index.ts")).toBe(true);
  });

  it("git_diff shows the change", async () => {
    const result = await client.callTool({ name: "git_diff", arguments: { mode: "unstaged" } });
    const diff = jsonOf<{ diff: string; hasMore: boolean }>(result);
    expect(diff.diff).toContain("answer = 43");
    expect(diff.hasMore).toBe(false);
  });

  it("git_diff paginates large diffs", async () => {
    const big = Array.from({ length: 20000 }, (_, i) => `content line ${i}`).join("\n");
    write(root, "big-change.txt", big);
    git(root, "add", "big-change.txt");
    const first = jsonOf<{ hasMore: boolean; nextOffset: number; totalBytes: number; returnedBytes: number }>(
      await client.callTool({ name: "git_diff", arguments: { mode: "staged", max_bytes: 4096 } })
    );
    expect(first.hasMore).toBe(true);
    expect(first.returnedBytes).toBeLessThanOrEqual(4096);
    const second = jsonOf<{ offset: number; diff: string }>(
      await client.callTool({
        name: "git_diff",
        arguments: { mode: "staged", max_bytes: 4096, offset: first.nextOffset },
      })
    );
    expect(second.offset).toBe(first.nextOffset);
    expect(second.diff.length).toBeGreaterThan(0);
    git(root, "reset", "big-change.txt");
  });

  it("execution_summary and test_status read harness records", async () => {
    appendExecutionRecord(bridge.workspace.id, {
      taskId: "c2c_test1",
      iteration: 1,
      changedFiles: ["src/index.ts"],
      tests: "27 passed",
      exitStatus: "ok",
      timestamp: new Date().toISOString(),
    });
    const summary = jsonOf<{ records: { taskId: string }[] }>(
      await client.callTool({ name: "execution_summary", arguments: {} })
    );
    expect(summary.records[0].taskId).toBe("c2c_test1");

    const status = jsonOf<{ available: boolean; tests: string }>(
      await client.callTool({ name: "test_status", arguments: {} })
    );
    expect(status.available).toBe(true);
    expect(status.tests).toBe("27 passed");
  });

  it("enforces scopes per tool", async () => {
    const limited = bridge.authStore.issueTokens({
      clientId: "limited",
      scopes: ["workspace.read"],
      resource: `${bridge.localBaseUrl()}/mcp`,
    });
    const limitedClient = new Client({ name: "limited", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${bridge.localBaseUrl()}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${limited.accessToken}` } },
    });
    await limitedClient.connect(transport);
    const denied = await limitedClient.callTool({ name: "git_diff", arguments: {} });
    expect(denied.isError).toBe(true);
    expect(textOf(denied)).toContain("INSUFFICIENT_SCOPE");
    const allowed = await limitedClient.callTool({ name: "read_file", arguments: { path: "hello.txt" } });
    expect(allowed.isError ?? false).toBe(false);
    const projectsAllowed = await limitedClient.callTool({ name: "projects_list", arguments: {} });
    expect(projectsAllowed.isError ?? false).toBe(false);
    await limitedClient.close();

    const executionOnly = bridge.authStore.issueTokens({
      clientId: "execution-only",
      scopes: ["execution.read"],
      resource: `${bridge.localBaseUrl()}/mcp`,
    });
    const executionClient = new Client({ name: "execution-only", version: "1.0.0" });
    const executionTransport = new StreamableHTTPClientTransport(new URL(`${bridge.localBaseUrl()}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${executionOnly.accessToken}` } },
    });
    await executionClient.connect(executionTransport);
    const projectsDenied = await executionClient.callTool({ name: "projects_list", arguments: {} });
    expect(projectsDenied.isError).toBe(true);
    expect(textOf(projectsDenied)).toContain("INSUFFICIENT_SCOPE");
    await executionClient.close();
  });

  it("git_diff over MCP excludes sensitive files like .npmrc and service-account*.json", async () => {
    write(root, ".npmrc", "//registry.npmjs.org/:_authToken=supersecret-npm-token\n");
    write(root, "service-account-test.json", '{"private_key": "supersecret-sa-key"}\n');
    write(root, "src/visible.ts", "export const visible = 'safe-change';\n");

    git(root, "add", "-f", ".npmrc", "service-account-test.json", "src/visible.ts");

    const result = jsonOf<{ diff: string; isRepo: boolean }>(
      await client.callTool({ name: "git_diff", arguments: { mode: "staged" } })
    );

    expect(result.isRepo).toBe(true);
    expect(result.diff).toContain("safe-change");
    expect(result.diff).not.toContain("supersecret-npm-token");
    expect(result.diff).not.toContain("supersecret-sa-key");

    git(root, "rm", "-f", "--cached", ".npmrc", "service-account-test.json", "src/visible.ts");
  });

  it("git_diff over MCP blocks sensitive-to-safe renames from leaking original content", async () => {
    write(root, ".npmrc", "//registry.npmjs.org/:_authToken=mcp-secret-token-123\n");
    git(root, "add", "-f", ".npmrc");
    git(root, "commit", "-m", "add secret to rename");

    git(root, "mv", ".npmrc", "public_harmless.txt");

    const result = jsonOf<{ diff: string; isRepo: boolean }>(
      await client.callTool({ name: "git_diff", arguments: { mode: "staged" } })
    );

    expect(result.isRepo).toBe(true);
    expect(result.diff).not.toContain("mcp-secret-token-123");
    expect(result.diff).not.toContain("public_harmless.txt");

    git(root, "reset", "--hard", "HEAD");
  });

  it("git_diff over MCP with path='src' blocks cross-boundary rename leaks from root secrets", async () => {
    write(root, ".npmrc", "//registry.npmjs.org/:_authToken=root-mcp-scoped-secret\n");
    git(root, "add", "-f", ".npmrc");
    git(root, "commit", "-m", "add root secret for scoped test");

    // Rename root .npmrc to src/public.txt
    git(root, "mv", ".npmrc", "src/public.txt");

    const result = jsonOf<{ diff: string; isRepo: boolean }>(
      await client.callTool({
        name: "git_diff",
        arguments: { mode: "staged", path: "src" },
      })
    );

    expect(result.isRepo).toBe(true);
    expect(result.diff).not.toContain("root-mcp-scoped-secret");
    expect(result.diff).not.toContain("src/public.txt");

    git(root, "reset", "--hard", "HEAD");
  });

  it("supports alpha, beta, gamma and dynamic delta add/beta removal through one MCP server", async () => {
    for (const id of ["alpha", "beta", "gamma"]) {
      const file = jsonOf<{ content: string }>(
        await client.callTool({ name: "read_file", arguments: { project_id: id, path: "shared.txt" } })
      );
      expect(file.content).toBe(`${id} content`);
    }

    const deltaRoot = makeTmpDir("mcp-delta");
    projectRoots.delta = deltaRoot;
    write(deltaRoot, "shared.txt", "delta content\n");
    addProject({ id: "delta", displayName: "DELTA", workspaceRoot: deltaRoot });
    const delta = jsonOf<{ content: string }>(
      await client.callTool({ name: "read_file", arguments: { project_id: "delta", path: "shared.txt" } })
    );
    expect(delta.content).toBe("delta content");

    removeProject("beta");
    const removed = await client.callTool({ name: "read_file", arguments: { project_id: "beta", path: "shared.txt" } });
    expect(removed.isError).toBe(true);
    expect(textOf(removed)).toContain("PROJECT_NOT_FOUND");

    const available = jsonOf<{ projects: { id: string }[] }>(
      await client.callTool({ name: "projects_list", arguments: {} })
    );
    expect(available.projects.map((project) => project.id)).toEqual(["alpha", "delta", "gamma"]);
    for (const id of ["alpha", "gamma", "delta"]) {
      const file = jsonOf<{ content: string }>(
        await client.callTool({ name: "read_file", arguments: { project_id: id, path: "shared.txt" } })
      );
      expect(file.content).toBe(`${id} content`);
    }
  });
});

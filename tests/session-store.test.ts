import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SessionStore } from "../src/session/store.js";
import { cleanup, makeTmpDir } from "./helpers.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(cleanup));

describe("SessionStore", () => {
  it("writes and reads an allowed ChatGPT conversation URL", () => {
    const state = makeTmpDir("session-state"); roots.push(state);
    const store = new SessionStore("workspace-1", state);
    const saved = store.save({ conversationUrl: "https://chatgpt.com/c/abc123", title: "C2C" });
    expect(saved.workspaceId).toBe("workspace-1");
    expect(store.read()).toMatchObject({ conversationUrl: "https://chatgpt.com/c/abc123", title: "C2C" });
  });

  it("rejects non-conversation URLs and migrates legacy fields", () => {
    const state = makeTmpDir("session-legacy"); roots.push(state);
    const file = path.join(state, "sessions", "workspace-1.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ url: "https://chatgpt.com/c/legacy", taskId: "c2c_12345678", iteration: 2 }));
    expect(new SessionStore("workspace-1", state).read()).toMatchObject({ conversationUrl: "https://chatgpt.com/c/legacy", lastTaskId: "c2c_12345678", lastIteration: 2 });
    expect(() => new SessionStore("workspace-2", state).save({ conversationUrl: "https://example.com/c/nope" })).toThrow();
  });

  it("returns a stable empty result for corrupt state", () => {
    const state = makeTmpDir("session-corrupt"); roots.push(state);
    const file = path.join(state, "sessions", "workspace-1.json");
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "not json");
    expect(new SessionStore("workspace-1", state).read()).toBeNull();
  });
});

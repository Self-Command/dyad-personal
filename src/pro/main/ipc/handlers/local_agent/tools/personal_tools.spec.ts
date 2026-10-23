import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";
import type { UserSettings } from "@/lib/schemas";

const mocks = vi.hoisted(() => ({
  ready: true,
  settings: {
    enablePersonalMode: true,
    enableCodeExplorer: true,
    enableShellTool: true,
    agentToolConsents: {},
  },
  run: vi.fn(async () => ({
    query: "find component",
    totalSymbols: 1,
    totalFiles: 1,
    indexedFileCount: 1,
    indexMs: 1,
    searchMs: 1,
    notes: [],
    files: [],
    truncated: false,
  })),
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => mocks.settings,
  writeSettings: vi.fn(),
}));
vi.mock("@/ipc/processors/code_explorer", () => ({
  getCodeExplorerAvailability: () => ({
    ready: mocks.ready,
    reason: mocks.ready ? null : "typescript_not_installed",
    tsconfigPath: "tsconfig.json",
  }),
  formatCodeExplorerDisabledReason: () => "TypeScript is not installed",
  runCodeExplorer: mocks.run,
}));

import { TOOL_DEFINITIONS, shouldIncludeTool } from "../tool_definitions";
import { exploreCodeTool } from "./subagent_tools";
import { runShellTool } from "./run_shell";

const ctx = () =>
  ({
    isDyadPro: false,
    appPath: "/personal-app",
    referencedApps: new Map(),
    inferenceSettings: mocks.settings as unknown as UserSettings,
    onXmlComplete: vi.fn(),
  }) as unknown as AgentContext;

beforeEach(() => {
  mocks.ready = true;
  mocks.run.mockClear();
});

describe("personal tool capability boundary", () => {
  it("exposes compiler exploration directly to the root without Pro or sub-agents", async () => {
    const context = ctx();
    expect(shouldIncludeTool(exploreCodeTool, context)).toBe(true);
    const result = await exploreCodeTool.execute(
      { query: "find component" },
      context,
    );
    expect(result).toContain("Found 1 symbols");
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        appPath: "/personal-app",
        query: "find component",
      }),
    );
    mocks.ready = false;
    expect(shouldIncludeTool(exploreCodeTool, context)).toBe(false);
    await expect(
      exploreCodeTool.execute({ query: "find component" }, context),
    ).rejects.toThrow("Code exploration is unavailable");
  });
  it("filters every Engine endpoint while preserving shell mode restrictions", () => {
    const context = ctx();
    for (const tool of TOOL_DEFINITIONS.filter(
      (entry) => entry.usesEngineEndpoint,
    )) {
      expect(shouldIncludeTool(tool, { ...context, isDyadPro: true })).toBe(
        false,
      );
    }
    expect(shouldIncludeTool(runShellTool, context)).toBe(true);
    expect(shouldIncludeTool(runShellTool, context, { readOnly: true })).toBe(
      false,
    );
    expect(
      shouldIncludeTool(runShellTool, context, { planModeOnly: true }),
    ).toBe(false);
  });
});

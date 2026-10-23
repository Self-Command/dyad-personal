// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map(), reserveQuota: vi.fn(), bill: vi.fn() };
});
vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});
vi.mock("@/ipc/handlers/free_agent_quota_handlers", async (original) => ({
  ...(await original<
    typeof import("@/ipc/handlers/free_agent_quota_handlers")
  >()),
  reserveFreeAgentQuotaSlot: h.reserveQuota,
}));
vi.mock("@/ipc/services/external_model_usage", async (original) => ({
  ...(await original<typeof import("@/ipc/services/external_model_usage")>()),
  startExternalModelUsage: h.bill,
}));

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "./chat_flow_harness";

describe("Personal Agent full IPC, model HTTP and filesystem flow", () => {
  let harness: ChatFlowHarness;
  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        enablePersonalMode: true,
        enableDyadPro: false,
        enableAppBlueprint: false,
        enableAutoReview: false,
        enableCodeExplorer: false,
      },
    });
  }, 60_000);
  afterAll(async () => {
    await harness?.dispose();
  });
  it("uses a custom endpoint, executes the real write tool and commits without official credits or trial admissions", async () => {
    const { eventsFor, messages } = await harness.streamChat(
      "tc=local-agent/dyad-write-angle",
    );
    expect(eventsFor("chat:response:error")).toEqual([]);
    expect(harness.appFileExists("src/foo/bar.tsx")).toBe(true);
    expect(harness.gitLog().length).toBeGreaterThan(1);
    expect(
      messages.find((message) => message.role === "assistant")?.commitHash,
    ).toBeTruthy();
    expect(h.reserveQuota).not.toHaveBeenCalled();
    expect(h.bill).not.toHaveBeenCalled();
  }, 60_000);
});

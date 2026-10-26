import { describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./tools/types";

const mocks = vi.hoisted(() => ({
  settings: {
    enablePersonalMode: true,
    providerSettings: {},
    personalSafetyReviewModel: {
      provider: "review",
      name: "new-reviewer",
      effortLevel: "low",
    },
    personalSafetyReviewTimeoutSeconds: 90,
  },
  review: vi.fn(async () => ({ decision: "allow", reason: "test" })),
}));
vi.mock("@/main/settings", () => ({ readSettings: () => mocks.settings }));
vi.mock("./tool_safety_reviewer", () => ({
  reviewToolAction: mocks.review,
  SHELL_REVIEW_TIMEOUT_MS: 45_000,
  ShellReviewCatalogTooLargeError: class extends Error {},
}));
vi.mock("./mcp_consent_context", () => ({ getRecentTurnsForConsent: vi.fn() }));
import { reviewShellCommand } from "./shell_review";

describe("review retry configuration", () => {
  it("uses fresh review configuration while preserving the accepted chat model", async () => {
    const chatModel = { provider: "chat", name: "accepted-model" };
    const ctx = {
      appPath: "/app",
      inferenceSettings: {
        enablePersonalMode: true,
        selectedModel: chatModel,
        providerSettings: {},
        personalSafetyReviewModel: { provider: "old", name: "old-reviewer" },
      },
    } as unknown as AgentContext;
    await reviewShellCommand("git status", "inspect app", ctx);
    expect(mocks.review).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          selectedModel: chatModel,
          personalSafetyReviewModel: mocks.settings.personalSafetyReviewModel,
        }),
        timeoutMs: 90_000,
      }),
    );
  });
});

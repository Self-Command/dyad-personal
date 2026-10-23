import { describe, expect, it, vi } from "vitest";
import {
  isBasicAgentMode,
  isDyadProEnabled,
  isPersonalMode,
  type UserSettings,
} from "./schemas";
import { isShellExperimentAvailable } from "@/shared/shell_capability";
import { getAuxiliarySettings } from "./auxiliaryModel";
import { resolveSubscriptionModel } from "@/ipc/services/resolve_subscription_model";
import { usesChatGPTSubscription } from "./subscriptionModels";

const mocks = vi.hoisted(() => ({ providers: vi.fn(), subscription: vi.fn() }));
vi.mock("@/ipc/shared/language_model_helpers", () => ({
  getLanguageModelProviders: mocks.providers,
}));
vi.mock("@/ipc/services/codex_subscription_account", () => ({
  getSubscriptionAccount: mocks.subscription,
}));

const settings = {
  enablePersonalMode: true,
  selectedModel: { provider: "custom-local", name: "my-model" },
  selectedChatMode: "local-agent",
  providerSettings: {},
  enableShellTool: true,
} as UserSettings;

describe("independent personal capabilities", () => {
  it("does not label a self-funded OpenAI model as using a connected subscription", () => {
    const model = { provider: "openai", name: "user-model" };
    const account = { connected: true, models: ["user-model"] };
    expect(
      usesChatGPTSubscription(model, { enablePersonalMode: true }, account),
    ).toBe(false);
    expect(usesChatGPTSubscription(model, {}, account)).toBe(true);
  });
  it("never claims an official subscription or consumes Basic Agent admissions", () => {
    expect(isPersonalMode(settings)).toBe(true);
    expect(isDyadProEnabled(settings)).toBe(false);
    expect(isBasicAgentMode(settings)).toBe(false);
    expect(isBasicAgentMode({ ...settings, enablePersonalMode: false })).toBe(
      true,
    );
  });

  it.each(["custom-local", "ollama", "lmstudio", "openai", "anthropic"])(
    "routes %s directly without consulting official subscription services",
    async (provider) => {
      const model = await resolveSubscriptionModel(
        {
          provider,
          name: "my-model",
          connection: "pro",
          effortLevel: "medium",
        },
        { ...settings, enableDyadPro: true },
      );
      expect(model.connection).toBe("api-key");
      expect(mocks.providers).not.toHaveBeenCalled();
      expect(mocks.subscription).not.toHaveBeenCalled();
    },
  );

  it("rejects official-only model choices with an actionable error", async () => {
    await expect(
      resolveSubscriptionModel(
        { provider: "auto", name: "free-pro", effortLevel: "medium" },
        settings,
      ),
    ).rejects.toThrow("Personal mode uses your API keys");
    await expect(
      resolveSubscriptionModel(
        { provider: "claude-code", name: "default", effortLevel: "medium" },
        settings,
      ),
    ).rejects.toThrow("Personal mode uses your API keys");
  });

  it("keeps auxiliary requests on the user's provider even with saved Pro credentials", () => {
    const auxiliary = getAuxiliarySettings({
      ...settings,
      enableDyadPro: true,
      proModelUsage: "pro",
      providerSettings: { auto: { apiKey: { value: "official-key" } } },
    });
    expect(auxiliary.proModelUsage).toBe("api-key");
    expect(auxiliary.selectedModel).toEqual(settings.selectedModel);
    expect(settings.providerSettings).toEqual({});
  });

  it("preserves host, opt-in, consent, read-only and child shell restrictions", () => {
    const input = { settings, isDyadPro: false };
    expect(isShellExperimentAvailable(input)).toBe(true);
    for (const override of [
      { readOnly: true },
      { planModeOnly: true },
      { isChild: true },
      { settings: { ...settings, runtimeMode2: "docker" as const } },
      { settings: { ...settings, enableShellTool: false } },
      {
        settings: {
          ...settings,
          agentToolConsents: { run_shell: "never" as const },
        },
      },
    ]) {
      expect(isShellExperimentAvailable({ ...input, ...override })).toBe(false);
    }
  });
});

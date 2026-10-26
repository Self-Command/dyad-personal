import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { SafetyReviewModelSettings } from "./SafetyReviewModelSettings";

const mocks = vi.hoisted(() => ({
  update: vi.fn(async () => {}),
  settings: {
    enablePersonalMode: true,
    selectedModel: { provider: "chat-provider", name: "chat-model" },
    personalSafetyReviewModel: { provider: "review-provider", name: "review-model", effortLevel: "low" },
    personalSafetyReviewTimeoutSeconds: 45,
  },
}));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ settings: mocks.settings, updateSettings: mocks.update }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [{ id: "review-provider", name: "My review API" }, { id: "auto", name: "Official Engine" }] }) }));
vi.mock("@/hooks/useLanguageModelsByProviders", () => ({ useLanguageModelsByProviders: () => ({ data: { "review-provider": [{ apiName: "review-model", displayName: "Review model", type: "custom", id: 7 }] } }) }));

beforeEach(() => { mocks.update.mockClear(); mocks.settings.enablePersonalMode = true; });
afterEach(cleanup);

describe("Personal review configuration", () => {
  it("saves an independent model, effort and timeout without changing the chat model", async () => {
    render(<SafetyReviewModelSettings />);
    fireEvent.change(screen.getByLabelText("审查模型 ID"), { target: { value: "another-review-model" } });
    fireEvent.change(screen.getByLabelText("Shell 审查超时（秒）"), { target: { value: "90" } });
    await userEvent.click(screen.getByRole("button", { name: "保存审查配置" }));
    expect(mocks.update).toHaveBeenCalledWith({ personalSafetyReviewModel: { provider: "review-provider", name: "another-review-model", effortLevel: "low" }, personalSafetyReviewTimeoutSeconds: 90 });
    expect(mocks.settings.selectedModel.name).toBe("chat-model");
    expect(await screen.findByRole("status")).toHaveTextContent("已保存");
  });
  it("allows switching back to the current chat model", async () => {
    render(<SafetyReviewModelSettings />);
    await userEvent.click(screen.getByLabelText("审查模型服务"));
    await userEvent.click(await screen.findByRole("option", { name: "跟随当前聊天模型" }));
    await userEvent.click(screen.getByRole("button", { name: "保存审查配置" }));
    expect(mocks.update).toHaveBeenCalledWith({ personalSafetyReviewModel: null, personalSafetyReviewTimeoutSeconds: 45 });
  });
  it("validates model and timeout before persisting and is hidden outside Personal mode", async () => {
    render(<SafetyReviewModelSettings />);
    fireEvent.change(screen.getByLabelText("Shell 审查超时（秒）"), { target: { value: "1" } });
    await userEvent.click(screen.getByRole("button", { name: "保存审查配置" }));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("15–120");
    cleanup();
    mocks.settings.enablePersonalMode = false;
    render(<SafetyReviewModelSettings />);
    expect(screen.queryByRole("button", { name: "保存审查配置" })).toBeNull();
  });
});

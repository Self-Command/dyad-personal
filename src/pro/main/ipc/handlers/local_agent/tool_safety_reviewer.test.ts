// @vitest-environment node
import type { UserSettings } from "@/lib/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  getModelClient: vi.fn(),
  getMaxTokens: vi.fn(async () => 8192),
  getTemperature: vi.fn(async () => 0.2),
}));
vi.mock("@/ipc/utils/token_utils", () => ({ getMaxTokens: mocks.getMaxTokens, getTemperature: mocks.getTemperature }));
vi.mock("@/ipc/utils/model_effort", () => ({
  resolveModelSelection: async ({ model, preferredEffortLevel }: { model: object; preferredEffortLevel?: string }) => ({ ...model, effortLevel: preferredEffortLevel ?? "medium" }),
}));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  streamText: mocks.streamText,
}));
vi.mock("@/ipc/utils/get_model_client", () => ({
  getModelClient: mocks.getModelClient,
}));
import {
  reviewToolAction,
  SHELL_REVIEW_TIMEOUT_MS,
} from "./tool_safety_reviewer";
const input = {
  settings: {} as UserSettings,
  system: "policy",
  fallback: "block" as const,
  prepare: async () => ({ payload: "exact command" }),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getModelClient.mockResolvedValue({ modelClient: { model: {} } });
});
describe("mandatory tool reviewer", () => {
  it("uses an independently configured reviewer and forwards its provider settings", async () => {
    const reviewer = { provider: "review-endpoint", name: "review-model", effortLevel: "low" };
    const settings = { enablePersonalMode: true, selectedModel: { provider: "chat-endpoint", name: "chat-model" }, personalSafetyReviewModel: reviewer } as UserSettings;
    mocks.getModelClient.mockResolvedValue({ modelClient: { model: {}, builtinProviderId: "review-endpoint", reasoningEffortProviderId: "review-endpoint" } });
    mocks.streamText.mockReturnValue({ text: Promise.resolve('{"decision":"allow","reason":"Bounded task"}') });
    expect((await reviewToolAction({ ...input, settings })).decision).toBe("allow");
    expect(mocks.getModelClient).toHaveBeenCalledWith(reviewer, expect.objectContaining({ proModelUsage: "api-key" }));
    expect(mocks.streamText).toHaveBeenCalledWith(expect.objectContaining({
      providerOptions: expect.objectContaining({ "review-endpoint": { reasoningEffort: "low" } }),
      maxOutputTokens: 8192, temperature: 0.2,
    }));
    expect(settings.selectedModel.name).toBe("chat-model");
  });
  it("reviews personal commands with the selected user model and direct API settings", async () => {
    const settings = {
      enablePersonalMode: true,
      selectedModel: { provider: "ollama", name: "local-tool-model" },
      providerSettings: {},
      proModelUsage: "pro",
    } as UserSettings;
    mocks.streamText.mockReturnValue({
      text: Promise.resolve('{"reason":"Bounded task","decision":"allow"}'),
    });
    expect((await reviewToolAction({ ...input, settings })).decision).toBe(
      "allow",
    );
    expect(mocks.getModelClient).toHaveBeenCalledWith(
      settings.selectedModel,
      expect.objectContaining({
        enablePersonalMode: true,
        proModelUsage: "api-key",
      }),
    );
  });
  it.each(["garbage", '{"decision":"allow"}'])(
    "blocks invalid shell verdict %s",
    async (text) => {
      mocks.streamText.mockReturnValue({ text: Promise.resolve(text) });
      expect(await reviewToolAction(input)).toEqual({
        decision: "block",
        unavailable: true,
        reason: "The safety reviewer returned an invalid verdict.",
      });
    },
  );
  it("accepts a structured allow and preserves exact command data", async () => {
    mocks.streamText.mockReturnValue({
      text: Promise.resolve('{"reason":"Bounded task","decision":"allow"}'),
    });
    expect((await reviewToolAction(input)).decision).toBe("allow");
    expect(mocks.getModelClient).toHaveBeenCalledWith(
      { name: "gpt-6-luna", provider: "openai" },
      input.settings,
    );
    expect(mocks.streamText.mock.calls[0][0].messages[0].content).toBe(
      "exact command",
    );
  });
  it("times out model setup as well as generation", async () => {
    vi.useFakeTimers();
    try {
      mocks.getModelClient.mockReturnValue(new Promise(() => {}));
      const pending = reviewToolAction(input);
      await vi.advanceTimersByTimeAsync(8000);
      expect(await pending).toEqual({
        decision: "block",
        unavailable: true,
        reason: "Tool safety review timed out.",
      });
      expect(mocks.streamText).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("cancels evidence collection and never starts inference afterward", async () => {
    let finish!: () => void;
    const controller = new AbortController();
    const pending = reviewToolAction({
      ...input,
      signal: controller.signal,
      prepare: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { payload: "data" };
      },
    });
    controller.abort();
    expect(await pending).toEqual({
      decision: "block",
      unavailable: true,
      reason: "Tool safety review was cancelled.",
    });
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.getModelClient).not.toHaveBeenCalled();
  });
});

it("accepts a structured ask verdict for shell authorization", async () => {
  mocks.streamText.mockReturnValue({
    text: Promise.resolve(
      '{"decision":"ask","reason":"Delete the production service; approval required."}',
    ),
  });
  expect(await reviewToolAction(input)).toEqual({
    decision: "ask",
    reason: "Delete the production service; approval required.",
  });
});

it.each([
  'Here: {"reason":"safe read","decision":"allow"}',
  '```json\n{"reason":"safe read","decision":"allow"}\n```',
])("accepts a wrapped shell verdict: %s", async (text) => {
  mocks.streamText.mockReturnValue({ text: Promise.resolve(text) });
  expect(await reviewToolAction(input)).toEqual({
    decision: "allow",
    reason: "safe read",
  });
});
it("gives shell preparation and multi-step inference time beyond the MCP deadline", async () => {
  vi.useFakeTimers();
  try {
    mocks.streamText.mockImplementation(() => ({
      text: new Promise((resolve) =>
        setTimeout(
          () => resolve('{"decision":"allow","reason":"Inspected migration"}'),
          20000,
        ),
      ),
    }));
    const pending = reviewToolAction({
      ...input,
      timeoutMs: SHELL_REVIEW_TIMEOUT_MS,
      prepare: async () => {
        await new Promise((resolve) => setTimeout(resolve, 9000));
        return { payload: "migration" };
      },
    });
    await vi.advanceTimersByTimeAsync(29000);
    expect(await pending).toEqual({
      decision: "allow",
      reason: "Inspected migration",
    });
  } finally {
    vi.useRealTimers();
  }
});
it("bounds stalled shell setup by its own deadline and never starts inference", async () => {
  vi.useFakeTimers();
  try {
    mocks.getModelClient.mockReturnValue(new Promise(() => {}));
    const pending = reviewToolAction({
      ...input,
      timeoutMs: SHELL_REVIEW_TIMEOUT_MS,
    });
    await vi.advanceTimersByTimeAsync(SHELL_REVIEW_TIMEOUT_MS);
    expect(await pending).toMatchObject({
      unavailable: true,
      reason: "Tool safety review timed out.",
    });
    expect(mocks.streamText).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

import { ShellReviewCatalogTooLargeError } from "./tool_safety_reviewer";
it("surfaces actionable catalog overflow without starting paid inference", async () => {
  const result = await reviewToolAction({
    ...input,
    prepare: async () => {
      throw new ShellReviewCatalogTooLargeError();
    },
  });
  expect(result).toMatchObject({
    decision: "block",
    unavailable: true,
    reason: expect.stringContaining("Disconnect unused MCP servers"),
  });
  expect(mocks.getModelClient).not.toHaveBeenCalled();
  expect(mocks.streamText).not.toHaveBeenCalled();
});

import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { z } from "zod";
it("reserves a verdict step after six inspections across three tool rounds", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  mocks.streamText.mockImplementation(actual.streamText);
  const inspect = vi.fn(async () => "ordinary app file");
  let calls = 0;
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      calls++;
      const inspecting = !!options.tools?.length;
      const chunks: LanguageModelV3StreamPart[] = [
        { type: "stream-start", warnings: [] },
      ];
      if (inspecting) {
        for (let i = 0; i < 2; i++)
          chunks.push({
            type: "tool-call",
            toolCallId: `inspect-${calls}-${i}`,
            toolName: "inspect_app_path",
            input: "{}",
          });
      } else {
        chunks.push(
          { type: "text-start", id: "verdict" },
          {
            type: "text-delta",
            id: "verdict",
            delta: '{"decision":"allow","reason":"Inspected six files"}',
          },
          { type: "text-end", id: "verdict" },
        );
      }
      chunks.push({
        type: "finish",
        finishReason: {
          unified: inspecting ? "tool-calls" : "stop",
          raw: inspecting ? "tool_calls" : "stop",
        },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
      });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
  mocks.getModelClient.mockResolvedValue({ modelClient: { model } });
  const result = await reviewToolAction({
    ...input,
    prepare: async () => ({
      payload: "inspect script",
      tools: {
        inspect_app_path: actual.tool({
          inputSchema: z.object({}),
          execute: inspect,
        }),
      },
    }),
  });
  expect(result).toEqual({ decision: "allow", reason: "Inspected six files" });
  expect(inspect).toHaveBeenCalledTimes(6);
  expect(calls).toBe(4);
});

import { createServer } from "node:http";
import { once } from "node:events";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
it("preserves actual provider HTTP errors from the streaming SDK without exposing its key or response body", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  mocks.streamText.mockImplementation(actual.streamText);
  const requests: unknown[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Bearer SECRET_KEY sensitive-provider-body", type: "invalid_api_key", code: "invalid_api_key" } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local fake API");
  try {
    const provider = createOpenAICompatible({ name: "review-test", baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "SECRET_KEY" });
    mocks.getModelClient.mockResolvedValue({ modelClient: { model: provider("review-model"), builtinProviderId: "review-test", reasoningEffortProviderId: "review-test" } });
    const settings = { enablePersonalMode: true, selectedModel: { provider: "chat", name: "chat-model" }, personalSafetyReviewModel: { provider: "review-test", name: "review-model", effortLevel: "low" } } as UserSettings;
    const result = await reviewToolAction({ ...input, settings });
    expect(result).toMatchObject({ decision: "block", unavailable: true });
    expect(result.reason).toContain("HTTP 401");
    expect(result.reason).not.toMatch(/SECRET_KEY|sensitive-provider-body/);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: "review-model", reasoning_effort: "low", max_tokens: 8192 });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

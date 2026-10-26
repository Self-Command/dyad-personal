import { tool } from "ai";
import { z } from "zod";
import type { UserSettings } from "@/lib/schemas";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { reviewToolAction } from "@/pro/main/ipc/handlers/local_agent/tool_safety_reviewer";
import { buildShellReviewPrompt } from "@/prompts/shell_review_policy";

/** A real model request through the production reviewer; never invokes a shell. */
export async function probePersonalSafetyReview(settings: UserSettings) {
  if (!settings.enablePersonalMode) throw new DyadError("Enable Personal mode before testing its review model.", DyadErrorKind.Precondition);
  const result = await reviewToolAction({
    settings,
    system: buildShellReviewPrompt(),
    fallback: "block",
    timeoutMs: (settings.personalSafetyReviewTimeoutSeconds ?? 45) * 1000,
    prepare: async () => ({
      payload: JSON.stringify({
        command: "echo review-connection-probe",
        description: "Connectivity check only. No command will execute, regardless of the verdict.",
        recentTurns: [{ role: "user", content: "Check whether my review model can produce a safety verdict." }],
        execution: "This is a harmless connectivity probe without a command execution path.",
        tools: [], history: [],
      }),
      tools: {
        inspect_app_path: tool({
          description: "Connectivity probe; returns fixed metadata without reading any file.",
          inputSchema: z.object({ path: z.string(), read: z.boolean().optional() }),
          execute: async () => ({ type: "directory", probe: true }),
        }),
      },
    }),
  });
  return {
    available: !result.unavailable,
    reason: result.unavailable ? result.reason : "审查连接成功，模型返回了有效结论。未执行 Shell 命令。",
  };
}

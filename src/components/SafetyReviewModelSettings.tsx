import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "@/hooks/useSettings";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const FOLLOW_CHAT = "follow-chat";

export function SafetyReviewModelSettings() {
  const { settings, updateSettings } = useSettings();
  const { data: providers = [] } = useQuery({
    queryKey: queryKeys.languageModels.providers,
    queryFn: () => ipc.languageModel.getProviders(),
  });
  const { data: models = {} } = useLanguageModelsByProviders();
  const saved = settings?.personalSafetyReviewModel;
  const [provider, setProvider] = useState(saved?.provider ?? FOLLOW_CHAT);
  const [model, setModel] = useState(saved?.name ?? "");
  const [effort, setEffort] = useState(saved?.effortLevel ?? "medium");
  const [timeout, setTimeout] = useState(
    String(settings?.personalSafetyReviewTimeoutSeconds ?? 45),
  );
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    setProvider(saved?.provider ?? FOLLOW_CHAT);
    setModel(saved?.name ?? "");
    setEffort(saved?.effortLevel ?? "medium");
    setTimeout(String(settings?.personalSafetyReviewTimeoutSeconds ?? 45));
  }, [
    saved?.provider,
    saved?.name,
    saved?.effortLevel,
    settings?.personalSafetyReviewTimeoutSeconds,
  ]);

  if (!settings?.enablePersonalMode) return null;
  const available = providers.filter(
    (entry) => entry.id !== "auto" && entry.id !== "claude-code",
  );
  const suggestions = models[provider] ?? [];
  const save = async () => {
    const seconds = Number(timeout);
    if (!Number.isInteger(seconds) || seconds < 15 || seconds > 120) {
      setNotice("审查超时需为 15–120 秒的整数。");
      return;
    }
    if (provider !== FOLLOW_CHAT && !model.trim()) {
      setNotice("请输入该服务实际支持的模型 ID。");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const match = suggestions.find((entry) => entry.apiName === model.trim());
      await updateSettings({
        personalSafetyReviewModel:
          provider === FOLLOW_CHAT
            ? null
            : {
                provider,
                name: model.trim(),
                effortLevel: effort.trim() || "medium",
                ...(match?.type === "custom" && match.id
                  ? { customModelId: match.id }
                  : {}),
              },
        personalSafetyReviewTimeoutSeconds: seconds,
      });
      setNotice("已保存。可重试当前审查；若该次操作已结束，请重新提交任务。");
    } catch {
      setNotice("保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">Safety review model / 安全审查模型</h3>
      <p className="text-sm text-muted-foreground">
        可独立配置 Shell 和 MCP 的审查模型，不改变聊天模型。复用所选服务在 Model
        Providers 中的 API Key 和地址；请选择支持流式工具调用的模型。Shell
        审查失败不会执行命令。
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="review-provider">审查模型服务</Label>
        <Select
          value={provider}
          onValueChange={(value) => {
            if (value) {
              setProvider(value);
              setModel("");
              setNotice("");
            }
          }}
        >
          <SelectTrigger id="review-provider" aria-label="审查模型服务">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FOLLOW_CHAT}>跟随当前聊天模型</SelectItem>
            {available.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.name}
              </SelectItem>
            ))}
            {saved &&
              !available.some((entry) => entry.id === saved.provider) && (
                <SelectItem value={saved.provider}>
                  {saved.provider}（已保存）
                </SelectItem>
              )}
          </SelectContent>
        </Select>
      </div>
      {provider !== FOLLOW_CHAT && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="review-model">审查模型 ID</Label>
            <Input
              id="review-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              list="review-model-suggestions"
              placeholder="填写服务提供的模型 ID"
            />
            <datalist id="review-model-suggestions">
              {suggestions.map((entry) => (
                <option key={entry.apiName} value={entry.apiName}>
                  {entry.displayName}
                </option>
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="review-effort">推理强度（按模型支持填写）</Label>
            <Input
              id="review-effort"
              value={effort}
              onChange={(event) => setEffort(event.target.value)}
              placeholder="medium"
            />
          </div>
        </>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="review-timeout">Shell 审查超时（秒）</Label>
        <Input
          id="review-timeout"
          type="number"
          min={15}
          max={120}
          value={timeout}
          onChange={(event) => setTimeout(event.target.value)}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        当前配置：
        {saved ? `${saved.provider} / ${saved.name}` : "跟随当前聊天模型"}
        。模型服务可能收取审查费用。
      </p>
      <Button onClick={save} disabled={saving}>
        {saving ? "保存中…" : "保存审查配置"}
      </Button>
      <Button
        variant="outline"
        className="ml-2"
        disabled={testing || saving}
        onClick={async () => {
          setTesting(true);
          setNotice("");
          try {
            const result = await ipc.settings.testPersonalSafetyReview();
            setNotice(result.reason);
          } catch {
            setNotice("无法完成连接检查，请检查已保存的审查配置。");
          } finally {
            setTesting(false);
          }
        }}
      >
        {testing ? "正在测试审查连接…" : "测试已保存的审查连接"}
      </Button>
      <p className="text-xs text-muted-foreground">
        测试会向已保存的审查模型发送一次请求，不执行命令；请先保存配置，模型服务可能收费。
      </p>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </div>
  );
}

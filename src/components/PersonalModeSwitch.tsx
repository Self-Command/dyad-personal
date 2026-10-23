import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";

export function PersonalModeSwitch() {
  const { settings, updateSettings } = useSettings();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch
          id="personal-mode"
          aria-label="Personal mode"
          checked={!!settings?.enablePersonalMode}
          disabled={!settings}
          onCheckedChange={(checked) =>
            updateSettings({ enablePersonalMode: checked })
          }
        />
        <Label htmlFor="personal-mode">
          Personal mode (your API / local models)
        </Label>
      </div>
      <p className="text-sm text-muted-foreground">
        Local Agent, TypeScript code exploration, and optional Shell use your
        configured model provider directly. Add your API key or a custom
        OpenAI-compatible endpoint in Model Providers, then select that model.
        Shell requires a fresh approval for every command. Official Engine tools
        and subscription transports are unavailable while this mode is on. Your
        provider may charge for model requests, including safety reviews.
      </p>
    </div>
  );
}

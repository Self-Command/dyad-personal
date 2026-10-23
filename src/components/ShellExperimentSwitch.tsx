import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { isDyadProEnabled } from "@/lib/schemas";

export function ShellExperimentSwitch() {
  const { settings, updateSettings } = useSettings();
  const canUseShell = !!settings && (settings.enablePersonalMode || isDyadProEnabled(settings));
  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <Switch
          id="enable-shell-tool"
          aria-label="Shell tool"
          checked={!!settings?.enableShellTool}
          disabled={!canUseShell}
          onCheckedChange={(checked) =>
            updateSettings({ enableShellTool: checked })
          }
        />
        <Label htmlFor="enable-shell-tool">Shell tool</Label>
      </div>
      <div className="text-sm text-muted-foreground">
        Allow Agent mode to run Bash on macOS/Linux or PowerShell on Windows for
        app tasks and connected cloud services. Personal mode reviews commands
        using your selected API or local model and asks for approval every time.
        Official mode uses Pro credits. Commands run on your
        machine without filesystem isolation, and an AI safety review can make
        mistakes. Commands classified as safe run automatically unless you set
        run_shell consent to Ask. Consequential commands may require your
        approval; clear safety violations are blocked. Available only with the
        Host runtime.
      </div>
    </div>
  );
}

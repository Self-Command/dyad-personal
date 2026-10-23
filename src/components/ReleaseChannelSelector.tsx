import { SettingField } from "@/components/settings/SettingField";

export function ReleaseChannelSelector() {
  return (
    <SettingField
      htmlFor="personal-release-channel"
      label="Release channel"
      description="This independent distribution uses personal version tags. Official stable and beta update feeds do not apply."
    >
      <span id="personal-release-channel" className="text-sm">
        Personal
      </span>
    </SettingField>
  );
}

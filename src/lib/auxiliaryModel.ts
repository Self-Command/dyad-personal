import { isDyadProEnabled, isPersonalMode, type UserSettings } from "./schemas";

/** Pro helpers retain their engine models even when main-chat inference uses BYO.
 * Return a request-only snapshot; never change the user's billing-source setting.
 */
export function getAuxiliarySettings(settings: UserSettings): UserSettings {
  if (isPersonalMode(settings)) return { ...settings, proModelUsage: "api-key" };
  return settings.proModelUsage === "api-key" && isDyadProEnabled(settings)
    ? { ...settings, proModelUsage: "pro" }
    : settings;
}

import { api } from "@/api/client"
import type { RuntimeSettings, RuntimeSettingValue } from "@/types/api"

export async function getSettings() {
  const { data } = await api.get<RuntimeSettings>("/settings")
  return data
}

export async function updateSettings(values: Record<string, RuntimeSettingValue>) {
  const { data } = await api.patch<RuntimeSettings>("/settings", { values })
  return data
}

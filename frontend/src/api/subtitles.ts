import { api } from "@/api/client"
import type { SubtitlePayload } from "@/types/api"

export async function getSubtitles(jobId: string, version: "cleaned" | "normalized" | "raw") {
  const { data } = await api.get<SubtitlePayload>(`/subtitles/${jobId}`, { params: { version } })
  return data
}

export async function getBestSubtitles(jobId: string) {
  for (const version of ["cleaned", "normalized", "raw"] as const) {
    try {
      return await getSubtitles(jobId, version)
    } catch {
      // Fall through to the next available subtitle representation.
    }
  }
  return null
}

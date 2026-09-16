import { api } from "@/api/client"
import type { Artifact } from "@/types/api"

export async function listArtifacts(jobId?: string, kind?: string) {
  const { data } = await api.get<Artifact[]>("/artifacts", { params: { job_id: jobId, kind } })
  return data
}

export function artifactDownloadUrl(artifactId: string) {
  return `/api/artifacts/${artifactId}/download`
}

export async function loadArtifactText(artifactId: string) {
  const response = await fetch(artifactDownloadUrl(artifactId))
  if (!response.ok) throw new Error(`Could not load text (${response.status})`)
  return (await response.text()).replace(/^\uFEFF/, "")
}

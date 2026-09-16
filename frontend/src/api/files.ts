import { api } from "@/api/client"
import type { AudioFile } from "@/types/api"

export interface FileFilters {
  q?: string
  tag?: string
  status?: string
  batch_id?: string
  include_deleted?: boolean
  limit?: number
}

export async function listFiles(filters: FileFilters = {}) {
  const { data } = await api.get<AudioFile[]>("/files", { params: filters })
  return data
}

export async function getAudioFile(fileId: string) {
  const { data } = await api.get<AudioFile>(`/files/${fileId}`)
  return data
}

export async function updateAudioFile(fileId: string, body: { description?: string | null; tags?: string[] }) {
  const { data } = await api.patch<AudioFile>(`/files/${fileId}`, body)
  return data
}

export async function deleteSourceAudio(fileId: string) {
  const { data } = await api.delete<{ deleted: string }>(`/files/${fileId}`)
  return data
}

export function audioStreamUrl(fileId: string) {
  return `/api/files/${fileId}/stream`
}

export function audioDownloadUrl(fileId: string) {
  return `/api/files/${fileId}/download`
}

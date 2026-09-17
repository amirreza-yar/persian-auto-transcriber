import { api } from "@/api/client"
import type { CleaningConfig, Job, JobHistoryPage, TranscriptionConfig } from "@/types/api"

export interface JobFilters {
  status?: string
  stage?: string
  batch_id?: string
  tag?: string
  q?: string
  limit?: number
}

export interface JobHistoryFilters extends JobFilters {
  created_from?: string
  created_to?: string
  offset?: number
}

export interface UploadOptions {
  batchName?: string
  batchDescription?: string
  description?: string
  tags?: string[]
  priority?: number
  scheduledFor?: string
  transcriptionOverrides?: Partial<TranscriptionConfig>
  cleaningOverrides?: Partial<CleaningConfig>
  onProgress?: (progress: number) => void
}

export async function listJobs(filters: JobFilters = {}) {
  const { data } = await api.get<Job[]>("/jobs", { params: filters })
  return data
}

export async function getJob(jobId: string) {
  const { data } = await api.get<Job>(`/jobs/${jobId}`)
  return data
}

export async function getJobHistory(filters: JobHistoryFilters = {}) {
  const { data } = await api.get<JobHistoryPage>("/jobs/history", { params: filters })
  return data
}

export async function uploadJobs(files: File[], options: UploadOptions = {}) {
  const form = new FormData()
  files.forEach((file) => form.append("files", file))

  if (options.batchName) form.append("batch_name", options.batchName)
  if (options.batchDescription) form.append("batch_description", options.batchDescription)
  if (options.description) form.append("description", options.description)
  if (options.tags?.length) form.append("tags", JSON.stringify(options.tags))
  if (options.priority !== undefined) form.append("priority", String(options.priority))
  if (options.scheduledFor) form.append("scheduled_for", options.scheduledFor)
  if (options.transcriptionOverrides) form.append("transcription_overrides", JSON.stringify(options.transcriptionOverrides))
  if (options.cleaningOverrides) form.append("cleaning_overrides", JSON.stringify(options.cleaningOverrides))

  const { data } = await api.post<Job[]>("/jobs/upload", form, {
    timeout: 0,
    onUploadProgress: (event) => {
      if (!options.onProgress || !event.total) return
      options.onProgress(Math.round((event.loaded / event.total) * 100))
    },
  })
  return data
}

export async function pauseJob(jobId: string) {
  const { data } = await api.post<Job>(`/jobs/${jobId}/pause`)
  return data
}

export async function resumeJob(jobId: string) {
  const { data } = await api.post<Job>(`/jobs/${jobId}/resume`)
  return data
}

export async function cancelJob(jobId: string) {
  const { data } = await api.post<Job>(`/jobs/${jobId}/cancel`)
  return data
}

export async function retryJob(jobId: string) {
  const { data } = await api.post<Job>(`/jobs/${jobId}/retry`)
  return data
}

export async function recleanJob(jobId: string) {
  const { data } = await api.post<Job>(`/jobs/${jobId}/reclean`)
  return data
}

export async function deleteJob(jobId: string) {
  const { data } = await api.delete<{ deleted: string }>(`/jobs/${jobId}`)
  return data
}

export async function reorderJobs(jobIds: string[]) {
  const { data } = await api.post<Job[]>("/jobs/reorder", { job_ids: jobIds })
  return data
}

export async function updateJobSettings(
  jobId: string,
  settings: {
    transcription?: Partial<TranscriptionConfig>
    cleaning?: Partial<CleaningConfig>
  },
) {
  const { data } = await api.patch<Job>(`/jobs/${jobId}/settings`, settings)
  return data
}

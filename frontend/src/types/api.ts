export interface Artifact {
  id: string
  kind: string
  name: string
  mime_type: string
  created_at: string
}

export interface Task {
  id: string
  kind: string
  queue: string
  status: string
  progress: number
  attempts: number
  next_run_at: string
  last_error: string | null
}

export interface TranscriptionConfig {
  model: string
  core_seconds: number
  context_seconds: number
  cpu_threads: number
  beam_size: number
}

export interface CleaningConfig {
  enabled: boolean
  model: string
  chunk_chars: number
  retry_count: number
  retry_base_seconds: number
  request_timeout_seconds: number
  token_cooldown_seconds: number
}

export interface Job {
  id: string
  batch_id: string
  original_name: string
  duration_seconds: number | null
  size_bytes: number
  source_mime_type: string | null
  source_format: string | null
  source_codec: string | null
  sample_rate: number | null
  channels: number | null
  bit_rate: number | null
  source_available: boolean
  description: string | null
  tags: string[]
  status: string
  stage: string
  progress: number
  priority: number
  queue_position: number
  scheduled_for: string
  is_paused: boolean
  cancel_requested: boolean
  error: string | null
  transcription_config: TranscriptionConfig | null
  cleaning_config: CleaningConfig | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
  tasks: Task[]
  artifacts: Artifact[]
}

export interface JobHistoryPage {
  total: number
  offset: number
  limit: number
  items: Job[]
}

export interface Batch {
  id: string
  name: string | null
  description: string | null
  status: string
  progress: number
  total_jobs: number
  completed_jobs: number
  failed_jobs: number
  running_jobs: number
  queued_jobs: number
  created_at: string
  updated_at: string
  jobs: Job[]
}

export interface AudioFile {
  id: string
  job_id: string
  batch_id: string
  name: string
  duration_seconds: number | null
  size_bytes: number
  mime_type: string | null
  format: string | null
  codec: string | null
  sample_rate: number | null
  channels: number | null
  bit_rate: number | null
  source_available: boolean
  description: string | null
  tags: string[]
  job_status: string
  created_at: string
}

export interface ApiToken {
  id: string
  provider: string
  label: string
  masked_token: string
  enabled: boolean
  priority: number
  cooldown_until: string | null
  usage_date: string | null
  prompt_tokens_today: number
  response_tokens_today: number
  total_tokens_today: number
  requests_today: number
  prompt_tokens_total: number
  response_tokens_total: number
  total_tokens_total: number
  requests_total: number
  failures_total: number
  daily_token_limit: number | null
  daily_request_limit: number | null
  remaining_tokens_today: number | null
  remaining_requests_today: number | null
  last_used_at: string | null
  last_error: string | null
}

export interface WorkerState {
  id: string
  queue: string
  status: string
  current_job_id: string | null
  model_name: string | null
  detail: string | null
  started_at: string
  heartbeat_at: string
  updated_at: string
  stale: boolean
}

export interface CircuitBreaker {
  name: string
  state: string
  consecutive_failures: number
  opened_until: string | null
  last_error: string | null
  last_failure_at: string | null
  last_success_at: string | null
  updated_at?: string
}

export interface SystemResources {
  cpu_percent: number
  cpu_count: number | null
  memory_total: number
  memory_used: number
  memory_percent: number
  disk_total: number
  disk_used: number
  disk_free: number
  disk_percent: number
}

export interface SystemStatus {
  system: SystemResources
  workers: WorkerState[]
  circuits: CircuitBreaker[]
  jobs: Record<string, number>
}

export interface ModelStatus {
  status: string
  model_name: string | null
  current_job_id: string | null
  detail?: string | null
  heartbeat_at?: string | null
  stale?: boolean
}

export interface BackendEvent {
  id: number
  job_id: string | null
  batch_id: string | null
  event_type: string
  level: string
  message: string
  data: Record<string, unknown>
  created_at: string
}

export interface SubtitleCue {
  id: string
  start: number
  end: number
  text: string
  paragraph_after?: boolean
}

export interface SubtitlePayload {
  version: "raw" | "normalized" | "cleaned" | string
  source_name: string
  cues: SubtitleCue[]
}

export type RuntimeSettingValue = string | number | boolean | null
export type RuntimeSettings = Record<string, RuntimeSettingValue>

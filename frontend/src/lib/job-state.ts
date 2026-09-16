import type { Job, Task } from "@/types/api"

export type JobTone = "neutral" | "active" | "success" | "warning" | "error"

export interface JobDisplayState {
  label: string
  detail: string | null
  tone: JobTone
  progress: number | null
  activeTask: Task | null
  waiting: boolean
}

function activeTask(job: Job) {
  const preferredKind = job.stage === "clean" ? "clean_text" : "transcribe"
  return (
    [...job.tasks]
      .reverse()
      .find((task) => task.kind === preferredKind && ["claimed", "running", "retry_wait", "queued", "failed"].includes(task.status)) ??
    [...job.tasks].reverse().find((task) => ["claimed", "running", "retry_wait", "queued", "failed"].includes(task.status)) ??
    null
  )
}

function waitingDetail(task: Task | null) {
  const message = task?.last_error?.toLowerCase() ?? ""
  if (message.includes("no gemini token")) return "Cleanup will continue when a cleaner is available."
  if (message.includes("circuit") && message.includes("open")) return "Cleanup is temporarily delayed."
  if (message.includes("proxy")) return "Waiting for the network connection."
  return null
}

export function getJobDisplayState(job: Job): JobDisplayState {
  const task = activeTask(job)

  if (job.status === "completed") {
    return { label: "Completed", detail: null, tone: "success", progress: 1, activeTask: task, waiting: false }
  }

  if (job.status === "failed" || task?.status === "failed") {
    return { label: "Failed", detail: job.error || task?.last_error || "Processing failed.", tone: "error", progress: null, activeTask: task, waiting: false }
  }

  if (job.status === "cancelled") {
    return { label: "Cancelled", detail: null, tone: "neutral", progress: null, activeTask: task, waiting: false }
  }

  if (job.is_paused) {
    return { label: "Paused", detail: "Processing will continue when resumed.", tone: "warning", progress: job.progress, activeTask: task, waiting: true }
  }

  if (job.cancel_requested) {
    return { label: "Cancelling", detail: "Finishing the current safe step.", tone: "warning", progress: job.progress, activeTask: task, waiting: true }
  }

  if (job.status === "retry_wait" || task?.status === "retry_wait") {
    const label = job.stage === "clean" ? "Waiting for cleanup" : "Waiting to retry"
    return { label, detail: waitingDetail(task), tone: "warning", progress: job.progress, activeTask: task, waiting: true }
  }

  if (task?.status === "claimed") {
    return { label: job.stage === "clean" ? "Preparing cleanup" : "Starting transcription", detail: null, tone: "active", progress: job.progress, activeTask: task, waiting: false }
  }

  if (job.status === "running" || task?.status === "running") {
    if (job.stage === "clean") {
      return { label: "Cleaning", detail: null, tone: "active", progress: task?.progress ?? null, activeTask: task, waiting: false }
    }
    return { label: "Transcribing", detail: null, tone: "active", progress: task?.progress ?? job.progress, activeTask: task, waiting: false }
  }

  if (job.status === "queued") {
    if (job.stage === "clean") {
      return { label: "Waiting for cleanup", detail: null, tone: "neutral", progress: job.progress, activeTask: task, waiting: true }
    }
    return { label: "Waiting", detail: null, tone: "neutral", progress: job.progress, activeTask: task, waiting: true }
  }

  return {
    label: job.stage === "clean" ? "Processing cleanup" : "Processing",
    detail: null,
    tone: "neutral",
    progress: job.progress,
    activeTask: task,
    waiting: false,
  }
}

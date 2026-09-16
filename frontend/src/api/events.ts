import type { BackendEvent, SystemStatus } from "@/types/api"

export type EventConnectionState = "connecting" | "open" | "error"

const JOB_EVENT_TYPES = [
  "batch.created",
  "batch.status",
  "batch.updated",
  "circuit.status",
  "file.deleted",
  "file.updated",
  "job.completed",
  "job.created",
  "job.failed",
  "job.progress",
  "job.recovered",
  "job.retry",
  "job.settings",
  "job.stage",
  "job.status",
  "job.updated",
  "queue.updated",
  "worker.status",
] as const

export function connectEvents(
  onEvent: (event: BackendEvent) => void,
  onState?: (state: EventConnectionState) => void,
) {
  onState?.("connecting")
  const source = new EventSource("/api/events/stream")

  source.onopen = () => onState?.("open")
  source.onerror = () => onState?.("error")

  const listeners = JOB_EVENT_TYPES.map((eventType) => {
    const listener = (message: MessageEvent<string>) => {
      try {
        onEvent(JSON.parse(message.data) as BackendEvent)
      } catch {
        // Ignore malformed events; REST remains the source of truth.
      }
    }
    source.addEventListener(eventType, listener as EventListener)
    return [eventType, listener] as const
  })

  return () => {
    listeners.forEach(([eventType, listener]) => source.removeEventListener(eventType, listener as EventListener))
    source.close()
  }
}

export function connectSystemStream(onSnapshot: (snapshot: SystemStatus) => void) {
  const source = new EventSource("/api/system/stream")
  const listener = (message: MessageEvent<string>) => {
    try {
      onSnapshot(JSON.parse(message.data) as SystemStatus)
    } catch {
      // Ignore malformed snapshot and wait for the next one.
    }
  }
  source.addEventListener("system.snapshot", listener as EventListener)
  return () => {
    source.removeEventListener("system.snapshot", listener as EventListener)
    source.close()
  }
}

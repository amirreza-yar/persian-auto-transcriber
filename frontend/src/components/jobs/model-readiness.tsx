import { LoaderCircleIcon } from "lucide-react"
import type { ModelStatus } from "@/types/api"
import { cn } from "@/lib/utils"

function labelFor(status: string) {
  if (status === "ready" || status === "busy") return "Ready"
  if (status === "loading_model") return "Loading transcription model"
  if (status === "starting") return "Starting"
  if (status === "error") return "Transcription unavailable"
  if (status === "offline") return "Server worker offline"
  return "Checking service"
}

export function ModelReadiness({ status }: { status: ModelStatus | null }) {
  const value = status?.status ?? "checking"
  const active = value === "ready" || value === "busy"
  const loading = value === "loading_model" || value === "starting" || value === "checking"

  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      {loading ? (
        <LoaderCircleIcon className="size-3.5 animate-spin" />
      ) : (
        <span className={cn("size-2 rounded-full", active ? "bg-foreground" : "bg-destructive")} />
      )}
      <span>{labelFor(value)}</span>
    </div>
  )
}

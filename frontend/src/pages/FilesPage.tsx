import * as React from "react"
import { FilesIcon, SearchIcon, WifiOffIcon } from "lucide-react"
import { toast } from "sonner"

import { normalizeApiError } from "@/api/client"
import { listFiles } from "@/api/files"
import { useAppData } from "@/app/app-data-provider"
import { useBackendEvents } from "@/app/events-provider"
import { EmptyState } from "@/components/common/empty-state"
import { PageHeader } from "@/components/common/page-header"
import { FileItem } from "@/components/files/file-item"
import { OfflineFileItem } from "@/components/files/offline-file-item"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useOfflineLibrary } from "@/hooks/use-offline-library"
import type { AudioFile } from "@/types/api"

export function FilesPage() {
  const { jobs } = useAppData()
  const { lastEvent } = useBackendEvents()
  const { files: offlineFiles, refresh: refreshOfflineFiles } = useOfflineLibrary()
  const [files, setFiles] = React.useState<AudioFile[]>([])
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [loading, setLoading] = React.useState(true)
  const [serverUnavailable, setServerUnavailable] = React.useState(false)
  const timer = React.useRef<number | null>(null)
  const lastFailure = React.useRef<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      setFiles(await listFiles({ q: query || undefined, status: status === "all" ? undefined : status, limit: 250 }))
      setServerUnavailable(false)
      lastFailure.current = null
    } catch (error) {
      const message = normalizeApiError(error).message
      setServerUnavailable(true)
      if (lastFailure.current !== message) {
        lastFailure.current = message
        toast.info("Server unavailable. Showing saved offline files.")
      }
    } finally {
      setLoading(false)
    }
  }, [query, status])

  React.useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void load(), 250)
    return () => { if (timer.current !== null) window.clearTimeout(timer.current) }
  }, [load])

  React.useEffect(() => {
    if (!lastEvent || serverUnavailable) return
    if (["file.updated", "file.deleted", "job.created", "job.completed", "job.status"].includes(lastEvent.event_type)) void load()
  }, [lastEvent, load, serverUnavailable])

  React.useEffect(() => {
    const onOnline = () => void load()
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [load])

  const jobMap = React.useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs])
  const offlineIds = React.useMemo(() => new Set(offlineFiles.map((file) => file.id)), [offlineFiles])

  const visibleOfflineFiles = React.useMemo(() => {
    if (!serverUnavailable) return []
    const normalized = query.trim().toLocaleLowerCase()
    if (status !== "all" && status !== "completed") return []
    if (!normalized) return offlineFiles
    return offlineFiles.filter((file) => {
      const haystack = [file.name, file.description ?? "", ...file.tags].join(" ").toLocaleLowerCase()
      return haystack.includes(normalized)
    })
  }, [offlineFiles, query, serverUnavailable, status])

  return (
    <div className="space-y-6">
      <PageHeader title="Files" description="Play recordings, read transcripts and find older work." />

      {serverUnavailable ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <WifiOffIcon className="size-4" />
          <span>Server unavailable. Offline files are still available on this device.</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" className="pl-9" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All files</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="running">Processing</SelectItem>
            <SelectItem value="retry_wait">Waiting</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      ) : serverUnavailable ? (
        visibleOfflineFiles.length ? (
          <div className="space-y-3">
            {visibleOfflineFiles.map((file) => <OfflineFileItem key={file.id} file={file} />)}
          </div>
        ) : (
          <EmptyState icon={FilesIcon} title="No offline files" description="Save completed recordings for offline use while the server is available." />
        )
      ) : files.length ? (
        <div className="space-y-3">
          {files.map((file) => (
            <FileItem
              key={file.id}
              file={file}
              job={jobMap.get(file.job_id)}
              offlineSaved={offlineIds.has(file.id)}
              onOfflineChanged={() => void refreshOfflineFiles()}
              onFileUpdated={(updated) => setFiles((current) => current.map((item) => item.id === updated.id ? updated : item))}
              onSourceDeleted={(fileId) => setFiles((current) => current.filter((item) => item.id !== fileId))}
            />
          ))}
        </div>
      ) : (
        <EmptyState icon={FilesIcon} title="No files found" description={query || status !== "all" ? "Try changing the search or filter." : "Uploaded recordings will appear here."} />
      )}
    </div>
  )
}

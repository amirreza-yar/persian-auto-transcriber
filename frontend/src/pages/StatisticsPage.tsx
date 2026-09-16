import * as React from "react"
import { ActivityIcon, Clock3Icon, DatabaseIcon, FileCheck2Icon, HardDriveIcon, MemoryStickIcon, ServerIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"

import { connectSystemStream } from "@/api/events"
import { normalizeApiError } from "@/api/client"
import { getJobHistory } from "@/api/jobs"
import { listBatches } from "@/api/batches"
import { getSystemStatus } from "@/api/system"
import { listTokens } from "@/api/tokens"
import { useBackendEvents } from "@/app/events-provider"
import { PageHeader } from "@/components/common/page-header"
import { StatCard } from "@/components/common/stat-card"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { formatBytes, formatDateTime, formatDuration, formatNumber } from "@/lib/format"
import type { ApiToken, Batch, JobHistoryPage, SystemStatus } from "@/types/api"

export function StatisticsPage() {
  const { lastEvent } = useBackendEvents()
  const [system, setSystem] = React.useState<SystemStatus | null>(null)
  const [history, setHistory] = React.useState<JobHistoryPage | null>(null)
  const [batches, setBatches] = React.useState<Batch[]>([])
  const [tokens, setTokens] = React.useState<ApiToken[]>([])
  const [loading, setLoading] = React.useState(true)

  const loadRecords = React.useCallback(async () => {
    try {
      const [historyData, batchData, tokenData] = await Promise.all([
        getJobHistory({ limit: 500 }),
        listBatches(20),
        listTokens(),
      ])
      setHistory(historyData)
      setBatches(batchData)
      setTokens(tokenData)
    } catch (error) {
      toast.error(normalizeApiError(error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void getSystemStatus().then(setSystem).catch(() => undefined)
    void loadRecords()
    return connectSystemStream(setSystem)
  }, [loadRecords])

  React.useEffect(() => {
    if (!lastEvent) return
    if (["job.completed", "job.failed", "batch.created", "batch.status", "circuit.status"].includes(lastEvent.event_type)) void loadRecords()
  }, [lastEvent, loadRecords])

  const jobs = history?.items ?? []
  const completed = jobs.filter((job) => job.status === "completed").length
  const failed = jobs.filter((job) => job.status === "failed").length
  const audioSeconds = jobs.reduce((sum, job) => sum + (job.duration_seconds ?? 0), 0)
  const totalTokensToday = tokens.reduce((sum, token) => sum + token.total_tokens_today, 0)
  const requestsToday = tokens.reduce((sum, token) => sum + token.requests_today, 0)

  if (loading && !system) {
    return <div className="space-y-6"><PageHeader title="Statistics" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32" />)}</div><Skeleton className="h-72" /></div>
  }

  return (
    <div className="space-y-7">
      <PageHeader title="Statistics" description="History and server health when you need to inspect them." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Jobs" value={formatNumber(history?.total ?? 0)} note={history && history.total > 500 ? "Latest 500 shown below" : undefined} icon={DatabaseIcon} />
        <StatCard label="Completed" value={formatNumber(completed)} note={failed ? `${failed} failed in loaded history` : "No failures in loaded history"} icon={FileCheck2Icon} />
        <StatCard label="Audio processed" value={formatDuration(audioSeconds)} note="Loaded job history" icon={Clock3Icon} />
        <StatCard label="Gemini today" value={formatNumber(totalTokensToday)} note={`${formatNumber(requestsToday)} requests`} icon={SparklesIcon} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Server</CardTitle><CardDescription>Current resource use on the transcription machine.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            {system ? (
              <>
                <ResourceRow icon={ActivityIcon} label="CPU" value={`${Math.round(system.system.cpu_percent)}%`} progress={system.system.cpu_percent} />
                <ResourceRow icon={MemoryStickIcon} label="Memory" value={`${Math.round(system.system.memory_percent)}% · ${formatBytes(system.system.memory_used)} / ${formatBytes(system.system.memory_total)}`} progress={system.system.memory_percent} />
                <ResourceRow icon={HardDriveIcon} label="Disk" value={`${Math.round(system.system.disk_percent)}% · ${formatBytes(system.system.disk_free)} free`} progress={system.system.disk_percent} />
              </>
            ) : <p className="text-muted-foreground text-sm">Server status is unavailable.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Workers</CardTitle><CardDescription>Transcription and network worker state.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {system?.workers.length ? system.workers.map((worker) => (
              <div key={worker.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="bg-muted flex size-9 items-center justify-center rounded-lg"><ServerIcon className="text-muted-foreground size-4" /></div>
                <div className="min-w-0 flex-1"><p className="text-sm font-medium capitalize">{worker.queue.replaceAll("_", " ")}</p><p className="text-muted-foreground truncate text-xs">{worker.model_name || worker.detail || "Worker"}</p></div>
                <Badge variant={worker.status === "error" || worker.status === "offline" ? "destructive" : "outline"} className="capitalize">{worker.status.replaceAll("_", " ")}</Badge>
              </div>
            )) : <p className="text-muted-foreground text-sm">No worker information yet.</p>}

            {system?.circuits.map((circuit) => (
              <div key={circuit.name} className="flex items-center justify-between rounded-lg border p-3">
                <div><p className="text-sm font-medium capitalize">{circuit.name} connection</p><p className="text-muted-foreground text-xs">{circuit.last_error || "No recent provider error"}</p></div>
                <Badge variant={circuit.state === "open" ? "destructive" : "secondary"} className="capitalize">{circuit.state}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent batches</CardTitle><CardDescription>Groups of recordings uploaded together.</CardDescription></CardHeader>
        <CardContent>
          {batches.length ? <div className="divide-y">{batches.slice(0, 10).map((batch) => (
            <div key={batch.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{batch.name || `${batch.total_jobs} recording${batch.total_jobs === 1 ? "" : "s"}`}</p><p className="text-muted-foreground text-xs">{formatDateTime(batch.created_at)} · {batch.completed_jobs}/{batch.total_jobs} completed</p></div>
              <Badge variant="outline" className="capitalize">{batch.status}</Badge>
            </div>
          ))}</div> : <p className="text-muted-foreground text-sm">No batches yet.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

function ResourceRow({ icon: Icon, label, value, progress }: { icon: typeof ActivityIcon; label: string; value: string; progress: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm"><Icon className="text-muted-foreground size-4" /><span className="font-medium">{label}</span><span className="text-muted-foreground ml-auto text-xs tabular-nums">{value}</span></div>
      <Progress value={progress} />
    </div>
  )
}

import { FileAudioIcon } from "lucide-react";
import { JobActions } from "@/components/jobs/job-actions";
import { JobStatus } from "@/components/jobs/job-status";
import { formatDuration, formatRelativeDate } from "@/lib/format";
import type { Job } from "@/types/api";

export function JobCard({ job }: { job: Job }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs transition-colors">
      <div className="flex gap-3">
        <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
          <FileAudioIcon className="text-muted-foreground size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p
                className="truncate text-sm font-medium"
                title={job.original_name}
              >
                {job.original_name}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {formatDuration(job.duration_seconds)} ·{" "}
                {formatRelativeDate(job.created_at)}
              </p>
            </div>
            <JobActions job={job} compact />
          </div>
          <div className="mt-4">
            <JobStatus job={job} />
          </div>
        </div>
      </div>
    </div>
  );
}

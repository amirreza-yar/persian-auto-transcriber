import { CheckCircle2Icon, Clock3Icon } from "lucide-react";
import { useAppData } from "@/app/app-data-provider";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { JobCard } from "@/components/jobs/job-card";
import { ModelReadiness } from "@/components/jobs/model-readiness";
import { UploadZone } from "@/components/jobs/upload-zone";
import { Skeleton } from "@/components/ui/skeleton";

export function HomePage() {
  const { jobs, modelStatus, loading, error } = useAppData();
  const active = jobs
    .filter((job) => !["completed", "cancelled"].includes(job.status))
    .slice(0, 12);
  const completed = jobs
    .filter((job) => job.status === "completed")
    .slice(0, 5);

  return (
    <div className="space-y-8 relative">
      <PageHeader
        title="Transcribe audio"
        description="Add recordings and download the finished text."
        action={<ModelReadiness status={modelStatus} />}
      />

      <section aria-labelledby="upload-title">
        <h2 id="upload-title" className="sr-only">
          Add audio
        </h2>
        <UploadZone />
      </section>

      <section className="space-y-3" aria-labelledby="current-jobs-title">
        <div className="flex items-center justify-between">
          <h2 id="current-jobs-title" className="text-base font-semibold">
            Current jobs
          </h2>
          {active.length ? (
            <span className="text-muted-foreground text-xs">
              {active.length} active
            </span>
          ) : null}
        </div>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : error && !jobs.length ? (
          <EmptyState
            icon={Clock3Icon}
            title="Server is not available"
            description={error}
          />
        ) : active.length ? (
          <div className="space-y-3">
            {active.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Clock3Icon}
            title="Nothing is processing"
            description="New recordings will appear here after you add them."
          />
        )}
      </section>

      <section className="space-y-3" aria-labelledby="completed-title">
        <h2 id="completed-title" className="text-base font-semibold">
          Recently completed
        </h2>
        {completed.length ? (
          <div className="space-y-3">
            {completed.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={CheckCircle2Icon}
            title="No finished recordings yet"
            description="Completed transcriptions will stay easy to reach here."
          />
        )}
      </section>
    </div>
  );
}

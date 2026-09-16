import * as React from "react";
import { listJobs } from "@/api/jobs";
import { getModelStatus } from "@/api/system";
import { normalizeApiError } from "@/api/client";
import { useBackendEvents } from "@/app/events-provider";
import type { Job, ModelStatus } from "@/types/api";

interface AppDataContextValue {
  jobs: Job[];
  modelStatus: ModelStatus | null;
  loading: boolean;
  error: string | null;
  refreshJobs: () => Promise<void>;
  refreshModelStatus: () => Promise<void>;
  setJob: (job: Job) => void;
}

const AppDataContext = React.createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const { lastEvent } = useBackendEvents();
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [modelStatus, setModelStatus] = React.useState<ModelStatus | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const refreshTimer = React.useRef<number | null>(null);

  const refreshJobs = React.useCallback(async () => {
    try {
      const result = await listJobs({ limit: 250 });
      setJobs(result);
      setError(null);
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
    }
  }, []);

  const refreshModelStatus = React.useCallback(async () => {
    try {
      setModelStatus(await getModelStatus());
    } catch {
      setModelStatus({
        status: "offline",
        model_name: null,
        current_job_id: null,
      });
    }
  }, []);

  React.useEffect(() => {
    void Promise.all([refreshJobs(), refreshModelStatus()]).finally(() =>
      setLoading(false),
    );
  }, [refreshJobs, refreshModelStatus]);

  React.useEffect(() => {
    if (!lastEvent) return;
    if (refreshTimer.current !== null)
      window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      void refreshJobs();
      if (lastEvent.event_type === "worker.status") void refreshModelStatus();
    }, 180);
    return () => {
      if (refreshTimer.current !== null)
        window.clearTimeout(refreshTimer.current);
    };
  }, [lastEvent, refreshJobs, refreshModelStatus]);

  const setJob = React.useCallback((updated: Job) => {
    setJobs((current) => {
      const exists = current.some((job) => job.id === updated.id);
      const next = exists
        ? current.map((job) => (job.id === updated.id ? updated : job))
        : [updated, ...current];
      return [...next].sort((a, b) => a.queue_position - b.queue_position);
    });
  }, []);

  return (
    <AppDataContext.Provider
      value={{
        jobs,
        modelStatus,
        loading,
        error,
        refreshJobs,
        refreshModelStatus,
        setJob,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData() {
  const context = React.useContext(AppDataContext);
  if (!context)
    throw new Error("useAppData must be used inside AppDataProvider");
  return context;
}

import * as React from "react";
import { FilesIcon, SearchIcon, WifiOffIcon } from "lucide-react";
import { toast } from "sonner";

import { normalizeApiError } from "@/api/client";
import { listFiles } from "@/api/files";
import { useAppData } from "@/app/app-data-provider";
import { useBackendEvents } from "@/app/events-provider";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { FileItem } from "@/components/files/file-item";
import { OfflineFileItem } from "@/components/files/offline-file-item";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useOfflineLibrary } from "@/hooks/use-offline-library";
import type { AudioFile } from "@/types/api";

const FILES_SCROLL_STORAGE_KEY = "persian-stt:files-scroll-y";

function readSavedFilesScroll() {
  if (typeof window === "undefined") return 0;
  const raw = window.sessionStorage.getItem(FILES_SCROLL_STORAGE_KEY);
  const value = raw ? Number(raw) : 0;
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function saveFilesScroll(value: number) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    FILES_SCROLL_STORAGE_KEY,
    String(Math.max(0, value)),
  );
}

function findScrollContainer(page: HTMLElement): HTMLElement {
  let node = page.parentElement;

  while (node) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    const canScroll =
      overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";

    if (canScroll) return node;
    node = node.parentElement;
  }

  return (
    (document.scrollingElement as HTMLElement | null) ??
    document.documentElement
  );
}

export function FilesPage() {
  const { jobs } = useAppData();
  const { lastEvent } = useBackendEvents();
  const { files: offlineFiles, refresh: refreshOfflineFiles } =
    useOfflineLibrary();
  const [files, setFiles] = React.useState<AudioFile[]>([]);
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [loading, setLoading] = React.useState(true);
  const [serverUnavailable, setServerUnavailable] = React.useState(false);
  const timer = React.useRef<number | null>(null);
  const lastFailure = React.useRef<string | null>(null);

  const pageRef = React.useRef<HTMLDivElement | null>(null);
  const savedScroll = React.useRef(readSavedFilesScroll());
  const lastKnownScroll = React.useRef(savedScroll.current);
  const scrollRestored = React.useRef(savedScroll.current <= 0);
  const leavingFilesPage = React.useRef(false);
  const scrollSaveFrame = React.useRef<number | null>(null);
  const scrollContainer = React.useRef<HTMLElement | null>(null);

  const load = React.useCallback(async () => {
    try {
      setFiles(
        await listFiles({
          q: query || undefined,
          status: status === "all" ? undefined : status,
          limit: 250,
        }),
      );
      setServerUnavailable(false);
      lastFailure.current = null;
    } catch (error) {
      const message = normalizeApiError(error).message;
      setServerUnavailable(true);
      if (lastFailure.current !== message) {
        lastFailure.current = message;
        toast.info("Server unavailable. Showing saved offline files.");
      }
    } finally {
      setLoading(false);
    }
  }, [query, status]);

  React.useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void load(), 250);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [load]);

  React.useEffect(() => {
    if (!lastEvent || serverUnavailable) return;
    if (
      [
        "file.updated",
        "file.deleted",
        "job.created",
        "job.completed",
        "job.status",
      ].includes(lastEvent.event_type)
    )
      void load();
  }, [lastEvent, load, serverUnavailable]);

  React.useEffect(() => {
    const onOnline = () => void load();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load]);

  React.useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const container = findScrollContainer(page);
    scrollContainer.current = container;

    const persistKnownPosition = () => {
      if (!scrollRestored.current || leavingFilesPage.current) return;
      saveFilesScroll(lastKnownScroll.current);
    };

    const beginLeaving = () => {
      if (leavingFilesPage.current) return;

      // Snapshot the actual scroll container before React Router changes the
      // route. Never read scroll position during unmount.
      if (scrollRestored.current) {
        lastKnownScroll.current = Math.max(0, container.scrollTop);
        saveFilesScroll(lastKnownScroll.current);
      }
      leavingFilesPage.current = true;
    };

    const onScroll = () => {
      if (!scrollRestored.current || leavingFilesPage.current) return;

      lastKnownScroll.current = Math.max(0, container.scrollTop);

      if (scrollSaveFrame.current !== null) return;
      scrollSaveFrame.current = window.requestAnimationFrame(() => {
        scrollSaveFrame.current = null;
        persistKnownPosition();
      });
    };

    const onClickCapture = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname.startsWith("/api/")) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return;

      beginLeaving();
    };

    const onPageHide = () => {
      // A real document navigation/reload can safely use the last known value.
      // Do not query the DOM here because scroll may already have been reset.
      if (scrollRestored.current) saveFilesScroll(lastKnownScroll.current);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("click", onClickCapture, true);
    window.addEventListener("popstate", beginLeaving);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("popstate", beginLeaving);
      window.removeEventListener("pagehide", onPageHide);

      if (scrollSaveFrame.current !== null) {
        window.cancelAnimationFrame(scrollSaveFrame.current);
        scrollSaveFrame.current = null;
      }

      // Deliberately do not save here. Route teardown may already have reset
      // the scroll container to zero. The last valid value was saved by the
      // scroll handler or synchronously by beginLeaving().
      scrollContainer.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (loading || scrollRestored.current) return;

    const target = savedScroll.current;
    const container = scrollContainer.current;
    if (!container) return;

    if (target <= 0) {
      scrollRestored.current = true;
      lastKnownScroll.current = 0;
      return;
    }

    let cancelled = false;
    let frame: number | null = null;
    const startedAt = performance.now();

    const restore = () => {
      if (cancelled) return;

      const maxScroll = Math.max(
        0,
        container.scrollHeight - container.clientHeight,
      );
      const pageIsTallEnough = maxScroll + 2 >= target;
      const timedOut = performance.now() - startedAt >= 5000;

      if (!pageIsTallEnough && !timedOut) {
        frame = window.requestAnimationFrame(restore);
        return;
      }

      const restoredY = Math.min(target, maxScroll);
      const previousBehavior = container.style.scrollBehavior;
      container.style.scrollBehavior = "auto";
      container.scrollTop = restoredY;
      container.style.scrollBehavior = previousBehavior;

      lastKnownScroll.current = restoredY;
      scrollRestored.current = true;
      leavingFilesPage.current = false;
      saveFilesScroll(restoredY);
    };

    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(restore);
    });

    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [loading, files.length, offlineFiles.length, serverUnavailable]);

  const jobMap = React.useMemo(
    () => new Map(jobs.map((job) => [job.id, job])),
    [jobs],
  );
  const offlineIds = React.useMemo(
    () => new Set(offlineFiles.map((file) => file.id)),
    [offlineFiles],
  );

  const visibleOfflineFiles = React.useMemo(() => {
    if (!serverUnavailable) return [];
    const normalized = query.trim().toLocaleLowerCase();
    if (status !== "all" && status !== "completed") return [];
    if (!normalized) return offlineFiles;
    return offlineFiles.filter((file) => {
      const haystack = [file.name, file.description ?? "", ...file.tags]
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(normalized);
    });
  }, [offlineFiles, query, serverUnavailable, status]);

  return (
    <div ref={pageRef} className="space-y-6">
      <PageHeader
        title="Files"
        description="Play recordings, read transcripts and find older work."
      />

      {serverUnavailable ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <WifiOffIcon className="size-4" />
          <span>
            Server unavailable. Offline files are still available on this
            device.
          </span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
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
        <div className="space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : serverUnavailable ? (
        visibleOfflineFiles.length ? (
          <div className="space-y-3">
            {visibleOfflineFiles.map((file) => (
              <OfflineFileItem key={file.id} file={file} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FilesIcon}
            title="No offline files"
            description="Save completed recordings for offline use while the server is available."
          />
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
              onFileUpdated={(updated) =>
                setFiles((current) =>
                  current.map((item) =>
                    item.id === updated.id ? updated : item,
                  ),
                )
              }
              onSourceDeleted={(fileId) =>
                setFiles((current) =>
                  current.filter((item) => item.id !== fileId),
                )
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FilesIcon}
          title="No files found"
          description={
            query || status !== "all"
              ? "Try changing the search or filter."
              : "Uploaded recordings will appear here."
          }
        />
      )}
    </div>
  );
}

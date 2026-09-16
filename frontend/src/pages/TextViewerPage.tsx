import * as React from "react";
import {
  ArrowLeftIcon,
  CopyIcon,
  DownloadIcon,
  MinusIcon,
  PlusIcon,
  WifiOffIcon,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { normalizeApiError } from "@/api/client";
import { getJob } from "@/api/jobs";
import { getBestSubtitles } from "@/api/subtitles";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { preferredTextArtifact } from "@/lib/artifacts";
import { getCueEditsForJob, getOfflineBundleByJobId } from "@/lib/offline-db";
import {
  cuesToPlainText,
  downloadTextFile,
  transcriptDownloadName,
} from "@/lib/transcript";
import type { Job } from "@/types/api";

export function TextViewerPage() {
  const { jobId = "" } = useParams();
  const [job, setJob] = React.useState<Job | null>(null);
  const [sourceName, setSourceName] = React.useState("Transcript");
  const [text, setText] = React.useState("");
  const [zoom, setZoom] = React.useState(100);
  const [loading, setLoading] = React.useState(true);
  const [offline, setOffline] = React.useState(false);
  const [edited, setEdited] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const cached = await getOfflineBundleByJobId(jobId).catch(() => null);
      const cachedEdits = await getCueEditsForJob(jobId).catch(
        () => ({}) as Record<string, string>,
      );

      if (cached && !cancelled) {
        const cachedText =
          cached.editedText ||
          (cached.transcript?.cues.length
            ? cuesToPlainText(cached.transcript.cues, cachedEdits)
            : (cached.transcript?.cleanedText ?? ""));
        setSourceName(cached.file.name);
        setText(cachedText);
        setOffline(true);
        setEdited(Object.keys(cachedEdits).length > 0);
      }

      try {
        const serverJob = await getJob(jobId);
        const [subtitle, localEdits] = await Promise.all([
          getBestSubtitles(jobId),
          getCueEditsForJob(jobId),
        ]);

        let body = "";
        if (subtitle?.cues?.length && Object.keys(localEdits).length) {
          body = cuesToPlainText(subtitle.cues, localEdits);
        } else {
          const artifact = preferredTextArtifact(serverJob);
          if (artifact) {
            const response = await fetch(
              `/api/artifacts/${artifact.id}/download`,
            );
            if (!response.ok) throw new Error("Could not load transcript");
            body = (await response.text()).replace(/^\uFEFF/, "");
          } else if (subtitle?.cues?.length) {
            body = cuesToPlainText(subtitle.cues);
          }
        }

        if (cancelled) return;
        setJob(serverJob);
        setSourceName(serverJob.original_name);
        setText(body);
        setOffline(false);
        setEdited(Object.keys(localEdits).length > 0);
      } catch (error) {
        if (!cached && !cancelled)
          toast.error(normalizeApiError(error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const downloadCurrentText = () => {
    if (!text) return;
    downloadTextFile(
      text,
      edited
        ? transcriptDownloadName(sourceName)
        : `${sourceName.replace(/\.[^.]+$/, "") || "transcript"}.txt`,
    );
  };

  return (
    <main className="bg-background text-foreground min-h-svh">
      <div className="mx-auto flex min-h-svh max-w-4xl flex-col px-4 py-4 sm:px-8 sm:py-6 max-h-dvh! relative">
        <header className="z-20 bg-background sticky top-0 -mt-4 pt-4 -mx-3 px-3 flex flex-wrap items-center gap-2 border-b pb-4">
          <Button asChild variant="ghost" size="icon" aria-label="Back">
            <Link to="/files">
              <ArrowLeftIcon />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h1 className="truncate text-base font-semibold">
                {job?.original_name ?? sourceName}
              </h1>
              <div className="flex items-center gap-2">
                {offline ? (
                  <Badge variant="secondary">
                    <WifiOffIcon />
                    Offline
                  </Badge>
                ) : null}
                {edited ? (
                  <Badge variant="outline">Edited locally</Badge>
                ) : null}
              </div>
            </div>
            <p className="text-muted-foreground text-xs">Readable transcript</p>
          </div>
        </header>

        <section className="min-h-0 flex-1 overflow-y-scroll pt-5 pb-10 relative -mb-3 -mx-3 px-3">
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading transcript…</p>
          ) : text ? (
            <article
              dir="rtl"
              lang="fa"
              // className="persian-content mx-auto max-w-[72ch] whitespace-pre-wrap rounded-2xl border bg-card px-5 py-7 text-right leading-[2.15] shadow-xs sm:px-8 sm:py-9 lg:px-12 lg:py-12"
              className="persian-content mx-auto max-w-3xl whitespace-pre-wrap text-right leading-[2.05] pb-10"
              style={{ fontSize: `${zoom}%` }}
            >
              {text}
            </article>
          ) : (
            <div className="flex min-h-64 items-center justify-center text-center">
              <p className="text-muted-foreground text-sm">
                No transcript is available yet.
              </p>
            </div>
          )}
        </section>
        <div className="absolute bottom-0 right-0 left-0 flex items-center justify-between w-full px-6 pb-4">
          <div className="flex items-center gap-1 border rounded-full px-1 bg-background">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setZoom((value) => Math.max(80, value - 10))}
              aria-label="Zoom out"
            >
              <MinusIcon />
            </Button>
            <span className="text-muted-foreground w-11 text-center text-xs tabular-nums">
              {zoom}%
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setZoom((value) => Math.min(160, value + 10))}
              aria-label="Zoom in"
            >
              <PlusIcon />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              className="bg-background!"
              variant="outline"
              size="sm"
              disabled={!text}
              onClick={async () => {
                await navigator.clipboard.writeText(text);
                toast.success("Transcript copied.");
              }}
            >
              <CopyIcon />
              Copy
            </Button>

            <Button size="sm" disabled={!text} onClick={downloadCurrentText}>
              <DownloadIcon />
              Download
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}

{
  /* <main className="bg-background text-foreground min-h-svh">
      <div className="mx-auto flex min-h-svh max-w-4xl flex-col px-4 py-4 sm:px-8 sm:py-6 max-h-dvh! relative">
        <header className="z-20 bg-background sticky top-0 -mt-4 pt-4 -mx-3 px-3 flex flex-wrap items-center gap-2 border-b pb-4">
          <Button asChild variant="ghost" size="icon" aria-label="Back">
            <Link to="/files">
              <ArrowLeftIcon />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">
              {job?.original_name ?? "Transcript"}
            </h1>
            <p className="text-muted-foreground text-xs">Readable transcript</p>
          </div>
        </header>

        <section className="min-h-0 flex-1 overflow-y-scroll pt-5 pb-10 relative -mb-3 -mx-3 px-3">
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading transcript…</p>
          ) : text ? (
            <article
              dir="rtl"
              lang="fa"
              className="persian-content mx-auto max-w-3xl whitespace-pre-wrap text-right leading-[2.05]"
              style={{ fontSize: `${zoom}%` }}
            >
              {text}
            </article>
          ) : (
            <div className="flex min-h-64 items-center justify-center text-center">
              <p className="text-muted-foreground text-sm">
                No transcript is available yet.
              </p>
            </div>
          )}
        </section>
        <div className="absolute bottom-0 right-0 left-0 flex items-center justify-between w-full px-6 pb-4">
          <div className="flex items-center gap-1 border rounded-full px-1 bg-background">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setZoom((value) => Math.max(80, value - 10))}
              aria-label="Zoom out"
            >
              <MinusIcon />
            </Button>
            <span className="text-muted-foreground w-11 text-center text-xs tabular-nums">
              {zoom}%
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setZoom((value) => Math.min(160, value + 10))}
              aria-label="Zoom in"
            >
              <PlusIcon />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              className="bg-background!"
              variant="outline"
              size="sm"
              disabled={!text}
              onClick={async () => {
                await navigator.clipboard.writeText(text);
                toast.success("Transcript copied.");
              }}
            >
              <CopyIcon />
              Copy
            </Button>
            {artifact ? (
              <Button asChild size="sm">
                <a href={`/api/artifacts/${artifact.id}/download`} download>
                  <DownloadIcon />
                  Download
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </main> */
}

import * as React from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  DownloadIcon,
  MinusIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Repeat2Icon,
  RotateCcwIcon,
  RotateCwIcon,
  WifiOffIcon,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { normalizeApiError } from "@/api/client";
import { audioStreamUrl, getAudioFile } from "@/api/files";
import { getJob } from "@/api/jobs";
import { getBestSubtitles } from "@/api/subtitles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  getCueEditsForFile,
  getOfflineBundle,
  saveCueEdit,
  type OfflineBundle,
} from "@/lib/offline-db";
import { saveFileForOffline } from "@/lib/offline-sync";
import { formatDuration } from "@/lib/format";
import {
  cueDisplayText,
  cuesToPlainText,
  downloadTextFile,
  transcriptDownloadName,
} from "@/lib/transcript";
import type { AudioFile, Job, SubtitleCue } from "@/types/api";

function findActiveCueIndex(cues: SubtitleCue[], time: number) {
  if (!cues.length) return -1;

  let low = 0;
  let high = cues.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].start <= time) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return candidate;
}

const TranscriptPane = React.memo(function TranscriptPane({
  cues,
  edits,
  activeIndex,
  onSeek,
  onEdit,
}: {
  cues: SubtitleCue[];
  edits: Record<string, string>;
  activeIndex: number;
  onSeek: (seconds: number) => void;
  onEdit: (cue: SubtitleCue) => void;
}) {
  const activeRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex]);

  // A one-hour recording can contain 4k-5k cues. Rendering all of them every
  // time playback moves is expensive, so keep only a generous window around
  // the current cue in the DOM.
  const center = activeIndex >= 0 ? activeIndex : 0;
  const start = Math.max(0, center - 120);
  const end = Math.min(cues.length, center + 181);
  const visible = cues.slice(start, end);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth p-3">
      {start > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 w-full"
          onClick={() => onSeek(cues[Math.max(0, start - 180)].start)}
        >
          Earlier transcript
        </Button>
      ) : null}

      {visible.map((cue, offset) => {
        const index = start + offset;
        const active = index === activeIndex;
        const edited = edits[cue.id] !== undefined;
        const text = cueDisplayText(cue, edits);

        return (
          <div
            key={cue.id}
            ref={active ? activeRef : undefined}
            className={`group mb-1 flex items-start gap-2 rounded-xl px-2 py-2 transition-colors ${active ? "bg-accent" : "hover:bg-muted/60"}`}
          >
            <button
              type="button"
              onClick={() => onEdit(cue)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="text-muted-foreground mb-1 block text-[11px] tabular-nums">
                {formatDuration(cue.start)}
              </span>
              <span
                dir="rtl"
                lang="fa"
                className={`persian-content block text-right leading-7 ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}
              >
                {text}
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              className={
                active || edited
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              }
              aria-label="Edit subtitle"
              onClick={() => onEdit(cue)}
            >
              <PencilIcon />
            </Button>
          </div>
        );
      })}

      {end < cues.length ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          onClick={() =>
            onSeek(cues[Math.min(cues.length - 1, end + 179)].start)
          }
        >
          Later transcript
        </Button>
      ) : null}
    </div>
  );
});

type CueEditorHandle = {
  commit: () => Promise<void>;
};

const CueEditor = React.forwardRef<
  CueEditorHandle,
  {
    cue: SubtitleCue;
    initialText: string;
    fileId: string;
    jobId: string;
    onCommitted: (cueId: string, text: string, originalText: string) => void;
    onClose: () => void;
  }
>(function CueEditor(
  { cue, initialText, fileId, jobId, onCommitted, onClose },
  ref,
) {
  const [draft, setDraft] = React.useState(initialText);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const draftRef = React.useRef(draft);
  const lastSavedRef = React.useRef(initialText);

  React.useEffect(() => {
    setDraft(initialText);
    draftRef.current = initialText;
    lastSavedRef.current = initialText;
    setSaveState("idle");
  }, [cue.id, initialText]);

  React.useEffect(() => {
    draftRef.current = draft;
    if (draft === lastSavedRef.current) return;

    setSaveState("idle");
    const timer = window.setTimeout(() => {
      const text = draftRef.current;
      setSaveState("saving");
      void saveCueEdit(fileId, jobId, cue.id, text, cue.text)
        .then(() => {
          lastSavedRef.current = text;
          setSaveState("saved");
        })
        .catch(() => setSaveState("idle"));
    }, 650);

    return () => window.clearTimeout(timer);
  }, [cue.id, cue.text, draft, fileId, jobId]);

  const commit = React.useCallback(async () => {
    const text = draftRef.current;

    if (text !== lastSavedRef.current) {
      setSaveState("saving");
      await saveCueEdit(fileId, jobId, cue.id, text, cue.text);
      lastSavedRef.current = text;
    }

    onCommitted(cue.id, text, cue.text);
    setSaveState("saved");
  }, [cue.id, cue.text, fileId, jobId, onCommitted]);

  React.useImperativeHandle(ref, () => ({ commit }), [commit]);

  const commitAndClose = async () => {
    try {
      await commit();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save local edit.",
      );
    }
  };

  const reset = async () => {
    setDraft(cue.text);
    draftRef.current = cue.text;
    try {
      await saveCueEdit(fileId, jobId, cue.id, cue.text, cue.text);
      lastSavedRef.current = cue.text;
      onCommitted(cue.id, cue.text, cue.text);
      setSaveState("saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not reset local edit.",
      );
    }
  };

  return (
    <div className="mt-6 space-y-2 rounded-xl border bg-background/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">
          {saveState === "saving"
            ? "Saving locally…"
            : saveState === "saved"
              ? "Saved locally"
              : "Changes stay on this device"}
        </span>
        <div className="flex gap-1">
          {draft !== cue.text ? (
            <Button size="sm" variant="ghost" onClick={() => void reset()}>
              Reset
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void commitAndClose()}
          >
            Done
          </Button>
        </div>
      </div>
      <Textarea
        dir="rtl"
        lang="fa"
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="persian-content min-h-28 resize-y text-base leading-8"
      />
    </div>
  );
});

export function AudioPlayerPage() {
  const { jobId: fileId = "" } = useParams();
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const cueEditorRef = React.useRef<CueEditorHandle | null>(null);
  const loopFrameRef = React.useRef<number | null>(null);
  const loopDelayRef = React.useRef<number | null>(null);
  const loopPauseRef = React.useRef(false);

  const [file, setFile] = React.useState<AudioFile | null>(null);
  const [job, setJob] = React.useState<Job | null>(null);
  const [offlineBundle, setOfflineBundle] =
    React.useState<OfflineBundle | null>(null);
  const [cues, setCues] = React.useState<SubtitleCue[]>([]);
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [cleanedText, setCleanedText] = React.useState("");
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [rate, setRate] = React.useState(1);
  const [editLoopEnabled, setEditLoopEnabled] = React.useState(false);
  const [editingCueId, setEditingCueId] = React.useState<string | null>(null);
  const [useOfflineAudio, setUseOfflineAudio] = React.useState(false);
  const [offlineSaving, setOfflineSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const cached = await getOfflineBundle(fileId).catch(() => null);
      if (!cancelled && cached) {
        setOfflineBundle(cached);
        setCues(cached.transcript?.cues ?? []);
        setCleanedText(cached.transcript?.cleanedText ?? "");
        setEdits(cached.edits);
        setDuration(cached.file.durationSeconds ?? 0);
        if (!navigator.onLine) setUseOfflineAudio(true);
      }

      try {
        const serverFile = await getAudioFile(fileId);
        const serverJob = await getJob(serverFile.job_id);
        const [subtitle, localEdits] = await Promise.all([
          getBestSubtitles(serverJob.id),
          getCueEditsForFile(serverFile.id),
        ]);

        if (cancelled) return;
        setFile(serverFile);
        setJob(serverJob);
        setCues(subtitle?.cues ?? cached?.transcript?.cues ?? []);
        setCleanedText(cached?.transcript?.cleanedText ?? "");
        setEdits(localEdits);
        setDuration(
          serverFile.duration_seconds ??
            serverJob.duration_seconds ??
            cached?.file.durationSeconds ??
            0,
        );
        setUseOfflineAudio(false);
      } catch (error) {
        if (!cached && !cancelled)
          toast.error(normalizeApiError(error).message);
        if (cached && !cancelled) setUseOfflineAudio(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const offlineAudioUrl = React.useMemo(() => {
    if (!offlineBundle?.file.audioBlob) return null;
    return URL.createObjectURL(offlineBundle.file.audioBlob);
  }, [offlineBundle]);

  React.useEffect(
    () => () => {
      if (offlineAudioUrl) URL.revokeObjectURL(offlineAudioUrl);
    },
    [offlineAudioUrl],
  );

  const playbackActiveIndex = React.useMemo(
    () => findActiveCueIndex(cues, currentTime),
    [cues, currentTime],
  );

  const editingCueIndex = React.useMemo(
    () =>
      editingCueId ? cues.findIndex((cue) => cue.id === editingCueId) : -1,
    [cues, editingCueId],
  );

  // Keep the visible transcript pinned to the cue being edited while edit-loop
  // mode is active. At the exact cue boundary the audio element can report a
  // time that belongs to the next cue for a few milliseconds before the
  // 300 ms replay delay starts. Using playbackActiveIndex directly would make
  // the highlighted/current subtitle briefly jump forward and then back.
  const activeIndex =
    editLoopEnabled && editingCueIndex >= 0
      ? editingCueIndex
      : playbackActiveIndex;

  const activeCue = activeIndex >= 0 ? cues[activeIndex] : null;
  const previousCue = activeIndex > 0 ? cues[activeIndex - 1] : null;
  const nextCue =
    activeIndex >= 0 && activeIndex < cues.length - 1
      ? cues[activeIndex + 1]
      : null;
  const editingCue = React.useMemo(
    () =>
      editingCueId
        ? (cues.find((cue) => cue.id === editingCueId) ?? null)
        : null,
    [cues, editingCueId],
  );

  const sourceName =
    file?.name ??
    offlineBundle?.file.name ??
    job?.original_name ??
    "Audio player";
  const editJobId = job?.id ?? offlineBundle?.file.jobId ?? "";
  const audioSource = useOfflineAudio
    ? (offlineAudioUrl ?? undefined)
    : file?.source_available
      ? audioStreamUrl(file.id)
      : (offlineAudioUrl ?? undefined);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play();
    else audio.pause();
  };

  const seekBy = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(
      0,
      Math.min(audio.duration || duration, audio.currentTime + seconds),
    );
  };

  const seekTo = React.useCallback((seconds: number) => {
    if (audioRef.current) audioRef.current.currentTime = seconds;
  }, []);

  const cancelEditLoopCycle = React.useCallback(() => {
    loopPauseRef.current = false;
    if (loopFrameRef.current !== null) {
      window.cancelAnimationFrame(loopFrameRef.current);
      loopFrameRef.current = null;
    }
    if (loopDelayRef.current !== null) {
      window.clearTimeout(loopDelayRef.current);
      loopDelayRef.current = null;
    }
  }, []);

  const commitEdit = React.useCallback(
    (cueId: string, text: string, originalText: string) => {
      setEdits((current) => {
        const next = { ...current };
        if (text === originalText) delete next[cueId];
        else next[cueId] = text;
        return next;
      });
    },
    [],
  );

  const startEditing = React.useCallback(
    async (cue: SubtitleCue) => {
      // Clicking the cue that is already open should not tear down/restart its
      // current loop or editor state.
      if (editingCueId === cue.id) return;

      const audio = audioRef.current;
      const switchingCue = Boolean(editingCueId && editingCueId !== cue.id);

      // Before replacing the editor with another cue, force-save whatever is
      // currently in the textarea. This avoids losing the last debounced
      // characters when the user moves quickly through the transcript.
      if (switchingCue) {
        try {
          await cueEditorRef.current?.commit();
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not save the current subtitle edit.",
          );
          return;
        }
      }

      cancelEditLoopCycle();
      setEditingCueId(cue.id);

      if (!audio) return;

      if (!editLoopEnabled) {
        // Normal edit mode: select the clicked cue, pause there, and let the
        // editor swap to that cue immediately.
        audio.pause();
        audio.currentTime = cue.start;
        setCurrentTime(cue.start);
        return;
      }

      // In loop mode, clicking a different cue always starts that cue from
      // the beginning. If the user starts editing the cue that is already
      // playing, keep the current playback position and let it reach the end
      // naturally before the first replay.
      const insideCue =
        audio.currentTime >= cue.start && audio.currentTime < cue.end;

      if (switchingCue || !insideCue) {
        audio.currentTime = cue.start;
        setCurrentTime(cue.start);
      }

      void audio.play().catch(() => {
        toast.error("Could not start audio for edit loop.");
      });
    },
    [cancelEditLoopCycle, editLoopEnabled, editingCueId],
  );

  React.useEffect(() => {
    if (!editLoopEnabled || !editingCue) {
      cancelEditLoopCycle();
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    let cancelled = false;

    const playFromStart = () => {
      if (cancelled) return;

      audio.currentTime = editingCue.start;
      setCurrentTime(editingCue.start);

      void audio.play().catch(() => {
        if (!cancelled) toast.error("Could not replay edited subtitle audio.");
      });

      loopFrameRef.current = window.requestAnimationFrame(watchCueEnd);
    };

    const watchCueEnd = () => {
      if (cancelled) return;

      if (audio.currentTime >= editingCue.end) {
        // This pause is part of the loop itself, not a user pause. Keep the
        // transport controls visually in the playing state during the 300 ms
        // gap so the player does not flash between Play/Pause icons.
        loopPauseRef.current = true;
        audio.pause();
        audio.currentTime = editingCue.end;
        setCurrentTime(editingCue.end);

        loopFrameRef.current = null;
        loopDelayRef.current = window.setTimeout(() => {
          loopDelayRef.current = null;
          playFromStart();
        }, 300);
        return;
      }

      loopFrameRef.current = window.requestAnimationFrame(watchCueEnd);
    };

    if (
      audio.currentTime < editingCue.start ||
      audio.currentTime >= editingCue.end
    ) {
      audio.currentTime = editingCue.start;
      setCurrentTime(editingCue.start);
    }

    if (audio.paused) {
      void audio.play().catch(() => {
        if (!cancelled) toast.error("Could not start edit-loop playback.");
      });
    }

    loopFrameRef.current = window.requestAnimationFrame(watchCueEnd);

    return () => {
      cancelled = true;
      cancelEditLoopCycle();
    };
  }, [cancelEditLoopCycle, editLoopEnabled, editingCue]);

  const finishEditing = React.useCallback(() => {
    const audio = audioRef.current;

    // Stop any pending replay first. Do not seek anywhere: finishing an edit
    // should continue from the exact point at which the user pressed Done.
    cancelEditLoopCycle();
    setEditingCueId(null);

    if (!audio) return;

    void audio.play().catch(() => {
      toast.error("Could not resume audio after editing.");
    });
  }, [cancelEditLoopCycle]);

  const toggleEditLoop = React.useCallback(() => {
    setEditLoopEnabled((enabled) => {
      const next = !enabled;

      if (!next) {
        cancelEditLoopCycle();
        if (editingCueId) audioRef.current?.pause();
      }

      return next;
    });
  }, [cancelEditLoopCycle, editingCueId]);

  // const cycleRate = () => {
  //   const rates = [0.5, 0.8, 1, 1.25, 1.5, 2];
  //   const next = rates[(rates.indexOf(rate) + 1) % rates.length];
  //   setRate(next);
  //   if (audioRef.current) audioRef.current.playbackRate = next;
  // };

  const cycleRateInc = () => {
    const rates = [
      0.4, 0.5, 0.6, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3,
    ];
    const next = rates[rates.indexOf(rate) + 1];
    if (next) {
      setRate(next);
      if (audioRef.current) audioRef.current.playbackRate = next;
    }
  };

  const cycleRateDec = () => {
    const rates = [
      0.4, 0.5, 0.6, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3,
    ];
    const prev = rates[rates.indexOf(rate) - 1];
    if (prev) {
      setRate(prev);
      if (audioRef.current) audioRef.current.playbackRate = prev;
    }
  };

  const saveOffline = async () => {
    if (!file || !job) return;
    setOfflineSaving(true);
    try {
      await saveFileForOffline(file, job);
      const cached = await getOfflineBundle(file.id);
      if (!cached?.file.audioBlob.size)
        throw new Error("Offline audio verification failed.");
      setOfflineBundle(cached);
      toast.success("Audio, cleaned text and edited text saved offline.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save offline copy.",
      );
    } finally {
      setOfflineSaving(false);
    }
  };

  const downloadEdited = () => {
    const text = cues.length
      ? cuesToPlainText(cues, edits)
      : offlineBundle?.editedText || cleanedText;
    if (!text) return;
    downloadTextFile(text, transcriptDownloadName(sourceName));
  };

  const handleAudioError = () => {
    if (!useOfflineAudio && offlineAudioUrl) {
      setUseOfflineAudio(true);
      toast.info("Server audio unavailable. Switched to the offline copy.");
      return;
    }
    toast.error("Audio is not available on this device.");
  };

  const activeText = activeCue ? cueDisplayText(activeCue, edits) : "";
  const previousText = previousCue ? cueDisplayText(previousCue, edits) : "";
  const nextText = nextCue ? cueDisplayText(nextCue, edits) : "";

  return (
    <main className="bg-background text-foreground min-h-svh">
      <div className="mx-auto flex max-h-dvh min-h-svh max-w-7xl flex-col px-4 py-4 sm:px-8 sm:py-6">
        <header className="flex flex-wrap items-center gap-3 border-b pb-4">
          <Button asChild variant="ghost" size="icon" aria-label="Back">
            <Link to="/files">
              <ArrowLeftIcon />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">{sourceName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-muted-foreground text-xs">
                Audio & synchronized transcript
              </p>
              {useOfflineAudio ? (
                <Badge variant="secondary">
                  <WifiOffIcon />
                  Offline
                </Badge>
              ) : null}
              {offlineBundle && !useOfflineAudio ? (
                <Badge variant="outline">
                  <CheckIcon />
                  Saved offline
                </Badge>
              ) : null}
            </div>
          </div>
          {file && job?.status === "completed" && !offlineBundle ? (
            <Button
              variant="outline"
              size="sm"
              disabled={offlineSaving}
              onClick={() => void saveOffline()}
            >
              <DownloadIcon />
              {offlineSaving ? "Saving…" : "Save offline"}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={!cues.length && !cleanedText}
            onClick={downloadEdited}
          >
            <DownloadIcon />
            Edited text
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 gap-5 py-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(340px,1.1fr)]">
          <section className="flex min-h-0 flex-col gap-4">
            <div className="relative flex min-h-[42vh] flex-1 flex-col justify-center overflow-hidden rounded-2xl border bg-card px-5 py-8 sm:px-10 lg:min-h-0">
              {loading ? (
                <p className="text-muted-foreground text-center text-sm">
                  Loading audio…
                </p>
              ) : cues.length ? (
                <div className="space-y-5 text-center">
                  <p className="persian-content text-muted-foreground/55 min-h-12 text-center text-base transition-opacity sm:text-lg">
                    {previousText}
                  </p>
                  <button
                    type="button"
                    className="persian-content mx-auto block w-full text-center text-xl font-semibold leading-9 transition-colors hover:text-primary sm:text-2xl"
                    onClick={() => activeCue && startEditing(activeCue)}
                  >
                    {activeText || cueDisplayText(cues[0], edits)}
                  </button>
                  <p className="persian-content text-muted-foreground/55 min-h-12 text-center text-base transition-opacity sm:text-lg">
                    {nextText}
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground text-center text-sm">
                  Subtitles are not available for this recording yet.
                </p>
              )}

              {editingCue && editJobId ? (
                <CueEditor
                  ref={cueEditorRef}
                  key={editingCue.id}
                  cue={editingCue}
                  initialText={cueDisplayText(editingCue, edits)}
                  fileId={fileId}
                  jobId={editJobId}
                  onCommitted={commitEdit}
                  onClose={finishEditing}
                />
              ) : activeCue ? (
                <div className="mt-6 flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEditing(activeCue)}
                  >
                    <PencilIcon />
                    Edit current text
                  </Button>
                </div>
              ) : null}
            </div>

            <audio
              ref={audioRef}
              src={audioSource}
              preload="metadata"
              onLoadedMetadata={(event) =>
                setDuration(
                  event.currentTarget.duration ||
                    file?.duration_seconds ||
                    offlineBundle?.file.durationSeconds ||
                    0,
                )
              }
              onTimeUpdate={(event) =>
                setCurrentTime(event.currentTarget.currentTime)
              }
              onPlay={() => {
                loopPauseRef.current = false;
                setPlaying(true);
              }}
              onPause={() => {
                if (!loopPauseRef.current) setPlaying(false);
              }}
              onEnded={() => setPlaying(false)}
              onError={handleAudioError}
            />

            <div className="space-y-3 rounded-2xl border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Slider
                value={[currentTime]}
                min={0}
                max={Math.max(duration, 1)}
                step={0.1}
                onValueChange={([value]) => seekTo(value)}
                aria-label="Audio position"
              />
              <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
                <span>{formatDuration(currentTime)}</span>
                <span>{formatDuration(duration)}</span>
              </div>

              <div className="relative flex items-center justify-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => seekBy(-5)}
                  aria-label="Back 10 seconds"
                >
                  <RotateCcwIcon />
                </Button>
                <Button
                  size="icon-lg"
                  className="size-14 rounded-full"
                  onClick={() => void toggle()}
                  aria-label={playing ? "Pause" : "Play"}
                >
                  {playing ? (
                    <PauseIcon className="size-6" />
                  ) : (
                    <PlayIcon className="ml-0.5 size-6" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => seekBy(5)}
                  aria-label="Forward 10 seconds"
                >
                  <RotateCwIcon />
                </Button>

                <div className="absolute left-0 flex items-center gap-1 rounded-lg border">
                  <Button variant="ghost" size="icon-sm" onClick={cycleRateDec}>
                    <MinusIcon className="size-3" />
                  </Button>
                  <p className="text-sm w-8 text-center">{rate}×</p>
                  <Button variant="ghost" size="icon-sm" onClick={cycleRateInc}>
                    <PlusIcon className="size-3" />
                  </Button>
                </div>

                <Button
                  className="absolute right-0"
                  variant={editLoopEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={toggleEditLoop}
                  aria-pressed={editLoopEnabled}
                  title="Loop the subtitle audio while editing"
                >
                  <Repeat2Icon />
                  <span className="hidden sm:inline">Edit loop</span>
                </Button>
              </div>
            </div>
          </section>

          <aside className="hidden min-h-0 overflow-hidden rounded-2xl border bg-card lg:flex lg:flex-col">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold">Transcript</h2>
              <p className="text-muted-foreground mt-1 text-xs">
                Click a sentence to seek. Only a nearby cue window is rendered
                for speed on long recordings.
              </p>
            </div>
            <TranscriptPane
              cues={cues}
              edits={edits}
              activeIndex={activeIndex}
              onSeek={seekTo}
              onEdit={startEditing}
            />
          </aside>
        </div>
      </div>
    </main>
  );
}

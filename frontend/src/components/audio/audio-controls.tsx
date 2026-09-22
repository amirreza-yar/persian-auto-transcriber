import { PauseIcon, PlayIcon, RotateCcwIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDuration } from "@/lib/format";

export function AudioControls({
  currentTime,
  duration,
  playing,
  rate,
  onToggle,
  onSeek,
  onSkip,
  onRate,
}: {
  currentTime: number;
  duration: number;
  playing: boolean;
  rate: number;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onSkip: (seconds: number) => void;
  onRate: (rate: number) => void;
}) {
  return (
    <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 border-t px-4 py-4 backdrop-blur">
      <div className="mx-auto max-w-3xl space-y-3">
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span className="text-muted-foreground w-11 text-right">
            {formatDuration(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.05}
            value={Math.min(currentTime, Math.max(duration, 0.01))}
            onChange={(event) => onSeek(Number(event.target.value))}
            className="h-1.5 flex-1 accent-[var(--primary)]"
            aria-label="Audio position"
          />
          <span className="text-muted-foreground w-11">
            {formatDuration(duration)}
          </span>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSkip(-10)}
            aria-label="Back 10 seconds"
          >
            <RotateCcwIcon />
          </Button>
          <Button
            size="icon-lg"
            onClick={onToggle}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <PauseIcon className="size-5 fill-current" />
            ) : (
              <PlayIcon className="size-5 fill-current" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSkip(10)}
            aria-label="Forward 10 seconds"
          >
            <RotateCwIcon />
          </Button>
          <Select
            value={String(rate)}
            onValueChange={(value) => onRate(Number(value))}
          >
            <SelectTrigger size="sm" className="ml-2 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0.75, 1, 1.25, 1.5, 2].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

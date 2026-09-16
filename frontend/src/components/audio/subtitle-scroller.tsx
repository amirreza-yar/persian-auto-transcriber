import * as React from "react"
import { cn } from "@/lib/utils"
import type { SubtitleCue } from "@/types/api"

export function SubtitleScroller({ cues, activeIndex, onSeek }: { cues: SubtitleCue[]; activeIndex: number; onSeek: (seconds: number) => void }) {
  const activeRef = React.useRef<HTMLButtonElement | null>(null)

  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [activeIndex])

  if (!cues.length) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <p className="text-muted-foreground text-sm">Subtitles are not available for this recording yet.</p>
      </div>
    )
  }

  return (
    <div className="relative h-full overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-linear-to-b from-background to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-linear-to-t from-background to-transparent" />
      <div className="h-full overflow-y-auto px-3 py-[35vh] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="persian-content mx-auto max-w-3xl space-y-4" lang="fa" dir="rtl">
          {cues.map((cue, index) => {
            const distance = Math.abs(index - activeIndex)
            const active = index === activeIndex
            return (
              <button
                key={cue.id}
                ref={active ? activeRef : null}
                type="button"
                onClick={() => onSeek(cue.start)}
                className={cn(
                  "block w-full rounded-lg px-3 py-2 text-right leading-[1.9] transition-all duration-300",
                  active ? "text-foreground scale-[1.01] text-xl font-semibold sm:text-2xl" : "text-muted-foreground hover:text-foreground text-base sm:text-lg",
                  distance > 2 && "opacity-35",
                  distance === 2 && "opacity-55",
                  distance === 1 && "opacity-75",
                )}
              >
                {cue.text}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

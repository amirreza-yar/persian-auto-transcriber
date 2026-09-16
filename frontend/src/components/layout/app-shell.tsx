import { AudioLinesIcon } from "lucide-react";
import { Outlet } from "react-router-dom";
import {
  DesktopNavigation,
  MobileNavigation,
} from "@/components/layout/navigation";
import { ThemeToggle } from "@/components/common/theme-toggle";

export function AppShell() {
  return (
    <div className="min-h-svh bg-background">
      <aside className="bg-sidebar fixed inset-y-0 left-0 z-30 hidden w-56 border-r lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <div className="bg-sidebar-primary text-sidebar-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <AudioLinesIcon className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">Persian STT</div>
            <div className="text-muted-foreground text-[11px]">
              Transcribe & clean
            </div>
          </div>
        </div>
        <div className="px-3 py-3">
          <DesktopNavigation />
        </div>
        <div className="mt-auto flex items-center justify-between border-t px-4 py-3">
          <span className="text-muted-foreground text-xs">Local workspace</span>
          <ThemeToggle />
        </div>
      </aside>

      <main className="pb-24 lg:ml-56 lg:pb-0">
        <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <div className="page-enter">
            <Outlet />
          </div>
        </div>
      </main>

      <MobileNavigation />
    </div>
  );
}

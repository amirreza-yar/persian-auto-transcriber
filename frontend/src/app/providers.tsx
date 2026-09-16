import type { ReactNode } from "react";
import { AppDataProvider } from "@/app/app-data-provider";
import { EventsProvider } from "@/app/events-provider";
import { ThemeProvider } from "@/app/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
// import { PWAProvider } from "./pwa-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={350}>
        <EventsProvider>
          <AppDataProvider>
            {/* <PWAProvider> */}
            {children}
            {/* </PWAProvider> */}
          </AppDataProvider>
        </EventsProvider>
        <Toaster position="top-center" richColors />
      </TooltipProvider>
    </ThemeProvider>
  );
}

// src/app/App.tsx

import { usePwaInstall } from "@/hooks/use-pwa-install";
import { Button } from "@/components/ui/button";
import { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function PWAProvider({ children }: { children: ReactNode }) {
  const { installed, canInstall, install } = usePwaInstall();

  return (
    <>
      {!installed && (
        <Dialog defaultOpen>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Install Persian STT</DialogTitle>
              <DialogDescription>
                Install the app to continue.
              </DialogDescription>
            </DialogHeader>
            {canInstall ? (
              <Button size="lg" className="w-full" onClick={install}>
                Install app
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Open this page in Chrome and use “Install app” or “Add to Home
                screen” from the browser menu.
              </p>
            )}
          </DialogContent>
        </Dialog>
      )}
      {children}
    </>
  );
}

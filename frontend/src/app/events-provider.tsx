import * as React from "react";
import { connectEvents, type EventConnectionState } from "@/api/events";
import type { BackendEvent } from "@/types/api";

interface EventsContextValue {
  lastEvent: BackendEvent | null;
  connectionState: EventConnectionState;
}

const EventsContext = React.createContext<EventsContextValue | null>(null);

export function EventsProvider({ children }: { children: React.ReactNode }) {
  const [lastEvent, setLastEvent] = React.useState<BackendEvent | null>(null);
  const [connectionState, setConnectionState] =
    React.useState<EventConnectionState>("connecting");

  React.useEffect(() => connectEvents(setLastEvent, setConnectionState), []);

  return (
    <EventsContext.Provider value={{ lastEvent, connectionState }}>
      {children}
    </EventsContext.Provider>
  );
}

export function useBackendEvents() {
  const context = React.useContext(EventsContext);
  if (!context)
    throw new Error("useBackendEvents must be used inside EventsProvider");
  return context;
}

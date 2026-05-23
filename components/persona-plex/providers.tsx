"use client";

// Client boundary for the ElevenLabs ConversationProvider (it calls
// createContext at module load, so it must live in the client graph).

import { ConversationProvider } from "@elevenlabs/react";
import { AppShell } from "./app-shell";

export function Providers() {
  return (
    <ConversationProvider>
      <AppShell />
    </ConversationProvider>
  );
}

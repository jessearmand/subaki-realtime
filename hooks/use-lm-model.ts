"use client";

// Runtime-selected LM model id for the cascade engine, persisted to localStorage.
// Lets the Providers view override the catalog `default` without editing
// config/lm-models.json. Falls back to the catalog default until hydrated.

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_LM_MODEL } from "@/lib/realtime/lm-config";

const KEY = "tsubaki.lm-model";

export function useLmModel(): [string, (id: string) => void] {
  const [id, setId] = useState<string>(DEFAULT_LM_MODEL.id);

  // Hydrate after mount to avoid SSR mismatch.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setId(saved);
    } catch {
      // ignore malformed / unavailable storage
    }
  }, []);

  const set = useCallback((next: string) => {
    setId(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, []);

  return [id, set];
}

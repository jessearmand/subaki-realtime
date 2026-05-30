"use client";

import { useEffect, useState } from "react";

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

/**
 * Enumerates the system's audio OUTPUT devices (speakers/headphones) exactly as
 * macOS — and the browser — report them, re-reading on hot-plug (`devicechange`).
 *
 * Note on labels: the browser only fills in real device labels once the page has
 * been granted microphone permission for this origin (a privacy guard). Until
 * then `enumerateDevices` returns unlabeled entries, so we fall back to a
 * readable placeholder. Picking the mic in the Audio-In selector grants that
 * permission, after which the real output names appear.
 */
export function useAudioOutputDevices(): AudioOutputDevice[] {
  const [devices, setDevices] = useState<AudioOutputDevice[]>([]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    let cancelled = false;

    const enumerate = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const outputs = list
          .filter((d) => d.kind === "audiooutput")
          .map((d, i) => ({
            deviceId: d.deviceId,
            label:
              d.label?.replace(/\s*\([^)]*\)/g, "").trim() ||
              (d.deviceId === "default" ? "System default" : `Output ${i + 1}`),
          }));
        if (!cancelled) setDevices(outputs);
      } catch {
        if (!cancelled) setDevices([]);
      }
    };

    void enumerate();
    navigator.mediaDevices.addEventListener("devicechange", enumerate);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", enumerate);
    };
  }, []);

  return devices;
}

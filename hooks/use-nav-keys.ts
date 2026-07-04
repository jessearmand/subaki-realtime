// Global section-navigation shortcuts. The sidebar has always *advertised*
// single-letter keys (C / P / V / S in `NAV`) — this hook is what actually
// binds them. Plain keypresses only: anything typed into a form control or
// with a modifier held is left alone.

import { useEffect } from "react";
import { NAV, type NavId } from "@/components/tsubaki/nav";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}

export function useNavKeys(setNav: (id: NavId) => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const item = NAV.find((n) => n.key.toLowerCase() === e.key.toLowerCase());
      if (!item) return;
      e.preventDefault();
      setNav(item.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setNav]);
}

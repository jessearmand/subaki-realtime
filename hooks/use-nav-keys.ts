// Global section-navigation shortcuts. The sidebar has always *advertised*
// single-letter keys (C / P / V / S in `NAV`) — this hook is what actually
// binds them. Plain keypresses only: anything typed into a form control,
// handled by a focused widget, or with a modifier held is left alone.

import { useEffect } from "react";
import { NAV, type NavId } from "@/components/tsubaki/nav";

const LOCAL_KEYBOARD_SCOPE_SELECTOR = [
  "[role='menu']",
  "[role='menubar']",
  "[role='menuitem']",
  "[role='listbox']",
  "[role='option']",
  "[role='combobox']",
  "[role='dialog']",
  "[role='grid']",
  "[role='tree']",
  "[role='tablist']",
  "[data-slot='dropdown-menu-content']",
  "[data-slot='dropdown-menu-item']",
  "[data-slot='dropdown-menu-checkbox-item']",
  "[data-slot='dropdown-menu-radio-item']",
  "[data-slot='dropdown-menu-sub-trigger']",
  "[data-slot='dropdown-menu-sub-content']",
].join(", ");

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}

function isLocalKeyboardScope(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.closest(LOCAL_KEYBOARD_SCOPE_SELECTOR) !== null;
}

export function useNavKeys(setNav: (id: NavId) => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        isTypingTarget(e.target) ||
        isLocalKeyboardScope(e.target)
      ) {
        return;
      }
      const item = NAV.find((n) => n.key.toLowerCase() === e.key.toLowerCase());
      if (!item) return;
      e.preventDefault();
      setNav(item.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setNav]);
}

// Wrench button on the call controls bar. Click to peek the currently-armed
// tools (derived from Settings). Greyed out when nothing's armed.

import { useEffect, useRef } from "react";
import { Btn } from "./primitives";
import { WrenchGlyph } from "./glyphs";
import type { Tool } from "@/lib/data";

export function ToolsButton({
  tools,
  open,
  setOpen,
}: {
  tools: Tool[];
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const active = tools.filter((t) => t.on);
  const total = tools.length;
  const allOff = active.length === 0;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, setOpen]);

  return (
    <div className="pp-tools-wrap" ref={wrapRef}>
      <Btn
        small
        onClick={() => !allOff && setOpen(!open)}
        disabled={allOff}
        active={open}
        aria-label={allOff ? "Tools — none armed" : `Tools — ${active.length} of ${total} armed`}
        aria-expanded={open}
      >
        <WrenchGlyph />
        {!allOff && <span className="pp-btn-badge">{active.length}</span>}
      </Btn>
      {open && !allOff && (
        <div className="pp-tools-pop" role="dialog" aria-label="Active tools">
          <div className="pp-tools-pop-hd">
            <span>ACTIVE TOOLS</span>
            <span className="pp-tools-pop-count">
              {active.length} / {total}
            </span>
          </div>
          <div className="pp-tools-pop-body">
            {active.map((t) => (
              <div key={t.name} className="pp-tools-pop-row">
                <span className="pp-tools-pop-name">{t.name}</span>
                <span className="pp-tools-pop-label">{t.label}</span>
              </div>
            ))}
          </div>
          <div className="pp-tools-pop-foot">
            <span>↳ CONFIGURE IN SETTINGS</span>
          </div>
        </div>
      )}
    </div>
  );
}

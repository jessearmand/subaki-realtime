// Wrench button on the call controls bar. Click to peek the currently-armed
// tools (derived from Settings). Greyed out when nothing's armed.

import { useEffect, useRef } from "react";
import { Btn, PreviewTag } from "./primitives";
import { useT } from "./i18n-context";
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
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const active = tools.filter((tool) => tool.on);
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
    <div className="tb-tools-wrap" ref={wrapRef}>
      <Btn
        small
        onClick={() => !allOff && setOpen(!open)}
        disabled={allOff}
        active={open}
        aria-label={allOff ? t("aria.toolsNone") : t("aria.toolsSome", { n: active.length, total })}
        aria-expanded={open}
      >
        <WrenchGlyph />
        {!allOff && <span className="tb-btn-badge">{active.length}</span>}
      </Btn>
      {open && !allOff && (
        <div className="tb-tools-pop" role="dialog" aria-label={t("aria.activeTools")}>
          <div className="tb-tools-pop-hd">
            <span>
              {t("tools.active")}
              <PreviewTag />
            </span>
            <span className="tb-tools-pop-count">
              {active.length} / {total}
            </span>
          </div>
          <div className="tb-tools-pop-body">
            {active.map((tool) => (
              <div key={tool.name} className="tb-tools-pop-row">
                <span className="tb-tools-pop-name">{tool.name}</span>
                <span className="tb-tools-pop-label">
                  {t(`tool.${tool.name}`, null, tool.label)}
                </span>
              </div>
            ))}
          </div>
          <div className="tb-tools-pop-foot">
            <span>{t("tools.configure")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

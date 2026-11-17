import { useState, type CSSProperties } from "react";
import { SwitchRow } from "./primitives";
import { ACCENTS, type OrbStyle, type Tweaks, type TranscriptMode } from "@/hooks/use-tweaks";
import { useDockDrag, type DockDrag } from "@/hooks/use-dock-drag";
import { JA_SANS, JA_SERIF, type JaFont } from "@/lib/ja-fonts";
import { TWEAKS_DOCKS, type TweaksDock } from "@/lib/tweaks-dock";

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="tb-seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          className={o === value ? "on" : ""}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/** Labelled dropdown — for options too long for a Segmented control. */
function FontSelect<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: JaFont<V>[];
  onChange: (v: V) => void;
}) {
  return (
    <label className="tb-tweaks-field">
      <span>{label}</span>
      <select className="tb-select" value={value} onChange={(e) => onChange(e.target.value as V)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The spots the button can snap to. Always laid out (hidden until a drag
 * starts), because their rects are the snap anchors the drag measures.
 */
function DockTargets({ drag }: { drag: DockDrag }) {
  return (
    <div className={`tb-dock-targets ${drag.hover ? "on" : ""}`} aria-hidden="true">
      {TWEAKS_DOCKS.map((dock) => (
        <span
          key={dock}
          ref={drag.targetRef(dock)}
          className={`tb-dock-target tb-dock-${dock} ${drag.hover === dock ? "hit" : ""}`}
        />
      ))}
    </div>
  );
}

export function TweaksPanel({
  tweaks,
  setTweak,
}: {
  tweaks: Tweaks;
  setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
}) {
  const [open, setOpen] = useState(false);
  const drag = useDockDrag((dock) => setTweak("dock", dock));
  const docked = `tb-dock-${tweaks.dock}`;

  if (!open) {
    return (
      <>
        <DockTargets drag={drag} />
        <button
          type="button"
          className={`tb-tweaks-toggle ${docked} ${drag.hover ? "dragging" : ""}`}
          aria-label="Open tweaks"
          title="Tweaks · drag to move"
          {...drag.handlers}
          onClick={() => {
            if (!drag.consumeDragClick()) setOpen(true);
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="2.4" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13" />
          </svg>
        </button>
      </>
    );
  }

  return (
    <div className={`tb-tweaks ${docked}`}>
      <div className="tb-tweaks-hd">
        <span>Tweaks</span>
        <button
          type="button"
          className="tb-tweaks-x"
          aria-label="Close tweaks"
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>
      <div className="tb-tweaks-body">
        <div className="tb-tweaks-sect">Theme</div>
        <div className="tb-tweaks-row">
          <span>Dark mode</span>
          <SwitchRow value={tweaks.dark} onChange={(v) => setTweak("dark", v)} />
        </div>
        <div className="tb-tweaks-row">
          <span>Accent</span>
          <div className="tb-swatches">
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                className={`tb-swatch ${tweaks.accent.toLowerCase() === c.toLowerCase() ? "on" : ""}`}
                style={{ background: c } as CSSProperties}
                onClick={() => setTweak("accent", c)}
              />
            ))}
          </div>
        </div>

        {/* CJK fallbacks only — Latin stays Plex Mono / Newsreader. Visible once a
            session is in 日本語. */}
        <div className="tb-tweaks-sect">Japanese type</div>
        <FontSelect
          label="Sans (UI)"
          value={tweaks.jaSans}
          options={JA_SANS}
          onChange={(v) => setTweak("jaSans", v)}
        />
        <FontSelect
          label="Serif (display · captions)"
          value={tweaks.jaSerif}
          options={JA_SERIF}
          onChange={(v) => setTweak("jaSerif", v)}
        />

        <div className="tb-tweaks-sect">Orb</div>
        <Segmented<OrbStyle>
          value={tweaks.orbStyle}
          options={["gradient", "mono", "particles"]}
          onChange={(v) => setTweak("orbStyle", v)}
        />

        <div className="tb-tweaks-sect">Transcript</div>
        <Segmented<TranscriptMode>
          value={tweaks.transcript}
          options={["caption", "drawer", "off"]}
          onChange={(v) => setTweak("transcript", v)}
        />

        <div className="tb-tweaks-sect">Provider</div>
        <div className="tb-tweaks-row">
          <span>Show provider chip</span>
          <SwitchRow
            value={tweaks.providerPreview}
            onChange={(v) => setTweak("providerPreview", v)}
          />
        </div>

        {/* The keyboard path to what dragging the closed button does. */}
        <div className="tb-tweaks-sect">Button position</div>
        <Segmented<TweaksDock>
          value={tweaks.dock}
          options={TWEAKS_DOCKS}
          onChange={(v) => setTweak("dock", v)}
        />
      </div>
    </div>
  );
}

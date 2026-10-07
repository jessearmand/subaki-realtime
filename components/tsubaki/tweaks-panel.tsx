import { useState, type CSSProperties } from "react";
import { SwitchRow } from "./primitives";
import { ACCENTS, type OrbStyle, type Tweaks, type TranscriptMode } from "@/hooks/use-tweaks";
import { JA_SANS, JA_SERIF, type JaFont } from "@/lib/ja-fonts";

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

export function TweaksPanel({
  tweaks,
  setTweak,
}: {
  tweaks: Tweaks;
  setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="tb-tweaks-toggle"
        aria-label="Open tweaks"
        onClick={() => setOpen(true)}
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
    );
  }

  return (
    <div className="tb-tweaks">
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
      </div>
    </div>
  );
}

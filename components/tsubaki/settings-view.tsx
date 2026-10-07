import { useEffect, useState, type CSSProperties } from "react";
import { Hr, FieldRow, PreviewTag, SwitchRow, ToolRow } from "./primitives";
import { useT } from "./i18n-context";
import { MicSelector } from "@/components/ui/mic-selector";
import { useAudioOutputDevices } from "@/hooks/use-audio-output-devices";
import { LangSwitch } from "./lang-switch";
import type { Tool } from "@/lib/data";
import type { Lang } from "@/lib/lang";

export function SettingsView({
  accent,
  lang,
  setLang,
  tools,
  setTools,
  muted,
  onMutedChange,
  bargeIn,
  onBargeInChange,
  pushToTalk,
  onPushToTalkChange,
}: {
  accent: string;
  /** Session language — interface and voice. */
  lang: Lang;
  setLang: (lang: Lang) => void;
  tools: Tool[];
  setTools: (updater: (prev: Tool[]) => Tool[]) => void;
  muted: boolean;
  onMutedChange: (m: boolean) => void;
  /** Voice barge-in — user speech interrupts the agent (OpenAI engine). */
  bargeIn: boolean;
  onBargeInChange: (v: boolean) => void;
  /** Push-to-talk — only the Send button ends a turn (cascade engine). */
  pushToTalk: boolean;
  onPushToTalkChange: (v: boolean) => void;
}) {
  const t = useT();
  const [device, setDevice] = useState("");
  const outputs = useAudioOutputDevices();
  const [out, setOut] = useState("");
  const [latency, setLatency] = useState(220);
  const [vad, setVad] = useState(0.65);
  const [denoise, setDenoise] = useState(true);

  // Default the output selection to the first real device once enumerated.
  useEffect(() => {
    if (!out && outputs.length > 0) setOut(outputs[0].deviceId);
  }, [out, outputs]);

  const accentColor = { accentColor: accent } as CSSProperties;
  const toggleTool = (name: string) =>
    setTools((prev) => prev.map((x) => (x.name === name ? { ...x, on: !x.on } : x)));

  return (
    <div className="tb-settings">
      <div className="tb-page-hd">
        <div>
          <div className="tb-h-eyebrow">{t("settings.eyebrow")}</div>
          <h1 className="tb-h1">{t("settings.title")}</h1>
          <p className="tb-lede">{t("settings.lede")}</p>
        </div>
      </div>

      <div className="tb-settings-grid">
        {/* GENERAL spans the full width so the 2×2 grid below keeps its order:
            AUDIO IN | AUDIO OUT, BEHAVIOUR | TOOLS. */}
        <section className="tb-settings-sec tb-settings-sec-wide">
          <Hr label={t("sec.general")} />
          <FieldRow label={t("field.language")} hint={t("field.language.hint")}>
            <LangSwitch lang={lang} onChange={setLang} />
          </FieldRow>
        </section>

        <section className="tb-settings-sec">
          <Hr label={t("sec.audioIn")} />
          <FieldRow label={t("field.inputDevice")}>
            <MicSelector
              value={device}
              onValueChange={setDevice}
              muted={muted}
              onMutedChange={onMutedChange}
              className="w-full sm:w-full"
            />
          </FieldRow>
          <FieldRow label={t("field.level")}>
            <div className="tb-meter">
              <span style={{ width: "58%", background: accent }} />
            </div>
          </FieldRow>
          <FieldRow label={t("field.denoise")}>
            <SwitchRow value={denoise} onChange={setDenoise} />
          </FieldRow>
          <FieldRow label={t("field.vad")} hint={t("field.vad.hint", { v: vad.toFixed(2) })}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={vad}
              onChange={(e) => setVad(parseFloat(e.target.value))}
              className="tb-range"
              style={accentColor}
            />
          </FieldRow>
        </section>

        <section className="tb-settings-sec">
          <Hr label={t("sec.audioOut")} />
          <FieldRow label={t("field.outputDevice")}>
            <select className="tb-select" value={out} onChange={(e) => setOut(e.target.value)}>
              {outputs.length === 0 ? (
                <option value="">System default</option>
              ) : (
                outputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))
              )}
            </select>
          </FieldRow>
          <FieldRow label={t("field.volume")}>
            <input type="range" defaultValue="70" className="tb-range" style={accentColor} />
          </FieldRow>
          <FieldRow label={t("field.spatial")}>
            <SwitchRow value={false} onChange={() => {}} />
          </FieldRow>
        </section>

        <section className="tb-settings-sec">
          <Hr label={t("sec.behaviour")} />
          <FieldRow label={t("field.latency")} hint={t("field.latency.hint", { ms: latency })}>
            <input
              type="range"
              min="80"
              max="600"
              step="10"
              value={latency}
              onChange={(e) => setLatency(parseInt(e.target.value))}
              className="tb-range"
              style={accentColor}
            />
            <div className="tb-range-scale">
              <span>80</span>
              <span>240</span>
              <span>400</span>
              <span>600</span>
            </div>
          </FieldRow>
          <FieldRow label={t("field.interruptions")} hint={t("field.interruptions.hint")}>
            <SwitchRow value={bargeIn} onChange={onBargeInChange} />
          </FieldRow>
          <FieldRow label={t("field.ptt")} hint={t("field.ptt.hint")}>
            <SwitchRow value={pushToTalk} onChange={onPushToTalkChange} />
          </FieldRow>
        </section>

        <section className="tb-settings-sec">
          <Hr
            label={
              <>
                {t("sec.tools")}
                <PreviewTag />
              </>
            }
          />
          {tools.map((tool) => (
            <ToolRow
              key={tool.name}
              name={tool.name}
              label={tool.label}
              on={tool.on}
              onToggle={() => toggleTool(tool.name)}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

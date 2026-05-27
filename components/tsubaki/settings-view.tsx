import { useState, type CSSProperties } from "react";
import { Hr, FieldRow, SwitchRow, ToolRow } from "./primitives";
import { MicSelector } from "@/components/ui/mic-selector";
import type { Tool } from "@/lib/data";

export function SettingsView({
  accent,
  tools,
  setTools,
  muted,
  onMutedChange,
}: {
  accent: string;
  tools: Tool[];
  setTools: (updater: (prev: Tool[]) => Tool[]) => void;
  muted: boolean;
  onMutedChange: (m: boolean) => void;
}) {
  const [device, setDevice] = useState("");
  const [out, setOut] = useState("AirPods Pro · Erik");
  const [latency, setLatency] = useState(220);
  const [vad, setVad] = useState(0.65);
  const [denoise, setDenoise] = useState(true);
  const [interruptions, setInterruptions] = useState(true);
  const [pushToTalk, setPushToTalk] = useState(false);

  const accentColor = { accentColor: accent } as CSSProperties;
  const toggleTool = (name: string) =>
    setTools((prev) => prev.map((t) => (t.name === name ? { ...t, on: !t.on } : t)));

  return (
    <div className="tb-settings">
      <div className="tb-page-hd">
        <div>
          <div className="tb-h-eyebrow">003 / CONFIGURATION</div>
          <h1 className="tb-h1">Settings.</h1>
          <p className="tb-lede">Local audio chain, model behaviour, tools and safety.</p>
        </div>
      </div>

      <div className="tb-settings-grid">
        <section className="tb-settings-sec">
          <Hr label="AUDIO IN" />
          <FieldRow label="INPUT DEVICE">
            <MicSelector
              value={device}
              onValueChange={setDevice}
              muted={muted}
              onMutedChange={onMutedChange}
              className="w-full"
            />
          </FieldRow>
          <FieldRow label="LEVEL">
            <div className="tb-meter">
              <span style={{ width: "58%", background: accent }} />
            </div>
          </FieldRow>
          <FieldRow label="DENOISE">
            <SwitchRow value={denoise} onChange={setDenoise} />
          </FieldRow>
          <FieldRow label="VAD SENSITIVITY" hint={`${vad.toFixed(2)} · medium`}>
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
          <Hr label="AUDIO OUT" />
          <FieldRow label="OUTPUT DEVICE">
            <select className="tb-select" value={out} onChange={(e) => setOut(e.target.value)}>
              <option>AirPods Pro · Erik</option>
              <option>MacBook Pro Speakers</option>
              <option>Studio Monitors L/R</option>
            </select>
          </FieldRow>
          <FieldRow label="VOLUME">
            <input type="range" defaultValue="70" className="tb-range" style={accentColor} />
          </FieldRow>
          <FieldRow label="SPATIAL">
            <SwitchRow value={false} onChange={() => {}} />
          </FieldRow>
        </section>

        <section className="tb-settings-sec">
          <Hr label="BEHAVIOUR" />
          <FieldRow label="LATENCY BUDGET" hint={`${latency} ms · balanced`}>
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
          <FieldRow label="INTERRUPTIONS">
            <SwitchRow value={interruptions} onChange={setInterruptions} />
          </FieldRow>
          <FieldRow label="PUSH-TO-TALK">
            <SwitchRow value={pushToTalk} onChange={setPushToTalk} />
          </FieldRow>
        </section>

        <section className="tb-settings-sec">
          <Hr label="TOOLS" />
          {tools.map((t) => (
            <ToolRow
              key={t.name}
              name={t.name}
              label={t.label}
              on={t.on}
              onToggle={() => toggleTool(t.name)}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

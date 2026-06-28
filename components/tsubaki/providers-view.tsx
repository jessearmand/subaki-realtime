import { Tag, Hr, Spec } from "./primitives";
import { PROVIDERS, type Provider } from "@/lib/data";
import type { CSSProperties } from "react";

export function ProvidersView({
  provider,
  setProvider,
  accent,
}: {
  provider: Provider;
  setProvider: (p: Provider) => void;
  accent: string;
}) {
  // Surface the headline transport changes in the active-provider detail:
  // the cascade engine (STT→LM→TTS) and neural Silero VAD turn detection.
  const isCascade = provider.engine === "cascade";

  return (
    <div className="tb-providers">
      <div className="tb-page-hd">
        <div>
          <div className="tb-h-eyebrow">002 / TRANSPORT</div>
          <h1 className="tb-h1">Realtime providers.</h1>
          <p className="tb-lede">
            All six backends accept the same audio stream. Switch mid-call without dropping the
            session.
          </p>
        </div>
        <div className="tb-page-hd-r">
          <Tag mono dot>
            AUTO-FAILOVER ON
          </Tag>
        </div>
      </div>

      <table className="tb-table">
        <thead>
          <tr>
            <th style={{ width: 32 }} />
            <th>VENDOR</th>
            <th>MODEL</th>
            <th>EXECUTION</th>
            <th>NOTES</th>
          </tr>
        </thead>
        <tbody>
          {PROVIDERS.map((p) => {
            const on = provider.id === p.id;
            const radioStyle: CSSProperties | undefined = on
              ? { background: accent, borderColor: accent }
              : undefined;
            return (
              <tr key={p.id} className={on ? "on" : ""} onClick={() => setProvider(p)}>
                <td className="tb-table-radio">
                  <span className={on ? "on" : ""} style={radioStyle} />
                </td>
                <td className="tb-table-vendor">{p.name}</td>
                <td className="tb-mono-num">{p.model}</td>
                <td>
                  <Tag mono dot>
                    {p.exec.toUpperCase()}
                  </Tag>
                </td>
                <td className="tb-table-note">{p.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="tb-prov-detail">
        <Hr label={`ACTIVE · ${provider.name}`} />
        <div className="tb-prov-specs">
          <Spec
            label="ENGINE"
            value={provider.engine ? provider.engine.toUpperCase() : "MOCK"}
            sub={
              isCascade ? "STT → LM → TTS" : provider.engine ? "native realtime" : "design preview"
            }
          />
          <Spec label="CODEC" value="opus 48k mono" sub="server-side resample" />
          <Spec
            label="TURN DETECTION"
            value={isCascade ? "Silero VAD" : "server VAD"}
            sub={isCascade ? "neural · browser · send-turn" : "200 ms silence → end-of-turn"}
          />
          <Spec label="TOOL FORMAT" value="OpenAI-style fn-calls" sub="translated per provider" />
        </div>
      </div>
    </div>
  );
}

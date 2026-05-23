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
  return (
    <div className="pp-providers">
      <div className="pp-page-hd">
        <div>
          <div className="pp-h-eyebrow">002 / TRANSPORT</div>
          <h1 className="pp-h1">Realtime providers.</h1>
          <p className="pp-lede">
            All six backends accept the same audio stream. Switch mid-call without dropping the
            session.
          </p>
        </div>
        <div className="pp-page-hd-r">
          <Tag mono dot>
            AUTO-FAILOVER ON
          </Tag>
        </div>
      </div>

      <table className="pp-table">
        <thead>
          <tr>
            <th style={{ width: 32 }} />
            <th>VENDOR</th>
            <th>MODEL</th>
            <th>REGION</th>
            <th style={{ textAlign: "right" }}>P50 LAT</th>
            <th>STATUS</th>
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
                <td className="pp-table-radio">
                  <span className={on ? "on" : ""} style={radioStyle} />
                </td>
                <td className="pp-table-vendor">{p.name}</td>
                <td className="pp-mono-num">{p.model}</td>
                <td>{p.region}</td>
                <td className="pp-mono-num" style={{ textAlign: "right" }}>
                  {p.latency} ms
                </td>
                <td>
                  <Tag mono dot>
                    {p.status.toUpperCase()}
                  </Tag>
                </td>
                <td className="pp-table-note">{p.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="pp-prov-detail">
        <Hr label={`ACTIVE · ${provider.name}`} />
        <div className="pp-prov-specs">
          <Spec
            label="ENDPOINT"
            value={`wss://rt.${provider.id}.persona-plex.dev`}
            sub="auto-resolved"
          />
          <Spec label="CODEC" value="opus 48k mono" sub="server-side resample" />
          <Spec label="VAD" value="server" sub="200 ms silence → end-of-turn" />
          <Spec label="TOOL FORMAT" value="OpenAI-style fn-calls" sub="translated per provider" />
        </div>
      </div>
    </div>
  );
}

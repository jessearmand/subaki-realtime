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
                <td className="tb-table-radio">
                  <span className={on ? "on" : ""} style={radioStyle} />
                </td>
                <td className="tb-table-vendor">{p.name}</td>
                <td className="tb-mono-num">{p.model}</td>
                <td>{p.region}</td>
                <td className="tb-mono-num" style={{ textAlign: "right" }}>
                  {p.latency} ms
                </td>
                <td>
                  <Tag mono dot>
                    {p.status.toUpperCase()}
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
            label="ENDPOINT"
            value={`wss://rt.${provider.id}.tsubaki.dev`}
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

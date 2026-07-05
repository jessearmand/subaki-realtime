import { Fragment } from "react";
import { Tag, Hr, Spec } from "./primitives";
import { PROVIDERS, type Provider } from "@/lib/data";
import { lmModelsForEngine, providerModelLabel, resolveLmModel } from "@/lib/realtime/lm-config";
import {
  DEFAULT_STT_BACKEND_ID,
  DEFAULT_TTS_BACKEND_ID,
  providerExecLabel,
} from "@/lib/realtime/voice-config";
import type { CSSProperties } from "react";

export function ProvidersView({
  provider,
  setProvider,
  accent,
  lmModelId,
  setLmModelId,
}: {
  provider: Provider;
  setProvider: (p: Provider) => void;
  accent: string;
  lmModelId: string;
  setLmModelId: (id: string) => void;
}) {
  // Surface the headline transport changes in the active-provider detail:
  // the cascade engine (STT→LM→TTS) and neural Silero VAD turn detection.
  const isCascade = provider.engine === "cascade";
  // The cascade's EXECUTION cell reflects the resolved backends, so it follows
  // the LM picker live (TTS/STT come from config/voice-models.json + env).
  const lmBackend = resolveLmModel(lmModelId).backend;

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
            // Only engines with a multi-model catalog (cascade) get a picker inset;
            // single-model / unconfigurable providers render no inset.
            const models = lmModelsForEngine(p.engine);
            return (
              <Fragment key={p.id}>
                <tr className={on ? "on" : ""} onClick={() => setProvider(p)}>
                  <td className="tb-table-radio">
                    <span className={on ? "on" : ""} style={radioStyle} />
                  </td>
                  <td className="tb-table-vendor">{p.name}</td>
                  <td className="tb-mono-num">{providerModelLabel(p, lmModelId)}</td>
                  <td>
                    <Tag mono dot>
                      {providerExecLabel(p, lmBackend).toUpperCase()}
                    </Tag>
                  </td>
                  <td className="tb-table-note">{p.note}</td>
                </tr>
                {models.length > 1 && (
                  <tr className={`tb-prov-inset-row ${on ? "on" : ""}`}>
                    <td />
                    <td colSpan={4} className="tb-prov-inset">
                      <div className="tb-prov-inset-inner">
                        <span className="tb-prov-inset-l">LM MODEL</span>
                        <span className="tb-prov-models">
                          {models.map((m) => {
                            const sel = m.id === lmModelId;
                            return (
                              <button
                                key={m.id}
                                type="button"
                                className={`tb-prov-model ${sel ? "on" : ""}`}
                                style={sel ? { borderColor: accent, color: accent } : undefined}
                                aria-pressed={sel}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLmModelId(m.id);
                                }}
                              >
                                {m.label}
                              </button>
                            );
                          })}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
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
          {isCascade ? (
            <Spec
              label="VOICE LEGS"
              value={`TTS ${DEFAULT_TTS_BACKEND_ID.toUpperCase()} · STT ${DEFAULT_STT_BACKEND_ID.toUpperCase()}`}
              sub="NEXT_PUBLIC_*_BACKEND · voice-models.json"
            />
          ) : (
            <Spec label="CODEC" value="opus 48k mono" sub="server-side resample" />
          )}
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

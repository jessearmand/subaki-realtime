import { Fragment } from "react";
import { Tag, Hr, Spec } from "./primitives";
import { useT } from "./i18n-context";
import { formatExec } from "@/lib/i18n";
import { PROVIDERS, type JaSupport, type Provider } from "@/lib/data";
import { lmModelsForEngine, providerModelLabel, resolveLmModel } from "@/lib/realtime/lm-config";
import {
  DEFAULT_STT_BACKEND_ID,
  DEFAULT_TTS_BACKEND_ID,
  providerExecLabel,
} from "@/lib/realtime/voice-config";
import type { CSSProperties } from "react";

/** Marks a JA-capable transport and how it gets there (solid: agent, dashed: prompt). */
function JaMark({ level }: { level: JaSupport }) {
  const t = useT();
  return (
    <span className={`tb-ja-mark tb-ja-mark-${level}`} title={t(`providers.jaMarkTitle.${level}`)}>
      {t(`providers.jaMark.${level}`)}
    </span>
  );
}

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
  const t = useT();
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
          <div className="tb-h-eyebrow">{t("providers.eyebrow")}</div>
          <h1 className="tb-h1">{t("providers.title")}</h1>
          <p className="tb-lede">{t("providers.lede")}</p>
        </div>
        <div className="tb-page-hd-r">
          <Tag mono dot>
            {t("providers.autoFailover")}
          </Tag>
        </div>
      </div>

      <table className="tb-table">
        <thead>
          <tr>
            <th style={{ width: 32 }} />
            <th>{t("providers.th.vendor")}</th>
            <th>{t("providers.th.model")}</th>
            <th>{t("providers.th.exec")}</th>
            <th className="tb-th-note">{t("providers.th.notes")}</th>
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
                  <td className="tb-table-vendor">
                    {p.name}
                    {p.ja && <JaMark level={p.ja} />}
                  </td>
                  <td className="tb-mono-num">{providerModelLabel(p, lmModelId)}</td>
                  <td>
                    <Tag mono dot>
                      {formatExec(t, providerExecLabel(p, lmBackend))}
                    </Tag>
                  </td>
                  <td className="tb-table-note">{t(`prov.note.${p.id}`, null, p.note)}</td>
                </tr>
                {models.length > 1 && (
                  <tr className={`tb-prov-inset-row ${on ? "on" : ""}`}>
                    <td />
                    <td colSpan={4} className="tb-prov-inset">
                      <div className="tb-prov-inset-inner">
                        <span className="tb-prov-inset-l">{t("providers.lmModel")}</span>
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
        <Hr label={t("providers.active", { name: provider.name })} />
        <div className="tb-prov-specs">
          <Spec
            label={t("spec.engine")}
            value={provider.engine ? provider.engine.toUpperCase() : t("spec.engine.mock")}
            sub={
              isCascade
                ? "STT → LM → TTS"
                : t(provider.engine ? "spec.engine.native" : "spec.engine.preview")
            }
          />
          {isCascade ? (
            <Spec
              label={t("spec.voiceLegs")}
              value={`TTS ${DEFAULT_TTS_BACKEND_ID.toUpperCase()} · STT ${DEFAULT_STT_BACKEND_ID.toUpperCase()}`}
              sub="NEXT_PUBLIC_*_BACKEND · voice-models.json"
            />
          ) : (
            <Spec label={t("spec.codec")} value="opus 48k mono" sub={t("spec.codec.sub")} />
          )}
          <Spec
            label={t("spec.turn")}
            value={isCascade ? "Silero VAD" : t("spec.turn.server")}
            sub={t(isCascade ? "spec.turn.cascadeSub" : "spec.turn.serverSub")}
          />
          <Spec
            label={t("spec.language")}
            value={t(provider.ja ? "spec.language.both" : "spec.language.enOnly")}
            sub={t(`spec.language.sub.${provider.ja ?? "none"}`)}
          />
          <Spec label={t("spec.tools")} value={t("spec.tools.value")} sub={t("spec.tools.sub")} />
        </div>
      </div>
    </div>
  );
}

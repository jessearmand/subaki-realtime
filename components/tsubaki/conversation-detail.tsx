// Right pane of the Conversations view: one call read back, with CONTINUE.

import { useT } from "./i18n-context";
import { Btn, Hr, Tag } from "./primitives";
import { SOURCE_LABEL, formatDuration, formatStartedAt, personaName } from "./conversation-format";
import type { ConversationDetail as Detail } from "@/lib/conversations/types";
import { LANG_LABEL, type Lang } from "@/lib/lang";

function noteKey(mapped: boolean, callLive: boolean, resuming: boolean): string {
  if (!mapped) return "convs.continueUnmapped";
  if (callLive && !resuming) return "convs.busy";
  return "convs.continueNote";
}

export function ConversationDetail({
  detail,
  lang,
  resuming,
  callLive,
  onContinue,
  onClear,
}: {
  detail: Detail;
  lang: Lang;
  /** Whether this conversation is the one the next call continues. */
  resuming: boolean;
  callLive: boolean;
  onContinue: () => void;
  onClear: () => void;
}) {
  const t = useT();
  const name = personaName(detail.personaId, lang);
  const who = name ?? t("convs.unknownPersona");
  return (
    <article className="tb-conv-detail">
      <Hr label={detail.title || t("convs.untitled")} />
      <div className="tb-conv-tags">
        <Tag mono>{who}</Tag>
        <Tag mono>{SOURCE_LABEL[detail.source]}</Tag>
        <Tag mono>{LANG_LABEL[detail.lang]}</Tag>
        <Tag mono>{formatStartedAt(detail.startedAt, lang)}</Tag>
        <Tag mono>{formatDuration(detail.durationSecs)}</Tag>
      </div>
      {detail.summary && <p className="tb-conv-summary">{detail.summary}</p>}

      <div className="tb-conv-actions">
        {resuming ? (
          <>
            <Tag accent dot>
              {t("convs.armed")}
            </Tag>
            <Btn small onClick={onClear}>
              {t("convs.clear")}
            </Btn>
          </>
        ) : (
          <Btn
            primary
            onClick={onContinue}
            disabled={!name || callLive || detail.transcript.length === 0}
          >
            {t("convs.continue")}
          </Btn>
        )}
        <span className="tb-conv-note">
          {t(noteKey(!!name, callLive, resuming), {
            name: who,
            transport: SOURCE_LABEL[detail.source],
          })}
        </span>
      </div>

      <Hr label={t("transcript.turns", { n: detail.transcript.length })} />
      <div className="tb-conv-transcript">
        {detail.transcript.map((turn, i) => (
          <div key={i} className={`tb-turn tb-turn-${turn.who}`}>
            <div className="tb-turn-hd">
              <span className="tb-turn-who">{turn.who === "user" ? t("transcript.you") : who}</span>
            </div>
            <div className="tb-turn-text">{turn.text}</div>
          </div>
        ))}
      </div>
    </article>
  );
}

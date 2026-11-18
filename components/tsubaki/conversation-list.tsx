// Left pane of the Conversations view: stored calls, newest first.

import { useT } from "./i18n-context";
import { Btn } from "./primitives";
import { formatDuration, formatStartedAt, personaName } from "./conversation-format";
import type { ConversationSummary } from "@/lib/conversations/types";
import { LANG_LABEL, type Lang } from "@/lib/lang";

export function ConversationList({
  items,
  lang,
  selectedId,
  onSelect,
  resumingId,
  hasMore,
  loading,
  onLoadMore,
}: {
  items: ConversationSummary[];
  lang: Lang;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The conversation armed to be continued, marked in the list. */
  resumingId: string | null;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const t = useT();
  return (
    <div className="tb-conv-list">
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`tb-conv-item ${c.id === selectedId ? "on" : ""}`}
          aria-current={c.id === selectedId ? "true" : undefined}
          onClick={() => onSelect(c.id)}
        >
          <span className="tb-conv-item-hd">
            <span className="tb-conv-item-who">
              {personaName(c.personaId, lang) ?? t("convs.unknownPersona")} · {LANG_LABEL[c.lang]}
            </span>
            <span>{formatStartedAt(c.startedAt, lang)}</span>
          </span>
          <span className="tb-conv-item-title">{c.title || t("convs.untitled")}</span>
          <span className="tb-conv-item-ft">
            <span>
              {formatDuration(c.durationSecs)} · {t("transcript.turns", { n: c.messageCount })}
            </span>
            {c.id === resumingId && <span className="tb-conv-item-armed">{t("convs.armed")}</span>}
          </span>
        </button>
      ))}
      {hasMore && (
        <div className="tb-conv-more">
          <Btn small onClick={onLoadMore} disabled={loading}>
            {t(loading ? "convs.loading" : "convs.more")}
          </Btn>
        </div>
      )}
    </div>
  );
}

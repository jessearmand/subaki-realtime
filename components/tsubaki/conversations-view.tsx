// Conversations: the visitor's stored ElevenLabs calls. Pick one to read it
// back; CONTINUE arms it so the next CALL picks the thread back up with the
// same persona (see hooks/use-resume.ts). ElevenLabs is the only transport
// that stores calls today, so it is the only one that can continue them.

import { useEffect, useRef } from "react";
import { useT } from "./i18n-context";
import { Btn, Tag } from "./primitives";
import { ConversationList } from "./conversation-list";
import { ConversationDetail } from "./conversation-detail";
import { useConversations, type HistoryFailure } from "@/hooks/use-conversations";
import type { ConversationDetail as Detail } from "@/lib/conversations/types";
import type { Lang } from "@/lib/lang";

function Status({ children }: { children: string }) {
  return <p className="tb-conv-status">{children}</p>;
}

function failureKey(f: HistoryFailure): string {
  return f === "unconfigured" ? "convs.unconfigured" : "convs.failed";
}

export function ConversationsView({
  lang,
  resumeId,
  callLive,
  onContinue,
  onClearResume,
}: {
  lang: Lang;
  /** The conversation the next call continues, if any (selected first on open). */
  resumeId: string | null;
  /** A call is in progress: continuing waits until it is hung up. */
  callLive: boolean;
  onContinue: (detail: Detail) => void;
  onClearResume: () => void;
}) {
  const t = useT();
  const convs = useConversations(resumeId);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  // Narrow layouts stack the detail under the list. Once a picked call has
  // loaded (so there is something to scroll to), bring it into view.
  const scrollOnLoadRef = useRef(false);
  const select = (id: string) => {
    scrollOnLoadRef.current = true;
    convs.select(id);
  };
  const loadedId = convs.detail?.id;
  useEffect(() => {
    if (!scrollOnLoadRef.current || !loadedId) return;
    scrollOnLoadRef.current = false;
    const list = listRef.current?.getBoundingClientRect();
    const detail = detailRef.current;
    if (list && detail && detail.getBoundingClientRect().top >= list.bottom) {
      detail.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [loadedId]);
  const { items, loading, failure, detail, detailLoading, detailFailure } = convs;

  let list;
  if (failure) list = <Status>{t(failureKey(failure))}</Status>;
  else if (loading && items.length === 0) list = <Status>{t("convs.loading")}</Status>;
  else if (items.length === 0) list = <Status>{t("convs.empty")}</Status>;
  else
    list = (
      <ConversationList
        items={items}
        lang={lang}
        selectedId={convs.selectedId}
        onSelect={select}
        resumingId={resumeId}
        hasMore={convs.hasMore}
        loading={loading}
        onLoadMore={convs.loadMore}
      />
    );

  let pane;
  if (detailFailure) pane = <Status>{t(failureKey(detailFailure))}</Status>;
  else if (detailLoading) pane = <Status>{t("convs.loading")}</Status>;
  else if (detail)
    pane = (
      <ConversationDetail
        detail={detail}
        lang={lang}
        resuming={detail.id === resumeId}
        callLive={callLive}
        onContinue={() => onContinue(detail)}
        onClear={onClearResume}
      />
    );
  else pane = items.length > 0 ? <Status>{t("convs.pick")}</Status> : null;

  return (
    <div className="tb-convs">
      <div className="tb-page-hd">
        <div>
          <div className="tb-h-eyebrow">{t("convs.eyebrow")}</div>
          <h1 className="tb-h1">{t("convs.title")}</h1>
          <p className="tb-lede">{t("convs.lede")}</p>
        </div>
        <div className="tb-page-hd-r">
          <Tag mono dot>
            {t("convs.source")}
          </Tag>
          <Btn small onClick={convs.reload} disabled={loading}>
            {t("convs.refresh")}
          </Btn>
        </div>
      </div>
      <div className="tb-convs-body">
        <div className="tb-convs-list-col" ref={listRef}>
          {list}
        </div>
        <div className="tb-convs-detail-col" ref={detailRef}>
          {pane}
        </div>
      </div>
    </div>
  );
}

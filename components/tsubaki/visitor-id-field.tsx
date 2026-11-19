import { useEffect, useState } from "react";
import { FieldRow } from "./primitives";
import { useT } from "./i18n-context";
import { isMemoryUserId } from "@/lib/memory/ids";
import { getMemoryUserId, setMemoryUserId } from "@/lib/memory/user-id";

type Notice = "copied" | "copyFailed" | "applied";

/** Ids are lowercase; forgive a pasted one with stray spaces or capitals. */
function normalize(draft: string): string {
  return draft.trim().toLowerCase();
}

async function copyText(text: string): Promise<boolean> {
  try {
    // Undefined on insecure origins (plain http on a LAN host).
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Settings → VISITOR ID. Shows this browser's visitor id and lets the visitor
 * replace it with one copied from another browser, so both share one history
 * and one memory. `onChange` fires once a different id is in use.
 */
export function VisitorIdField({ onChange }: { onChange: () => void }) {
  const t = useT();
  // Read after mount: the id lives in localStorage, which the server render lacks.
  const [current, setCurrent] = useState("");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const id = getMemoryUserId();
    setCurrent(id);
    setDraft(id);
  }, []);

  const candidate = normalize(draft);
  const changed = candidate !== current;
  const valid = isMemoryUserId(candidate);
  const invalid = changed && candidate !== "" && !valid;

  const apply = () => {
    if (!changed || !setMemoryUserId(candidate)) return;
    setCurrent(candidate);
    setDraft(candidate);
    setNotice("applied");
    onChange();
  };

  const copy = async () => {
    setNotice((await copyText(current)) ? "copied" : "copyFailed");
  };

  const status = invalid ? t("visitorId.invalid") : notice ? t(`visitorId.${notice}`) : "";

  return (
    <FieldRow label={t("field.visitorId")} hint={t("field.visitorId.hint")}>
      <div className="tb-visitor-id">
        <input
          type="text"
          className="tb-input tb-visitor-id-input"
          value={draft}
          aria-label={t("field.visitorId")}
          aria-invalid={invalid}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          onChange={(e) => {
            setDraft(e.target.value);
            setNotice(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
        />
        <button type="button" className="tb-btn tb-btn-sm" onClick={copy} disabled={!current}>
          {t("visitorId.copy")}
        </button>
        <button
          type="button"
          className="tb-btn tb-btn-sm"
          onClick={apply}
          disabled={!changed || !valid}
        >
          {t("visitorId.apply")}
        </button>
      </div>
      <p className="tb-visitor-id-status" aria-live="polite" data-invalid={invalid}>
        {status}
      </p>
      <p className="tb-visitor-id-note">{t("visitorId.note")}</p>
    </FieldRow>
  );
}

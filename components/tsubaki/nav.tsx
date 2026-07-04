import type { Persona, Provider } from "@/lib/data";

export type NavId = "call" | "personas" | "providers" | "settings";

export const NAV: { id: NavId; label: string; key: string }[] = [
  { id: "call", label: "SESSIONS", key: "C" },
  { id: "personas", label: "PERSONAS", key: "P" },
  { id: "providers", label: "PROVIDERS", key: "V" },
  { id: "settings", label: "SETTINGS", key: "S" },
];

export function Sidebar({
  nav,
  setNav,
  persona,
  provider,
  providerModel,
  providerExec,
}: {
  nav: NavId;
  setNav: (id: NavId) => void;
  persona: Persona;
  provider: Provider;
  /** Display model — tracks the cascade LM picker (see providerModelLabel). */
  providerModel: string;
  /** Execution mode — cascade computes it from the resolved backends
   *  (see providerExecLabel); other engines pass their static `exec`. */
  providerExec: string;
}) {
  return (
    <nav className="tb-side">
      <div className="tb-side-eyebrow">— SECTIONS</div>
      {NAV.map((item) => (
        <button
          key={item.id}
          className={`tb-nav-item ${nav === item.id ? "on" : ""}`}
          onClick={() => setNav(item.id)}
        >
          <span>{item.label}</span>
          <span className="tb-nav-key">{item.key}</span>
        </button>
      ))}
      <div className="tb-side-foot">
        <div>
          <b>{persona.name}</b>
          <br />
          active persona
        </div>
        <div>
          <b>{provider.name}</b> · {providerModel}
          <br />
          active transport
        </div>
        <div>
          exec <b>{providerExec.toUpperCase()}</b>
        </div>
      </div>
    </nav>
  );
}

export function MobileTabs({ nav, setNav }: { nav: NavId; setNav: (id: NavId) => void }) {
  return (
    <nav className="tb-mobile-tabs">
      {NAV.map((item) => (
        <button
          key={item.id}
          className={`tb-mobile-tab ${nav === item.id ? "on" : ""}`}
          onClick={() => setNav(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

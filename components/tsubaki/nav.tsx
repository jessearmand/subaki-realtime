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
}: {
  nav: NavId;
  setNav: (id: NavId) => void;
  persona: Persona;
  provider: Provider;
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
          <b>{provider.name}</b> · {provider.model}
          <br />
          active transport
        </div>
        <div>
          p50 <b style={{ fontVariantNumeric: "tabular-nums" }}>{provider.latency} ms</b>
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

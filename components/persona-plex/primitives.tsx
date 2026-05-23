// Brutalist editorial primitives ported from the design bundle (screens.jsx).

import type { ButtonHTMLAttributes, ReactNode } from "react";

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  danger?: boolean;
  primary?: boolean;
  small?: boolean;
}

export function Btn({
  children,
  active,
  danger,
  primary,
  small,
  className = "",
  ...rest
}: BtnProps) {
  const cls = [
    "pp-btn",
    active ? "pp-btn-on" : "",
    danger ? "pp-btn-danger" : "",
    primary ? "pp-btn-primary" : "",
    small ? "pp-btn-sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

export function Tag({
  children,
  dot,
  mono,
  accent,
}: {
  children: ReactNode;
  dot?: boolean;
  mono?: boolean;
  accent?: boolean;
}) {
  const cls = ["pp-tag", mono ? "pp-tag-mono" : "", accent ? "pp-tag-accent" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls}>
      {dot && <span className="pp-dot" />}
      {children}
    </span>
  );
}

export function Hr({ label }: { label?: string }) {
  if (!label) return <hr className="pp-hr" />;
  return (
    <div className="pp-hr-l">
      <span className="pp-hr-line" />
      <span className="pp-hr-label">{label}</span>
      <span className="pp-hr-line" />
    </div>
  );
}

export function Spec({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="pp-spec">
      <div className="pp-spec-l">{label}</div>
      <div className="pp-spec-v">{value}</div>
      {sub && <div className="pp-spec-s">{sub}</div>}
    </div>
  );
}

export function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="pp-field">
      <div className="pp-field-hd">
        <span className="pp-field-l">{label}</span>
        {hint && <span className="pp-field-hint">{hint}</span>}
      </div>
      <div className="pp-field-c">{children}</div>
    </div>
  );
}

export function SwitchRow({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`pp-switch ${value ? "on" : ""}`}
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
    >
      <span className="pp-switch-l">OFF</span>
      <span className="pp-switch-knob" />
      <span className="pp-switch-r">ON</span>
    </button>
  );
}

export function ToolRow({
  name,
  label,
  on,
  onToggle,
}: {
  name: string;
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className={`pp-tool ${on ? "on" : "off"}`} onClick={onToggle}>
      <span className="pp-tool-name">{name}</span>
      <span className="pp-tool-label">{label}</span>
      <span className={`pp-tool-status ${on ? "on" : "off"}`}>{on ? "● ON" : "○ OFF"}</span>
    </button>
  );
}

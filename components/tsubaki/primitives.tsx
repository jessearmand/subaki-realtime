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
    "tb-btn",
    active ? "tb-btn-on" : "",
    danger ? "tb-btn-danger" : "",
    primary ? "tb-btn-primary" : "",
    small ? "tb-btn-sm" : "",
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
  const cls = ["tb-tag", mono ? "tb-tag-mono" : "", accent ? "tb-tag-accent" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls}>
      {dot && <span className="tb-dot" />}
      {children}
    </span>
  );
}

export function Hr({ label }: { label?: string }) {
  if (!label) return <hr className="tb-hr" />;
  return (
    <div className="tb-hr-l">
      <span className="tb-hr-line" />
      <span className="tb-hr-label">{label}</span>
      <span className="tb-hr-line" />
    </div>
  );
}

export function Spec({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tb-spec">
      <div className="tb-spec-l">{label}</div>
      <div className="tb-spec-v">{value}</div>
      {sub && <div className="tb-spec-s">{sub}</div>}
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
    <div className="tb-field">
      <div className="tb-field-hd">
        <span className="tb-field-l">{label}</span>
        {hint && <span className="tb-field-hint">{hint}</span>}
      </div>
      <div className="tb-field-c">{children}</div>
    </div>
  );
}

export function SwitchRow({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`tb-switch ${value ? "on" : ""}`}
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
    >
      <span className="tb-switch-l">OFF</span>
      <span className="tb-switch-knob" />
      <span className="tb-switch-r">ON</span>
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
    <button type="button" className={`tb-tool ${on ? "on" : "off"}`} onClick={onToggle}>
      <span className="tb-tool-name">{name}</span>
      <span className="tb-tool-label">{label}</span>
      <span className={`tb-tool-status ${on ? "on" : "off"}`}>{on ? "● ON" : "○ OFF"}</span>
    </button>
  );
}

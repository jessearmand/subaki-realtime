// Glyphs — simple 1px-stroke brutalist symbols, sized to the call-control caps.

interface GlyphProps {
  size?: number;
}

export function WaveGlyph({ size = 14 }: GlyphProps) {
  // Audio waveform bars — start a voice call.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <line x1="2" y1="6.5" x2="2" y2="9.5" />
      <line x1="5" y1="4.5" x2="5" y2="11.5" />
      <line x1="8" y1="2.5" x2="8" y2="13.5" />
      <line x1="11" y1="4.5" x2="11" y2="11.5" />
      <line x1="14" y1="6.5" x2="14" y2="9.5" />
    </svg>
  );
}

export function PhoneHangGlyph({ size = 14 }: GlyphProps) {
  // Hang up — clean cross. Universal "end".
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <line x1="3" y1="3" x2="13" y2="13" />
      <line x1="13" y1="3" x2="3" y2="13" />
    </svg>
  );
}

export function MicGlyph({ size = 14, muted = false }: GlyphProps & { muted?: boolean }) {
  // Mic body + stand. Mute state adds a diagonal slash.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <rect x="6" y="2" width="4" height="8" />
      <path d="M3.5 8.5a4.5 4.5 0 0 0 9 0" />
      <line x1="8" y1="13" x2="8" y2="15" />
      <line x1="5.5" y1="15" x2="10.5" y2="15" />
      {muted && <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" strokeWidth="1.8" />}
    </svg>
  );
}

export function WrenchGlyph({ size = 14 }: GlyphProps) {
  // Open-end wrench at 45°. 1.4px stroke, brutalist square caps.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <line x1="3" y1="13" x2="9" y2="7" />
      <path d="M9.5 6.5 L12 4 L13.2 5.2 L13.2 7.2 L11.2 7.2 L10 8.4 Z" />
    </svg>
  );
}

export function ScrollGlyph({ size = 14 }: GlyphProps) {
  // Paper scroll — top + bottom rolled edges, text lines in the middle.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <rect x="2.5" y="2" width="11" height="2" />
      <line x1="3.5" y1="4" x2="3.5" y2="12" />
      <line x1="12.5" y1="4" x2="12.5" y2="12" />
      <line x1="5" y1="6.5" x2="11" y2="6.5" />
      <line x1="5" y1="9" x2="11" y2="9" />
      <rect x="2.5" y="12" width="11" height="2" />
    </svg>
  );
}

export function SendGlyph({ size = 14 }: GlyphProps) {
  // Arrow into an end-bar — "send / commit my turn".
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <line x1="2" y1="8" x2="10" y2="8" />
      <path d="M7 5 L10 8 L7 11" />
      <line x1="13" y1="3.5" x2="13" y2="12.5" />
    </svg>
  );
}

export function InterruptGlyph({ size = 14 }: GlyphProps) {
  // Open palm — universal "stop / hold on, let me talk".
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d="M5 8V3.5a1 1 0 0 1 2 0V7" />
      <path d="M7 7V2.5a1 1 0 0 1 2 0V7" />
      <path d="M9 7V3a1 1 0 0 1 2 0v5" />
      <path d="M11 5.5a1 1 0 0 1 2 0V10a4 4 0 0 1-4 4H8a3 3 0 0 1-2.6-1.5L3 8.5a1 1 0 0 1 1.7-1L6 9" />
    </svg>
  );
}

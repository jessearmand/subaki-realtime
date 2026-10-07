// The EN / 日本語 string layer. One switch drives both the session voice
// language and the UI locale, so every label lives here rather than inline.
//
// Conventions:
// - Technical identifiers stay untranslated in both tables: vendor names (XAI,
//   ELEVENLABS), model ids, engine ids, tool names (search.web), device names.
// - STRINGS.en is the UI copy. Data-borne copy (provider notes, tool labels)
//   stays English in lib/data.ts and is only overridden in `ja`, through
//   t(key, vars, fallback).
// - `{name}` placeholders are interpolated from `vars`.

import type { Lang } from "@/lib/lang";

export const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    // Language control
    "lang.label": "LANG",
    "lang.aria": "Language",
    "lang.name.en": "EN",
    "lang.name.ja": "日本語",

    // Chrome — top bar, sidebar, mobile tabs
    "brand.sub": "realtime console",
    "top.session": "SESSION",
    "top.network": "NETWORK",
    "top.mic": "MIC",
    "status.live": "LIVE",
    "status.idle": "IDLE",
    "status.ended": "ENDED",
    "status.ok": "OK",
    "status.on": "ON",
    "status.off": "OFF",
    "side.sections": "— SECTIONS",
    "side.activePersona": "active persona",
    "side.activeTransport": "active transport",
    "side.exec": "exec",
    "nav.call": "SESSIONS",
    "nav.personas": "PERSONAS",
    "nav.providers": "PROVIDERS",
    "nav.settings": "SETTINGS",

    // Execution labels
    "exec.remote": "REMOTE",
    "exec.local": "LOCAL",
    "exec.hybrid": "LOCAL / REMOTE",
    "exec.partial": "LOCAL: {legs}",

    // Call view
    "call.state.idle": "IDLE",
    "call.state.connecting": "CONNECTING",
    "call.state.listening": "LISTENING",
    "call.state.speaking": "SPEAKING",
    "call.state.interrupted": "INTERRUPTED",
    "call.state.ended": "ENDED",
    "call.session": "SESSION",
    "call.via": "VIA",
    "call.persona": "PERSONA",
    "call.manualHint": "MANUAL TURN · PRESS SEND TO REPLY",
    "caption.idle": "press CALL to begin",
    "caption.connecting": "establishing session…",
    "caption.interrupted": "… you interrupted",
    "caption.ended": "— call ended —",

    // Status captions. The engine hooks emit these English strings; CallView
    // maps them to keys (CAPTION_KEYS) so they follow the session language.
    "caption.listening": "listening…",
    "caption.connectingShort": "connecting…",
    "caption.error": "— connection error —",
    "caption.micDenied": "— microphone permission denied —",
    "caption.tokenUnreachable": "— could not reach token endpoint —",
    "caption.endingSoon": "— session ending soon —",
    "caption.searching": "searching the web…",
    "caption.wakingLocal": "waking the local model…",
    "transcript.live": "LIVE TRANSCRIPT",
    "transcript.turns": "{n} TURNS",
    "transcript.you": "YOU",
    "transcript.liveTag": "— LIVE —",
    "tools.active": "ACTIVE TOOLS",
    "tools.configure": "↳ CONFIGURE IN SETTINGS",
    "tag.preview": "PREVIEW",
    "tag.previewTitle": "Mock — tools are not wired to a live backend yet",

    // Accessible names
    "aria.mute": "Mute microphone",
    "aria.unmute": "Unmute microphone",
    "aria.interrupt": "Interrupt agent",
    "aria.send": "Send turn",
    "aria.call": "Call",
    "aria.hangup": "Hang up",
    "aria.showTranscript": "Show transcript",
    "aria.hideTranscript": "Hide transcript",
    "aria.toolsNone": "Tools — none armed",
    "aria.toolsSome": "Tools — {n} of {total} armed",
    "aria.activeTools": "Active tools",
    "aria.activePersona": "Active persona",
    "aria.inactivePersona": "Inactive persona",
    "aria.openMenu": "Open menu",
    "aria.closeMenu": "Close menu",
    "aria.sections": "Sections",

    // Session routing notices. A transport or language change points the
    // session at a different platform agent; mid-call handover doesn't work
    // upstream, so a live call ends and a new session opens.
    "route.failover.switching": "▲ NO JAPANESE ON {from} — ENDING SESSION → NEW SESSION ON {to}",
    "route.failover.done": "● NEW SESSION ON {to} · JA {via}",
    "route.failover.idle": "● TRANSPORT → {to} · JA {via}",
    "route.downgrade.switching": "▲ NO JAPANESE ON {to} — LANGUAGE → EN · ENDING SESSION",
    "route.downgrade.done": "● LANGUAGE → EN · NEW SESSION ON {to}",
    "route.downgrade.idle": "▲ NO JAPANESE ON {to} — LANGUAGE → EN",
    "route.via.agent": "AGENT {agent}",
    "route.via.prompt": "VIA PROMPT",
    "route.switch.switching": "▲ ENDING SESSION ON {from} → NEW SESSION ON {to}",
    "route.switch.done": "● NEW SESSION ON {to} · {lang}",
    "route.unavailable": "▲ NO TRANSPORT SPEAKS JAPANESE — LANGUAGE STAYS EN",

    // Personas
    "personas.eyebrow": "001 / VOICE LIBRARY",
    "personas.title": "Personas.",
    "personas.lede":
      "One ancient camellia spirit. Seven named manifestations, each voiced in English and Japanese. Selection persists across providers.",
    "personas.clone": "+ CLONE NEW",
    "personas.import": "IMPORT",
    "personas.firstMessage": "FIRST MESSAGE",
    "personas.jaAgent": "JA AGENT",
    "personas.jaPrompt": "JA VOICE",
    "personas.jaPromptValue": "via prompt · same voice",
    "slot.name": "EMPTY SLOT",
    "slot.desc": "Drop a 30-second voice sample to clone. Consent prompt is run end-to-end.",
    "slot.drop": "DRAG · .wav · .mp3 · ≤ 30s",

    // Providers
    "providers.eyebrow": "002 / TRANSPORT",
    "providers.title": "Realtime providers.",
    "providers.lede":
      "All seven backends accept the same audio stream. Switching transport ends the call and opens a fresh session.",
    "providers.autoFailover": "AUTO-FAILOVER ON",
    "providers.th.vendor": "VENDOR",
    "providers.th.model": "MODEL",
    "providers.th.exec": "EXECUTION",
    "providers.th.notes": "NOTES",
    "providers.jaMark.agent": "JA · AGENT",
    "providers.jaMark.prompt": "JA · PROMPT",
    "providers.jaMarkTitle.agent":
      "Dedicated Japanese agent per persona — JA prompt and a cast native-speaker voice",
    "providers.jaMarkTitle.prompt":
      "Japanese set through the session instructions — same voice, no language parameter",
    "providers.lmModel": "LM MODEL",
    "providers.active": "ACTIVE · {name}",
    "spec.engine": "ENGINE",
    "spec.engine.mock": "MOCK",
    "spec.engine.native": "native realtime",
    "spec.engine.preview": "design preview",
    "spec.voiceLegs": "VOICE LEGS",
    "spec.codec": "CODEC",
    "spec.codec.sub": "server-side resample",
    "spec.turn": "TURN DETECTION",
    "spec.turn.server": "server VAD",
    "spec.turn.cascadeSub": "neural · browser · send-turn",
    "spec.turn.serverSub": "200 ms silence → end-of-turn",
    "spec.language": "LANGUAGE",
    "spec.language.both": "EN · JA",
    "spec.language.enOnly": "EN ONLY",
    "spec.language.sub.agent": "dedicated JA agent · tsubaki-<id>-ja",
    "spec.language.sub.prompt": "JA via instructions · same voice",
    "spec.language.sub.none": "no Japanese path on this engine",
    "spec.tools": "TOOL FORMAT",
    "spec.tools.value": "OpenAI-style fn-calls",
    "spec.tools.sub": "translated per provider",

    // Settings
    "settings.eyebrow": "003 / CONFIGURATION",
    "settings.title": "Settings.",
    "settings.lede": "Language, local audio chain, model behaviour, tools and safety.",
    "sec.general": "GENERAL",
    "sec.audioIn": "AUDIO IN",
    "sec.audioOut": "AUDIO OUT",
    "sec.behaviour": "BEHAVIOUR",
    "sec.tools": "TOOLS",
    "field.language": "LANGUAGE",
    "field.language.hint": "interface + voice · routes the agent",
    "field.inputDevice": "INPUT DEVICE",
    "field.level": "LEVEL",
    "field.denoise": "DENOISE",
    "field.vad": "VAD SENSITIVITY",
    "field.vad.hint": "{v} · medium",
    "field.outputDevice": "OUTPUT DEVICE",
    "field.volume": "VOLUME",
    "field.spatial": "SPATIAL",
    "field.latency": "LATENCY BUDGET",
    "field.latency.hint": "{ms} ms · balanced",
    "field.interruptions": "INTERRUPTIONS",
    "field.interruptions.hint": "voice barge-in · headphones only",
    "field.ptt": "PUSH-TO-TALK",
    "field.ptt.hint": "cascade · send button ends your turn",
    "switch.off": "OFF",
    "switch.on": "ON",
    "tool.on": "● ON",
    "tool.off": "○ OFF",
  },

  ja: {
    "lang.label": "言語",
    "lang.aria": "言語",
    "lang.name.en": "EN",
    "lang.name.ja": "日本語",

    "brand.sub": "リアルタイム・コンソール",
    "top.session": "セッション",
    "top.network": "回線",
    "top.mic": "マイク",
    "status.live": "通話中",
    "status.idle": "待機",
    "status.ended": "終了",
    "status.ok": "良好",
    "status.on": "オン",
    "status.off": "オフ",
    "side.sections": "— セクション",
    "side.activePersona": "使用中のペルソナ",
    "side.activeTransport": "使用中の通信経路",
    "side.exec": "実行",
    "nav.call": "セッション",
    "nav.personas": "ペルソナ",
    "nav.providers": "プロバイダ",
    "nav.settings": "設定",

    "exec.remote": "リモート",
    "exec.local": "ローカル",
    "exec.hybrid": "ローカル / リモート",
    "exec.partial": "ローカル: {legs}",

    "call.state.idle": "待機",
    "call.state.connecting": "接続中",
    "call.state.listening": "聞き取り中",
    "call.state.speaking": "発話中",
    "call.state.interrupted": "割り込み",
    "call.state.ended": "終了",
    "call.session": "セッション",
    "call.via": "経由",
    "call.persona": "ペルソナ",
    "call.manualHint": "手動ターン · 送信を押して応答",
    "caption.idle": "通話ボタンを押して開始",
    "caption.connecting": "セッションを確立中…",
    "caption.interrupted": "……割り込みました",
    "caption.ended": "— 通話終了 —",

    "caption.listening": "聞いています…",
    "caption.connectingShort": "接続中…",
    "caption.error": "— 接続エラー —",
    "caption.micDenied": "— マイクの使用が許可されていません —",
    "caption.tokenUnreachable": "— トークン発行先に接続できません —",
    "caption.endingSoon": "— まもなくセッションが終了します —",
    "caption.searching": "ウェブを検索中…",
    "caption.wakingLocal": "ローカルモデルを起動中…",
    "transcript.live": "ライブ文字起こし",
    "transcript.turns": "{n} ターン",
    "transcript.you": "あなた",
    "transcript.liveTag": "— 発話中 —",
    "tools.active": "有効なツール",
    "tools.configure": "↳ 設定で変更",
    "tag.preview": "プレビュー",
    "tag.previewTitle": "モック — ツールはまだ実際のバックエンドに接続されていません",

    "aria.mute": "マイクをミュート",
    "aria.unmute": "マイクのミュートを解除",
    "aria.interrupt": "エージェントに割り込む",
    "aria.send": "ターンを送信",
    "aria.call": "通話を開始",
    "aria.hangup": "通話を終了",
    "aria.showTranscript": "文字起こしを表示",
    "aria.hideTranscript": "文字起こしを隠す",
    "aria.toolsNone": "ツール — 有効なものなし",
    "aria.toolsSome": "ツール — {total}件中{n}件が有効",
    "aria.activeTools": "有効なツール",
    "aria.activePersona": "使用中のペルソナ",
    "aria.inactivePersona": "未使用のペルソナ",
    "aria.openMenu": "メニューを開く",
    "aria.closeMenu": "メニューを閉じる",
    "aria.sections": "セクション",

    "route.failover.switching":
      "▲ {from} は日本語非対応 — セッションを終了し、{to} で新規セッション",
    "route.failover.done": "● {to} で新しいセッション · 日本語 {via}",
    "route.failover.idle": "● 通信経路 → {to} · 日本語 {via}",
    "route.downgrade.switching": "▲ {to} は日本語非対応 — 言語を英語へ · セッションを終了",
    "route.downgrade.done": "● 言語を英語へ · {to} で新しいセッション",
    "route.downgrade.idle": "▲ {to} は日本語非対応 — 言語を英語へ",
    "route.via.agent": "エージェント {agent}",
    "route.via.prompt": "プロンプト指定",
    "route.switch.switching": "▲ {from} のセッションを終了 → {to} で新規セッション",
    "route.switch.done": "● {to} で新しいセッション · {lang}",
    "route.unavailable": "▲ 日本語に対応する通信経路がありません — 英語のまま",

    "personas.eyebrow": "001 / 音声ライブラリ",
    "personas.title": "ペルソナ。",
    "personas.lede":
      "古き椿の精、ひとつ。名を持つ七つの化身——それぞれが英語と日本語で語る。選択はプロバイダを切り替えても保持される。",
    "personas.clone": "+ 新規クローン",
    "personas.import": "読み込み",
    "personas.firstMessage": "第一声",
    "personas.jaAgent": "日本語エージェント",
    "personas.jaPrompt": "日本語の声",
    "personas.jaPromptValue": "プロンプト指定 · 同じ声",
    "slot.name": "空きスロット",
    "slot.desc": "30秒の音声サンプルをドロップしてクローン。同意の確認は最初から最後まで行われる。",
    "slot.drop": "ドラッグ · .wav · .mp3 · 30秒以内",

    "providers.eyebrow": "002 / 通信経路",
    "providers.title": "リアルタイム・プロバイダ。",
    "providers.lede":
      "七つのバックエンドはすべて同じ音声ストリームを受け付ける。通信経路を切り替えると通話を終え、新しいセッションを開く。",
    "providers.autoFailover": "自動フェイルオーバー · オン",
    "providers.th.vendor": "ベンダー",
    "providers.th.model": "モデル",
    "providers.th.exec": "実行環境",
    "providers.th.notes": "備考",
    "providers.jaMark.agent": "日本語 · 専用",
    "providers.jaMark.prompt": "日本語 · プロンプト",
    "providers.jaMarkTitle.agent":
      "ペルソナごとの専用日本語エージェント — 日本語プロンプトと、配役された母語話者の声",
    "providers.jaMarkTitle.prompt":
      "セッションの指示文で日本語を指定 — 声は同じ、言語パラメータなし",
    "providers.lmModel": "LMモデル",
    "providers.active": "使用中 · {name}",
    "prov.note.grok": "デフォルト。フィルターなしの率直な応答スタイル。",
    "prov.note.openai": "総合性能が最も高い。",
    "prov.note.elevenlabs": "声の再現性が最も高い。ペルソナごと・言語ごとに専用エージェント。",
    "prov.note.gemini": "最初のトークンまでの遅延が最小。映像入力に対応。",
    "prov.note.mistral":
      "STT→LM→TTS のカスケード。各レッグをクラウド（HF/Mistral）またはオンデバイス（llama-server + mlx-audio）で実行。",
    "prov.note.fal": "全二重の音声対音声（NVIDIA PersonaPlex）。話しながら聞く。",
    "prov.note.kyutai":
      "PersonaPlex RL ファインチューンをオンデバイス（MLX）で全二重実行。`mise run personaplex-local` が必要。",
    "spec.engine": "エンジン",
    "spec.engine.mock": "モック",
    "spec.engine.native": "ネイティブ・リアルタイム",
    "spec.engine.preview": "デザインプレビュー",
    "spec.voiceLegs": "音声レッグ",
    "spec.codec": "コーデック",
    "spec.codec.sub": "サーバー側でリサンプル",
    "spec.turn": "ターン検出",
    "spec.turn.server": "サーバーVAD",
    "spec.turn.cascadeSub": "ニューラル · ブラウザ · 送信でターン終了",
    "spec.turn.serverSub": "200ms の無音 → ターン終了",
    "spec.language": "言語",
    "spec.language.both": "英語 · 日本語",
    "spec.language.enOnly": "英語のみ",
    "spec.language.sub.agent": "専用の日本語エージェント · tsubaki-<id>-ja",
    "spec.language.sub.prompt": "指示文で日本語を指定 · 同じ声",
    "spec.language.sub.none": "このエンジンに日本語の経路なし",
    "spec.tools": "ツール形式",
    "spec.tools.value": "OpenAI形式の関数呼び出し",
    "spec.tools.sub": "プロバイダごとに変換",

    "settings.eyebrow": "003 / 構成",
    "settings.title": "設定。",
    "settings.lede": "言語、ローカル音声チェーン、モデルの挙動、ツール、安全性。",
    "sec.general": "全般",
    "sec.audioIn": "音声入力",
    "sec.audioOut": "音声出力",
    "sec.behaviour": "挙動",
    "sec.tools": "ツール",
    "field.language": "言語",
    "field.language.hint": "表示と音声 · エージェントを切替",
    "field.inputDevice": "入力デバイス",
    "field.level": "レベル",
    "field.denoise": "ノイズ除去",
    "field.vad": "VAD感度",
    "field.vad.hint": "{v} · 中",
    "field.outputDevice": "出力デバイス",
    "field.volume": "音量",
    "field.spatial": "空間オーディオ",
    "field.latency": "レイテンシ予算",
    "field.latency.hint": "{ms} ms · バランス",
    "field.interruptions": "割り込み",
    "field.interruptions.hint": "音声バージイン · ヘッドホン専用",
    "field.ptt": "プッシュ・トゥ・トーク",
    "field.ptt.hint": "カスケード · 送信ボタンでターン終了",
    "switch.off": "オフ",
    "switch.on": "オン",
    "tool.on": "● オン",
    "tool.off": "○ オフ",
    "tool.search.web": "ウェブ検索 · Tavily",
    "tool.screen.capture": "スクリーンショット · 画面取得",
    "tool.shell.exec": "シェル実行 · サンドボックス",
    "tool.memory.recall": "長期記憶 · ベクトル",
  },
};

/** t(key, vars?, fallback?) */
export type Translate = (
  key: string,
  vars?: Record<string, string | number> | null,
  fallback?: string,
) => string;

/**
 * Lookup order: active table → EN table → fallback → the key itself (so a
 * missing string is visible, never blank).
 */
export function makeT(lang: Lang): Translate {
  const table = STRINGS[lang];
  return (key, vars, fallback) => {
    const s = table[key] ?? STRINGS.en[key] ?? fallback ?? key;
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  };
}

// Status captions the engine hooks emit (in English) → string keys.
const CAPTION_KEYS: Record<string, string> = {
  "press CALL to begin": "caption.idle",
  "— call ended —": "caption.ended",
  "establishing session…": "caption.connecting",
  "… you interrupted": "caption.interrupted",
  "listening…": "caption.listening",
  "connecting…": "caption.connectingShort",
  "— connection error —": "caption.error",
  "— microphone permission denied —": "caption.micDenied",
  "— could not reach token endpoint —": "caption.tokenUnreachable",
  "— session ending soon —": "caption.endingSoon",
  "searching the web…": "caption.searching",
  "waking the local model…": "caption.wakingLocal",
};

/** Localize a status caption; transcript text and unknown messages pass through. */
export function localizeCaption(t: Translate, caption: string): string {
  const key = CAPTION_KEYS[caption];
  return key ? t(key) : caption;
}

/**
 * Execution labels arrive as raw strings from the provider data / cascade
 * resolver ("remote", "local / remote", "local: LM+TTS"); render them localized.
 */
export function formatExec(t: Translate, raw = "remote"): string {
  if (raw === "remote") return t("exec.remote");
  if (raw === "local") return t("exec.local");
  if (raw === "local / remote") return t("exec.hybrid");
  if (raw.startsWith("local: ")) {
    return t("exec.partial", { legs: raw.slice("local: ".length).toUpperCase() });
  }
  return raw.toUpperCase();
}

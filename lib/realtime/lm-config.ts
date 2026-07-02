// Catalog of LM models + backends for the cascade (STT → LM → TTS) engine.
//
// Single source of truth, edited as data in `config/lm-models.json` — so changing
// which model the cascade uses is a config edit, not a code change, and there's no
// need to pull a live model list. Read by both the server route (`app/api/llm`,
// which resolves a backend's URL + secret env key) and the client agent config
// (`cascade-agent.ts`, which picks the model). Only env var *names* and public
// API URLs live here; secret values stay in fnox and are read server-side.

import catalog from "@/config/lm-models.json";

export interface LmBackendConfig {
  /** OpenAI-compatible chat-completions endpoint. */
  url: string;
  /** Name of the secret env var holding the bearer token (read server-side only). */
  envKey: string;
  /** Send chat_template_kwargs.enable_thinking:false (reasoning models). Must be
   *  false for APIs that reject unknown fields (e.g. Mistral). */
  supportsThinking: boolean;
}

export interface LmModel {
  /** Stable key used by `default` / a persona's `lmModelId`. */
  id: string;
  /** Human label (for docs / a future picker). */
  label: string;
  /** Backend id — a key of `backends`. */
  backend: string;
  /** Upstream model id (HF repo or Mistral model name). */
  model: string;
  temperature: number;
  maxTokens: number;
}

interface LmCatalog {
  default: string;
  backends: Record<string, LmBackendConfig>;
  models: LmModel[];
}

const CONFIG = catalog as unknown as LmCatalog;

export const LM_BACKENDS: Record<string, LmBackendConfig> = CONFIG.backends;
export const LM_MODELS: LmModel[] = CONFIG.models;

/** Look up a backend by id (undefined if not in the catalog). */
export function resolveLmBackend(id: string): LmBackendConfig | undefined {
  return LM_BACKENDS[id];
}

/** Resolve a model by id, falling back to the catalog `default`, then the first
 *  entry — so a stale/empty id never breaks a call. */
export function resolveLmModel(id?: string): LmModel {
  return (
    (id ? LM_MODELS.find((m) => m.id === id) : undefined) ??
    LM_MODELS.find((m) => m.id === CONFIG.default) ??
    LM_MODELS[0]
  );
}

/** The catalog default — the model every cascade persona uses unless it pins one. */
export const DEFAULT_LM_MODEL: LmModel = resolveLmModel(CONFIG.default);

/** Selectable LM models for a provider's engine. Only the cascade engine draws
 *  from the catalog; every other engine is a single fixed realtime model (so the
 *  Providers view shows no model picker for them). */
export function lmModelsForEngine(engine?: string): LmModel[] {
  return engine === "cascade" ? LM_MODELS : [];
}

/** MODEL label for a provider wherever the UI shows one (sidebar, call header,
 *  transcript drawer, providers table). Cascade reflects the *picked* catalog
 *  model — not the static string in lib/data.ts, which can't know the runtime
 *  selection; every other engine has a single fixed model. */
export function providerModelLabel(
  provider: { engine?: string; model: string },
  lmModelId?: string,
): string {
  return provider.engine === "cascade"
    ? `cascade · ${resolveLmModel(lmModelId).id}`
    : provider.model;
}

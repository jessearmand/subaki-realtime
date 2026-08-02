// Catalog of fixed model ids for the realtime engines, edited as data in
// `config/realtime-models.json` — so bumping a provider's realtime model is a
// config edit, not a code change. Read by the client agent config
// (`openai-agent.ts`, which sends the model in `session.update`), the server
// mint route (`app/api/openai/token`, which scopes the ephemeral client secret
// to the same model), and the Providers UI label (`lib/data.ts`) — keeping all
// three in agreement by construction. Client-safe: model ids only, no secrets.

import catalog from "@/config/realtime-models.json";

/** OpenAI realtime model — used for the ephemeral-token mint and `session.update`. */
export const OPENAI_REALTIME_MODEL: string = catalog.openai.model;

/** OpenAI input-audio transcription model paired with the realtime model. */
export const OPENAI_TRANSCRIPTION_MODEL: string = catalog.openai.transcriptionModel;

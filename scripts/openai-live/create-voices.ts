// Creates the GPT-Live prompt-to-voice voices listed in
// config/openai-live-voices.json and writes each new voice id back into it.
//
// Idempotent: an entry that already has an id is skipped, so rerunning only
// creates what is missing. To recreate a voice, set its "id" back to null.
// Each creation saves a new voice on the organization (limit 100), and
// creating is free; speaking with it is billed as a normal GPT-Live session.
//
// Usage (from the repo root): fnox exec -- bun scripts/openai-live/create-voices.ts

import { readFile, writeFile } from "node:fs/promises";

const CONFIG_PATH = new URL("../../config/openai-live-voices.json", import.meta.url);
const VOICES_URL = "https://api.openai.com/v1/audio/voices";

interface CustomVoice {
  name: string;
  prompt: string;
  scriptHint?: string;
  id: string | null;
}

interface VoiceEntry {
  voice: string;
  custom?: CustomVoice;
}

interface VoicesConfig {
  personas: Record<string, Record<string, VoiceEntry>>;
}

async function createVoice(apiKey: string, custom: CustomVoice): Promise<string> {
  const res = await fetch(VOICES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "prompt",
      name: custom.name,
      prompt: custom.prompt,
      model: "auto",
      ...(custom.scriptHint ? { script_hint: custom.scriptHint } : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${custom.name}: ${res.status} ${text.slice(0, 300)}`);
  const id = (JSON.parse(text) as { id?: unknown }).id;
  if (typeof id !== "string") throw new Error(`${custom.name}: no id in response`);
  return id;
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set (run through fnox exec).");
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as VoicesConfig;
  let created = 0;
  const failed: string[] = [];
  for (const [persona, langs] of Object.entries(config.personas)) {
    for (const [lang, entry] of Object.entries(langs)) {
      const custom = entry.custom;
      if (!custom || custom.id) continue;
      try {
        custom.id = await createVoice(apiKey, custom);
      } catch (err) {
        // Keep going: one rejected voice shouldn't block the others.
        failed.push(err instanceof Error ? err.message : String(err));
        continue;
      }
      created++;
      console.log(`created ${persona}/${lang}: ${custom.name} → ${custom.id}`);
      // Write after each voice so a later failure keeps the ids already made.
      await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
    }
  }
  console.log(created ? `${created} voice(s) created.` : "Nothing to create.");
  if (failed.length) {
    console.error(`${failed.length} failed:\n${failed.join("\n")}`);
    process.exitCode = 1;
  }
}

await main();

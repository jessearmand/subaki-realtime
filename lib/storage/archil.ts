// Server-only: the Archil disk that stores OPENAI LIVE call transcripts.
//
// Archil exposes the disk as an S3-style object store over HTTPS, keyed by
// path, with the workspace API key (ARCHIL_API_KEY, from fnox). The disk id
// and endpoints are config (config/archil.json), not secrets. Storage is
// best-effort for calls: without the key, OPENAI LIVE calls still work, they
// just aren't stored or listed.

import { Archil, ArchilS3Error, type Disk } from "disk";
import config from "@/config/archil.json";

/** Key prefix shared by everything this app writes on the disk. */
export const ARCHIL_ROOT: string = config.root;

let diskPromise: Promise<Disk> | null = null;

export function archilConfigured(): boolean {
  return !!process.env.ARCHIL_API_KEY;
}

/** The disk, looked up once per server process (a failed lookup is retried next time). */
export function archilDisk(): Promise<Disk> {
  if (!diskPromise) {
    const client = new Archil({
      apiKey: process.env.ARCHIL_API_KEY,
      region: config.region,
      baseUrl: config.baseUrl,
      s3BaseUrl: config.s3BaseUrl,
    });
    diskPromise = client.disks.get(config.diskId).catch((err: unknown) => {
      diskPromise = null;
      throw err;
    });
  }
  return diskPromise;
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ArchilS3Error && err.status === 404;
}

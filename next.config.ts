import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating Next.js dev badge (bottom-left build/route indicator).
  // It only ever renders under `next dev` — never in a production build.
  devIndicators: false,
};

export default nextConfig;

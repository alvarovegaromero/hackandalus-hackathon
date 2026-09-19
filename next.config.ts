import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Project rules are maintained in PROJECT.md, not generated during next dev.
  agentRules: false,
  // Lets a second instance run without fighting over the build directory:
  //   NEXT_DIST_DIR=.next-dev npm run dev -- -p 3001
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async redirects() {
    return [{ source: "/landing", destination: "/", permanent: true }];
  },
};
export default nextConfig;

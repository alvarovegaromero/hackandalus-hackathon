import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Project rules are maintained in PROJECT.md, not generated during next dev.
  agentRules: false
};
export default withWorkflow(nextConfig);

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/**": ["./certs/**/*"],
  },
};

export default nextConfig;

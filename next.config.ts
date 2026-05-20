import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // World archives can be up to 500MB; raise the proxy body-size limit accordingly.
    // Default is 10MB which causes "Failed to parse body as FormData" on large uploads.
    proxyClientMaxBodySize: '500mb',
  },
};

export default nextConfig;

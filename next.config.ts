import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Addons can be up to 200MB; raise the proxy body-size limit accordingly.
    // Default is 10MB which causes "Failed to parse body as FormData" on large uploads.
    proxyClientMaxBodySize: '200mb',
  },
};

export default nextConfig;

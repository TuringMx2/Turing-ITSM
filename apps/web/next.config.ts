import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Includes multipart overhead while task files remain capped at 10 MiB in validation and Storage.
      bodySizeLimit: "11mb",
    },
  },
};

export default nextConfig;

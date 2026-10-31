import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile in a parent folder must not change which project Next treats as root.
  devIndicators: false,
  turbopack: { root: path.resolve(".") },
};

export default nextConfig;

import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    },
  },
};

export default config;

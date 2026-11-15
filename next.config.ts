import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 「Next.js のどの版か」を攻撃者に教えない
  poweredByHeader: false,
};

export default nextConfig;

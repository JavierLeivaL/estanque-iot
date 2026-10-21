/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["firebase-admin"],
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;

/** @type {import('next').NextConfig} */
const apiInternalUrl = (process.env.API_INTERNAL_URL || "http://localhost:8010").replace(/\/$/, "");

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiInternalUrl}/api/:path*`
      },
      {
        source: "/campaign/:path*",
        destination: `${apiInternalUrl}/campaign/:path*`
      }
    ];
  }
};

module.exports = nextConfig;

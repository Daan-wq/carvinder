/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@autarb/db"],
  experimental: {
    outputFileTracingIncludes: {
      "/**": ["../../packages/db/node_modules/.prisma/client/**"],
    },
  },
};

module.exports = nextConfig;

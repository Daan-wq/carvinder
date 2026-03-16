/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      "/**": [
        "../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**",
        "../../node_modules/.prisma/client/**",
      ],
    },
  },
};

module.exports = nextConfig;

import type { NextConfig } from 'next';

// Security headers for every response: no framing, no referrer, no indexing (a private tool).
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Workspace packages export TypeScript source.
  transpilePackages: ['@solaryna/core', '@solaryna/db', '@solaryna/config'],
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default nextConfig;

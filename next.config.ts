import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'oybwoawidkryladoyyyf.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // The agent's behavioral "skills" live as plain .md files under
  // src/agent/skills/ and are read at runtime via fs.readFileSync. Next's
  // file tracer doesn't follow runtime fs reads, so we explicitly include
  // the folder in the /api/agent function bundle — without this, prod
  // 500s with ENOENT when the route is first hit.
  outputFileTracingIncludes: {
    '/api/agent': ['./src/agent/skills/**/*.md'],
  },
};

export default nextConfig;

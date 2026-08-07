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
  // src/agent/skills/ and are read at runtime via fs.readFileSync (see
  // src/agent/skills/index.ts). Next's file tracer doesn't follow runtime fs
  // reads, so every function that can reach that loader has to name the folder
  // explicitly — without it, prod 500s with ENOENT the first time the route is
  // hit, and dev never reproduces it.
  //
  // "Can reach the loader" is wider than it looks. The read happens at MODULE
  // LOAD, so it fires for any route that imports runAgent even indirectly:
  //   /api/agent            → runAgent
  //   /api/agent/confirm    → continuation.ts → runAgent
  //   /api/slack/events     → runAgent
  //   /api/slack/interactivity → continuation.ts → runAgent
  // These keys are globs matched against route paths, and '/api/agent' alone
  // matches only that exact route — the three others were relying on luck.
  outputFileTracingIncludes: {
    '/api/agent': ['./src/agent/skills/**/*.md'],
    '/api/agent/**': ['./src/agent/skills/**/*.md'],
    '/api/slack/**': ['./src/agent/skills/**/*.md'],
  },
  // iPhone photos reach the model through libheif compiled to WebAssembly
  // (heic-convert -> heic-decode -> libheif-js). sharp is already in the tree
  // and would be the obvious tool, but its prebuilt libvips carries the
  // AVIF-only libheif build — it cannot decode HEIC at all.
  //
  // The emscripten glue does its own runtime resolution of the .wasm payload,
  // which the bundler rewrites into something that no longer resolves. Leaving
  // these external keeps them as plain node_modules requires at runtime. Same
  // failure shape as the skills-folder tracing above: fine in dev, ENOENT in
  // prod, on the first Slack message that happens to carry a photo.
  serverExternalPackages: ['heic-convert', 'heic-decode', 'libheif-js'],
};

export default nextConfig;

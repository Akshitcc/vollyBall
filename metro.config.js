/**
 * Metro config. Launch prep: with EXPO_PUBLIC_STRIP_DEMO=1 (set by the EAS "production" profile) the
 * demo-only modules are swapped for small stubs at resolve time, so the demo backend, its seed data,
 * the demo admin account and the QA tools are not in the shipped JavaScript at all.
 * Check it with: EXPO_PUBLIC_STRIP_DEMO=1 … npx expo export -p web && npm run check:strip
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require('expo/metro-config');

/** project-relative source path (no extension) → stub file */
const DEMO_STUBS = {
  'src/services/backend/demoBackend': 'src/stubs/demoBackend.prod.ts',
  'src/services/backend/demoSeed': 'src/stubs/demoSeed.prod.ts',
  'src/components/DemoQaTools': 'src/stubs/DemoQaTools.prod.tsx',
};

function stubFor(filePath, root = __dirname) {
  const rel = path.relative(root, filePath).split(path.sep).join('/').replace(/\.(web\.)?(tsx?|jsx?)$/, '');
  return DEMO_STUBS[rel] ? path.join(root, DEMO_STUBS[rel]) : null;
}

function withDemoStrip(config, env = process.env, root = __dirname) {
  if (env.EXPO_PUBLIC_STRIP_DEMO !== '1') return config;
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const res = upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
    if (res && res.type === 'sourceFile') {
      const stub = stubFor(res.filePath, root);
      if (stub) return { type: 'sourceFile', filePath: stub };
    }
    return res;
  };
  return config;
}

module.exports = withDemoStrip(getDefaultConfig(__dirname));
module.exports.withDemoStrip = withDemoStrip;
module.exports.DEMO_STUBS = DEMO_STUBS;

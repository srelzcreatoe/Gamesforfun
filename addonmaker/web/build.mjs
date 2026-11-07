// Bundles the UI into the Android app's assets (addonmaker/src/main/assets/www).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../src/main/assets/www');
const watch = process.argv.includes('--watch');
fs.mkdirSync(OUT, { recursive: true });

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0f1720">
<title>Mobsmith</title>
<link rel="stylesheet" href="app.css">
</head>
<body>
<div id="root"></div>
<div id="crash" hidden></div>
<script src="app.js"></script>
</body>
</html>
`;

// Older Android WebViews (before Chrome 111) don't understand color-mix().
// Emit a plain-colour fallback declaration in front of every such declaration.
const colorMixFallback = {
  name: 'color-mix-fallback',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const src = await fs.promises.readFile(args.path, 'utf8');
      const out = src.replace(/([a-z-]+):\s*([^;{}]*color-mix\([^;{}]*);/g, (m, prop, value) => {
        // Use whichever colour dominates the mix.
        const fb = value.replace(/color-mix\(in srgb,\s*([^,]+?)\s+(\d+)%,\s*([^)]+?)\)/g, (_, a, pct, b) => (Number(pct) >= 50 ? a.trim() : b.trim()));
        return fb.includes('color-mix') ? m : `${prop}: ${fb}; ${prop}: ${value};`;
      });
      return { contents: out, loader: 'css' };
    });
  },
};

const opts = {
  plugins: [colorMixFallback],
  entryPoints: [path.join(HERE, 'src/ui/main.jsx')],
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  format: 'iife',
  target: ['chrome80'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.json': 'json' },
  outfile: path.join(OUT, 'app.js'),
  legalComments: 'none',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
};

fs.writeFileSync(path.join(OUT, 'index.html'), html);
if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
} else {
  const r = await esbuild.build({ ...opts, metafile: true });
  const kb = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0);
  console.log(`app.js ${kb('app.js')} KB, app.css ${kb('app.css')} KB`);
}

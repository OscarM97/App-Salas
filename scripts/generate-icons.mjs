// Genera los PNG de la PWA a partir de los SVG de public/icons.
// Uso: npm run icons   (requiere Playwright: `npx playwright install chromium` la primera vez)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(root, 'public', 'icons');

const jobs = [
  { src: 'icon.svg', out: 'icon-192.png', size: 192 },
  { src: 'icon.svg', out: 'icon-512.png', size: 512 },
  { src: 'maskable.svg', out: 'maskable-512.png', size: 512 },
  { src: 'maskable.svg', out: 'apple-touch-icon.png', size: 180 },
  { src: 'icon.svg', out: 'favicon-48.png', size: 48 },
];

// `require` respeta NODE_PATH (Playwright instalado globalmente también sirve).
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const job of jobs) {
  const svg = await readFile(join(icons, job.src), 'utf8');
  await page.setViewportSize({ width: job.size, height: job.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${job.size}" height="${job.size}" `)}</body></html>`,
  );
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: job.size, height: job.size } });
  await writeFile(join(icons, job.out), png);
  console.log('✓', job.out);
}
await browser.close();

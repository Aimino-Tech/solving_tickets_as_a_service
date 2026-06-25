import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'dist');

async function build(): Promise<void> {
  console.log('Building STAS Marketplace Action...');

  if (!existsSync(DIST)) {
    mkdirSync(DIST, { recursive: true });
  }

  console.log('Running ncc bundle...');
  execSync(
    `npx @vercel/ncc build src/marketplace/action.ts --out dist --minify --no-cache`,
    { cwd: ROOT, stdio: 'inherit' },
  );

  const indexPath = resolve(DIST, 'index.js');
  if (!existsSync(indexPath)) {
    throw new Error('Build failed: dist/index.js not found');
  }

  const stats = execSync(`wc -c < dist/index.js`, { cwd: ROOT, encoding: 'utf-8' }).trim();
  console.log(`Build complete: ${stats} bytes`);

  const sourcesPath = resolve(DIST, 'sources.json');
  if (existsSync(sourcesPath)) {
    execSync(`rm ${sourcesPath}`, { cwd: ROOT });
    console.log('Cleaned up sources.json');
  }
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});

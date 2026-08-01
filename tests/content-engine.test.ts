import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');

function fileExists(...segments: string[]): boolean {
  return fs.existsSync(path.join(PROJECT_ROOT, ...segments));
}

function readFile(...segments: string[]): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...segments), 'utf-8');
}

function readDir(...segments: string[]): string[] {
  return fs.readdirSync(path.join(PROJECT_ROOT, ...segments));
}

function extractBlogSlugs(blogHtml: string): string[] {
  const slugs: string[] = [];
  const hrefRe = /href="\/blog\/([a-z0-9-]+)"/g;
  let match = hrefRe.exec(blogHtml);
  while (match !== null) {
    slugs.push(match[1]);
    match = hrefRe.exec(blogHtml);
  }
  return [...new Set(slugs)];
}

function extractFrontmatter(markdown: string): Record<string, string> {
  const fm = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return {};
  const fields: Record<string, string> = {};
  let currentKey = '';
  for (const line of fm[1].split('\n')) {
    const isIndented = /^[ \t]/.test(line);
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (isIndented && listItem && currentKey) {
      const value = listItem[1];
      fields[currentKey] = fields[currentKey] ? `${fields[currentKey]}, ${value}` : value;
      continue;
    }
    if (isIndented) continue; // nested keys (e.g. cross_post.devto.canonical) are not top-level fields
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    currentKey = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    // A key with only nested content (e.g. cross_post:) still marks the field as present.
    fields[currentKey] = value || 'present';
  }
  return fields;
}

describe('blog index cards reference real posts', () => {
  const blogHtml = readFile('website', 'blog.html');
  const slugs = extractBlogSlugs(blogHtml);
  const publishedFiles = readDir('website', 'blog').filter((f) => f.endsWith('.html'));

  it("indexes every card's target file", () => {
    expect(slugs.length).toBeGreaterThanOrEqual(4);
    for (const slug of slugs) {
      expect(fileExists('website', 'blog', `${slug}.html`), `missing file for /blog/${slug}`).toBe(true);
    }
  });

  it('every published post has an index card (no orphan posts)', () => {
    for (const file of publishedFiles) {
      const slug = file.replace(/\.html$/, '');
      expect(slugs, `no index card for /blog/${slug}`).toContain(slug);
    }
  });

  it('no dead links to missing posts', () => {
    const broken = slugs.filter((slug) => !fileExists('website', 'blog', `${slug}.html`));
    expect(broken).toEqual([]);
  });
});

describe('published blog posts carry SEO metadata', () => {
  const publishedFiles = readDir('website', 'blog').filter((f) => f.endsWith('.html'));

  it('at least two posts are published', () => {
    expect(publishedFiles.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of publishedFiles) {
    const slug = file.replace(/\.html$/, '');
    const html = readFile('website', 'blog', file);

    it(`${slug}: has full head + social metadata`, () => {
      expect(html).toContain(`<title>`);
      expect(html).toContain(`— STAS Blog</title>`);
      expect(html).toContain(`<meta name="description"`);
      expect(html).toContain(`<meta name="keywords"`);
      expect(html).toContain(`<meta property="og:type" content="article"`);
      expect(html).toContain(`https://syntaro.io/blog/${slug}`);
      expect(html).toContain(`<meta property="og:title"`);
      expect(html).toContain(`<meta property="og:description"`);
      expect(html).toContain(`https://syntaro.io/img/og-image.png`);
      expect(html).toContain(`<meta name="twitter:card" content="summary_large_image"`);
      expect(html).toMatch(/"@type"\s*:\s*"BlogPosting"/);
      expect(html).toMatch(/"datePublished"/);
      expect(html).toContain(`"author"`);
      expect(html).toContain(`"publisher"`);
      expect(html).toContain(`data-domain="syntaro.io"`);
    });
  }
});

describe('canonical blog markdown sources carry frontmatter', () => {
  const canonicalPosts = ['architecture-deep-dive', 'post-mortem-flask-todo-race'];

  for (const post of canonicalPosts) {
    it(`${post}.md: has complete frontmatter`, () => {
      const md = readFile('docs', 'blog', `${post}.md`);
      const fm = extractFrontmatter(md);
      expect(fm.title).toBeTruthy();
      expect(fm.description).toBeTruthy();
      expect(fm.status).toBeTruthy();
      expect(fm.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fm.canonical).toBe(`https://syntaro.io/blog/${post}`);
      expect(fm.keywords).toBeTruthy();
      expect(fm.featured_image).toBeTruthy();
      expect(fm.cross_post).toBeTruthy();
    });
  }

  it('published posts are not marked draft', () => {
    for (const post of canonicalPosts) {
      const fm = extractFrontmatter(readFile('docs', 'blog', `${post}.md`));
      expect(fm.status).not.toBe('draft');
    }
  });
});

describe('sitemap covers the blog', () => {
  const sitemap = readFile('website', 'sitemap.xml');

  it('includes the blog index', () => {
    expect(sitemap).toContain('https://syntaro.io/blog</loc>');
  });

  it('includes every blog card slug', () => {
    const blogHtml = readFile('website', 'blog.html');
    for (const slug of extractBlogSlugs(blogHtml)) {
      expect(sitemap, `sitemap missing /blog/${slug}`).toContain(`https://syntaro.io/blog/${slug}`);
    }
  });
});

describe('distribution assets exist and are actionable', () => {
  it('newsletter sponsorships doc covers target publications, budget, and UTM', () => {
    expect(fileExists('docs', 'distribution', 'newsletter-sponsorships.md')).toBe(true);
    const content = readFile('docs', 'distribution', 'newsletter-sponsorships.md');
    expect(content).toContain('TLDR');
    expect(content).toContain('Python Weekly');
    expect(content).toContain('ByteSized');
    expect(content).toMatch(/utm_source=/);
    expect(content).toMatch(/CPC/);
  });

  it('tweet threads doc contains ready-to-post before/after threads', () => {
    expect(fileExists('docs', 'distribution', 'tweet-threads.md')).toBe(true);
    const content = readFile('docs', 'distribution', 'tweet-threads.md');
    expect(content).toMatch(/before/i);
    expect(content).toMatch(/after/i);
    expect(content).toMatch(/utm_source=/);
    expect(content.length).toBeGreaterThan(1500);
  });

  it('guest posts doc covers dev.to, HackerNoon, and InfoQ', () => {
    expect(fileExists('docs', 'distribution', 'guest-posts.md')).toBe(true);
    const content = readFile('docs', 'distribution', 'guest-posts.md');
    expect(content).toMatch(/dev\.to/);
    expect(content).toMatch(/HackerNoon/);
    expect(content).toMatch(/InfoQ/);
  });

  it('phase 4 content engine doc exists and captures success metrics', () => {
    expect(fileExists('docs', 'stas', 'growth-initiative-phase-4-content-engine.md')).toBe(true);
    const content = readFile('docs', 'stas', 'growth-initiative-phase-4-content-engine.md');
    expect(content).toMatch(/5,?000/);
    expect(content).toMatch(/CPC/);
  });
});

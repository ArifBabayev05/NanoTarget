#!/usr/bin/env node
// Writes the search and answer-engine block into the <head> of every public page: title, description, canonical,
// Open Graph, Twitter card and JSON-LD (organisation, website, software, FAQ, article, dataset). Questions are read
// from the page itself, so the structured data always matches what a visitor sees.
//   node scripts/seo.mjs          rewrite the pages
//   node scripts/seo.mjs --check  exit 1 if a page is out of date (run by the tests)
import { readFileSync, writeFileSync } from 'node:fs';

const SITE = 'https://onehuman.ai';
const pkg = JSON.parse(readFileSync(new URL('../packages/onehumanai/package.json', import.meta.url), 'utf8'));
const IMAGE = `${SITE}/og.png`;
const SAME_AS = ['https://github.com/OneHumanAI/onehumanai', 'https://github.com/OneHumanAI', 'https://www.npmjs.com/package/onehumanai'];

const PAGES = [
  {
    file: 'index.html', path: '/',
    title: 'OneHuman · Control the AI agents your customers bring',
    description: 'OneHuman detects AI agents like Claude in Chrome, ChatGPT agent and Codex inside signed-in sessions, hides private data, waits for the owner\'s passkey on payments and exports, and signs every decision.',
    og: 'Control the AI agents your customers bring. Prove what a person approved.',
    faq: '<section class="faq"',
    extra: () => [{
      '@type': 'SoftwareApplication', '@id': `${SITE}/#software`, name: 'OneHuman', url: `${SITE}/`,
      applicationCategory: 'SecurityApplication', applicationSubCategory: 'AI agent detection and access control',
      operatingSystem: 'Node.js 22.13 or newer', softwareVersion: pkg.version, image: IMAGE,
      description: 'Controls the AI agents customers bring into a web app: Node.js middleware and browser SDK that detects an AI browser agent inside a signed-in session and decides per endpoint whether to allow it, hide private fields, wait for the account owner\'s passkey approval, or keep it closed, with a signed proof of every decision.',
      featureList: ['Detects AI browser agents (Claude in Chrome, ChatGPT agent, OpenAI Codex, Perplexity Comet, Playwright, Puppeteer) inside a signed-in session', 'Per-click check that tells a human hand from a program', 'Per-endpoint policy: allow, hide private fields, wait for the owner\'s passkey approval, never share', 'Redacts sensitive data on screen the moment an agent attaches', 'Ed25519-signed proof of every decision, verifiable offline',
        'Only the account owner\'s passkey approves an action an agent asked for; the agent cannot complete that step', 'Web Bot Auth signature verification', 'Runs on your own server; one-command setup with npx onehumanai init'],
      downloadUrl: 'https://www.npmjs.com/package/onehumanai', installUrl: 'https://www.npmjs.com/package/onehumanai',
      license: 'https://github.com/OneHumanAI/onehumanai/blob/main/LICENSE',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      publisher: { '@id': `${SITE}/#org` },
      sameAs: SAME_AS,
    }],
  },
  {
    file: 'docs.html', path: '/docs',
    title: 'OneHuman docs · Protect endpoints from AI browser agents in Node.js',
    description: 'Install OneHuman with npx onehumanai init, write a policy per endpoint (allow, mask, step up, block), and verify it. Concepts, API reference and the protocol for AI coding agents.',
    faq: '<section id="faq">', type: 'TechArticle', crumb: 'Docs',
  },
  {
    file: 'scorecard.html', path: '/scorecard',
    title: 'AI agent scorecard · Claude, Codex, Playwright against a protected page · OneHuman',
    description: 'What happens when today\u2019s AI browser agents (Claude in Chrome, Claude desktop, OpenAI Codex, Playwright, Puppeteer, human-like cursor bots) open a signed-in page protected by OneHuman. Every result, including what gets through.',
    type: 'Article', crumb: 'Agent scorecard',
  },
  {
    file: 'measurements.html', path: '/measurements',
    title: 'How we measured · human and AI agent clicks · OneHuman',
    description: 'How every number on onehuman.ai was measured: 397 human clicks from 22 browsers and devices, 824 AI agent clicks, how the data was collected, how it was evaluated and where the method fails.',
    type: 'Article', crumb: 'How we measured',
    extra: (p) => [{
      '@type': 'Dataset', name: 'OneHuman human and AI agent click measurements', url: SITE + p.path,
      description: 'Pointer and click measurements used to evaluate OneHuman: 397 human clicks from 22 browser and device installations and 824 AI agent clicks (224 from real agent products, 600 generated human-like cursor paths), collected in September 2026. Summary statistics only; raw data is not published.',
      creator: { '@id': `${SITE}/#org` }, temporalCoverage: '2026-09',
      measurementTechnique: 'Grouped five-fold cross-validation by device; per-click evaluation plus 15 full sessions replayed through the engine',
      isAccessibleForFree: true,
    }],
  },
  {
    file: 'trust.html', path: '/trust',
    title: 'Trust and privacy · what OneHuman stores and never collects',
    description: 'What OneHuman keeps on your server, what leaves it only when you add an API key, and what is never collected. Sub-processors, retention and offline proof verification, written for security and legal reviewers.',
    faq: 'Questions a reviewer asks', type: 'WebPage', crumb: 'Trust and privacy',
  },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** Question/answer pairs from the section that starts at `marker`: <details><summary>/<p> or <dt>/<dd>. */
function questions(html, marker) {
  const at = html.indexOf(marker); if (at < 0) throw new Error(`FAQ marker not found: ${marker}`);
  const end = html.indexOf('</section>', at) > 0 && marker.startsWith('<section') ? html.indexOf('</section>', at) : html.indexOf('</dl>', at);
  const part = html.slice(at, end);
  const out = [];
  for (const m of part.matchAll(/<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)) out.push([m[1], m[2]]);
  for (const m of part.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) out.push([m[1], m[2]]);
  if (!out.length) throw new Error(`no questions after ${marker}`);
  return out.map(([q, a]) => ({ '@type': 'Question', name: text(q), acceptedAnswer: { '@type': 'Answer', text: text(a) } }));
}

function block(p, html) {
  const url = SITE + p.path;
  const graph = [
    { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'OneHuman', url: `${SITE}/`, logo: `${SITE}/apple-touch-icon.png`, sameAs: SAME_AS, email: 'security@onehuman.ai' },
    { '@type': 'WebSite', '@id': `${SITE}/#website`, name: 'OneHuman', url: `${SITE}/`, publisher: { '@id': `${SITE}/#org` }, inLanguage: 'en' },
  ];
  if (p.type) graph.push({ '@type': p.type, '@id': `${url}#page`, headline: p.title, name: p.title, description: p.description, url, image: IMAGE, inLanguage: 'en', isPartOf: { '@id': `${SITE}/#website` }, publisher: { '@id': `${SITE}/#org` }, ...(p.type !== 'WebPage' ? { author: { '@id': `${SITE}/#org` } } : {}), about: { '@id': `${SITE}/#software` } });
  if (p.crumb) graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'OneHuman', item: `${SITE}/` }, { '@type': 'ListItem', position: 2, name: p.crumb, item: url }] });
  if (p.extra) graph.push(...p.extra(p));
  if (p.faq) graph.push({ '@type': 'FAQPage', '@id': `${url}#faq`, url, mainEntity: questions(html, p.faq) });
  const og = p.og ?? p.description;
  return [
    '<!-- seo:start (generated by scripts/seo.mjs) -->',
    `<title>${esc(p.title)}</title>`,
    `<meta name="description" content="${esc(p.description)}">`,
    `<link rel="canonical" href="${url}">`,
    '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">',
    '<meta name="theme-color" content="#0a0a0b">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="OneHuman">',
    `<meta property="og:title" content="${esc(p.title)}">`,
    `<meta property="og:description" content="${esc(og)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${IMAGE}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="OneHuman: prove who approved what.">',
    '<meta property="og:locale" content="en_US">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(p.title)}">`,
    `<meta name="twitter:description" content="${esc(og)}">`,
    `<meta name="twitter:image" content="${IMAGE}">`,
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
    '<link rel="alternate" type="text/plain" title="LLM summary" href="/llms.txt">',
    `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`,
    '<!-- seo:end -->',
  ].join('\n');
}

// Tags the block owns; any copy of them outside the block is removed so a page never has two.
const OWNED = [/<title>[\s\S]*?<\/title>\n?/g, /<meta name="description"[^>]*>\n?/g, /<link rel="canonical"[^>]*>\n?/g, /<meta name="robots"[^>]*>\n?/g, /<meta name="theme-color"[^>]*>\n?/g,
  /<meta property="og:[^"]+"[^>]*>\n?/g, /<meta name="twitter:[^"]+"[^>]*>\n?/g, /<link rel="apple-touch-icon"[^>]*>\n?/g, /<link rel="manifest"[^>]*>\n?/g, /<link rel="alternate" type="text\/plain"[^>]*>\n?/g];

const check = process.argv.includes('--check');
let stale = 0;
for (const p of PAGES) {
  const file = new URL(`../web/${p.file}`, import.meta.url);
  const before = readFileSync(file, 'utf8');
  let html = before.replace(/<!-- seo:start[\s\S]*?<!-- seo:end -->\n?/, '');
  for (const re of OWNED) html = html.replace(re, '');
  html = html.replace(/(<meta name="viewport"[^>]*>\n)/, `$1${block(p, html)}\n`);
  if (html === before) continue;
  stale++;
  if (check) console.error(`out of date: web/${p.file} (run node scripts/seo.mjs)`);
  else { writeFileSync(file, html); console.log(`updated web/${p.file}`); }
}
if (check && stale) process.exit(1);

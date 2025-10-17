// crawler.js
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import PQueue from 'p-queue';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';

let browser = null;
let initPromise = null;

/**
 * Initialize single browser instance (idempotent)
 */
export async function initBrowser() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    // Launch browser with sandbox flags for container environments
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    console.log('Browser launched');
    return browser;
  })();
  return initPromise;
}

/**
 * Shutdown browser gracefully
 */
export async function shutdownBrowser() {
  if (browser) {
    try {
      await browser.close();
      browser = null;
      console.log('Browser closed');
    } catch (err) {
      console.error('Error closing browser:', err);
    }
  }
}

/**
 * Simple static asset filter
 */
function isStaticAsset(url) {
  if (!url) return false;
  const staticExt = /\.(jpg|jpeg|png|gif|svg|ico|webp|css|js|woff|woff2|ttf|eot|map)(\?.*)?$/i;
  return staticExt.test(new URL(url, 'http://example.com').pathname);
}

/**
 * Crawl a URL limited by depth and concurrency.
 * Returns an object { pages: [{url, title, status}], apiEndpoints: [] } etc.
 */
export async function crawl(startUrl, opts = {}) {
  await initBrowser();
  const concurrency = Math.max(1, opts.concurrency || 5);
  const maxDepth = Math.max(1, opts.depth || 2);
  const filterStatic = opts.filterStatic ?? true;
  const limitToSameOrigin = opts.sameOrigin ?? true;

  const queue = new PQueue({ concurrency });
  const visited = new Set();
  const results = [];
  const apiEndpoints = new Set();

  // Normalize origin for same-origin filtering
  let startOrigin;
  try {
    startOrigin = new URL(startUrl).origin;
  } catch (err) {
    throw new Error('Invalid startUrl');
  }

  // BFS-like function that enqueues link crawling tasks
  async function enqueue(url, depth) {
    if (visited.has(url)) return;
    visited.add(url);
    await queue.add(() => processPage(url, depth));
  }

  async function processPage(url, depth) {
    // optional filter static extensions quickly
    if (filterStatic && isStaticAsset(url)) {
      return;
    }
    if (limitToSameOrigin && new URL(url).origin !== startOrigin) {
      // skip external origins
      return;
    }

    const context = await browser.newContext(); // isolates cookies/storage
    const page = await context.newPage();
    try {
      // intercept responses to record API-like responses
      page.on('response', async (response) => {
        const rUrl = response.url();
        // crude check for JSON content or xhr/fetch
        const ct = response.headers()['content-type'] || '';
        if (ct.includes('application/json') || rUrl.match(/\/api\/|api=|graphql/gi)) {
          apiEndpoints.add(rUrl);
        }
      });

      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => null);
      const status = resp ? resp.status() : null;
      const title = await page.title().catch(() => '');

      results.push({ url, title, status, depth });

      if (depth < maxDepth) {
        // collect links on page
        const hrefs = await page.$$eval('a[href]', (els) => els.map(a => a.href).filter(Boolean));
        for (const h of hrefs) {
          try {
            // Normalize anchor-only links
            const absolute = new URL(h, url).toString();
            if (filterStatic && isStaticAsset(absolute)) continue;
            if (!visited.has(absolute)) {
              // enqueue next depth
              await enqueue(absolute, depth + 1);
            }
          } catch (err) {
            // ignore malformed URLs
          }
        }
      }
    } catch (err) {
      console.error('Error processing', url, err?.message || err);
    } finally {
      await page.close().catch(()=>{});
      await context.close().catch(()=>{});
    }
  }

  // start
  await enqueue(startUrl, 1);
  // wait for all tasks
  await queue.onIdle();

  return {
    pages: results,
    apiEndpoints: Array.from(apiEndpoints),
    visitedCount: visited.size,
  };
}

/**
 * Utility: write results to CSV and return file path
 */
export async function writeCsv(results, filenamePrefix='crawl') {
  const timestamp = Date.now();
  const filename = `${filenamePrefix}-${timestamp}.csv`;
  const filepath = path.resolve('/tmp', filename);

  const csvWriter = createCsvWriter({
    path: filepath,
    header: [
      { id: 'url', title: 'URL' },
      { id: 'title', title: 'Title' },
      { id: 'status', title: 'Status' },
      { id: 'depth', title: 'Depth' },
    ],
  });

  await csvWriter.writeRecords(results.pages || []);
  return filepath;
}

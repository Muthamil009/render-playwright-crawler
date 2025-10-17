// crawler.js
const { chromium } = require('playwright');
const fs = require('fs').promises;

// Configuration options
const CONFIG = {
  maxDepth: 2,
  concurrency: 3,
  ignoreAssets: true,
  outputFormat: 'json', // 'json' or 'csv'
  assetExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.css', '.js', '.svg', '.ico']
};

async function shouldIgnoreUrl(url) {
  if (!CONFIG.ignoreAssets) return false;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return CONFIG.assetExtensions.some(ext => pathname.endsWith(ext));
  } catch (e) {
    return false;
  }
}

async function crawl(urls, browser, visited = new Set(), depth = CONFIG.maxDepth) {
  if (depth < 0) return [];
  
  // Filter out already visited URLs
  const newUrls = urls.filter(url => !visited.has(url));
  if (newUrls.length === 0) return [];

  // Process URLs in chunks based on concurrency
  const chunks = [];
  for (let i = 0; i < newUrls.length; i += CONFIG.concurrency) {
    chunks.push(newUrls.slice(i, i + CONFIG.concurrency));
  }

  const results = [];
  for (const chunk of chunks) {
    const promises = chunk.map(async url => {
      visited.add(url);
      const page = await browser.newPage();
      const endpoints = new Set();
      const origin = new URL(url).origin;

      page.on('request', request => {
        const reqUrl = request.url();
        if (!reqUrl.startsWith('data:') && 
            reqUrl.startsWith(origin) && 
            !shouldIgnoreUrl(reqUrl)) {
          endpoints.add(reqUrl);
        }
      });

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        const forms = await page.$$eval('form', forms => forms.map(f => ({
          action: f.action,
          fields: Array.from(f.querySelectorAll('input, textarea, select')).map(i => ({
            name: i.name || '(no name)',
            type: i.type || i.tagName.toLowerCase()
          }))
        })));

        const links = await page.$$eval('a', anchors =>
          anchors.map(a => a.href).filter(href => href && href.startsWith(origin))
        );

        await page.close();

        // Recursively crawl found links
        const subResults = await crawl(links, browser, visited, depth - 1);
        
        return [{
          pageUrl: url,
          forms,
          apiEndpoints: Array.from(endpoints)
        }, ...subResults];

      } catch (e) {
        await page.close();
        return [];
      }
    });

    const chunkResults = await Promise.all(promises);
    results.push(...chunkResults.flat());
  }

  return results;
}

async function outputResults(data, format) {
  if (format === 'csv') {
    let csv = 'Page URL,Form Action,Form Fields,API Endpoints\n';
    data.forEach(page => {
      const forms = page.forms.map(f => 
        `${f.action}(${f.fields.map(field => `${field.name}:${field.type}`).join(';')})`
      ).join('|');
      csv += `"${page.pageUrl}","${forms}","${page.apiEndpoints.join('|')}"\n`;
    });
    await fs.writeFile('crawler-output.csv', csv);
    return 'crawler-output.csv';
  } else {
    await fs.writeFile('crawler-output.json', JSON.stringify(data, null, 2));
    return 'crawler-output.json';
  }
}

async function main() {
  const startUrl = process.argv[2];
  if (!startUrl) {
    console.error("Usage: node crawler.js <URL> [options]");
    process.exit(1);
  }

  // Parse command line options
  process.argv.slice(3).forEach(arg => {
    const [key, value] = arg.split('=');
    switch(key) {
      case '--depth': CONFIG.maxDepth = parseInt(value); break;
      case '--concurrency': CONFIG.concurrency = parseInt(value); break;
      case '--ignore-assets': CONFIG.ignoreAssets = value === 'true'; break;
      case '--format': CONFIG.outputFormat = value; break;
    }
  });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const data = await crawl([startUrl], browser, new Set());
    const outputFile = await outputResults(data, CONFIG.outputFormat);
    console.log(`Crawl complete! Results saved to ${outputFile}`);
    await browser.close();
  } catch (e) {
    console.error('Crawl failed:', e);
    await browser.close();
    process.exit(1);
  }
}

main();
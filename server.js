// server.js
import express from 'express';
import bodyParser from 'body-parser';
import { initBrowser, shutdownBrowser, crawl, writeCsv } from './crawler.js';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

let activeJobs = 0;

// init browser once at startup
initBrowser().catch(err => {
  console.error('Failed to init browser at startup', err);
});

// GET /health - simple liveness
app.get('/health', (req, res) => res.json({ ok: true, activeJobs }));

// GET /status - more info
app.get('/status', (req, res) => res.json({ ok: true, activeJobs }));

/**
 * POST /crawl
 * Body JSON: { url: string, depth?: number, concurrency?: number, filterStatic?: boolean, csv?: boolean }
 * Or use GET query params
 */
app.all('/crawl', async (req, res) => {
  try {
    const q = (req.method === 'GET') ? req.query : req.body;
    const startUrl = q.url;
    if (!startUrl) return res.status(400).json({ error: 'Missing url parameter' });

    const depth = q.depth ? parseInt(q.depth) : undefined;
    const concurrency = q.concurrency ? parseInt(q.concurrency) : undefined;
    const filterStatic = typeof q.filterStatic === 'undefined' ? true : (q.filterStatic === 'true' || q.filterStatic === true);
    const csv = q.csv === 'true' || q.csv === true;

    activeJobs++;
    console.log(`Starting crawl: ${startUrl} (depth=${depth}, concurrency=${concurrency})`);

    const result = await crawl(startUrl, { depth, concurrency, filterStatic });

    activeJobs--;
    if (csv) {
      const filepath = await writeCsv(result, 'crawl-results');
      // stream file as attachment
      return res.download(filepath, (err) => {
        if (err) {
          console.error('Error sending CSV', err);
          res.status(500).end();
        } else {
          // optionally remove file after download
          fs.unlink(filepath, ()=>{});
        }
      });
    }

    return res.json(result);
  } catch (err) {
    activeJobs = Math.max(0, activeJobs - 1);
    console.error('Crawl error', err);
    return res.status(500).json({ error: err.message || 'unknown' });
  }
});

// A shutdown endpoint for admin (protected in prod!)
app.post('/shutdown', async (req, res) => {
  res.json({ ok: true, msg: 'Shutting down' });
  // graceful shutdown
  await shutdownBrowser();
  process.exit(0);
});

// Graceful close on process signals
process.on('SIGTERM', async () => {
  console.log('SIGTERM received — closing browser');
  await shutdownBrowser();
  process.exit(0);
});
process.on('SIGINT', async () => {
  console.log('SIGINT received — closing browser');
  await shutdownBrowser();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Crawler service listening on ${PORT}`);
});

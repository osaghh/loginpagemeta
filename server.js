import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import sanitizeHtml from 'sanitize-html';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ----- Security / middleware -----
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false // we'll keep CSP simple for the demo
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(compression());
app.use(morgan('tiny'));

// ----- Rate limiting (basic) -----
const limiter = new RateLimiterMemory({
  points: 20, // 20 requests
  duration: 60 // per 60 seconds per IP
});
app.use(async (req, res, next) => {
  try {
    await limiter.consume(req.ip);
    next();
  } catch {
    res.status(429).json({ error: 'Too many requests. Try again shortly.' });
  }
});

// ----- Static frontend -----
app.use(express.static(path.join(__dirname, 'public')));

// Utilities
const isInstagramUrl = (url) => {
  try {
    const u = new URL(url);
    return /(^|\.)instagram\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
};

const normalizeUrl = (url) => {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url.split('?')[0]; // remove query for stability
};

// Core scraper: extracts media URLs using meta tags + fallback scan
async function scrapeInstagramMedia(targetUrl) {
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--no-zygote',
    '--disable-dev-shm-usage'
  ];

  const browser = await puppeteer.launch({
    args: launchArgs,
    headless: 'new'
  });

  try {
    const page = await browser.newPage();

    // Pretend to be a regular browser
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Grab essential metadata + og tags first
    const base = await page.evaluate(() => {
      const pick = (sel, attr) => {
        const el = document.querySelector(sel);
        return el ? el.getAttribute(attr) : null;
      };
      const title = pick('meta[property="og:title"]', 'content') ||
                    document.title || '';
      const description = pick('meta[property="og:description"]', 'content') || '';
      const image = pick('meta[property="og:image"]', 'content');
      const video = pick('meta[property="og:video"]', 'content') ||
                    pick('meta[property="og:video:secure_url"]', 'content');

      // ld+json sometimes contains richer info
      const ldNodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      const ldjson = ldNodes.map(n => {
        try { return JSON.parse(n.textContent || '{}'); } catch { return null; }
      }).filter(Boolean);

      return { title, description, image, video, ldjson };
    });

    // Start building media list
    const media = [];
    if (base.video) media.push({ type: 'video', url: base.video });
    if (base.image) media.push({ type: 'image', url: base.image });

    // Fallback: scan HTML for CDN media (captures carousels in many cases)
    const html = await page.content();

    // crude collectors for display_url (jpg) & video_url (mp4)
    const jpgs = Array.from(new Set(
      [...html.matchAll(/https:\/\/[^"']+?\.jpg/gi)].map(m => m[0])
        .filter(u => /fbcdn|cdninstagram/.test(u))
    ));
    const mp4s = Array.from(new Set(
      [...html.matchAll(/https:\/\/[^"']+?\.mp4/gi)].map(m => m[0])
        .filter(u => /fbcdn|cdninstagram/.test(u))
    ));

    // Add unique items not already present
    const known = new Set(media.map(m => m.url));
    for (const v of mp4s) if (!known.has(v)) { media.push({ type: 'video', url: v }); known.add(v); }
    for (const p of jpgs) if (!known.has(p)) { media.push({ type: 'image', url: p }); known.add(p); }

    // Best-effort author/shortcode
    const inferred = await page.evaluate(() => {
      const url = location.href;
      const m = url.match(/instagram\.com\/(p|reel|tv)\/([^\/?#]+)/i);
      const shortcode = m ? m[2] : null;

      let author = null;
      const metaDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
      // og:description usually like: “username on Instagram: ...”
      const am = metaDesc.match(/^([A-Za-z0-9._]+)\son\sInstagram/i);
      if (am) author = am[1];

      return { shortcode, author };
    });

    // Sanitize title/description for safety
    const title = sanitizeHtml(base.title || '', { allowedTags: [], allowedAttributes: {} }).trim();
    const description = sanitizeHtml(base.description || '', { allowedTags: [], allowedAttributes: {} }).trim();

    return {
      ok: media.length > 0,
      url: targetUrl,
      author: inferred.author || null,
      shortcode: inferred.shortcode || null,
      title: title || (inferred.shortcode ? `Instagram ${inferred.shortcode}` : 'Instagram'),
      description,
      count: media.length,
      media
    };
  } finally {
    await browser.close();
  }
}

// API: resolve media
app.post('/api/resolve', async (req, res) => {
  try {
    const rawUrl = (req.body?.url || '').trim();
    const target = normalizeUrl(rawUrl);

    if (!rawUrl || !isInstagramUrl(target)) {
      return res.status(400).json({ error: 'Provide a valid instagram.com post/reel URL.' });
    }

    const result = await scrapeInstagramMedia(target);
    if (!result.ok) {
      return res.status(404).json({ error: 'No downloadable media found on that URL.' });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to resolve media.' });
  }
});

// API: proxy download (streams file with a nice filename)
app.get('/api/download', async (req, res) => {
  try {
    const src = (req.query.src || '').toString();
    const type = (req.query.type || 'file').toString(); // image | video | file
    const name = (req.query.name || 'instagram').toString().replace(/[^a-z0-9._-]/gi, '_');

    if (!/^https?:\/\//i.test(src) || !/fbcdn|cdninstagram/.test(src)) {
      return res.status(400).json({ error: 'Invalid source URL.' });
    }

    const r = await fetch(src);
    if (!r.ok) return res.status(502).json({ error: 'Upstream error fetching media.' });

    const contentType = r.headers.get('content-type') || 'application/octet-stream';
    const ext = contentType.includes('mp4') ? 'mp4'
              : contentType.includes('jpeg') ? 'jpg'
              : contentType.includes('png') ? 'png'
              : contentType.includes('webp') ? 'webp'
              : 'bin';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${name}.${ext}"`);
    r.body.pipe(res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to download media.' });
  }
});

// Health
app.get('/healthz', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('IG Downloader listening on :' + PORT);
});

async function scrapeInstagramMedia(targetUrl) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--no-zygote',
      '--disable-dev-shm-usage'
    ]
  });

  try {
    const page = await browser.newPage();

    // Pretend to be a real Chrome browser
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    // Avoid IG’s login wall as much as possible
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // First, try OpenGraph tags (Instagram still sets these for public posts)
    const meta = await page.evaluate(() => {
      const pick = (prop) =>
        document.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') || null;

      return {
        title: pick('og:title'),
        description: pick('og:description'),
        image: pick('og:image'),
        video: pick('og:video') || pick('og:video:secure_url')
      };
    });

    const media = [];
    if (meta.video) media.push({ type: 'video', url: meta.video });
    if (meta.image) media.push({ type: 'image', url: meta.image });

    // If OG tags fail, scan the HTML for .jpg / .mp4
    if (media.length === 0) {
      const html = await page.content();

      const jpgs = [...html.matchAll(/https:\/\/[^"']+\.jpg/gi)].map(m => m[0]);
      const mp4s = [...html.matchAll(/https:\/\/[^"']+\.mp4/gi)].map(m => m[0]);

      for (const j of jpgs) media.push({ type: 'image', url: j });
      for (const v of mp4s) media.push({ type: 'video', url: v });
    }

    return {
      ok: media.length > 0,
      title: meta.title || 'Instagram',
      description: meta.description || '',
      count: media.length,
      media
    };
  } finally {
    await browser.close();
  }
}

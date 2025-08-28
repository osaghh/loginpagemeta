const express = require("express");
const puppeteer = require("puppeteer");
const chromium = require("@sparticuz/chromium");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// Helper: scrape media
async function scrapeInstagram(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Look for image or video tags
    const data = await page.evaluate(() => {
      const video = document.querySelector("video");
      if (video && video.src) {
        return { type: "video", url: video.src };
      }
      const img = document.querySelector("img");
      if (img && img.src) {
        return { type: "image", url: img.src };
      }
      return null;
    });

    return data;
  } catch (err) {
    console.error("Scraping failed:", err);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// API route
app.get("/api/download", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing Instagram URL" });

  const result = await scrapeInstagram(url);
  if (!result) {
    return res.status(500).json({ error: "Could not fetch media" });
  }

  res.json(result);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

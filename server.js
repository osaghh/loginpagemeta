import express from "express";
import puppeteer from "puppeteer";
import chromium from "@sparticuz/chromium";

const app = express();

app.get("/", (req, res) => {
  res.send("✅ IG Downloader is running!");
});

app.get("/download", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing ?url=");

  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2" });

    const title = await page.title();
    await browser.close();

    res.json({ title });
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch content");
  }
});

// 🚨 Must use Render’s PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

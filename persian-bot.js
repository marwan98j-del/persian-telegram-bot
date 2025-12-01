// anf-persian.js (CommonJS version)
const Parser = require("rss-parser");
const axios = require("axios");
const dotenv = require("dotenv");
const fs = require("fs");
const { URL } = require("url");

dotenv.config();

const parser = new Parser();

// Env
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const FEED_URL = process.env.FEED_URL;
const POSTED_FILE = "./posted.json";

const MAX_POSTED = parseInt(process.env.MAX_POSTED || "500", 10);
const POLL_INTERVAL_SECONDS = parseInt(process.env.POLL_INTERVAL_SECONDS || "60", 10);

// sanity checks
if (!BOT_TOKEN || !CHANNEL_ID || !FEED_URL) {
  console.error("❌ Missing environment variables. Please set BOT_TOKEN, CHANNEL_ID and FEED_URL in your .env.");
  process.exit(1);
}

// Load posted links
let posted = [];
if (fs.existsSync(POSTED_FILE)) {
  try {
    posted = JSON.parse(fs.readFileSync(POSTED_FILE, "utf8"));
  } catch (e) {
    console.warn("⚠️ Could not parse posted.json, starting fresh.");
  }
}
function savePosted() {
  try {
    fs.writeFileSync(POSTED_FILE, JSON.stringify(posted, null, 2));
  } catch (e) {
    console.error("❌ Failed to save posted.json:", e?.message || e);
  }
}

// Escape MarkdownV2
function escapeMarkdownV2(text = "") {
  return text
    .toString()
    .replace(/([\_\*\[\]\(\)\~\`\>\#\+\-\=\|\{\}\.\!])/g, "\\$1");
}

// Social links (updated)
const socialLinksArray = [
  { name: "Telegram", url: "https://t.me/ANF_FarsiChannel" },
  { name: "Instagram", url: "http://www.instagram.com/anf_persian" },
  { name: "Facebook", url: "http://facebook.com/anfpersianofficial" },
  { name: "X", url: "http://twitter.com/ANF_persian" },
  { name: "webSite", url: "http://anfpersian.com/" }
];
const socialLinks = socialLinksArray
  .map(link => `[${escapeMarkdownV2(link.name)}](${link.url})`)
  .join(" \\| ");

// Decode HTML entities
function decodeEntities(str) {
  if (!str) return "";
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// Strip HTML and decode
function stripHtmlAndDecode(str = "") {
  return decodeEntities(str).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function checkFeed() {
  try {
    const feed = await parser.parseURL(FEED_URL);

    for (const item of feed.items) {
      const rawLink = item.link || "";
      let link;
      try {
        link = new URL(rawLink, FEED_URL).toString().trim();
      } catch {
        link = (rawLink || "").trim();
      }

      // Duplicate check
      if (posted.includes(link)) {
        console.log("⏩ Skipped duplicate:", item.title || link);
        continue;
      }

      // Extract first sentence
      const snippetSource = item.contentSnippet || item.content || "";
      const snippetText = stripHtmlAndDecode(snippetSource);
      const firstSentence = (snippetText.split(/[\.\!\?؟]/)[0] || "").trim();

      // Build message
      const message = `*${escapeMarkdownV2((item.title || "").trim())}*\n\n${escapeMarkdownV2(firstSentence)}\n\n[مطالعه خبر](${link})\n\n${socialLinks}`;

      // Send to Telegram
      try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          chat_id: CHANNEL_ID,
          text: message,
          parse_mode: "MarkdownV2",
          disable_web_page_preview: false
        });
        console.log("✅ Posted:", item.title || link);

        // Save posted
        posted.push(link);
        if (posted.length > MAX_POSTED) posted = posted.slice(-MAX_POSTED);
        savePosted();
      } catch (err) {
        console.error("❌ Telegram API error:", err.response?.data || err.message || err);
      }
    }
  } catch (err) {
    console.error("❌ Error fetching feed:", err.message || err);
  }
}

// Start
checkFeed();
setInterval(checkFeed, POLL_INTERVAL_SECONDS * 1000);

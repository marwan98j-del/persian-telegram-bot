// persian-bot.js
// Automatically posts new Persian ANF RSS articles with Telegram Instant View.

const Parser = require("rss-parser");
const axios = require("axios");
const dotenv = require("dotenv");
const fs = require("fs");
const { URL } = require("url");

dotenv.config();

const parser = new Parser();

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const FEED_URL = process.env.FEED_URL;

// Your working Telegram Instant View template
const INSTANT_VIEW_RHASH =
  process.env.INSTANT_VIEW_RHASH || "cb93cf5b90b9dc";

const POSTED_FILE = "./posted.json";

const MAX_POSTED = Number.parseInt(
  process.env.MAX_POSTED || "500",
  10
);

const POLL_INTERVAL_SECONDS = Number.parseInt(
  process.env.POLL_INTERVAL_SECONDS || "60",
  10
);

// Required settings check
if (!BOT_TOKEN || !CHANNEL_ID || !FEED_URL) {
  console.error(
    "❌ Missing BOT_TOKEN, CHANNEL_ID or FEED_URL."
  );
  process.exit(1);
}

// Load previously posted URLs
let posted = [];

if (fs.existsSync(POSTED_FILE)) {
  try {
    const savedData = JSON.parse(
      fs.readFileSync(POSTED_FILE, "utf8")
    );

    if (Array.isArray(savedData)) {
      posted = savedData;
    }
  } catch (error) {
    console.warn(
      "⚠️ Could not read posted.json. Starting with an empty list."
    );
  }
}

// Save posted URLs
function savePosted() {
  try {
    fs.writeFileSync(
      POSTED_FILE,
      JSON.stringify(posted, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error(
      "❌ Could not save posted.json:",
      error.message
    );
  }
}

// Escape normal text for Telegram MarkdownV2
function escapeMarkdownV2(text = "") {
  return text
    .toString()
    .replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// Escape URLs used inside MarkdownV2 links
function escapeMarkdownUrl(url = "") {
  return url
    .toString()
    .replace(/\\/g, "\\\\")
    .replace(/\)/g, "\\)");
}

// Decode common HTML entities
function decodeEntities(text = "") {
  return text
    .replace(/&#(\d+);/g, (_, number) =>
      String.fromCodePoint(Number.parseInt(number, 10))
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// Remove HTML tags and extra spaces
function stripHtmlAndDecode(text = "") {
  return decodeEntities(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Create the special Telegram Instant View URL
function makeInstantViewUrl(articleUrl) {
  const encodedArticleUrl = encodeURIComponent(articleUrl);

  return (
    `https://t.me/iv?url=${encodedArticleUrl}` +
    `&rhash=${INSTANT_VIEW_RHASH}`
  );
}

// Social links
const socialLinksArray = [
  {
    name: "Telegram",
    url: "https://t.me/ANF_FarsiChannel"
  },
  {
    name: "Instagram",
    url: "https://www.instagram.com/anf_persian"
  },
  {
    name: "Facebook",
    url: "https://facebook.com/anfpersianofficial"
  },
  {
    name: "X",
    url: "https://twitter.com/ANF_persian"
  },
  {
    name: "Site",
    url: "https://farsi.anf-news.com/"
  }
];

const socialLinks = socialLinksArray
  .map(({ name, url }) => {
    return (
      `[${escapeMarkdownV2(name)}]` +
      `(${escapeMarkdownUrl(url)})`
    );
  })
  .join(" \\| ");

// Extract the first sentence for the Telegram message
function getFirstSentence(item) {
  const source =
    item.contentSnippet ||
    item.content ||
    item.summary ||
    "";

  const cleanText = stripHtmlAndDecode(source);

  return (
    cleanText
      .split(/[.!?؟]/)
      .map((part) => part.trim())
      .find(Boolean) || ""
  );
}

// Send an article to Telegram
async function sendArticle(item, articleUrl) {
  const title = stripHtmlAndDecode(item.title || "");
  const firstSentence = getFirstSentence(item);

  const instantViewUrl = makeInstantViewUrl(articleUrl);
  const escapedInstantViewUrl =
    escapeMarkdownUrl(instantViewUrl);

  const messageParts = [];

  if (title) {
    messageParts.push(
      `*${escapeMarkdownV2(title)}*`
    );
  }

  if (firstSentence) {
    messageParts.push(
      escapeMarkdownV2(firstSentence)
    );
  }

  // This visible link opens the full article in Instant View
  messageParts.push(
    `[مطالعه خبر](${escapedInstantViewUrl})`
  );

  messageParts.push(socialLinks);

  const message = messageParts.join("\n\n");

  await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      chat_id: CHANNEL_ID,
      text: message,
      parse_mode: "MarkdownV2",

      // Forces Telegram to generate the preview from the Instant View URL
      link_preview_options: {
        is_disabled: false,
        url: instantViewUrl,
        prefer_large_media: true,
        show_above_text: false
      }
    },
    {
      timeout: 30000
    }
  );
}

// Check the RSS feed
async function checkFeed() {
  try {
    console.log("🔎 Checking feed...");

    const feed = await parser.parseURL(FEED_URL);

    if (!Array.isArray(feed.items)) {
      console.warn("⚠️ No feed items found.");
      return;
    }

    // Older unseen articles are posted first
    const items = [...feed.items].reverse();

    for (const item of items) {
      const rawLink =
        item.link ||
        item.guid ||
        "";

      if (!rawLink) {
        console.warn(
          "⚠️ Skipped item without a link:",
          item.title || "Untitled article"
        );
        continue;
      }

      let articleUrl;

      try {
        articleUrl = new URL(
          rawLink,
          FEED_URL
        ).toString();
      } catch {
        articleUrl = rawLink.trim();
      }

      if (!articleUrl) {
        continue;
      }

      if (posted.includes(articleUrl)) {
        console.log(
          "⏩ Already posted:",
          item.title || articleUrl
        );
        continue;
      }

      try {
        await sendArticle(item, articleUrl);

        console.log(
          "✅ Posted with Instant View:",
          item.title || articleUrl
        );

        posted.push(articleUrl);

        if (posted.length > MAX_POSTED) {
          posted = posted.slice(-MAX_POSTED);
        }

        savePosted();

        // Avoid sending several messages too quickly
        await new Promise((resolve) =>
          setTimeout(resolve, 1500)
        );
      } catch (error) {
        console.error(
          "❌ Telegram error:",
          error.response?.data ||
            error.message ||
            error
        );
      }
    }
  } catch (error) {
    console.error(
      "❌ Feed error:",
      error.message || error
    );
  }
}

// Prevent overlapping feed checks
let checkInProgress = false;

async function safelyCheckFeed() {
  if (checkInProgress) {
    console.log(
      "⏳ A feed check is already running."
    );
    return;
  }

  checkInProgress = true;

  try {
    await checkFeed();
  } finally {
    checkInProgress = false;
  }
}

// Start
console.log("🤖 Persian ANF Telegram bot started.");
console.log(
  `⚡ Instant View hash: ${INSTANT_VIEW_RHASH}`
);
console.log(
  `⏱️ Checking every ${POLL_INTERVAL_SECONDS} seconds.`
);

safelyCheckFeed();

setInterval(
  safelyCheckFeed,
  POLL_INTERVAL_SECONDS * 1000
);

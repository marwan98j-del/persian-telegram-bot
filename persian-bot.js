// persian-bot.js
// Persian ANF RSS -> Telegram channel with Instant View preview
// "مطالعه خبر" opens the real ANF article page.
// The Telegram preview uses the Instant View template.

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

// Your Telegram Instant View template hash
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

// Required environment variables
if (!BOT_TOKEN || !CHANNEL_ID || !FEED_URL) {
  console.error(
    "❌ Missing environment variables. Please set BOT_TOKEN, CHANNEL_ID and FEED_URL."
  );
  process.exit(1);
}

// Load already-posted article URLs
let posted = [];

if (fs.existsSync(POSTED_FILE)) {
  try {
    const savedData = JSON.parse(
      fs.readFileSync(POSTED_FILE, "utf8")
    );

    if (Array.isArray(savedData)) {
      posted = savedData;
    } else {
      console.warn(
        "⚠️ posted.json is not an array. Starting fresh."
      );
    }
  } catch (error) {
    console.warn(
      "⚠️ Could not read posted.json. Starting fresh."
    );
  }
}

// Save posted article URLs
function savePosted() {
  try {
    fs.writeFileSync(
      POSTED_FILE,
      JSON.stringify(posted, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error(
      "❌ Failed to save posted.json:",
      error?.message || error
    );
  }
}

// Escape normal text for Telegram MarkdownV2
function escapeMarkdownV2(text = "") {
  return text
    .toString()
    .replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// Escape URLs when used inside MarkdownV2 links
function escapeMarkdownUrl(url = "") {
  return url
    .toString()
    .replace(/\\/g, "\\\\")
    .replace(/\)/g, "\\)");
}

// Decode common HTML entities
function decodeEntities(text = "") {
  return text
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10))
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

// Remove HTML tags and normalize spaces
function stripHtmlAndDecode(text = "") {
  return decodeEntities(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Generate Telegram Instant View URL
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

// Extract first sentence from RSS content
function getFirstSentence(item) {
  const source =
    item.contentSnippet ||
    item.content ||
    item.summary ||
    "";

  const cleanText = stripHtmlAndDecode(source);

  const firstSentence =
    cleanText
      .split(/[.!?؟]/)
      .map((part) => part.trim())
      .find(Boolean) || "";

  return firstSentence;
}

// Send one article to Telegram
async function sendArticle(item, articleUrl) {
  const title = stripHtmlAndDecode(
    item.title || ""
  ).trim();

  const firstSentence = getFirstSentence(item);

  // Instant View URL is used for Telegram preview
  const instantViewUrl =
    makeInstantViewUrl(articleUrl);

  // Normal article URL is used for "مطالعه خبر"
  const escapedArticleUrl =
    escapeMarkdownUrl(articleUrl);

  const messageParts = [];

  // Headline
  if (title) {
    messageParts.push(
      `*${escapeMarkdownV2(title)}*`
    );
  }

  // First sentence / lead
  if (firstSentence) {
    messageParts.push(
      escapeMarkdownV2(firstSentence)
    );
  }

  // This opens the REAL ANF article page
  messageParts.push(
    `[مطالعه خبر](${escapedArticleUrl})`
  );

  // Social links
  messageParts.push(socialLinks);

  const message = messageParts.join("\n\n");

  // Send message to Telegram
  await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      chat_id: CHANNEL_ID,
      text: message,
      parse_mode: "MarkdownV2",

      // The visible preview uses your Instant View template
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

// Check RSS feed
async function checkFeed() {
  try {
    console.log("🔎 Checking RSS feed...");

    const feed = await parser.parseURL(
      FEED_URL
    );

    if (!Array.isArray(feed.items)) {
      console.warn(
        "⚠️ RSS feed contains no items."
      );
      return;
    }

    // Process older unseen articles first
    const items = [...feed.items].reverse();

    for (const item of items) {
      const rawLink =
        item.link ||
        item.guid ||
        "";

      if (!rawLink) {
        console.warn(
          "⚠️ Skipped item without URL:",
          item.title || "Untitled"
        );
        continue;
      }

      let articleUrl;

      try {
        articleUrl = new URL(
          rawLink,
          FEED_URL
        )
          .toString()
          .trim();
      } catch {
        articleUrl = rawLink.trim();
      }

      if (!articleUrl) {
        continue;
      }

      // Skip duplicate articles
      if (posted.includes(articleUrl)) {
        console.log(
          "⏩ Already posted:",
          item.title || articleUrl
        );
        continue;
      }

      try {
        await sendArticle(
          item,
          articleUrl
        );

        console.log(
          "✅ Posted with Instant View:",
          item.title || articleUrl
        );

        // Save only after Telegram accepts the message
        posted.push(articleUrl);

        if (posted.length > MAX_POSTED) {
          posted = posted.slice(
            -MAX_POSTED
          );
        }

        savePosted();

        // Small delay between posts
        await new Promise((resolve) =>
          setTimeout(resolve, 1500)
        );
      } catch (error) {
        console.error(
          "❌ Telegram API error:",
          error.response?.data ||
            error.message ||
            error
        );
      }
    }
  } catch (error) {
    console.error(
      "❌ RSS feed error:",
      error.message || error
    );
  }
}

// Prevent overlapping RSS checks
let checkInProgress = false;

async function safelyCheckFeed() {
  if (checkInProgress) {
    console.log(
      "⏳ Previous RSS check still running. Skipping this cycle."
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

// Start bot
console.log(
  "🤖 Persian ANF Telegram bot started."
);

console.log(
  `⚡ Instant View hash: ${INSTANT_VIEW_RHASH}`
);

console.log(
  `⏱️ Checking RSS every ${POLL_INTERVAL_SECONDS} seconds.`
);

safelyCheckFeed();

setInterval(
  safelyCheckFeed,
  POLL_INTERVAL_SECONDS * 1000
);

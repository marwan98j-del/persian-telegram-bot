// persian-bot.js (CommonJS version)

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

// Telegram Instant View template hash
const INSTANT_VIEW_RHASH =
  process.env.INSTANT_VIEW_RHASH || "cb93cf5b90b9dc";

const POSTED_FILE = "./posted.json";

const MAX_POSTED = parseInt(process.env.MAX_POSTED || "500", 10);

const POLL_INTERVAL_SECONDS = parseInt(
  process.env.POLL_INTERVAL_SECONDS || "60",
  10
);

// Check required environment variables
if (!BOT_TOKEN || !CHANNEL_ID || !FEED_URL) {
  console.error(
    "❌ Missing environment variables. Please set BOT_TOKEN, CHANNEL_ID and FEED_URL in your .env file."
  );
  process.exit(1);
}

// Load previously posted article links
let posted = [];

if (fs.existsSync(POSTED_FILE)) {
  try {
    const fileContents = fs.readFileSync(POSTED_FILE, "utf8");
    const parsedContents = JSON.parse(fileContents);

    if (Array.isArray(parsedContents)) {
      posted = parsedContents;
    } else {
      console.warn("⚠️ posted.json is not an array. Starting fresh.");
    }
  } catch (error) {
    console.warn("⚠️ Could not parse posted.json. Starting fresh.");
  }
}

// Save posted article links
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

// Escape text for Telegram MarkdownV2
function escapeMarkdownV2(text = "") {
  return text
    .toString()
    .replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// Escape a URL used inside a MarkdownV2 link
function escapeMarkdownUrl(url = "") {
  return url
    .toString()
    .replace(/\\/g, "\\\\")
    .replace(/\)/g, "\\)");
}

// Decode common HTML entities
function decodeEntities(str = "") {
  return str
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(parseInt(code, 10))
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// Remove HTML and normalize spaces
function stripHtmlAndDecode(str = "") {
  return decodeEntities(str)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Create the Telegram Instant View URL automatically
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
    name: "webSite",
    url: "https://anfpersian.com/"
  }
];

const socialLinks = socialLinksArray
  .map((link) => {
    const name = escapeMarkdownV2(link.name);
    const url = escapeMarkdownUrl(link.url);

    return `[${name}](${url})`;
  })
  .join(" \\| ");

// Send one article to Telegram
async function sendArticle(item, articleUrl) {
  const title = stripHtmlAndDecode(item.title || "").trim();

  const snippetSource =
    item.contentSnippet ||
    item.content ||
    item.summary ||
    "";

  const snippetText = stripHtmlAndDecode(snippetSource);

  // Extract the first sentence
  const firstSentence =
    (snippetText.split(/[.!?؟]/)[0] || "").trim();

  const instantViewUrl = makeInstantViewUrl(articleUrl);
  const markdownInstantViewUrl =
    escapeMarkdownUrl(instantViewUrl);

  // Build the Telegram message
  const messageParts = [];

  if (title) {
    messageParts.push(`*${escapeMarkdownV2(title)}*`);
  }

  if (firstSentence) {
    messageParts.push(escapeMarkdownV2(firstSentence));
  }

  messageParts.push(
    `[مطالعه خبر](${markdownInstantViewUrl})`
  );

  messageParts.push(socialLinks);

  const message = messageParts.join("\n\n");

  await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      chat_id: CHANNEL_ID,
      text: message,
      parse_mode: "MarkdownV2",

      // Tell Telegram which URL should create the preview
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

// Read the RSS feed and post new articles
async function checkFeed() {
  try {
    console.log("🔎 Checking RSS feed...");

    const feed = await parser.parseURL(FEED_URL);

    if (!feed.items || !Array.isArray(feed.items)) {
      console.warn("⚠️ The RSS feed contains no items.");
      return;
    }

    // Reverse so older articles are posted before newer articles
    const items = [...feed.items].reverse();

    for (const item of items) {
      const rawLink = item.link || item.guid || "";

      if (!rawLink) {
        console.warn(
          "⚠️ Skipped an RSS item because it has no link:",
          item.title || "Untitled item"
        );
        continue;
      }

      let articleUrl;

      try {
        articleUrl = new URL(rawLink, FEED_URL)
          .toString()
          .trim();
      } catch (error) {
        articleUrl = rawLink.trim();
      }

      if (!articleUrl) {
        continue;
      }

      // Skip articles that were already posted
      if (posted.includes(articleUrl)) {
        console.log(
          "⏩ Skipped duplicate:",
          item.title || articleUrl
        );
        continue;
      }

      try {
        await sendArticle(item, articleUrl);

        console.log(
          "✅ Posted:",
          item.title || articleUrl
        );

        // Save article as posted only after Telegram accepts it
        posted.push(articleUrl);

        if (posted.length > MAX_POSTED) {
          posted = posted.slice(-MAX_POSTED);
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
      "❌ Error fetching RSS feed:",
      error.message || error
    );
  }
}

// Prevent multiple overlapping feed checks
let isCheckingFeed = false;

async function safelyCheckFeed() {
  if (isCheckingFeed) {
    console.log(
      "⏳ Previous feed check is still running. Skipping this cycle."
    );
    return;
  }

  isCheckingFeed = true;

  try {
    await checkFeed();
  } finally {
    isCheckingFeed = false;
  }
}

// Start the bot
console.log("🤖 Persian ANF bot started.");
console.log(
  `⏱️ Feed will be checked every ${POLL_INTERVAL_SECONDS} seconds.`
);
console.log(
  `⚡ Instant View template: ${INSTANT_VIEW_RHASH}`
);

safelyCheckFeed();

setInterval(
  safelyCheckFeed,
  POLL_INTERVAL_SECONDS * 1000
);

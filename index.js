const express = require("express");
const puppeteer = require("puppeteer");
const cron = require("node-cron");
const fs = require("fs").promises;
const path = require("path");
const nodemailer = require("nodemailer");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const moment = require("moment");

const app = express();
const PORT = process.env.PORT || 3000;

// Email configuration
const emailConfig = {
  from: "shanakaprince@gmail.com",
  to: "shanakaprince@gmail.com",
  smtp: {
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: "shanakaprince@gmail.com",
      pass: "xqlw xhyl vvem zhlk",
    },
  },
};

const transporter = nodemailer.createTransport(emailConfig.smtp);

const accounts = ["FirstSquawk", "theinsiderpaper", "deitaone", "disclosetv"];

async function scrapeProfileData(page, username) {
  try {
    await page.waitForSelector('[data-testid="UserName"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="UserDescription"]', {
      timeout: 10000,
    });

    const profileData = await page.evaluate(() => {
      const getName = () => {
        const nameElement = document.querySelector('[data-testid="UserName"]');
        return nameElement ? nameElement.textContent.trim() : "";
      };

      const getBio = () => {
        const bioElement = document.querySelector(
          '[data-testid="UserDescription"]'
        );
        return bioElement ? bioElement.textContent.trim() : "";
      };

      const getFollowers = () => {
        const followersText = Array.from(
          document.querySelectorAll('a[href*="/followers"] span')
        ).find((span) => span.textContent.includes("Followers"))?.parentElement
          ?.textContent;
        return followersText ? followersText.replace(/[^0-9.KMB]/g, "") : "0";
      };

      const getFollowing = () => {
        const followingText = Array.from(
          document.querySelectorAll('a[href*="/following"] span')
        ).find((span) => span.textContent.includes("Following"))?.parentElement
          ?.textContent;
        return followingText ? followingText.replace(/[^0-9.KMB]/g, "") : "0";
      };

      const getLocation = () => {
        const locationElement = document.querySelector(
          '[data-testid="UserLocation"]'
        );
        return locationElement ? locationElement.textContent.trim() : "";
      };

      return {
        name: getName(),
        bio: getBio(),
        followers: getFollowers(),
        following: getFollowing(),
        location: getLocation(),
        username: window.location.pathname.split("/")[1],
        lastUpdated: new Date().toISOString(),
      };
    });

    return profileData;
  } catch (error) {
    console.error(`Error scraping profile for ${username}:`, error);
    return null;
  }
}

async function saveProfileData(profiles) {
  const outputDir = path.join(__dirname, "scraped_data");
  await fs.mkdir(outputDir, { recursive: true });

  const filePath = path.join(outputDir, "profiles.json");
  await fs.writeFile(filePath, JSON.stringify(profiles, null, 2));
  return filePath;
}

async function scrapeTwitterAccount(username, browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    const url = `https://twitter.com/${username}`;
    await page.goto(url, { waitUntil: "networkidle0" });

    // First get profile data
    const profileData = await scrapeProfileData(page, username);

    // Then get tweets
    await page.waitForSelector('article[data-testid="tweet"]', {
      timeout: 10000,
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayString = yesterday.toISOString().split("T")[0];

    const tweets = await page.evaluate((date) => {
      const tweetElements = document.querySelectorAll(
        'article[data-testid="tweet"]'
      );
      const tweets = [];

      tweetElements.forEach((tweet) => {
        const tweetText = tweet.querySelector(
          '[data-testid="tweetText"]'
        )?.innerText;
        const timestamp = tweet.querySelector("time")?.dateTime;
        const likes =
          tweet.querySelector('[data-testid="like"]')?.innerText || "0";
        const retweets =
          tweet.querySelector('[data-testid="retweet"]')?.innerText || "0";

        if (tweetText && timestamp && timestamp.includes(date)) {
          tweets.push({
            text: tweetText,
            timestamp: timestamp,
            likes: likes,
            retweets: retweets,
          });
        }
      });

      return tweets;
    }, yesterdayString);

    return { profileData, tweets };
  } catch (error) {
    console.error(`Error scraping ${username}:`, error);
    return { profileData: null, tweets: [] };
  } finally {
    await page.close();
  }
}

async function saveToCsv(data, date) {
  const outputDir = path.join(__dirname, "scraped_data");
  await fs.mkdir(outputDir, { recursive: true });

  const fileName = `tweets_${date}.csv`;
  const filePath = path.join(outputDir, fileName);

  // Flatten the data for CSV
  const flattenedData = [];
  for (const [account, tweets] of Object.entries(data)) {
    tweets.forEach((tweet) => {
      flattenedData.push({
        account,
        timestamp: moment(tweet.timestamp).format("YYYY-MM-DD HH:mm:ss"),
        text: tweet.text.replace(/\n/g, " "), // Remove newlines for CSV
        likes: tweet.likes,
        retweets: tweet.retweets,
      });
    });
  }

  // Create CSV writer
  const csvWriter = createCsvWriter({
    path: filePath,
    header: [
      { id: "account", title: "ACCOUNT" },
      { id: "timestamp", title: "TIMESTAMP" },
      { id: "text", title: "TWEET" },
      { id: "likes", title: "LIKES" },
      { id: "retweets", title: "RETWEETS" },
    ],
  });

  await csvWriter.writeRecords(flattenedData);
  return filePath;
}

async function sendEmail(tweetFilePath, profileFilePath, date) {
  const emailText = `
Twitter scraping results for ${date}

Attached files:
1. Daily tweets data (CSV)
2. Updated profile information (JSON)

This is an automated message.
`;

  const mailOptions = {
    from: emailConfig.from,
    to: emailConfig.to,
    subject: `Twitter Scraping Report - ${date}`,
    text: emailText,
    attachments: [
      {
        filename: path.basename(tweetFilePath),
        path: tweetFilePath,
      },
      {
        filename: path.basename(profileFilePath),
        path: profileFilePath,
      },
    ],
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully with both tweets and profile data");
  } catch (error) {
    console.error("Error sending email:", error);
  }
}

async function scrapeAllAccounts() {
  console.log("Starting scraping process...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const results = {};
    const profiles = {};

    for (const account of accounts) {
      console.log(`Scraping ${account}...`);
      const { profileData, tweets } = await scrapeTwitterAccount(
        account,
        browser
      );

      if (profileData) {
        profiles[account] = profileData;
      }
      results[account] = tweets;

      await new Promise((resolve) => setTimeout(resolve, 5000)); // Rate limiting
    }

    // Save both profile and tweet data
    const date = moment().subtract(1, "days").format("YYYY-MM-DD");
    const profileFilePath = await saveProfileData(profiles);
    const tweetFilePath = await saveToCsv(results, date);

    // Send email with both files
    await sendEmail(tweetFilePath, profileFilePath, date);

    console.log("Scraping completed successfully");
  } finally {
    await browser.close();
  }
}

// Initialize scraping on startup
let initialScrapingDone = false;

async function initialize() {
  if (!initialScrapingDone) {
    console.log("Performing initial scraping...");
    await scrapeAllAccounts();
    initialScrapingDone = true;
    console.log("Initial scraping completed");
  }
}

// Start the server and initialize scraping
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initialize();
});

// Schedule daily scraping at 1 AM
cron.schedule("0 1 * * *", async () => {
  try {
    await scrapeAllAccounts();
  } catch (error) {
    console.error("Error in scheduled scrape:", error);
  }
});

module.exports = app;

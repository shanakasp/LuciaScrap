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
    // Wait for the main content to load
    await page.waitForSelector('div[data-testid="primaryColumn"]', {
      timeout: 10000,
    });

    // Use setTimeout with Promise instead of waitForTimeout
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const profileData = await page.evaluate(() => {
      const getName = () => {
        const nameElement = document.querySelector(
          'div[data-testid="primaryColumn"] span.css-901oao.css-16my406.r-poiln3.r-bcqeeo.r-qvutc0'
        );
        return nameElement ? nameElement.textContent.trim() : "";
      };

      const getBio = () => {
        const bioElement = document.querySelector(
          'div[data-testid="primaryColumn"] div[data-testid="UserDescription"]'
        );
        return bioElement ? bioElement.textContent.trim() : "";
      };

      const getFollowers = () => {
        const followersElement = document.querySelector(
          'div[data-testid="primaryColumn"] a[href$="/followers"] span'
        );
        return followersElement ? followersElement.textContent.trim() : "0";
      };

      const getFollowing = () => {
        const followingElement = document.querySelector(
          'div[data-testid="primaryColumn"] a[href$="/following"] span'
        );
        return followingElement ? followingElement.textContent.trim() : "0";
      };

      const getLocation = () => {
        const locationElement = document.querySelector(
          'div[data-testid="primaryColumn"] span[data-testid="UserLocation"]'
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

    console.log(`Profile data scraped for ${username}:`, profileData);
    return profileData;
  } catch (error) {
    console.error(`Error scraping profile for ${username}:`, error);
    return null;
  }
}

async function scrapeTweets(page, username) {
  try {
    // Wait for tweets to load
    await page.waitForSelector('article[data-testid="tweet"]', {
      timeout: 10000,
    });

    // Use setTimeout with Promise instead of waitForTimeout
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const yesterday = moment().subtract(1, "days").format("YYYY-MM-DD");

    const tweets = await page.evaluate((yesterday) => {
      const tweetElements = document.querySelectorAll(
        'article[data-testid="tweet"]'
      );
      const tweets = [];

      tweetElements.forEach((tweet) => {
        const tweetText = tweet.querySelector(
          '[data-testid="tweetText"]'
        )?.innerText;
        const timestamp = tweet.querySelector("time")?.dateTime;
        const likesElement = tweet.querySelector('[data-testid="like"] span');
        const retweetsElement = tweet.querySelector(
          '[data-testid="retweet"] span'
        );

        const likes = likesElement ? likesElement.innerText : "0";
        const retweets = retweetsElement ? retweetsElement.innerText : "0";

        if (tweetText && timestamp && timestamp.includes(yesterday)) {
          tweets.push({
            text: tweetText,
            timestamp: timestamp,
            likes: likes,
            retweets: retweets,
          });
        }
      });

      return tweets;
    }, yesterday);

    console.log(`Tweets scraped for ${username}:`, tweets);
    return tweets;
  } catch (error) {
    console.error(`Error scraping tweets for ${username}:`, error);
    return [];
  }
}

async function saveProfileData(profiles) {
  const outputDir = path.join(__dirname, "scraped_data");
  await fs.mkdir(outputDir, { recursive: true });

  const filePath = path.join(outputDir, "profiles.json");
  await fs.writeFile(filePath, JSON.stringify(profiles, null, 2));
  console.log("Profile data saved to:", filePath);
  return filePath;
}

async function saveToCsv(data, profiles, date) {
  const outputDir = path.join(__dirname, "scraped_data");
  await fs.mkdir(outputDir, { recursive: true });

  const fileName = `tweets_${date}.csv`;
  const filePath = path.join(outputDir, fileName);

  // Flatten the data for CSV
  const flattenedData = [];
  for (const [account, tweets] of Object.entries(data)) {
    const profile = profiles[account] || {};

    tweets.forEach((tweet) => {
      flattenedData.push({
        account,
        timestamp: moment(tweet.timestamp).format("YYYY-MM-DD HH:mm:ss"),
        text: tweet.text.replace(/\n/g, " "), // Remove newlines for CSV
        likes: tweet.likes,
        retweets: tweet.retweets,
        accountName: profile.name || "",
        accountBio: profile.bio || "",
        accountFollowers: profile.followers || "",
        accountFollowing: profile.following || "",
        accountLocation: profile.location || "",
        profileLastUpdated: profile.lastUpdated || "",
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
      { id: "accountName", title: "ACCOUNT_NAME" },
      { id: "accountBio", title: "ACCOUNT_BIO" },
      { id: "accountFollowers", title: "ACCOUNT_FOLLOWERS" },
      { id: "accountFollowing", title: "ACCOUNT_FOLLOWING" },
      { id: "accountLocation", title: "ACCOUNT_LOCATION" },
      { id: "profileLastUpdated", title: "PROFILE_LAST_UPDATED" },
    ],
  });

  await csvWriter.writeRecords(flattenedData);
  console.log("Data saved to CSV:", filePath);
  return filePath;
}

async function scrapeTwitterAccount(username, browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    const url = `https://twitter.com/${username}`;
    console.log(`Navigating to ${url}`);

    // Add navigation options for better reliability
    await page.goto(url, {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    // Wait for a bit after navigation
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Get profile data
    const profileData = await scrapeProfileData(page, username);

    // Get tweets
    const tweets = await scrapeTweets(page, username);

    return { profileData, tweets };
  } catch (error) {
    console.error(`Error scraping ${username}:`, error);
    return { profileData: null, tweets: [] };
  } finally {
    await page.close();
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

      // Add delay between accounts
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    const date = moment().subtract(1, "days").format("YYYY-MM-DD");

    // Save both profile and tweet data
    const profileFilePath = await saveProfileData(profiles);
    const tweetFilePath = await saveToCsv(results, profiles, date);

    // Send email with both files
    await sendEmail(tweetFilePath, profileFilePath, date);

    console.log("Scraping completed successfully");
  } catch (error) {
    console.error("Error in scraping process:", error);
  } finally {
    await browser.close();
  }
}

async function sendEmail(tweetFilePath, profileFilePath, date) {
  const emailText = `
Twitter scraping results for ${date}

Attached files:
1. Daily tweets data with profile information (CSV)
2. Profile information (JSON)

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
    console.log("Email sent successfully");
  } catch (error) {
    console.error("Error sending email:", error);
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

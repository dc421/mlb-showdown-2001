require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// --- Database Connection ---
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// --- Set ID and Offset Mapping ---
const SET_INFO = {
  'Base': { setId: '8115', offset: 5859 },
  '2001 MLB Showdown': { setId: '8115', offset: 5859 },
  'PR': { setId: '8117', offset: 6371 },
  '2001 MLB Showdown Pennant Run': { setId: '8117', offset: 6371 },
};

async function fetchPlayerData() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT card_id, name, set_name, card_number FROM cards_player ORDER BY card_id ASC');
    console.log(`Found ${res.rows.length} players. Starting download process...`);
    return res.rows;
  } finally {
    client.release();
  }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function downloadImageDirectly(page, player, filepath) {
  if (fs.existsSync(filepath)) {
    console.log(` -> Image for card ${player.card_id} (${player.name}) already exists. Skipping.`);
    return;
  }

  const setInfo = SET_INFO[player.set_name];
  if (!setInfo) {
    throw new Error(`No Set Info found for set: "${player.set_name}"`);
  }

  const imageId = setInfo.offset + player.card_number;
  const cid = '27' + imageId;

  // We only target the '/Large/' URL now
  const imageUrl = `https://www.tcdb.com/Images/Large/Baseball/${setInfo.setId}/${setInfo.setId}-${cid}Fr.jpg`;

  try {
    console.log(` -> Attempting to navigate to: ${imageUrl}`);
    await page.goto(imageUrl, { waitUntil: 'domcontentloaded' });
    let finalResponse;

    // Look for and solve the Cloudflare challenge
    try {
      const iframe = await page.waitForSelector('iframe[src*="challenges.cloudflare.com"]', { timeout: 5000 });
      const frame = await iframe.contentFrame();
      const checkbox = await frame.waitForSelector('input[type="checkbox"]', { timeout: 5000 });
      await checkbox.click();
      finalResponse = await page.waitForNavigation({ waitUntil: 'networkidle0' });
    } catch (e) {
      finalResponse = await page.goto(imageUrl, { waitUntil: 'networkidle0' });
    }
    
    // Check if the final page is an image
    if (finalResponse.ok() && finalResponse.headers()['content-type'].startsWith('image/')) {
      const buffer = await finalResponse.buffer();
      fs.writeFileSync(filepath, buffer);
      console.log(` -> Image successfully saved from ${imageUrl}`);
    } else {
      throw new Error(`Content was not an image. Content-Type: ${finalResponse.headers()['content-type']}`);
    }
  } catch (error) {
    // If anything fails, throw an error up to the main loop to be logged
    throw new Error(`Navigation or download failed. Original error: ${error.message}`);
  }
}

async function updateCardImagePath(client, cardId, imagePath) {
  const relativePath = `/card_images/${path.basename(imagePath)}`;
  await client.query(
    'UPDATE cards_player SET image_url = $1 WHERE card_id = $2',
    [relativePath, cardId]
  );
}

async function main() {
  const imagesDir = path.join(__dirname, 'card_images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir);
  }

  const client = await pool.connect();
  // We launch the browser just once, outside the loop
  const browser = await puppeteer.launch({ headless: false });

  let players;
  try {
    players = await fetchPlayerData();
  } catch (dbError) {
    console.error("Failed to fetch player data:", dbError);
    await browser.close();
    client.release();
    await pool.end();
    return;
  }

  let successCount = 0;
  let failureCount = 0;
  for (const player of players) {
    let page; // Define page here to access it in the 'finally' block
    try {
      // --- KEY CHANGE: A new page is created for every single player ---
      page = await browser.newPage();
      
      // --- KEY CHANGE: Page settings are applied to each new page ---
      await page.setViewport({ width: 1280, height: 800 });
      await page.setDefaultNavigationTimeout(60000);
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

      console.log(`Processing card ${player.card_id} for ${player.name}...`);
      const imagePath = path.join(imagesDir, `${player.card_id}.jpg`);
      
      // We pass the new, clean page into the function
      await downloadImageDirectly(page, player, imagePath);
      
      await updateCardImagePath(client, player.card_id, imagePath);
      console.log(` -> Successfully processed card ${player.card_id}`);
      successCount++;
    } catch (error) {
      console.error(` -> Failed to process card ${player.card_id} (${player.name}): ${error.message}`);
      failureCount++;
      if (page && !page.isClosed()) {
        const screenshotPath = path.join(__dirname, `error_screenshot_${player.card_id}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }
    } finally {
      // --- KEY CHANGE: We always close the tab after we're done with it ---
      if (page && !page.isClosed()) {
        await page.close();
      }
      const randomDelay = Math.floor(Math.random() * 5000) + 3000;
      console.log(`   ...waiting for ${Math.round(randomDelay / 1000)} seconds...`);
      await delay(randomDelay);
    }
  }
  
  // Your summary log can be improved to show failures
  console.log(`\nScript finished. \nSuccessfully downloaded: ${successCount} \nFailed: ${failureCount}`);

  await browser.close();
  await pool.end();
}

main();
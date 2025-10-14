require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

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
    const res = await client.query('SELECT card_id, name, set_name, card_number FROM cards_player');
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

  const imageUrl = `https://www.tcdb.com/Images/Large/Baseball/${setInfo.setId}/${setInfo.setId}-${cid}Fr.jpg`;
  console.log(` -> Navigating directly to image: ${imageUrl}`);

  try {
    const response = await page.goto(imageUrl, { waitUntil: 'domcontentloaded' });

    // Check if the response is successful and the content type is an image
    if (response.ok() && response.headers()['content-type'].startsWith('image/')) {
      const buffer = await response.buffer();
      fs.writeFileSync(filepath, buffer);
      console.log(` -> Image saved to ${filepath}`);
    } else {
      // If we didn't get an image, it's likely the Cloudflare challenge page.
      // We wait for a bit to let the page execute JavaScript.
      console.log(' -> Potentially a challenge page, waiting for navigation...');
      await page.waitForTimeout(8000); // Wait for 8 seconds for JS challenge

      // After waiting, we can try to get the image content again.
      // This time, we assume the browser has solved the challenge and the image is what's displayed.
      const imageBuffer = await page.screenshot({ type: 'jpeg', quality: 100, fullPage: true });

      // A simple check to see if we got a real image or a webpage screenshot
      if (imageBuffer.length < 20000) { // Challenge page screenshots are usually small
        throw new Error('Failed to bypass challenge page. The downloaded content is not a valid image.');
      }

      fs.writeFileSync(filepath, imageBuffer);
      console.log(` -> Image saved via screenshot to ${filepath}`);
    }
  } catch (error) {
    throw new Error(`Failed to download image from ${imageUrl}. Original error: ${error.message}`);
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
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(60000);
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

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
  for (const player of players) {
    const imagePath = path.join(imagesDir, `${player.card_id}.jpg`);
    try {
      console.log(`Processing card ${player.card_id} for ${player.name}...`);
      await downloadImageDirectly(page, player, imagePath);
      await updateCardImagePath(client, player.card_id, imagePath);
      console.log(` -> Successfully processed card ${player.card_id}`);
      successCount++;
      const randomDelay = Math.floor(Math.random() * 2000) + 1000; // 1-3 seconds
      await delay(randomDelay);
    } catch (error) {
      console.error(` -> Failed to process card ${player.card_id} (${player.name}): ${error.message}`);
      
      const screenshotPath = path.join(__dirname, `error_screenshot_${player.card_id}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.error(` -> Screenshot saved to ${screenshotPath}.`);

      const htmlPath = path.join(__dirname, `error_page_${player.card_id}.html`);
      const htmlContent = await page.content();
      fs.writeFileSync(htmlPath, htmlContent);
      console.error(` -> HTML content saved to ${htmlPath}.`);

      console.error(' -> Stopping script after first error for debugging.');
      break;
    }
  }
  
  if (successCount > 0 && successCount === players.length) {
      console.log(`\nSuccessfully downloaded ${successCount} of ${players.length} card images.`);
  } else if (successCount > 0) {
      console.log(`\nScript finished. Processed ${successCount} players before stopping with an error.`);
  }

  await browser.close();
  await pool.end();
}

main();
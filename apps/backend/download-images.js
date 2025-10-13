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

// --- Set ID Mapping ---
const SET_IDS = {
  '2001 MLB Showdown': '8115',
  '2001 MLB Showdown Pennant Run': '8117',
};

async function fetchPlayerData() {
  const client = await pool.connect();
  try {
    // Fetch card_id, name, and set_name to construct the URL
    const res = await client.query('SELECT card_id, name, set_name FROM cards_player');
    console.log(`Found ${res.rows.length} players. Starting download process...`);
    return res.rows;
  } finally {
    client.release();
  }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function downloadImageDirectly(page, player, filepath) {
  // Check if image already exists
  if (fs.existsSync(filepath)) {
    console.log(` -> Image for card ${player.card_id} (${player.name}) already exists. Skipping.`);
    return;
  }

  const setId = SET_IDS[player.set_name];
  if (!setId) {
    throw new Error(`No Set ID found for set: "${player.set_name}"`);
  }

  const cardPageUrl = `https://www.tcdb.com/ViewCard.cfm/sid/${setId}/cid/${player.card_id}`;

  console.log(` -> Navigating to ${cardPageUrl}`);
  await page.goto(cardPageUrl, { waitUntil: 'domcontentloaded' });

  // Handle potential CAPTCHA or other blocks
  const pageTitle = await page.title();
  if (pageTitle.includes('Pardon Our Interruption')) {
      throw new Error('CAPTCHA or block detected.');
  }

  // Extract the image source and download
  await page.waitForSelector('#card_img_front', { timeout: 15000 });
  const imageSrc = await page.evaluate(() => {
    const img = document.querySelector('#card_img_front');
    return img ? img.src : null;
  });

  if (!imageSrc) {
    throw new Error(`Could not find image on card page: ${cardPageUrl}`);
  }

  console.log(` -> Found image source: ${imageSrc}`);

  // Navigate to the image source and download the buffer
  const viewSource = await page.goto(imageSrc, { waitUntil: 'networkidle0' });
  const buffer = await viewSource.buffer();

  fs.writeFileSync(filepath, buffer);
  console.log(` -> Image saved to ${filepath}`);
}

// Temporarily removed until download is confirmed working
// async function updateCardImagePath(client, cardId, imagePath) {
//   const relativePath = `/card_images/${path.basename(imagePath)}`;
//   await client.query(
//     'UPDATE cards_player SET image_url = $1 WHERE card_id = $2',
//     [relativePath, cardId]
//   );
// }

async function main() {
  const imagesDir = path.join(__dirname, 'card_images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir);
  }

  // No database updates for now, so we don't need a client yet.
  // const client = await pool.connect();

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
    // client.release(); // Not needed right now
    await pool.end();
    return;
  }

  let successCount = 0;
  // We will loop through players but stop after the first error for debugging.
  for (const player of players) {
    const imagePath = path.join(imagesDir, `${player.card_id}.jpg`);
    try {
      console.log(`Processing card ${player.card_id} for ${player.name}...`);
      await downloadImageDirectly(page, player, imagePath);
      // await updateCardImagePath(client, player.card_id, imagePath);
      console.log(` -> Successfully processed card ${player.card_id}`);
      successCount++;
      await delay(3000); // Politeness delay
    } catch (error) {
      // This is the correct place for the error handling logic
      console.error(` -> Failed to process card ${player.card_id} (${player.name}): ${error.message}`);
      
      const screenshotPath = path.join(__dirname, `error_screenshot_${player.card_id}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.error(` -> Screenshot saved to ${screenshotPath}.`);

      const htmlPath = path.join(__dirname, `error_page_${player.card_id}.html`);
      const htmlContent = await page.content();
      fs.writeFileSync(htmlPath, htmlContent);
      console.error(` -> HTML content saved to ${htmlPath}.`);

      console.error(' -> Stopping script after first error for debugging.');
      break; // Exit the loop to stop the script
    }
  }
  
  if (successCount > 0 && successCount === players.length) {
      console.log(`\nSuccessfully downloaded and updated ${successCount} of ${players.length} card images.`);
  } else if (successCount > 0) {
      console.log(`\nScript finished. Processed ${successCount} players before stopping with an error.`);
  }

  // Cleanup
  await browser.close();
  // client.release();
  await pool.end();
}

main();
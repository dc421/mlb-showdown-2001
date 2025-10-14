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

async function downloadImageWithFormula(page, player, filepath) {
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

  // Construct the direct image URL
  const imageUrl = `https://www.tcdb.com/Images/Large/Baseball/${setInfo.setId}/${setInfo.setId}-${cid}Fr.jpg`;
  console.log(` -> Navigating directly to image: ${imageUrl}`);

  try {
    const viewSource = await page.goto(imageUrl, { waitUntil: 'networkidle0' });
    const buffer = await viewSource.buffer();

    if (buffer.length < 1000) {
      throw new Error('Downloaded file is too small to be a valid image. It might be an error page.');
    }

    fs.writeFileSync(filepath, buffer);
    console.log(` -> Image saved to ${filepath}`);
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
      await downloadImageWithFormula(page, player, imagePath);
      await updateCardImagePath(client, player.card_id, imagePath);
      console.log(` -> Successfully processed card ${player.card_id}`);
      successCount++;
      await delay(1500); // Politeness delay
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
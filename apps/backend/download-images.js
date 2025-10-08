require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// --- Constants from Python script ---
const BASE_SET_OFFSET = 5859; // So that card #1 maps to image ID 5860
const PENNANT_RUN_OFFSET = 6371; // So that card #1 maps to image ID 6372

// --- Database Connection ---
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function fetchPlayerData() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT card_id, set_name, card_number FROM cards_player');
    console.log(`Found ${res.rows.length} players. Starting download process...`);
    return res.rows;
  } finally {
    client.release();
  }
}

function generateImageUrl(setName, cardNumber) {
  let imageId = 0;
  let setId = 0;

  if (setName === 'Base') {
    imageId = BASE_SET_OFFSET + cardNumber;
    setId = 8115;
  } else if (setName === 'PR') {
    imageId = PENNANT_RUN_OFFSET + cardNumber;
    setId = 8117;
  }

  if (imageId > 0) {
    return `https://www.tcdb.com/Images/Cards/Baseball/${setId}/${setId}-${imageId}Fr.jpg`;
  }
  return null;
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function downloadImage(page, url, filepath) {
  await page.goto(url, { waitUntil: 'networkidle0' });

  const imageSrc = await page.evaluate(() => {
    const img = document.querySelector('img');
    return img ? img.src : null;
  });

  if (!imageSrc) {
    throw new Error('Could not find image source on page');
  }

  // The src might be a data URI or a URL.
  if (imageSrc.startsWith('data:image/')) {
    const buffer = Buffer.from(imageSrc.split(',')[1], 'base64');
    fs.writeFileSync(filepath, buffer);
  } else {
    // It's a URL, fetch it using the same page to maintain session/cookies.
    const viewSource = await page.goto(imageSrc);
    fs.writeFileSync(filepath, await viewSource.buffer());
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
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

  try {
    const players = await fetchPlayerData();
    let successCount = 0;
    for (const player of players) {
      const imageUrl = generateImageUrl(player.set_name, player.card_number);
      if (imageUrl) {
        const imagePath = path.join(imagesDir, `${player.card_id}.jpg`);
        try {
          console.log(`Downloading image for card ${player.card_id}...`);
          await downloadImage(page, imageUrl, imagePath);
          console.log(` -> Saved to ${imagePath}`);

          await updateCardImagePath(client, player.card_id, imagePath);
          console.log(` -> Updated database for card ${player.card_id}`);
          successCount++;

          // Wait for 3 seconds before the next download
          await delay(3000);
        } catch (error) {
          console.error(`Failed to process card ${player.card_id}: ${error.message}`);
        }
      }
    }
    console.log(`\nSuccessfully downloaded and updated ${successCount} of ${players.length} card images.`);
  } catch (error) {
    console.error('An error occurred during the main process:', error);
  } finally {
    await browser.close();
    client.release();
    await pool.end();
  }
}

main();
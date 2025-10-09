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

async function findAndDownloadImage(page, player, filepath) {
  const searchName = player.name;
  const targetSet = player.set_name === 'Base' ? '2001 MLB Showdown' : '2001 MLB Showdown Pennant Run';

  // 1. Navigate to search page and perform search
  await page.goto('https://www.tcdb.com/Search.cfm', { waitUntil: 'networkidle0' });
  await page.type('input[name="Search"]', searchName);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('input[type="submit"][value="Search"]'),
  ]);

  // 2. Find the correct card link from the search results
  const cardPageUrl = await page.evaluate((name, set) => {
    const rows = Array.from(document.querySelectorAll('.dataTable tbody tr'));
    for (const row of rows) {
      const linkElement = row.querySelector('td:nth-child(2) a');
      const setText = row.querySelector('td:nth-child(3)').innerText;
      if (linkElement && linkElement.innerText.trim() === name && setText.trim() === set) {
        return linkElement.href;
      }
    }
    return null;
  }, searchName, targetSet);

  if (!cardPageUrl) {
    throw new Error(`Could not find card for '${searchName}' in set '${targetSet}'`);
  }

  // 3. Navigate to the card page
  await page.goto(cardPageUrl, { waitUntil: 'networkidle0' });

  // 4. Extract the image source and download
  const imageSrc = await page.evaluate(() => {
    const img = document.querySelector('#card_img_front');
    return img ? img.src : null;
  });

  if (!imageSrc) {
    throw new Error(`Could not find image on card page: ${cardPageUrl}`);
  }

  const viewSource = await page.goto(imageSrc);
  fs.writeFileSync(filepath, await viewSource.buffer());
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
      const imagePath = path.join(imagesDir, `${player.card_id}.jpg`);
      try {
        console.log(`Processing card ${player.card_id} for ${player.name}...`);
        await findAndDownloadImage(page, player, imagePath);
        await updateCardImagePath(client, player.card_id, imagePath);
        console.log(` -> Successfully processed card ${player.card_id}`);
        successCount++;
        await delay(3000); // Politeness delay
      } catch (error) {
        console.error(` -> Failed to process card ${player.card_id} (${player.name}): ${error.message}`);
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
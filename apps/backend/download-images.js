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

  const urlsToTry = [
    `https://www.tcdb.com/Images/Large/Baseball/${setInfo.setId}/${setInfo.setId}-${cid}Fr.jpg`,
    `https://www.tcdb.com/Images/Cards/Baseball/${setInfo.setId}/${setInfo.setId}-${cid}Fr.jpg`
  ];

  for (const imageUrl of urlsToTry) {
    try {
      // --- NEW LOGIC: Start waiting for the response BEFORE navigating ---
      const responsePromise = page.waitForResponse(
        response => response.url().endsWith('.jpg') && response.ok(),
        { timeout: 30000 } // 5-minute timeout for you to solve
      );

      console.log(` -> Navigating to: ${imageUrl}`);
      await page.goto(imageUrl, { waitUntil: 'domcontentloaded' });

      console.log('\n>>> ACTION REQUIRED: Please solve the CAPTCHA in the browser. The script will wait for the image download...');

      // --- NEW LOGIC: Wait for the network response promise to resolve ---
      const finalResponse = await responsePromise;

      console.log(' -> Image response received! Saving...');
      const buffer = await finalResponse.buffer();
      fs.writeFileSync(filepath, buffer);
      
      console.log(` -> Image successfully saved!`);
      return; // Exit the function on success
    } catch (error) {
      console.log(` -> URL ${path.basename(imageUrl)} failed or timed out. Trying next...`);
    }
  }

  throw new Error(`Failed to save image from all possible URLs.`);
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
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    userDataDir: '/Users/drewcannon3/Library/Application Support/Google/Chrome/Default',
    ignoreDefaultArgs: ['--enable-automation'] // <-- ADD THIS LINE
});

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

      console.log(`Processing card ${player.card_id} for ${player.name}...`);
      const imagePath = path.join(imagesDir, `${player.card_id}.jpg`);
      
      // We pass the new, clean page into the function
      await downloadImageDirectly(page, player, imagePath);
      
      //await updateCardImagePath(client, player.card_id, imagePath);
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
      
    }
  }
  
  // Your summary log can be improved to show failures
  console.log(`\nScript finished. \nSuccessfully downloaded: ${successCount} \nFailed: ${failureCount}`);

  await browser.close();
  await pool.end();
}

main();
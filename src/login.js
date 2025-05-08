import { chromium } from 'playwright-core';
import Browserbase from '@browserbasehq/sdk';
import { config } from './config.js';
import winston from 'winston';

// ADDED: Setup logger instance (can be simplified if winston is already configured globally and exported)
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(), // Keep it simple for this module, or use shared config
    transports: [
        new winston.transports.Console(),
    ],
});

// Updated selectors for Canvas login based on provided screenshots
const USERNAME_SELECTOR = 'input#username'; // From screenshot, specific ID
const PASSWORD_SELECTOR = 'input#password'; // From screenshot, specific ID
const LOGIN_BUTTON_SELECTOR = 'button[data-testid="login-button"]'; // Matches screenshot and previous
// const POST_LOGIN_SELECTOR = '#dashboard'; // REMOVED - Rely on networkidle in scraper.js

const bb = new Browserbase({
  apiKey: config.browserbaseApiKey,
});

/**
 * Logs into Canvas using Browserbase and Playwright.
 * @returns {Promise<object>} An object containing the Playwright Page, Browser, and Session objects after successful login.
 * @throws {Error} If login fails.
 */
export async function loginToCanvas() {
  let session;
  let browser;
  try {
    console.log('Creating Browserbase session for Canvas...');
    session = await bb.sessions.create({
      projectId: config.browserbaseProjectId,
      // Enable stealth mode if needed (as per spec)
      // stealth: true,
    });

    console.log(`Connecting to session: ${session.id}...`);
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0];
    const page = context.pages()[0];

    console.log(`Navigating to ${config.canvasLoginUrl}...`); // Use a new config var for Canvas URL
    await page.goto(config.canvasLoginUrl, { waitUntil: 'networkidle' });

    console.log('Attempting to log in to Canvas...');

    // Wait for login form elements to be visible
    await page.waitForSelector(USERNAME_SELECTOR, { timeout: 15000 });

    // Fill in credentials
    console.log('Filling username...');
    await page.fill(USERNAME_SELECTOR, config.canvasUsername); // Use new config vars
    console.log('Filling password...');
    await page.fill(PASSWORD_SELECTOR, config.canvasPassword); // Use new config vars

    // Click login button
    console.log('Clicking login button...');
    await page.click(LOGIN_BUTTON_SELECTOR);

    // Explicitly wait for navigation to the target quiz URL after login
    logger.info(`Waiting for navigation to quiz page: ${config.canvasLoginUrl} after login submission...`);
    await page.waitForURL(config.canvasLoginUrl, { timeout: 25000, waitUntil: 'networkidle' });
    logger.info(`Successfully navigated to quiz page: ${page.url()}`);

    // Assuming navigation to the quiz page (config.canvasLoginUrl) occurs and networkidle will catch it in the calling function.
    // console.log('Canvas Login button clicked. Page should redirect to quiz or specified URL.'); // Old log
    // console.log(`View session replay: https://app.browserbase.com/sessions/${session.id}`); // This log can be moved to scraper.js after login returns

    return { page, browser, session };

  } catch (error) {
    console.error('Canvas login failed:', error);
    if (session) {
      console.error(`Session ID for debugging: ${session.id}`);
      console.error(`View session replay: https://app.browserbase.com/sessions/${session.id}`);
    }
    if (browser) {
        try { await browser.close(); } catch (e) { console.error('Error closing browser:', e); }
    }
    // Optionally delete session on failure for cleanup, or leave for inspection
    // if (session) { try { await bb.sessions.delete(session.id); } catch (e) { /* ... */ } }
    throw new Error(`Canvas login failed: ${error.message}`);
  }
}

// Example usage (for testing this module directly)
async function testLogin() {
  let loginResult;
  try {
    // Ensure config.js has canvasLoginUrl, canvasUsername, canvasPassword
    loginResult = await loginToCanvas();
    console.log('Canvas Login test successful. Page title:', await loginResult.page.title());
  } catch (e) {
    console.error('Canvas Login test failed:', e);
  } finally {
    // Clean up after test
    if (loginResult?.browser) {
      await loginResult.browser.close();
      console.log('Browser closed.');
    }
    // if (loginResult?.session) { /* delete session */ }
  }
}

// Uncomment the line below to run the test when executing this file directly
// testLogin(); 
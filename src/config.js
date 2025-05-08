import dotenv from 'dotenv';
dotenv.config();

export const config = {
  browserbaseApiKey: process.env.BROWSERBASE_API_KEY,
  browserbaseProjectId: process.env.BROWSERBASE_PROJECT_ID,
  canvasUsername: process.env.CANVAS_USERNAME,
  canvasPassword: process.env.CANVAS_PASSWORD,
  canvasLoginUrl: process.env.CANVAS_LOGIN_URL, // Read from .env
  openaiApiKey: process.env.OPENAI_API_KEY,
};

// Basic validation
if (!config.browserbaseApiKey || !config.browserbaseProjectId) {
  throw new Error('Browserbase API Key or Project ID is missing. Check your .env file.');
}

if (!config.canvasUsername || !config.canvasPassword) {
  throw new Error('Canvas credentials are missing. Check your .env file.');
}

if (!config.canvasLoginUrl) { // Add validation for the new env variable
    throw new Error('Canvas login URL is missing. Check your .env file.');
}

if (!config.openaiApiKey) {
  throw new Error('OpenAI API Key is missing. Check your .env file.');
} 
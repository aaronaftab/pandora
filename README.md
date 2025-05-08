# Pandora

Pandora is a testing framework for evaluating online assessments on their susceptibility to AI-based cheating. It's designed as a Node.js script that uses Playwright, Browserbase, and the OpenAI API (GPT-4o for vision and analysis) to automatically navigate and complete Canvas quizzes, but can be modified to work with any online learning system.

## Features

*   Logs into Canvas/other LMS using provided credentials.
*   Navigates to specified quiz/assessment.
*   Dynamically determines the number of questions on the quiz landing page.
*   For each question:
    *   Takes a screenshot.
    *   Uses OpenAI GPT-4o vision capabilities to analyze the screenshot, determine the question type, text, and available options.
    *   Determines and submits the correct answer.
    *   Selects the answer(s) on the page, navigates to the next question or submits the quiz.
*   Saves screenshots of each question and post-submission page for debugging and review.
*   Logs detailed information about its progress and any errors encountered.

## Prerequisites

*   Node.js (v16 or later recommended)
*   npm (usually comes with Node.js)
*   Access to a Canvas instance with a quiz you want to target, or an LMS of your choice with an assessment you want to test.
*   A Browserbase account and API key (free plan includes 60 min of scraping/month)
*   An OpenAI account and API key (running this on a 5-question Canvas quiz takes about 

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd <your-repository-directory>
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Create a `.env` file in the root of the project directory by copying and renaming .env.example.

    ```env.example
    # Browserbase Configuration
    BROWSERBASE_API_KEY="your_browserbase_api_key_here"
    BROWSERBASE_PROJECT_ID="your_browserbase_project_id_here"

    # Canvas Credentials & Target URL
    CANVAS_USERNAME="your_canvas_username"
    CANVAS_PASSWORD="your_canvas_password"
    CANVAS_LOGIN_URL="your_target_canvas_quiz_url_here" # Important: This should be the direct URL to the quiz landing page

    # OpenAI API Key
    OPENAI_API_KEY="your_openai_api_key_here"
    ```

    **How to get the credentials:**

    *   **Browserbase API Key & Project ID:**
        1.  Sign up or log in to your [Browserbase account](https://www.browserbase.com).
        2.  Your API Key can typically be found in your account settings or API section.
        3.  Create a new project in Browserbase if you haven't already. The Project ID will be visible in the project's settings or dashboard.

    *   **Canvas Credentials & Target URL:**
        *   `CANVAS_USERNAME`: Your username for logging into Canvas.
        *   `CANVAS_PASSWORD`: Your password for logging into Canvas.
        *   `CANVAS_LOGIN_URL`: This is the **direct URL to the quiz you want the bot to take**. The bot uses this URL both to log in (if redirected) and as the target page after login. Example: `https://your.canvas.instance.com/courses/12345/quizzes/67890`

    *   **OpenAI API Key:**
        1.  Sign up or log in to your [OpenAI account](https://platform.openai.com/).
        2.  Navigate to the API keys section in your account dashboard.
        3.  Create a new secret key and copy it. Ensure you have enough credits/quota for using the GPT-4o model.

## Usage

Once the setup is complete and your `.env` file is configured, you can run the scraper from the root of the project directory:

```bash
node src/scraper.js
```

The script will start logging its progress to the console. Screenshots and detailed logs (`error.log`, `combined.log`) will be saved in the `output/` directory (created if it doesn't exist) and `output/screenshots/` respectively.

## How it Works - Key Components

*   **`src/config.js`**: Loads environment variables from the `.env` file.
*   **`src/login.js`**: Handles logging into Canvas using Browserbase and Playwright.
*   **`src/scraper.js`**: Contains the main orchestration logic:
    *   `runCanvasScraper()`: Initializes the process, logs in, navigates to the quiz, scrapes the number of questions, and calls `handleDiagnostic`.
    *   `handleDiagnostic()`: Iterates through each question. For each question:
        *   Takes a screenshot.
        *   Sends the screenshot to GPT-4o for analysis (question text, type, options, correct answer).
        *   Interacts with the page to select the answer based on LLM output (with fallback to the first option for MCQs if no answer is determined).
        *   Clicks "Next" or "Submit Quiz" using predefined CSS selectors.

## Important Notes & Disclaimer

*   **CSS Selectors**: The script relies on CSS selectors for interacting with Canvas elements (e.g., "Take the Quiz" button, answer labels, "Next" button, "Submit Quiz" button). These selectors are hardcoded in `src/scraper.js`. If the Canvas UI changes or your specific Canvas instance has a different structure, these selectors might need to be updated. The current selectors are based on a standard Canvas quiz interface.
*   **Ethical Considerations**: This bot is for educational and experimental purposes. Automating quiz-taking may violate the terms of service of your educational institution or Canvas. Ensure you have permission and are using this script responsibly. The user of this script is solely responsible for any consequences of its use.
*   **LLM Accuracy**: The accuracy of the OpenAI GPT-4o model in interpreting questions and determining correct answers is not guaranteed. The bot may select incorrect answers.
*   **Error Handling**: The script includes error handling, but complex or unexpected quiz structures might lead to issues. Check the logs and session replays on Browserbase for debugging.
*   **Costs**: Be mindful of the costs associated with using the Browserbase service and the OpenAI API, especially with frequent runs or long quizzes.

## Troubleshooting

*   **Error: `page.goto: url: expected string, got undefined` for `canvasQuizUrl`**: Ensure `CANVAS_LOGIN_URL` in your `.env` file is correctly set to the full URL of the quiz. The script uses this single URL as the target.
*   **Failed to click "Next" or "Submit" buttons**: The CSS selectors in `src/scraper.js` might need adjustment for your specific Canvas instance or quiz structure. Use your browser's developer tools to inspect the buttons and update the selectors accordingly.
*   **LLM not returning correct answers**:
    *   Check the `output/screenshots/` to see what the LLM is "seeing".
    *   The prompt in `handleDiagnostic` can be tuned for better performance, but complex questions or unusual layouts might still be challenging.
*   **Authentication issues**: Double-check your `CANVAS_USERNAME` and `CANVAS_PASSWORD` in the `.env` file. Ensure the `CANVAS_LOGIN_URL` is correct. Watch the Browserbase session replay for clues. 

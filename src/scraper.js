import { loginToCanvas } from './login.js';
import { config } from './config.js';
import OpenAI from 'openai';
import winston from 'winston';
import fs from 'fs';
import path from 'path';

// Setup logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple(),
        }),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
    ],
});

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

async function handleDiagnostic(page, maxQuestionsToProcess) {
    logger.info(`Starting diagnostic test handling for ${maxQuestionsToProcess} questions (dynamically determined).`);
    const diagnosticData = [];
    const screenshotDir = path.join('output', 'screenshots');

    // Define hardcoded selectors for quiz interaction
    const NEXT_QUESTION_BUTTON_SELECTOR = 'button.Button.submit_button.next-question:has-text("Next")';
    const SUBMIT_QUIZ_BUTTON_SELECTOR = 'button#submit_quiz_button:has-text("Submit Quiz")';

    try {
        await fs.promises.mkdir(screenshotDir, { recursive: true });
        logger.info(`Ensured screenshot directory exists: ${screenshotDir}`);

        for (let i = 0; i < maxQuestionsToProcess; i++) {
            const questionIndex = i + 1;
            logger.info(`--- Processing Question ${questionIndex} of ${maxQuestionsToProcess} ---`);

            logger.info('Waiting for question page to be ready...');
            await page.waitForLoadState('networkidle', { timeout: 10000 });

            // --- 1. Take Screenshot of Question ---
            logger.info('Taking screenshot of the question page...');
            const questionScreenshotBuffer = await page.screenshot({ fullPage: true });
            const questionBase64Image = questionScreenshotBuffer.toString('base64');
            const questionScreenshotPath = path.join(screenshotDir, `Q${questionIndex}_question.png`);
            await fs.promises.writeFile(questionScreenshotPath, questionScreenshotBuffer);
            logger.info(`Saved question screenshot to: ${questionScreenshotPath}`);

            // --- 2. Call LLM for Question Analysis and Answer (from image) ---
            logger.info('Calling GPT-4o (vision) for question analysis and answer...');
            const questionAnalysisPrompt = `Analyze the provided screenshot of a quiz question page. Determine the question text, and classify the questionType.
Available questionTypes are: "multiple-choice-single" (requires selecting one option using a radio button), "multiple-choice-multiple" (allows selecting multiple options using checkboxes), "free-response", or "other". Pay close attention to the input elements: checkboxes usually indicate multiple selections are possible (multiple-choice-multiple), while radio buttons usually indicate only a single selection is possible (multiple-choice-single).

For "multiple-choice-single":
- Provide the full text of the correct answer as a string in the "correctAnswer" field.
- "options" should be an array of all visible option texts.

For "multiple-choice-multiple":
- Provide an array of strings, where each string is the full text of a correct option that should be selected, in the "correctAnswer" field.
- "options" should be an array of all visible option texts.

For "free-response":
- Provide the correct answer text/value as a string in the "correctAnswer" field.
- "options" should be null.

Identify any relevant images present in the question content.

Respond ONLY with a JSON object containing:
- questionText: string (The main text of the question)
- questionType: string ("multiple-choice-single" | "multiple-choice-multiple" | "free-response" | "other")
- options: string[] | null (Array of all option texts for MCQs, null otherwise)
- imagesPresent: boolean
- correctAnswer: string | string[] | null (Single string for single-choice MC & free-response; array of strings for multiple-choice-multiple; null if not applicable or cannot determine)
- correctAnswerLetter: string | null (DEPRECATED - can be removed or set to null, as we will use full answer text)

JSON response:`;

            const questionResponse = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: questionAnalysisPrompt },
                            { type: "image_url", image_url: { url: `data:image/png;base64,${questionBase64Image}` } },
                        ],
                    },
                ],
                max_tokens: 600, // Adjusted tokens for potentially more complex question structures
                response_format: { type: "json_object" },
            });

            const questionLlmAnalysisString = questionResponse.choices[0]?.message?.content;
            if (!questionLlmAnalysisString) throw new Error(`LLM did not return content for question ${questionIndex}.`);
            logger.info('Received LLM vision analysis for question.');
            let questionLlmAnalysis = JSON.parse(questionLlmAnalysisString);
            logger.info("Parsed LLM Question Vision Analysis:", questionLlmAnalysis);

            // Fallback: If LLM returns null for correctAnswer but provides options for MCQs, pick the first option.
            if (questionLlmAnalysis.correctAnswer === null && 
                (questionLlmAnalysis.questionType === 'multiple-choice-single' || questionLlmAnalysis.questionType === 'multiple-choice' || questionLlmAnalysis.questionType === 'multiple-choice-multiple') && 
                Array.isArray(questionLlmAnalysis.options) && questionLlmAnalysis.options.length > 0) {
                
                const fallbackAnswer = questionLlmAnalysis.options[0];
                logger.warn(`Q${questionIndex}: LLM did not provide a correct answer. Using fallback: selecting the first option: "${fallbackAnswer}"`);
                
                if (questionLlmAnalysis.questionType === 'multiple-choice-multiple') {
                    questionLlmAnalysis.correctAnswer = [fallbackAnswer]; // For multiple-choice-multiple, it expects an array
                } else {
                    questionLlmAnalysis.correctAnswer = fallbackAnswer; // For single choice
                }
            }

            // --- 3. Interact with Page (Answer and Submit) using hardcoded selectors ---

            if ((questionLlmAnalysis.questionType === 'multiple-choice-single' || questionLlmAnalysis.questionType === 'multiple-choice' || questionLlmAnalysis.questionType === 'multiple-choice-multiple') && questionLlmAnalysis.correctAnswer) {
                if (questionLlmAnalysis.questionType === 'multiple-choice-multiple' && Array.isArray(questionLlmAnalysis.correctAnswer)) {
                    logger.info(`Attempting to select multiple answers for a "multiple-choice-multiple" question.`);
                    for (const answerText of questionLlmAnalysis.correctAnswer) {
                        logger.info(`Attempting to select option: "${answerText}"`);
                        const mcOptionLabelSelector = `label:has-text("${answerText.replace(/"/g, '\\"')}")`;
                        try {
                            await page.locator(mcOptionLabelSelector).click({ timeout: 10000 }); // Shorter timeout for individual option
                            logger.info(`Clicked MC option label with text: "${answerText}"`);
                        } catch (error) {
                            logger.error(`Failed to find or click MC option label for Q${questionIndex} with text "${answerText}". Error: ${error.message}`);
                            await page.screenshot({ path: path.join(screenshotDir, `Q${questionIndex}_error_mc_option_${answerText.replace(/\s+/g, '_')}.png`), fullPage: true });
                            // Continue to try other answers even if one fails
                        }
                    }
                } else if (typeof questionLlmAnalysis.correctAnswer === 'string') { // Handles multiple-choice-single or if LLM misclassifies but gives single string
                    const answerText = questionLlmAnalysis.correctAnswer;
                    logger.info(`Attempting to select single multiple-choice answer with text: "${answerText}"`);
                    const mcOptionLabelSelector = `label:has-text("${answerText.replace(/"/g, '\\"')}")`;
                    try {
                        await page.locator(mcOptionLabelSelector).click({ timeout: 15000 });
                        logger.info(`Clicked MC option label with text: "${answerText}"`);
                    } catch (error) {
                        logger.error(`Failed to find or click MC option label for Q${questionIndex} with text "${answerText}". Error: ${error.message}`);
                        await page.screenshot({ path: path.join(screenshotDir, `Q${questionIndex}_error_mc_option.png`), fullPage: true });
                    }
                } else {
                    logger.warn(`Q${questionIndex}: correctAnswer format is not recognized for multiple choice. CorrectAnswer: ${JSON.stringify(questionLlmAnalysis.correctAnswer)}`);
                }
            } else if (questionLlmAnalysis.questionType === 'free-response') {
                logger.warn(`Q${questionIndex}: Free-response questions are not being automatically answered in this version. Skipping interaction.`);
                // TODO: Implement interaction for free-response questions if needed in the future.
            } else {
                logger.warn(`Q${questionIndex}: Cannot interact with question type "${questionLlmAnalysis.questionType}" or missing correct answer data from vision LLM.`);
            }

            // Determine whether to click "Next" or "Submit Quiz" based on question number
            let actionTaken = 'unknown';

            if (questionIndex < maxQuestionsToProcess) {
                // Expect and click the "Next" button
                try {
                    logger.info(`Attempting to click Next button for Q${questionIndex} (not the last question) using selector: ${NEXT_QUESTION_BUTTON_SELECTOR}`);
                    await page.locator(NEXT_QUESTION_BUTTON_SELECTOR).click({ timeout: 15000 }); // Standard timeout
                    logger.info(`Clicked Next button for Q${questionIndex}.`);
                    actionTaken = 'next_question_clicked';

                    // --- 3.5 Wait and Screenshot after Next click ---
                    logger.info('Waiting after Next button click for potential explanation/feedback or next question...');
                    await page.waitForLoadState('networkidle', { timeout: 15000 });
                    await page.waitForTimeout(2000); // Small extra buffer

                    logger.info('Taking screenshot of the post-Next click page...');
                    const explanationScreenshotBuffer = await page.screenshot({ fullPage: true });
                    const explanationScreenshotPath = path.join(screenshotDir, `Q${questionIndex}_after_next.png`);
                    await fs.promises.writeFile(explanationScreenshotPath, explanationScreenshotBuffer);
                    logger.info(`Saved post-Next click screenshot to: ${explanationScreenshotPath}`);

                } catch (error) {
                    logger.error(`Critical: Failed to click Next button for Q${questionIndex} when it was expected. Error: ${error.message}`);
                    await page.screenshot({ path: path.join(screenshotDir, `Q${questionIndex}_error_next_click.png`), fullPage: true });
                    actionTaken = 'error_clicking_next';
                    throw new Error(`Failed to click Next button for Q${questionIndex}: ${error.message}`);
                }
            } else { // This is the last question (questionIndex === maxQuestionsToProcess)
                // Expect and click the "Submit Quiz" button
                try {
                    logger.info(`Attempting to click Submit Quiz button for Q${questionIndex} (last question) using selector: ${SUBMIT_QUIZ_BUTTON_SELECTOR}`);
                    await page.locator(SUBMIT_QUIZ_BUTTON_SELECTOR).click({ timeout: 15000 }); // Standard timeout
                    logger.info('Submit Quiz button clicked successfully.');
                    actionTaken = 'quiz_submitted';
                } catch (error) {
                    logger.error(`Critical: Failed to click Submit Quiz button on the last question (Q${questionIndex}). Error: ${error.message}`);
                    await page.screenshot({ path: path.join(screenshotDir, `Q${questionIndex}_error_submit_quiz.png`), fullPage: true });
                    actionTaken = 'error_clicking_submit';
                    throw new Error(`Failed to click Submit Quiz button for Q${questionIndex}: ${error.message}`);
                }
            }

            diagnosticData.push({
                questionIndex,
                llmAnalysis: questionLlmAnalysis,
                actionTaken: actionTaken,
            });
            logger.info(`--- Finished processing attempt for Question ${questionIndex} ---`);

            if (actionTaken === 'quiz_submitted') {
                logger.info('Quiz has been submitted (last question processed). Ending diagnostic handling.');
                return diagnosticData; // Exit from handleDiagnostic
            }
            // If loop continues, it means next_question_clicked was the action

        } // End of for loop for questions

        logger.info('Successfully processed all designated questions.');
        return diagnosticData;

    } catch (error) {
        logger.error('An error occurred during the diagnostic handling process:', error);
        // Log current URL if page object is available
        if (page && typeof page.url === 'function') logger.error(`Error occurred on page: ${page.url()}`);
        // Make sure to re-throw or handle appropriately so runCanvasScraper knows about the failure.
        throw error; 
    }
}

// Main execution function for Canvas flow
async function runCanvasScraper() {
  let loginResult;
  const screenshotDir = path.join('output', 'screenshots');

  // Define hardcoded selectors
  const START_QUIZ_SELECTOR = 'a.btn.btn-primary:has-text("Take the Quiz")';
  const QUESTIONS_COUNT_SELECTOR = 'li:has(span.title:has-text("Questions")) > span.value';

  try {
    await fs.promises.mkdir(screenshotDir, { recursive: true });
    logger.info(`Ensured screenshot directory exists: ${screenshotDir}`);

    logger.info('Attempting to log in to Canvas...');
    loginResult = await loginToCanvas();
    const { page, browser, session } = loginResult;
    logger.info(`Canvas login successful. Session ID: ${session.id}`);
    logger.info(`View session replay: https://app.browserbase.com/sessions/${session.id}`);

    // The page should already be at the quiz URL (config.canvasLoginUrl) after loginToCanvas completes.
    logger.info(`Currently at quiz page: ${page.url()} (navigated by loginToCanvas)`);

    // Wait for the quiz content to load - e.g., for the "Take the Quiz" button
    logger.info(`Waiting for quiz landing page content to load, looking for Start Quiz button: ${START_QUIZ_SELECTOR}`);
    await page.waitForSelector(START_QUIZ_SELECTOR, { timeout: 20000 });
    logger.info('"Start Quiz" button is visible.');

    // Dynamically scrape the number of questions
    let actualMaxQuestions;
    try {
        logger.info(`Attempting to scrape MAX_QUESTIONS using selector: ${QUESTIONS_COUNT_SELECTOR}`);
        const questionsCountText = await page.locator(QUESTIONS_COUNT_SELECTOR).textContent({ timeout: 10000 });
        actualMaxQuestions = parseInt(questionsCountText, 10);
        if (isNaN(actualMaxQuestions) || actualMaxQuestions <= 0) {
            logger.error(`Failed to parse a valid number for MAX_QUESTIONS from text: "${questionsCountText}". Defaulting to 1.`);
            actualMaxQuestions = 1; // Default to 1 if parsing fails, to prevent errors, though this quiz attempt might be incomplete.
        } else {
            logger.info(`Successfully scraped MAX_QUESTIONS: ${actualMaxQuestions}`);
        }
    } catch (error) {
        logger.error(`Failed to scrape MAX_QUESTIONS from the page. Error: ${error.message}. Defaulting to 1.`);
        actualMaxQuestions = 1; // Default if selector fails
        // Consider if you want to throw an error here or proceed with a default.
        // For now, proceeding with a default to attempt at least one question.
    }

    // Click "Start Quiz" / "Take the Quiz" button using hardcoded selector
    logger.info(`Attempting to click "Start Quiz" button with hardcoded selector: ${START_QUIZ_SELECTOR}`);
    await page.locator(START_QUIZ_SELECTOR).click({ timeout: 20000 });
    logger.info('"Start Quiz" button clicked successfully.');
    
    // Wait for navigation/content update after clicking "Start Quiz"
    logger.info('Waiting for quiz to load after clicking "Start Quiz"...');
    await page.waitForLoadState('networkidle', { timeout: 20000 }); // General wait
    // Add more specific waits here if needed, e.g., for the first question's container.

    // Start handling the diagnostic/quiz questions
    await handleDiagnostic(page, actualMaxQuestions);

    logger.info('Canvas scraping process completed.');
    if (session) {
      logger.info(`View session replay: https://app.browserbase.com/sessions/${session.id}`);
    }
  } catch (error) {
    logger.error('An error occurred during the Canvas scraping process:', error);
     if (loginResult?.session) {
       logger.error(`Session ID for debugging: ${loginResult.session.id}`);
       logger.error(`View session replay: https://app.browserbase.com/sessions/${loginResult.session.id}`);
     }
  } finally {
    // Cleanup
    if (loginResult?.browser) {
      logger.info('Closing browser...');
      await loginResult.browser.close();
    }
    if (loginResult?.session) {
       // Optionally delete the session
       // logger.info(`Deleting session ${loginResult.session.id}`);
       // const bb = new Browserbase({ apiKey: config.browserbaseApiKey }); // Need instance here
       // await bb.sessions.delete(loginResult.session.id);
    }
    logger.info('Canvas scraper finished.');
  }
}

// Run the scraper
runCanvasScraper(); 
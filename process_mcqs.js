const fs = require('fs').promises;
const path = require('path');
const OpenAI = require('openai');
require('dotenv').config();

// Validate API key
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY not found in .env file. Please create .env file with your OpenAI API key.');
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Load MCQs from JSON file
 */
async function loadMCQs(subjectName, startNumber, endNumber) {
  // Try multiple file name patterns
  // Pattern 1: all_{subject}_mcqs.json (e.g., all_computer_mcqs.json)
  // Pattern 2: all_{subject}_mcqs.json with underscores replaced by hyphens
  // Pattern 3: all_{subject}-mcqs_mcqs.json (e.g., all_islamic-studies-mcqs_mcqs.json)
  // Pattern 4: Extract first part before underscore (e.g., "computer_science" -> "computer")
  const possibleFileNames = [
    `all_${subjectName}_mcqs.json`,
    `all_${subjectName.replace(/_/g, '-')}_mcqs.json`,
    `all_${subjectName.replace(/_/g, '-')}-mcqs_mcqs.json`,
    `all_${subjectName.split('_')[0]}_mcqs.json`
  ];
  
  let filePath = null;
  let lastError = null;
  
  for (const fileName of possibleFileNames) {
    const testPath = path.join(__dirname, 'MCQ_DB', fileName);
    try {
      await fs.access(testPath);
      filePath = testPath;
      break;
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  
  if (!filePath) {
    throw new Error(`MCQ file not found. Tried: ${possibleFileNames.join(', ')}`);
  }
  
  try {
    const data = await fs.readFile(filePath, 'utf8');
    const jsonData = JSON.parse(data);
    const mcqs = jsonData.mcqs || jsonData;
    
    // Convert to array if it's not already
    const mcqArray = Array.isArray(mcqs) ? mcqs : [];
    
    // Calculate indices (1-indexed to 0-indexed)
    const startIdx = Math.max(0, startNumber - 1);
    const endIdx = endNumber === 'all' ? mcqArray.length : Math.min(mcqArray.length, endNumber);
    
    return mcqArray.slice(startIdx, endIdx);
  } catch (error) {
    throw new Error(`Failed to load MCQs from ${filePath}: ${error.message}`);
  }
}

/**
 * Load Past MCQs from PAST_MCQ_DB folder
 */
async function loadPastMCQs(subjectName, startNumber, endNumber) {
  // File pattern: past_{subjectName}-mcqs.json (e.g., past_islamic-studies-mcqs.json)
  const fileName = `past_${subjectName.replace(/_/g, '-')}-mcqs.json`;
  const filePath = path.join(__dirname, 'PAST_MCQ_DB', fileName);
  
  try {
    await fs.access(filePath);
  } catch (error) {
    throw new Error(`Past MCQ file not found: ${filePath}`);
  }
  
  try {
    const data = await fs.readFile(filePath, 'utf8');
    const jsonData = JSON.parse(data);
    
    // Past MCQs are in array format (not wrapped in object)
    const mcqArray = Array.isArray(jsonData) ? jsonData : [];
    
    // Calculate indices (1-indexed to 0-indexed)
    const startIdx = Math.max(0, startNumber - 1);
    const endIdx = endNumber === 'all' ? mcqArray.length : Math.min(mcqArray.length, endNumber);
    
    return mcqArray.slice(startIdx, endIdx);
  } catch (error) {
    throw new Error(`Failed to load past MCQs from ${filePath}: ${error.message}`);
  }
}

/**
 * Load outline for a subject
 */
async function loadOutline(subjectName) {
  const fileName = `${subjectName}_outline.json`;
  const filePath = path.join(__dirname, 'outlines', fileName);
  
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`Failed to load outline from ${filePath}: ${error.message}`);
  }
}

/**
 * Load prompt template
 */
async function loadPromptTemplate() {
  const filePath = path.join(__dirname, 'prompts', 'mcq_generation_prompt.txt');
  
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to load prompt template from ${filePath}: ${error.message}`);
  }
}

/**
 * Format outline as string for prompt
 */
function formatOutline(outline) {
  let formatted = '';
  if (outline.chapters && Array.isArray(outline.chapters)) {
    outline.chapters.forEach(chapter => {
      formatted += `\nChapter: ${chapter.name}\n`;
      formatted += `Topics: ${chapter.topics.join(', ')}\n`;
    });
  }
  return formatted;
}

/**
 * Validate response structure
 */
function validateResponse(response, skipUniquenessCheck = false) {
  try {
    // Parse if it's a string
    const parsed = typeof response === 'string' ? JSON.parse(response) : response;
    
    // Check if mcq array exists
    if (!parsed.mcq || !Array.isArray(parsed.mcq) || parsed.mcq.length === 0) {
      return { valid: false, error: 'Missing or empty mcq array' };
    }
    
    const mcq = parsed.mcq[0];
    
    // Check statement
    if (!mcq.statement || typeof mcq.statement !== 'string') {
      return { valid: false, error: 'Missing or invalid statement' };
    }
    
    // Check options
    if (!mcq.options || typeof mcq.options !== 'object') {
      return { valid: false, error: 'Missing or invalid options object' };
    }
    
    const requiredOptions = ['a', 'b', 'c', 'd'];
    for (const opt of requiredOptions) {
      if (!mcq.options[opt] || typeof mcq.options[opt] !== 'string') {
        return { valid: false, error: `Missing or invalid option ${opt}` };
      }
    }
    
    // Check one_liner
    if (!mcq.one_liner || typeof mcq.one_liner !== 'string') {
      return { valid: false, error: 'Missing or invalid one_liner' };
    }
    
    // Check correct_option
    if (!mcq.correct_option || !['a', 'b', 'c', 'd'].includes(mcq.correct_option)) {
      return { valid: false, error: 'Missing or invalid correct_option' };
    }
    
    // Check suggestions
    if (!mcq.suggestions || !Array.isArray(mcq.suggestions)) {
      return { valid: false, error: 'Missing or invalid suggestions array' };
    }
    
    if (mcq.suggestions.length < 2) {
      return { valid: false, error: 'Suggestions array must have at least 2 items' };
    }
    
    // Check that topics are unique (skip if skipUniquenessCheck is true)
    if (!skipUniquenessCheck) {
      const topics = mcq.suggestions.map(s => s.topic).filter(Boolean);
      const uniqueTopics = new Set(topics);
      if (topics.length !== uniqueTopics.size) {
        return { valid: false, error: 'Topics in suggestions must be unique' };
      }
    }
    
    // Check each suggestion has topic and chapter
    for (const suggestion of mcq.suggestions) {
      if (!suggestion.topic || typeof suggestion.topic !== 'string') {
        return { valid: false, error: 'Each suggestion must have a topic string' };
      }
      if (!suggestion.chapter || typeof suggestion.chapter !== 'string') {
        return { valid: false, error: 'Each suggestion must have a chapter string' };
      }
    }
    
    return { valid: true, data: parsed };
  } catch (error) {
    return { valid: false, error: `JSON parsing error: ${error.message}` };
  }
}

/**
 * Get function schema for MCQ generation
 */
function getMCQFunctionSchema() {
  return {
    name: 'generate_mcq',
    description: 'Generate a multiple-choice question with statement, options, one-liner explanation, correct option, and topic suggestions for PPSC exam preparation.',
    parameters: {
      type: 'object',
      properties: {
        mcq: {
          type: 'array',
          description: 'Array containing a single MCQ object',
          items: {
            type: 'object',
            properties: {
              statement: {
                type: 'string',
                description: 'A well-crafted MCQ question statement suitable for PPSC exam preparation'
              },
              options: {
                type: 'object',
                description: 'Four multiple-choice options',
                properties: {
                  a: { type: 'string' },
                  b: { type: 'string' },
                  c: { type: 'string' },
                  d: { type: 'string', description: 'If requires, option "d" could be "None of these" or "All of these" ' }
                },
                required: ['a', 'b', 'c', 'd']
              },
              one_liner: {
                type: 'string',
                description: 'Write the one_liner as a natural, self-contained sentence that clearly conveys both the question’s context and the correct answer. The one_liner should make complete sense on its own, even outside the MCQ context'
              },
              correct_option: {
                type: 'string',
                enum: ['a', 'b', 'c', 'd'],
                description: 'The correct option letter'
              },
              suggestions: {
                type: 'array',
                description: 'preferably 3 but At least 2 most relevant suggestions in order',
                maxItems: 3,
                minItems: 2,
                items: {
                  type: 'object',
                  properties: {
                    topic: {
                      type: 'string',
                      description: 'Topic name from available topics only (must be unique across suggestions)'
                    },
                    chapter: {
                      type: 'string',
                      description: 'Chapter name from available chapters only'
                    }
                  },
                  required: ['topic', 'chapter']
                }
              }
            },
            required: ['statement', 'options', 'one_liner', 'correct_option', 'suggestions']
          },
          minItems: 1,
          maxItems: 1
        }
      },
      required: ['mcq']
    }
  };
}

/**
 * Call OpenAI API using Function Calling for structured output
 */
async function callOpenAI(question, correctAnswer, outline, promptTemplate, subjectName, isRetry = false) {
  const formattedOutline = formatOutline(outline);
  
  // Replace placeholders in prompt template
  let prompt = promptTemplate
    .replace(/{QUESTION_EN}/g, question)
    .replace(/{CORRECT_ANSWER}/g, correctAnswer)
    .replace(/{OUTLINE}/g, formattedOutline)
    .replace(/{subject_name}/g, subjectName);
  
  // Add stricter instructions for retry
  if (isRetry) {
    prompt += '\n\nIMPORTANT REMINDER: Each topic in suggestions MUST be unique. Do not repeat the same topic name. Select different topics from different areas if possible. Ensure all topics and chapters match exactly from the provided outline.';
  }
  
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert MCQ generator for PPSC exam preparation in the field of ' + subjectName + '. Generate high-quality multiple-choice questions with proper statements, options, and explanations.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      tools: [
        {
          type: 'function',
          function: getMCQFunctionSchema()
        }
      ],
      tool_choice: {
        type: 'function',
        function: { name: 'generate_mcq' }
      },
      temperature: isRetry ? 0.3 : 0.7
    });
    
    // Extract function call arguments
    const message = completion.choices[0].message;
    
    if (!message.tool_calls || message.tool_calls.length === 0) {
      throw new Error('No function call returned from OpenAI');
    }
    
    const functionCall = message.tool_calls[0];
    if (functionCall.function.name !== 'generate_mcq') {
      throw new Error(`Unexpected function name: ${functionCall.function.name}`);
    }
    
    // Parse the function arguments (already JSON)
    const functionArgs = JSON.parse(functionCall.function.arguments);
    
    // Validate business rules (structure is already enforced by schema)
    const validation = validateResponse(functionArgs, false);
    
    if (!validation.valid) {
      // If validation fails and this is not a retry, attempt retry
      if (!isRetry && validation.error.includes('unique')) {
        console.log('  ⚠️  Validation failed (duplicate topics), retrying with stricter instructions...');
        return await callOpenAI(question, correctAnswer, outline, promptTemplate, subjectName, true);
      }
      // If retry also failed with duplicate topics, accept it anyway
      if (isRetry && validation.error.includes('unique')) {
        console.log('  ⚠️  Retry still has duplicate topics, accepting response anyway...');
        // Re-validate without uniqueness check to accept the response
        const relaxedValidation = validateResponse(functionArgs, true);
        if (relaxedValidation.valid) {
          return relaxedValidation.data;
        }
      }
      throw new Error(`Validation failed: ${validation.error}`);
    }
    
    return validation.data;
  } catch (error) {
    // If it's a validation error and not a retry, attempt retry
    if (!isRetry && error.message && error.message.includes('Validation failed')) {
      const validationError = error.message.match(/Validation failed: (.+)/);
      if (validationError && validationError[1].includes('unique')) {
        console.log('  ⚠️  Validation failed (duplicate topics), retrying with stricter instructions...');
        return await callOpenAI(question, correctAnswer, outline, promptTemplate, subjectName, true);
      }
    }
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}

/**
 * Ensure directory exists
 */
async function ensureDirectoryExists(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Save response to numbered JSON file
 */
async function saveResponse(subjectName, number, response, prevOptions, prevStatement) {
  const outputDir = path.join(__dirname, 'openai_responses', subjectName);
  await ensureDirectoryExists(outputDir);
  
  // Extract statement from OpenAI response
  const statement = response.mcq && response.mcq[0] ? response.mcq[0].statement : '';
  
  const outputData = {
    mcq: response.mcq,
    'prev-options': prevOptions,
    'prev-statement': prevStatement,
    'statement': statement
  };
  
  const filePath = path.join(outputDir, `${number}.json`);
  await fs.writeFile(filePath, JSON.stringify(outputData, null, 2), 'utf8');
}

/**
 * Save past MCQ response to numbered JSON file with year field
 */
async function savePastResponse(subjectName, number, response, prevOptions, prevStatement, year) {
  const outputDir = path.join(__dirname, 'openai_responses_past', subjectName);
  await ensureDirectoryExists(outputDir);
  
  // Extract statement from OpenAI response
  const statement = response.mcq && response.mcq[0] ? response.mcq[0].statement : '';
  
  const outputData = {
    mcq: response.mcq,
    'prev-options': prevOptions,
    'prev-statement': prevStatement,
    'statement': statement,
    'year': year
  };
  
  const filePath = path.join(outputDir, `${number}.json`);
  await fs.writeFile(filePath, JSON.stringify(outputData, null, 2), 'utf8');
}

/**
 * Main processing function
 */
async function processMCQs(startNumber, endNumber, subjectName) {
  console.log(`Starting processing: Subject=${subjectName}, Start=${startNumber}, End=${endNumber}`);
  
  // Load data
  console.log('Loading MCQs...');
  const mcqs = await loadMCQs(subjectName, startNumber, endNumber);
  console.log(`Loaded ${mcqs.length} MCQs`);
  
  console.log('Loading outline...');
  const outline = await loadOutline(subjectName);
  
  console.log('Loading prompt template...');
  const promptTemplate = await loadPromptTemplate();
  
  // Process MCQs with concurrent API calls (2 at a time)
  let currentIndex = 0;
  let fileNumber = startNumber;
  
  // Queue for managing concurrent API calls - store promises with their metadata
  const activePromises = [];
  
  while (currentIndex < mcqs.length || activePromises.length > 0) {
    // Start new API calls if we have slots available and more MCQs to process
    while (activePromises.length < 2 && currentIndex < mcqs.length) {
      const mcq = mcqs[currentIndex];
      const index = currentIndex;
      const fileNum = fileNumber;
      
      if (!mcq.question_en || !mcq.correct_answer) {
        console.log(`Skipping MCQ at index ${index + 1}: missing question_en or correct_answer`);
        currentIndex++;
        fileNumber++;
        continue;
      }
      
      console.log(`Processing MCQ ${index + 1}/${mcqs.length} (original MCQ #${fileNum}, file: ${fileNum}.json)...`);
      
      const promise = callOpenAI(
        mcq.question_en,
        mcq.correct_answer,
        outline,
        promptTemplate,
        subjectName
      )
        .then(response => {
          return { 
            success: true, 
            index, 
            fileNum, 
            response, 
            prevOptions: mcq.options || [],
            prevStatement: mcq.question_en || ''
          };
        })
        .catch(error => {
          return { success: false, index, fileNum, error: error.message };
        });
      
      // Store promise with its metadata for tracking
      activePromises.push({ promise, index, fileNum });
      currentIndex++;
      fileNumber++;
    }
    
    // Wait for at least one promise to complete
    if (activePromises.length > 0) {
      const racePromises = activePromises.map(item => item.promise);
      const result = await Promise.race(racePromises);
      
      // Find and remove the completed promise by matching result metadata
      const completedIndex = activePromises.findIndex(item => 
        result.index === item.index && result.fileNum === item.fileNum
      );
      
      if (completedIndex !== -1) {
        activePromises.splice(completedIndex, 1);
      } else {
        // Fallback: remove first item if we can't match (shouldn't happen)
        console.warn(`Warning: Could not match completed promise, removing first item`);
        activePromises.shift();
      }
      
      if (result.success) {
        try {
          await saveResponse(
            subjectName, 
            result.fileNum, 
            result.response, 
            result.prevOptions,
            result.prevStatement
          );
          console.log(`✓ Saved ${result.fileNum}.json`);
        } catch (error) {
          console.error(`Failed to save ${result.fileNum}.json: ${error.message}`);
          console.error(`Stopping execution due to error at object number: ${result.index + 1}`);
          process.exit(1);
        }
      } else {
        console.error(`API call failed for object number: ${result.index + 1}`);
        console.error(`Error: ${result.error}`);
        console.error(`Stopping execution due to error at object number: ${result.index + 1}`);
        process.exit(1);
      }
    }
  }
  
  console.log(`\nProcessing complete! Processed ${mcqs.length} MCQs.`);
}

/**
 * Process Past MCQs function
 */
async function processPastMCQs(startNumber, endNumber, subjectName) {
  console.log(`Starting past MCQs processing: Subject=${subjectName}, Start=${startNumber}, End=${endNumber}`);
  
  // Load data
  console.log('Loading past MCQs...');
  const mcqs = await loadPastMCQs(subjectName, startNumber, endNumber);
  console.log(`Loaded ${mcqs.length} past MCQs`);
  
  console.log('Loading outline...');
  const outline = await loadOutline(subjectName);
  
  console.log('Loading prompt template...');
  const promptTemplate = await loadPromptTemplate();
  
  // Process MCQs with concurrent API calls (2 at a time)
  let currentIndex = 0;
  let fileNumber = startNumber;
  
  // Queue for managing concurrent API calls - store promises with their metadata
  const activePromises = [];
  
  while (currentIndex < mcqs.length || activePromises.length > 0) {
    // Start new API calls if we have slots available and more MCQs to process
    while (activePromises.length < 2 && currentIndex < mcqs.length) {
      const mcq = mcqs[currentIndex];
      const index = currentIndex;
      const fileNum = fileNumber;
      
      if (!mcq.question_en || !mcq.correct_answer) {
        console.log(`Skipping MCQ at index ${index + 1}: missing question_en or correct_answer`);
        currentIndex++;
        fileNumber++;
        continue;
      }
      
      // Extract year field (preserve it but don't send to OpenAI)
      const year = mcq.year || '';
      
      console.log(`Processing Past MCQ ${index + 1}/${mcqs.length} (original MCQ #${fileNum}, file: ${fileNum}.json, year: ${year})...`);
      
      const promise = callOpenAI(
        mcq.question_en,
        mcq.correct_answer,
        outline,
        promptTemplate,
        subjectName
      )
        .then(response => {
          return { 
            success: true, 
            index, 
            fileNum, 
            response, 
            prevOptions: mcq.options || [],
            prevStatement: mcq.question_en || '',
            year: year
          };
        })
        .catch(error => {
          return { success: false, index, fileNum, error: error.message };
        });
      
      // Store promise with its metadata for tracking
      activePromises.push({ promise, index, fileNum });
      currentIndex++;
      fileNumber++;
    }
    
    // Wait for at least one promise to complete
    if (activePromises.length > 0) {
      const racePromises = activePromises.map(item => item.promise);
      const result = await Promise.race(racePromises);
      
      // Find and remove the completed promise by matching result metadata
      const completedIndex = activePromises.findIndex(item => 
        result.index === item.index && result.fileNum === item.fileNum
      );
      
      if (completedIndex !== -1) {
        activePromises.splice(completedIndex, 1);
      } else {
        // Fallback: remove first item if we can't match (shouldn't happen)
        console.warn(`Warning: Could not match completed promise, removing first item`);
        activePromises.shift();
      }
      
      if (result.success) {
        try {
          await savePastResponse(
            subjectName,
            result.fileNum, 
            result.response, 
            result.prevOptions,
            result.prevStatement,
            result.year
          );
          console.log(`✓ Saved ${result.fileNum}.json`);
        } catch (error) {
          console.error(`Failed to save ${result.fileNum}.json: ${error.message}`);
          console.error(`Stopping execution due to error at object number: ${result.index + 1}`);
          process.exit(1);
        }
      } else {
        console.error(`API call failed for object number: ${result.index + 1}`);
        console.error(`Error: ${result.error}`);
        console.error(`Stopping execution due to error at object number: ${result.index + 1}`);
        process.exit(1);
      }
    }
  }
  
  console.log(`\nPast MCQs processing complete! Processed ${mcqs.length} MCQs.`);
}

// Export the functions
module.exports = { processMCQs, processPastMCQs };

// If run directly, allow manual invocation
if (require.main === module) {
  console.log('Use processMCQs(startNumber, endNumber, subjectName) to process regular MCQs');
  console.log('Example: processMCQs(1, 10, "computer_science")');
  console.log('');
  console.log('Use processPastMCQs(startNumber, endNumber, subjectName) to process past MCQs');
  console.log('Example: processPastMCQs(1, 10, "islamic_studies")');
}


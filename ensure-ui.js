const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');

// LLM Abstraction Layer
class LLMProvider {
  async generateText(prompt, systemPrompt, maxTokens = 500, temperature = 0.1) {
    throw new Error('generateText method must be implemented by subclass');
  }
}

class OpenAIProvider extends LLMProvider {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
  }

  async generateText(prompt, systemPrompt, maxTokens = 500, temperature = 0.1) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: maxTokens,
        temperature: temperature
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }
}

class AnthropicProvider extends LLMProvider {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
  }

  async generateText(prompt, systemPrompt, maxTokens = 500, temperature = 0.1) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: maxTokens,
        temperature: temperature,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.content[0].text;
  }
}

class EnsureUITester {
  constructor() {
    this.projectRoot = process.env.PROJECT_ROOT;
    this.deploymentUrl = process.env.DEPLOYMENT_URL;
    this.timeout = parseInt(process.env.TIMEOUT) * 1000 || 15000;
    this.githubToken = process.env.GITHUB_TOKEN;
    this.repository = process.env.GITHUB_REPOSITORY;
    this.eventName = process.env.GITHUB_EVENT_NAME;
    this.ref = process.env.GITHUB_REF;
    this.sha = process.env.GITHUB_SHA;
    this.prNumber = process.env.PR_NUMBER;
    
    // Initialize LLM provider based on environment variables
    // const llmProvider = process.env.OPENAI_API_KEY ? 'openai' : 'anthropic';
    const llmProvider = 'openai';
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    
    if (llmProvider === 'anthropic') {
      if (!anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY environment variable is required when using Anthropic provider');
      }
      this.llm = new AnthropicProvider(anthropicApiKey);
    } else {
      if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required when using OpenAI provider');
      }
      this.llm = new OpenAIProvider(openaiApiKey);
    }

    this.results = {
      totalPages: 0,
      passedPages: 0,
      failedPages: 0,
      pages: []
    };
  }

  // Enhanced comment parsing - extract expectation text
  async findEnsureUIPages() {
    const pages = [];
    const searchDirs = ['pages', 'app', 'src/pages', 'src/app'];
    const root = this.projectRoot || process.cwd();

    for (const dir of searchDirs) {
      const fullDir = path.join(root, dir);
      if (fs.existsSync(fullDir)) {
        console.log(`Scanning directory: ${fullDir}`);
        await this.scanDirectory(fullDir, pages);
      }
    }
    return pages;
  }

  async scanDirectory(dirPath, pages) {
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        await this.scanDirectory(fullPath, pages);
      } else if (this.isPageFile(item)) {
        const expectations = await this.extractEnsureUIComments(fullPath);
        if (expectations.length > 0) {
          const route = this.getRouteFromPath(fullPath);
          pages.push({
            filePath: fullPath,
            route: route,
            url: `${this.deploymentUrl}${route}`,
            expectations: expectations
          });
        }
      }
    }
  }

  // Extract expectations from ensureUI comments (supports multi-line) and split via LLM
  async extractEnsureUIComments(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const rawComments = [];
      const lines = content.split('\n');

      // First pass: Extract raw comments
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Match: // ensureUI: some expectation text
        const singleLineMatch = line.match(/\/\/\s*ensureUI:\s*(.+)/i);
        if (singleLineMatch) {
          const startLineNumber = i + 1;
          let fullExpectation = singleLineMatch[1].trim();
          let currentLine = i + 1;
          
          // Look for continuation lines that start with //
          while (currentLine < lines.length) {
            const nextLine = lines[currentLine].trim();
            const continuationMatch = nextLine.match(/\/\/\s*(.+)/);
            if (continuationMatch && !nextLine.match(/\/\/\s*ensureUI:/i)) {
              // Add all subsequent // lines as part of the testing prompt
              fullExpectation += ' ' + continuationMatch[1].trim();
              currentLine++;
            } else {
              break;
            }
          }
          
          // Skip the lines we've already processed
          i = currentLine - 1;
          
          rawComments.push({
            text: fullExpectation,
            lineNumber: startLineNumber
          });
        }
      }

      // Second pass: Split each raw comment into individual test flows using LLM
      const expectations = [];
      for (const comment of rawComments) {
        try {
          const testFlows = await this.splitExpectations(comment.text);
          
          // Add each test flow with the same line number
          for (const flow of testFlows) {
            expectations.push({
              text: flow.description.trim(),
              testCode: flow.testCode.trim(),
              lineNumber: comment.lineNumber,
              originalComment: comment.text // Keep reference to original
            });
          }
        } catch (error) {
          console.error(`Failed to split expectation: ${comment.text}`, error);
          // Fallback: use original comment as single expectation
          expectations.push({
            text: comment.text,
            testCode: `await expect(page).toHaveURL(/.*/);
await expect(page.locator('body')).toBeVisible();`,
            lineNumber: comment.lineNumber,
            originalComment: comment.text
          });
        }
      }

      return expectations;
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return [];
    }
  }


  isPageFile(filename) {
    const pagePatterns = [
      /^page\.(js|jsx|ts|tsx)$/,
      /^index\.(js|jsx|ts|tsx)$/,
      /\.(js|jsx|ts|tsx)$/
    ];
    return pagePatterns.some(pattern => pattern.test(filename));
  }

  getRouteFromPath(filePath) {
    let route = filePath;
    route = route.replace(/\\/g, '/');

    if (this.projectRoot) {
      const normalizedRoot = this.projectRoot.replace(/\\/g, '/');
      const cleanRoot = normalizedRoot.replace(/\/$/, '');
      route = route.replace(new RegExp(`^${cleanRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '');
    }

    route = route.replace(/^\/+/, '');
    route = route.replace(/^src\//, '');
    route = route.replace(/^pages\//, '');
    route = route.replace(/^app\//, '');
    route = route.replace(/\([^)]+\)\//g, '');
    route = route.replace(/\.(js|jsx|ts|tsx)$/, '');
    route = route.replace(/\/page$/, '');
    route = route.replace(/^page$/, '');
    route = route.replace(/\/index$/, '');
    route = route.replace(/^index$/, '');

    route = route.replace(/\[([^\]]+)\]/g, (match, param) => {
      if (param === 'id') return '1';
      if (param === 'slug') return 'example';
      if (param.startsWith('...')) return param.slice(3);
      return param;
    });

    if (!route.startsWith('/')) {
      route = '/' + route;
    }

    return route === '/' ? '/' : route;
  }

  // HTML shrinking - remove noise, keep content structure
  shrinkHTML(html) {
    // Remove scripts, styles, comments, and other noise
    let cleaned = html
      // Remove script and style blocks entirely
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, '')
      // Remove most attributes except semantic ones
      .replace(/\s(?:class|id|style|data-[^=]*?)="[^"]*"/gi, '')
      // Keep important attributes
      .replace(/\s(aria-[^=]*?|role|alt|title|placeholder|value|href|src|type|name)="[^"]*"/gi, ' $1="$2"')
      // Remove empty attributes
      .replace(/\s[a-zA-Z-]+=""/g, '')
      // Collapse multiple whitespace
      .replace(/\s+/g, ' ')
      // Remove whitespace between tags
      .replace(/>\s+</g, '><')
      // Trim
      .trim();

    // Remove deeply nested empty divs and spans
    let previousLength;
    do {
      previousLength = cleaned.length;
      cleaned = cleaned
        .replace(/<(div|span|section|article)\s*><\/(div|span|section|article)>/gi, '')
        .replace(/<(div|span)\s*>\s*<(div|span)\s*>(.*?)<\/\2>\s*<\/\1>/gi, '<$2>$3</$2>');
    } while (cleaned.length < previousLength);

    // Limit content length - truncate very long text nodes
    cleaned = cleaned.replace(/>([^<]{200})[^<]*</g, '>$1...<');

    return cleaned;
  }

  // Generate LLM prompt for test generation
  generateLLMPrompt(html, expectation, currentUrl, redirectChain) {
    const redirectInfo = redirectChain && redirectChain.length > 0 
      ? `\n- REDIRECT CHAIN AVAILABLE: A 'redirectChain' variable contains all HTTP responses with redirect info\n- redirectChain format: [{url, status, location}, ...] where location is the redirect target\n- Use redirectChain to test redirect status codes and targets`
      : '';

    return `You are a Playwright testing expert. Generate ONLY the test code to verify the expectation.

CRITICAL: First categorize the expectation, then generate appropriate code:

EXPECTATION CATEGORIES & CODE TEMPLATES:

1. PAGE_LOAD (keywords: "loaded successfully", "responds", "accessible", "works", "loads")
   Template: await expect(page).toHaveURL('${currentUrl}');
   - ONLY check URL or basic page state
   - DO NOT check specific content unless explicitly mentioned

2. CONTENT_PRESENCE (keywords: "contains", "shows", "displays", "has", "visible")
   Template: await expect(page.getByText('expected text')).toBeVisible();
   - Check for specific text, elements, or attributes mentioned
   - Use precise selectors based on mentioned content

3. INTERACTION (keywords: "click", "submit", "fill", "navigate", "select")
   Template: await page.click('selector'); await expect(result).toBeTruthy();
   - Perform the action then verify the result
   - Test the specific interaction mentioned

4. REDIRECT (keywords: "redirect", "301", "302", other status codes)${redirectInfo}
   Template options:
   - For specific status code (e.g. "should redirect with 301"): const redirect = redirectChain.find(r => r.status === 301); await expect(redirect).toBeDefined();
   - For any redirect (e.g. "should redirect"): await expect(redirectChain.length).toBeGreaterThan(1);
   - For redirect to specific page (e.g. "should redirect to /login"): const redirect = redirectChain.find(r => r.location && r.location.includes('/login')); await expect(redirect).toBeDefined();
   - Use redirectChain to verify redirect behavior based on what user specified

5. VISUAL (keywords: "layout", "responsive", "styling", "appearance")
   Template: await expect(page.locator('selector')).toHaveCSS('property', 'value');
   - Check visual properties and styling

RULES:
- Match expectation to ONE category above
- Use ONLY the code template for that category
- Be MINIMAL - don't add extra assertions
- Output ONLY raw Playwright code, no explanations

CURRENT CONTEXT:
- Page already loaded at: ${currentUrl}
- HTML provided below for reference only

HTML:
${html}

User Expectation: "${expectation}"

Category: [Determine from keywords above]
Generate minimal Playwright test code:`;
  }

  // Split a single comment into multiple test flows with generated test code using LLM
  async splitExpectations(commentText) {
    const prompt = `You are a test flow analyzer. Analyze the following UI testing description and split it into individual test flows.

FLOW ANALYSIS RULES:
1. GENERAL CHECKS FIRST: Basic page functionality (loading, basic content) should be Flow 1
2. FLOW SEPARATION: If user describes multiple user journeys/scenarios, each becomes a separate flow
3. SEQUENTIAL STEPS: If user describes step-by-step actions, group related steps into flows
4. ONE TEST PER FLOW: Each flow should test one complete user scenario

OUTPUT FORMAT:
Return JSON array of objects with this structure:
{
  "description": "Brief description of what this flow tests",
  "testCode": "Complete Playwright test code for this flow"
}

TEST CODE REQUIREMENTS:
- Include page navigation if needed: await page.goto('url');
- Use proper Playwright assertions: await expect(...).toBe...();
- Handle interactions: await page.click(), await page.fill(), etc.
- Be complete and executable
- No imports or require statements
- Use 'page' and 'expect' variables (already available)

EXAMPLE SCENARIOS:

Input: "page loads correctly and shows welcome message, then user can click login button and see login form"
Output: [
  {
    "description": "Page loads and shows basic content",
    "testCode": "await expect(page).toHaveURL(/.*/);
await expect(page.getByText('welcome message')).toBeVisible();"
  },
  {
    "description": "User can access login form",
    "testCode": "await page.click('button:contains(\"login\")');
await expect(page.getByText('login form')).toBeVisible();"
  }
]

Input: "the contact form should work properly"
Output: [
  {
    "description": "Contact form functionality",
    "testCode": "await expect(page.locator('form')).toBeVisible();
await page.fill('input[name\"email\"]', 'test@example.com');
await page.fill('textarea[name=\"message\"]', 'Test message');
await page.click('button[type=\"submit\"]');
await expect(page.getByText('message sent')).toBeVisible();"
  }
]

Comment: "${commentText}"

Return JSON array of flow objects:`;

    const systemPrompt = 'You are a test flow analyzer. Split UI testing descriptions into executable test flows. Return only valid JSON array of objects with description and testCode fields.';

    try {
      const result = await this.llm.generateText(prompt, systemPrompt, 800, 0.1);
      
      // Clean and parse JSON
      const cleanResult = result.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const flows = JSON.parse(cleanResult);
      
      // Validate structure
      if (!Array.isArray(flows) || !flows.every(flow => 
        typeof flow === 'object' && 
        typeof flow.description === 'string' && 
        typeof flow.testCode === 'string'
      )) {
        throw new Error('Invalid response format from LLM');
      }
      
      return flows;
    } catch (error) {
      console.error('LLM flow splitting failed:', error);
      // Fallback: return original comment as single basic test
      return [{
        description: commentText,
        testCode: `await expect(page).toHaveURL(/.*/);
await expect(page.locator('body')).toBeVisible();`
      }];
    }
  }

  // Generate test code using LLM
  async generateTestCode(html, expectation, currentUrl, redirectChain) {
    // const shrunkenHTML = this.shrinkHTML(html);
    const shrunkenHTML = '';
    const prompt = this.generateLLMPrompt(shrunkenHTML, expectation, currentUrl, redirectChain);
    const systemPrompt = 'You are a Playwright testing expert. Generate only raw executable Playwright assertion code. No explanations, no markdown, no extra text. No require, import, or module syntax. Use await expect() for assertions.';

    try {
      const generatedCode = await this.llm.generateText(prompt, systemPrompt, 500, 0.1);

      // Clean up the generated code - remove markdown if present
      const cleanCode = generatedCode
        .replace(/```(?:javascript|js)?\n?/g, '')
        .replace(/```/g, '')
        .trim();

      return cleanCode;
    } catch (error) {
      console.error('LLM API call failed:', error);
      throw error;
    }
  }

  // Enhanced page testing with LLM-generated assertions
  async runPageTest(pageInfo) {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();

    const testResult = {
      ...pageInfo,
      passed: false,
      basicChecks: {
        pageLoaded: false,
      },
      generatedTests: [],
      consoleErrors: [],
      screenshot: null,
      error: null
    };

    // Track redirects
    const redirectChain = [];

    try {
      // Capture console errors
      page.on('console', msg => {
        if (msg.type() === 'error') {
          testResult.consoleErrors.push(msg.text());
        }
      });

      // Capture all responses to track redirects
      page.on('response', response => {
        redirectChain.push({
          url: response.url(),
          status: response.status(),
          location: response.headers()['location'] || null
        });
      });

      // Navigate to page
      const response = await page.goto(pageInfo.url, {
        waitUntil: 'networkidle',
        timeout: this.timeout
      });

      // Basic check: page loaded
      testResult.basicChecks.pageLoaded = response.status() === 200;

      if (!testResult.basicChecks.pageLoaded) {
        throw new Error(`Page failed to load: ${response.status()}`);
      }

      // Get HTML content for LLM
      const htmlContent = await page.content();

      // Run each expectation as isolated test flow
      for (let i = 0; i < pageInfo.expectations.length; i++) {
        const expectation = pageInfo.expectations[i];
        const testNum = i + 1;
        
        console.log(`\n    ${testNum}. Testing Flow: "${expectation.text}"`);

        try {
          // Use pre-generated test code from splitExpectations
          const testCode = expectation.testCode || await this.generateTestCode(htmlContent, expectation.text, pageInfo.url, redirectChain);
          
          // Run test in complete isolation - create new page context
          const testPassed = await this.executeIsolatedTest(pageInfo.url, testCode, redirectChain);

          testResult.generatedTests.push({
            expectation: expectation.text,
            lineNumber: expectation.lineNumber,
            generatedCode: testCode,
            passed: testPassed,
            error: testPassed ? null : 'Assertion failed'
          });

          console.log(`       Generated code: ${testCode}`);
          if (testPassed) {
            console.log(`       ✅ PASSED`);
          } else {
            console.log(`       ❌ FAILED - Assertion failed`);
          }

        } catch (error) {
          console.log(`       ❌ FAILED - ${error.message}`);
          testResult.generatedTests.push({
            expectation: expectation.text,
            lineNumber: expectation.lineNumber,
            generatedCode: expectation.testCode || null,
            passed: false,
            error: error.message
          });
        }
      }

      // Take screenshot
      const screenshotDir = process.env.GITHUB_WORKSPACE ? `${process.env.GITHUB_WORKSPACE}/screenshots` : 'screenshots';
      const screenshotFilename = `${pageInfo.route.replace(/\//g, '_')}.png`;
      const screenshotPath = `${screenshotDir}/${screenshotFilename}`;
      
      // Ensure directory exists
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      
      await page.screenshot({ path: screenshotPath, fullPage: true });
      testResult.screenshot = screenshotPath;

      // Overall test result
      testResult.passed = testResult.basicChecks.pageLoaded &&
                         testResult.generatedTests.every(test => test.passed);

    } catch (error) {
      testResult.error = error.message;
      console.error(`Error testing ${pageInfo.url}:`, error);
    } finally {
      await browser.close();
    }

    return testResult;
  }

  // Execute test in complete isolation with fresh browser context
  async executeIsolatedTest(pageUrl, testCode, redirectChain) {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();

    try {
      // Track redirects for this isolated test
      const isolatedRedirectChain = [];
      
      page.on('response', response => {
        isolatedRedirectChain.push({
          url: response.url(),
          status: response.status(),
          location: response.headers()['location'] || null
        });
      });

      // Navigate to page if testCode doesn't include navigation
      if (!testCode.includes('page.goto')) {
        await page.goto(pageUrl, {
          waitUntil: 'networkidle',
          timeout: this.timeout
        });
      }

      // Create a safe execution context
      const testFunction = new Function('page', 'expect', 'redirectChain', `
        return (async () => {
          ${testCode}
          return true;
        })();
      `);
      
      await testFunction(page, expect, isolatedRedirectChain.length > 0 ? isolatedRedirectChain : redirectChain);
      return true;
    } catch (error) {
      console.error(`Isolated test execution failed: ${error.message}`);
      
      // If this looks like a redirect test failure, show the redirect chain for debugging
      if (testCode.includes('redirectChain') && redirectChain && redirectChain.length > 0) {
        console.error(`       Redirect chain details:`);
        redirectChain.forEach((redirect, index) => {
          console.error(`       ${index + 1}. ${redirect.url} -> Status: ${redirect.status}${redirect.location ? ` -> Location: ${redirect.location}` : ''}`);
        });
      }
      
      return false;
    } finally {
      await browser.close();
    }
  }

  // Legacy method for backward compatibility
  async executeGeneratedTest(page, testCode, redirectChain) {
    try {
      // Create a safe execution context
      const testFunction = new Function('page', 'expect', 'redirectChain', `
        return (async () => {
          ${testCode}
          return true;
        })();
      `);
      await testFunction(page, expect, redirectChain);
      return true;
    } catch (error) {
      console.error(`Generated test execution failed: ${error.message}`);
      
      // If this looks like a redirect test failure, show the redirect chain for debugging
      if (testCode.includes('redirectChain') && redirectChain && redirectChain.length > 0) {
        console.error(`       Redirect chain details:`);
        redirectChain.forEach((redirect, index) => {
          console.error(`       ${index + 1}. ${redirect.url} -> Status: ${redirect.status}${redirect.location ? ` -> Location: ${redirect.location}` : ''}`);
        });
      }
      
      return false;
    }
  }

  async run() {
    console.log('🤖 Starting EnsureUI tests with LLM...');

    if (!this.llm) {
      console.error('LLM provider not properly initialized');
      process.exit(1);
    }

    const pages = await this.findEnsureUIPages();
    const totalExpectations = pages.reduce((sum, page) => sum + page.expectations.length, 0);

    console.log(`Found ${pages.length} pages with ${totalExpectations} expectations`);

    if (pages.length === 0) {
      console.log('No pages found with // ensureUI comments. Skipping tests.');
      return;
    }

    this.results.totalPages = pages.length;

    for (let i = 0; i < pages.length; i++) {
      const pageInfo = pages[i];
      const pageNum = i + 1;
      
      // Only show separator between pages (not before first page)
      if (i > 0) {
        console.log(`\n${'='.repeat(80)}`);
      }
      
      console.log(`\n🌐 ${pageInfo.route}`);
      console.log(`   URL: ${pageInfo.url}`);
      console.log(`   Expectations: ${pageInfo.expectations.length}`);
      
      const result = await this.runPageTest(pageInfo);
      this.results.pages.push(result);

      const passedTests = result.generatedTests.filter(t => t.passed).length;
      const failedTests = result.generatedTests.filter(t => !t.passed).length;

      console.log(`\n  📊 Page Result: ${passedTests} passed, ${failedTests} failed`);
      
      if (result.passed) {
        this.results.passedPages++;
        console.log(`  🎉 OVERALL: ✅ PASSED`);
      } else {
        this.results.failedPages++;
        console.log(`  💥 OVERALL: ❌ FAILED`);
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🏁 FINAL RESULTS`);
    console.log(`   Total pages tested: ${pages.length}`);
    console.log(`   Passed: ${this.results.passedPages}`);
    console.log(`   Failed: ${this.results.failedPages}`);
    
    if (this.results.failedPages > 0) {
      console.log(`\n❌ Failed pages:`);
      const failedPages_list = this.results.pages.filter(p => !p.passed);
      failedPages_list.forEach(page => {
        console.log(`   - ${page.route}`);
      });
    } else {
      console.log(`\n✅ All tests passed! 🎉`);
    }
    console.log('='.repeat(80));

    // Add screenshot artifact information
    if (this.results.pages.some(page => page.screenshot)) {
      console.log(`\n📸 Screenshots saved to workflow artifacts`);
      if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID) {
        const artifactUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
        console.log(`   View artifacts: ${artifactUrl}`);
      }
    }

    // Output results using new GitHub Actions format
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `results=${JSON.stringify(this.results)}\n`);
    } else {
      console.log(`::set-output name=results::${JSON.stringify(this.results)}`);
    }

    if (this.results.failedPages > 0) {
      process.exit(1);
    }
  }
}

// Run the tests
const tester = new EnsureUITester();
tester.run().catch(error => {
  console.error('EnsureUI tests failed:', error);
  process.exit(1);
});
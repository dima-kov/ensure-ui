const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
        'x-api-key': `${this.apiKey}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
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
        const [expectations, rawExpectations] = await this.extractEnsureUIComments(fullPath);
        if (expectations.length > 0) {
          const route = this.getRouteFromPath(fullPath);
          pages.push({
            filePath: fullPath,
            route: route,
            url: `${this.deploymentUrl}${route}`,
            rawExpectations: rawExpectations,
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
        const singleLineMatch = line.match(/\/\/\s*ensureUI\s*(.+)/i);
        if (singleLineMatch) {
          const startLineNumber = i + 1;
          let fullExpectation = singleLineMatch[1].trim();
          let currentLine = i + 1;
          
          // Look for continuation lines that start with //
          while (currentLine < lines.length) {
            const nextLine = lines[currentLine].trim();
            const continuationMatch = nextLine.match(/\/\/\s*(.+)/);
            if (continuationMatch && !nextLine.match(/\/\/\s*ensureUI/i)) {
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

      // Second pass: Split each raw comment into individual expectations using LLM
      const expectations = [];
      for (const comment of rawComments) {
        try {
          const splitExpectations = await this.splitExpectations(comment.text);
          
          // Add each split expectation with the same line number
          for (const expectationText of splitExpectations) {
            expectations.push({
              text: expectationText.trim(),
              lineNumber: comment.lineNumber,
              originalComment: comment.text // Keep reference to original
            });
          }
        } catch (error) {
          console.error(`Failed to split expectation: ${comment.text}`, error);
          // Fallback: use original comment as single expectation
          expectations.push({
            text: comment.text,
            lineNumber: comment.lineNumber,
            originalComment: comment.text
          });
        }
      }

      return [expectations, rawComments.map(c => c.text).join('\n')];
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
    const redirectInfo = redirectChain && redirectChain.length > 0 ?
        `\n- REDIRECT CHAIN AVAILABLE: A 'redirectChain' variable contains all HTTP responses with redirect info\n- redirectChain format: [{url, status, location}, ...] where location is the redirect target\n- Use redirectChain to test redirect status codes and targets` :
        '';

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

  // Split a single comment into multiple testable expectations using LLM
  async splitExpectations(commentText) {
    const prompt = `You are a Senior QA.
Your task: convert the user's natural language test expectations into a **pure JSON array of strings**,  
where each string represents a complete test scenario or independent test expectation.

Rules:
1. Split by major test boundaries: explicit test labels (Test1, Test2, etc.), or distinct test scenarios separated by blank lines.
2. Keep related test steps within the same scenario grouped together as a single item.
3. For setup/utility expectations (like "ensureUI", "page loaded", etc.) that aren't part of a specific test, treat as separate items.
4. Do **not** add any explanations or extra keys; output JSON array only.
5. Preserve original wording unless a **minimal rewrite** is needed for clarity.
6. Each item should represent either a complete test flow or an independent verification.
7. When combining steps within a test, use "then" to connect sequential actions.

User expectations:
${commentText}`;

    const systemPrompt = 'You are a test expectation analyzer. Split UI testing expectations into individual tests. Return only valid JSON array of strings.';

    try {
      const result = await this.llm.generateText(prompt, systemPrompt, 300, 0.1);
      
      // Clean and parse JSON
      const cleanResult = result.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const expectations = JSON.parse(cleanResult);
      
      // Validate it's an array of strings
      if (!Array.isArray(expectations) || !expectations.every(exp => typeof exp === 'string')) {
        throw new Error('Invalid response format from LLM');
      }
      
      return expectations;
    } catch (error) {
      console.error('LLM expectation splitting failed:', error);
      // Fallback: return original comment as single expectation
      return [commentText];
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

      return generatedCode
        .replace(/```(?:javascript|js)?\n?/g, '')
        .replace(/```/g, '')
        .trim();

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
          /* jshint -W069 */
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

      // Generate and run tests for each expectation
      for (let i = 0; i < pageInfo.expectations.length; i++) {
        const expectation = pageInfo.expectations[i];
        const testNum = i + 1;

        console.log('\n')
        console.log(`\n${testNum}. Testing: "${expectation.text}"`);

        try {
          const testCode = await this.generateTestCode(htmlContent, expectation.text, pageInfo.url, redirectChain);
          console.log(`Code:\n${testCode}`);
          const testPassed = await this.executeGeneratedTest(page, testCode, redirectChain, pageInfo);

          testResult.generatedTests.push({
            expectation: expectation.text,
            lineNumber: expectation.lineNumber,
            generatedCode: testCode,
            passed: testPassed,
            error: testPassed ? null : 'Assertion failed'
          });

          if (testPassed) {
            console.log(`✅ PASSED`);
          } else {
            console.log(`❌ FAILED - Assertion failed`);
          }

        } catch (error) {
          console.log(`❌ FAILED - ${error.message}`);
          testResult.generatedTests.push({
            expectation: expectation.text,
            lineNumber: expectation.lineNumber,
            generatedCode: null,
            passed: false,
            error: error.message
          });
        }
        console.log('\n');
      }

      // Take screenshot
      testResult.screenshot = await this.takeScreenshot(page, pageInfo.route);

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

  // Take screenshot utility function
  async takeScreenshot(page, route) {
    const screenshotDir = process.env.GITHUB_WORKSPACE ? `${process.env.GITHUB_WORKSPACE}/screenshots` : 'screenshots';
    const screenshotFilename = `${route.replace(/\//g, '_')}_${crypto.randomUUID().split('-')[0]}.png`;
    const screenshotPath = `${screenshotDir}/${screenshotFilename}`;
    
    // Ensure directory exists
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    
    // Log GitHub URL for the screenshot
    if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID) {
      const branchName = process.env.GITHUB_REF_NAME || process.env.GITHUB_REF?.replace('refs/heads/', '') || 'main';
      const screenshotBranch = `${branchName}-ensureui-${process.env.GITHUB_RUN_ID}`;
      const githubUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/blob/${screenshotBranch}/screenshots/${screenshotFilename}`;
      console.log(`📸 Screenshot: ${githubUrl}`);
    }
    
    return screenshotPath;
  }

  // Execute the LLM-generated test code safely
  async executeGeneratedTest(page, testCode, redirectChain, pageInfo) {
    let isolatedPage = null;
    
    try {
      // Create a new isolated page with clean cookies
      const context = page.context();
      isolatedPage = await context.newPage();
      
      // Clear any existing cookies to ensure isolation
      await context.clearCookies();

      // Navigate to the same URL as the original page
      const currentUrl = page.url();
      await isolatedPage.goto(currentUrl, {
        waitUntil: 'networkidle',
        timeout: this.timeout
      });
      
      // Create a safe execution context
      const testFunction = new Function('page', 'expect', 'redirectChain', `
        return (async () => {
          ${testCode}
          return true;
        })();
      `);
      await testFunction(isolatedPage, expect, redirectChain);
      return true;
    } catch (error) {
      console.error(`Error: ${error.message}`);

      await this.takeScreenshot(page, pageInfo.route);

      // If this looks like a redirect test failure, show the redirect chain for debugging
      if (testCode.includes('redirectChain') && redirectChain && redirectChain.length > 0) {
        console.error(`Redirect chain details:`);
        redirectChain.forEach((redirect, index) => {
          console.error(`${index + 1}. ${redirect.url} -> Status: ${redirect.status}${redirect.location ? ` -> Location: ${redirect.location}` : ''}`);
        });
      }
      
      return false;
    } finally {
      // Clean up the isolated page
      if (isolatedPage) {
        try {
          await isolatedPage.close();
        } catch (closeError) {
          console.error(`Warning: Failed to close isolated page: ${closeError.message}`);
        }
      }
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
      const page = pages[i];
      const pageNum = i + 1;
      
      // Only show separator between pages (not before first page)
      if (i > 0) {
        console.log(`\n${'='.repeat(80)}`);
      }
      
      console.log(`\n🌐 ${page.route}`);
      console.log(`URL: ${page.url}`);
      console.log(`Ensure: ${page.rawExpectations}`);
      console.log(`Expectations: ${page.expectations.length}`);
      
      const result = await this.runPageTest(page);
      this.results.pages.push(result);

      const passedTests = result.generatedTests.filter(t => t.passed).length;
      const failedTests = result.generatedTests.filter(t => !t.passed).length;

      console.log(`\n📊 Page Result: ${passedTests} passed, ${failedTests} failed`);
      
      if (result.passed) {
        this.results.passedPages++;
        console.log(`🎉 OVERALL: ✅ PASSED`);
      } else {
        this.results.failedPages++;
        console.log(`💥 OVERALL: ❌ FAILED`);
      }
    }

    console.log(`\n\n${'='.repeat(80)}\n\n`);
    console.log(`🏁 FINAL RESULTS`);
    console.log(`Total pages tested: ${pages.length}`);
    console.log(`Passed: ${this.results.passedPages}`);
    console.log(`Failed: ${this.results.failedPages}`);
    
    if (this.results.failedPages > 0) {
      console.log(`\n❌ Failed pages:`);
      const failedPages_list = this.results.pages.filter(p => !p.passed);
      failedPages_list.forEach(page => {
        console.log(`- ${page.route}`);
      });
    } else {
      console.log(`\n✅ All tests passed! 🎉`);
    }
    console.log('='.repeat(80));

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
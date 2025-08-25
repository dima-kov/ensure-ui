const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');

async function generateText(apiKey, prompt, systemPrompt, maxTokens = 500, temperature = 0.1) {
  const response = await fetch('https://ensureui-be-production.up.railway.app/ensure', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
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
    throw new Error(`EnsureUI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

class EnsureUITester {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.env.PROJECT_ROOT || process.cwd();
    this.deploymentUrl = options.deploymentUrl || process.env.DEPLOYMENT_URL;
    this.timeout = parseInt(options.timeout || process.env.TIMEOUT || 15) * 1000;
    this.apiKey = options.apiKey || process.env.ENSURE_API_KEY;
    
    if (!this.apiKey) {
      throw new Error('ENSURE_API_KEY environment variable or apiKey option is required');
    }

    this.results = {
      totalPages: 0,
      passedPages: 0,
      failedPages: 0,
      pages: []
    };
  }

  async findEnsureUIPages() {
    const pages = [];
    const searchDirs = ['pages', 'app', 'src/pages', 'src/app'];
    const root = this.projectRoot;

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
        const [expectations, rawExpectations, urlParams] = await this.extractEnsureUIComments(fullPath);
        if (expectations.length > 0) {
          try {
            const route = this.getRouteFromPath(fullPath, urlParams);
            pages.push({
              filePath: fullPath,
              route: route,
              url: `${this.deploymentUrl}${route}`,
              rawExpectations: rawExpectations,
              expectations: expectations
            });
          } catch (error) {
            console.error(`❌ Parameter Error in ${fullPath}: ${error.message}`);
            continue;
          }
        }
      }
    }
  }

  async extractEnsureUIComments(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const rawComments = [];
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        const singleLineMatch = line.match(/\/\/\s*ensureUI\s*(.+)/i);
        if (singleLineMatch) {
          const startLineNumber = i + 1;
          let fullExpectation = singleLineMatch[1].trim();
          let currentLine = i + 1;
          
          while (currentLine < lines.length) {
            const nextLine = lines[currentLine].trim();
            const continuationMatch = nextLine.match(/\/\/\s*(.+)/);
            if (continuationMatch && !nextLine.match(/\/\/\s*ensureUI/i)) {
              fullExpectation += ' ' + continuationMatch[1].trim();
              currentLine++;
            } else {
              break;
            }
          }
          
          i = currentLine - 1;
          
          rawComments.push({
            text: fullExpectation,
            lineNumber: startLineNumber
          });
        }
      }

      const expectations = [];
      let allUrlParams = {};
      
      for (const comment of rawComments) {
        try {
          const result = await this.splitExpectations(comment.text);
          
          allUrlParams = { ...allUrlParams, ...result.urlParams };
          
          for (const expectationText of result.expectations) {
            expectations.push({
              text: expectationText.trim(),
              lineNumber: comment.lineNumber,
              originalComment: comment.text
            });
          }
        } catch (error) {
          console.error(`Failed to split expectation: ${comment.text}`, error);
          expectations.push({
            text: comment.text,
            lineNumber: comment.lineNumber,
            originalComment: comment.text
          });
        }
      }

      return [expectations, rawComments.map(c => c.text).join('\n'), allUrlParams];
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return [[], '', {}];
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

  getRouteFromPath(filePath, urlParams = {}) {
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
      const cleanParam = param.startsWith('...') ? param.slice(3) : param;
      
      if (urlParams[cleanParam] !== undefined) {
        return urlParams[cleanParam];
      }
      
      throw new Error(`Route parameter '[${param}]' required but not specified in test expectations. 
Example: "// ensureUI: test page with ${cleanParam} 123"`);
    });

    if (!route.startsWith('/')) {
      route = '/' + route;
    }

    return route === '/' ? '/' : route;
  }

  shrinkHTML(html) {
    let cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s(?:class|id|style|data-[^=]*?)="[^"]*"/gi, '')
      .replace(/\s(aria-[^=]*?|role|alt|title|placeholder|value|href|src|type|name)="[^"]*"/gi, ' $1="$2"')
      .replace(/\s[a-zA-Z-]+=""/g, '')
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim();

    let previousLength;
    do {
      previousLength = cleaned.length;
      cleaned = cleaned
        .replace(/<(div|span|section|article)\s*><\/(div|span|section|article)>/gi, '')
        .replace(/<(div|span)\s*>\s*<(div|span)\s*>(.*?)<\/\2>\s*<\/\1>/gi, '<$2>$3</$2>');
    } while (cleaned.length < previousLength);

    cleaned = cleaned.replace(/>([^<]{200})[^<]*</g, '>$1...<');

    return cleaned;
  }

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

  async splitExpectations(commentText) {
    const prompt = `You are a Senior QA analyzing UI test expectations.

Your task: Extract test expectations AND URL parameter specifications from user input.

Return a JSON object with this exact structure:
{
  "expectations": ["array of test expectation strings"],
  "urlParams": {
    "paramName": "value"
  }
}

Rules for expectations:
1. Split by distinct test scenarios separated.
2. Keep related test steps within the same scenario grouped together as a single item. Group standalone assertions (content checks that don't require user actions) together. For tests requiring user interactions (clicks, navigation, form filling, etc.), preserve the exact order as specified in the original input.
3. Preserve original wording unless a **minimal rewrite** is needed for clarity.
4. Each item should represent either a complete test flow or an independent verification.
5. When combining steps within a test, use "then" to connect sequential actions.
6. Do not add any new expectations that are not explicitly mentioned by the user.

Rules for urlParams:
1. Extract any URL parameter values mentioned in the expectations
2. Look for patterns like: "with id 413", "user john", "category electronics", "use 'ai' as subdomain", "slug example-post"
3. Map parameter names to their specified values
4. If no parameters specified, return empty object: {}
5. Use parameter names that match Next.js conventions: id, slug, userId, category, subdomain, etc.
6. For catch-all routes [...slug], use "slug" as the parameter name

User expectations:
${commentText}`;

    const systemPrompt = 'You are a test expectation analyzer. Split UI testing expectations into individual tests and extract URL parameters. Return only valid JSON object with expectations array and urlParams object.';

    try {
      const result = await generateText(this.apiKey, prompt, systemPrompt, 300, 0.1);
      
      const cleanResult = result.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanResult);
      
      if (!parsed.expectations || !Array.isArray(parsed.expectations) || 
          !parsed.expectations.every(exp => typeof exp === 'string') ||
          typeof parsed.urlParams !== 'object' || parsed.urlParams === null) {
        throw new Error('Invalid response format from LLM');
      }
      
      return {
        expectations: parsed.expectations,
        urlParams: parsed.urlParams || {}
      };
    } catch (error) {
      console.error('LLM expectation splitting failed:', error);
      return {
        expectations: [commentText],
        urlParams: {}
      };
    }
  }

  async generateTestCode(html, expectation, currentUrl, redirectChain) {
    const shrunkenHTML = '';
    const prompt = this.generateLLMPrompt(shrunkenHTML, expectation, currentUrl, redirectChain);
    const systemPrompt = `You are a Playwright testing expert. Generate only raw executable Playwright assertion code. 
No explanations, no markdown, no extra text. No require, import, or module syntax. 
When the user includes placeholders in their request, generate appropriate code that handles these placeholders according to their intent:

- For generic placeholders like {random}, {value}, {data}, etc. - replace with contextually appropriate random or example values
- For choice placeholders like {any from: [option1, option2, option3]} - randomly select one of the provided options
- For range placeholders like {number from 1-10} - generate a random number within the specified range
- For pattern placeholders like {name}, {email}, {date} - generate realistic sample data matching the expected format
- For variable placeholders like {userInput} or {apiResponse} - create representative mock data or use clear variable names

The generated code should be functional and demonstrate the intended behavior while making the placeholder logic clear and easily modifiable.Use await expect() for assertions.`

    try {
      const generatedCode = await generateText(this.apiKey, prompt, systemPrompt, 500, 0.1);

      return generatedCode
        .replace(/```(?:javascript|js)?\n?/g, '')
        .replace(/```/g, '')
        .trim();

    } catch (error) {
      console.error('LLM API call failed:', error);
      throw error;
    }
  }

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
      error: null
    };

    const redirectChain = [];

    try {
      page.on('console', msg => {
        if (msg.type() === 'error') {
          testResult.consoleErrors.push(msg.text());
        }
      });

      page.on('response', response => {
        redirectChain.push({
          url: response.url(),
          status: response.status(),
          location: response.headers()['location'] || null
        });
      });

      const response = await page.goto(pageInfo.url, {
        waitUntil: 'networkidle',
        timeout: this.timeout
      });

      testResult.basicChecks.pageLoaded = response.status() === 200;

      if (!testResult.basicChecks.pageLoaded) {
        throw new Error(`Page failed to load: ${response.status()}`);
      }

      const htmlContent = await page.content();

      for (let i = 0; i < pageInfo.expectations.length; i++) {
        const expectation = pageInfo.expectations[i];
        const testNum = i + 1;

        console.log(' ');
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
      }

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

  async takeScreenshot(page, route) {
    const screenshotDir = 'screenshots';
    const screenshotFilename = `${route.replace(/\//g, '_')}_${crypto.randomUUID().split('-')[0]}.png`;
    const screenshotPath = `${screenshotDir}/${screenshotFilename}`;
    
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    
    return screenshotPath;
  }

  async executeGeneratedTest(page, testCode, redirectChain, pageInfo) {
    let isolatedPage = null;
    
    try {
      const context = page.context();
      isolatedPage = await context.newPage();
      
      await context.clearCookies();

      const currentUrl = page.url();
      await isolatedPage.goto(currentUrl, {
        waitUntil: 'networkidle',
        timeout: this.timeout
      });
      
      const testFunction = new Function('page', 'expect', 'redirectChain', `
        return (async () => {
          ${testCode}
          return true;
        })();
      `);
      await testFunction(isolatedPage, expect, redirectChain);
      await this.takeScreenshot(isolatedPage, pageInfo.route);
      return true;
    } catch (error) {
      console.error(`Error: ${error.message}`);

      await this.takeScreenshot(isolatedPage, pageInfo.route);

      if (testCode.includes('redirectChain') && redirectChain && redirectChain.length > 0) {
        console.error(`Redirect chain details:`);
        redirectChain.forEach((redirect, index) => {
          console.error(`${index + 1}. ${redirect.url} -> Status: ${redirect.status}${redirect.location ? ` -> Location: ${redirect.location}` : ''}`);
        });
      }
      
      return false;
    } finally {
      if (isolatedPage) {
        try {
          await isolatedPage.close();
        } catch (closeError) {
          console.error(`Warning: Failed to close isolated page: ${closeError.message}`);
        }
      }
    }
  }

  async runAllTests() {
    console.log('🤖 Starting EnsureUI tests with LLM...');

    if (!this.apiKey) {
      console.error('API key not properly initialized');
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
      
      if (i > 0) {
        console.log(`\n${'='.repeat(80)}`);
      }
      
      console.log(`\n🌐 ${page.route}`);
      console.log(`URL: ${page.url}`);
      console.log(`Ensure: ${page.rawExpectations}`);
      console.log(`Expectations: ${page.expectations.length}`);
      
      const result = await this.runPageTest(page);
      if (result.passed) {
        this.results.passedPages++;
      } else {
        this.results.failedPages++;
      }
      this.results.pages.push(result);
    }

    console.log(`\n\n${'='.repeat(80)}\n\n`);
    console.log(`🏁 FINAL RESULTS`);
    console.log(`Tested: ${pages.length}`);
    console.log(`Passed: ${this.results.passedPages}`);
    console.log(`Failed: ${this.results.failedPages}`);
    console.log(' ');

    if (this.results.failedPages > 0) {
      console.log(`\n❌ Failed:`);
      const failedPages_list = this.results.pages.filter(p => !p.passed);
      failedPages_list.forEach(page => {
        console.log(`- ${page.route}`);
      });
    } else {
      console.log(`\n✅ All tests passed! 🎉`);
    }
    console.log('='.repeat(80));

    // Output results for GitHub Actions
    if (process.env.GITHUB_OUTPUT) {
      const fs = require('fs');
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `results=${JSON.stringify(this.results)}\n`);
    } else if (process.env.GITHUB_ACTIONS) {
      console.log(`::set-output name=results::${JSON.stringify(this.results)}`);
    }

    if (this.results.failedPages > 0) {
      process.exit(1);
    }
  }
}

module.exports = { EnsureUITester };
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');

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
    this.openaiApiKey = process.env.OPENAI_API_KEY;

    this.results = {
      totalPages: 0,
      passedPages: 0,
      failedPages: 0,
      pages: []
    };
  }

  // Enhanced comment parsing - extract expectation text
  findEnsureUIPages() {
    const pages = [];
    const searchDirs = ['pages', 'app', 'src/pages', 'src/app'];
    const root = this.projectRoot || process.cwd();

    for (const dir of searchDirs) {
      const fullDir = path.join(root, dir);
      if (fs.existsSync(fullDir)) {
        console.log(`Scanning directory: ${fullDir}`);
        this.scanDirectory(fullDir, pages);
      }
    }
    return pages;
  }

  scanDirectory(dirPath, pages) {
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        this.scanDirectory(fullPath, pages);
      } else if (this.isPageFile(item)) {
        const expectations = this.extractEnsureUIComments(fullPath);
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

  // Extract expectations from ensureUI comments (supports multi-line)
  extractEnsureUIComments(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const expectations = [];
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Match: // ensureUI: some expectation text
        const singleLineMatch = line.match(/\/\/\s*ensureUI:\s*(.+)/i);
        if (singleLineMatch) {
          // Check if this starts a multi-line expectation
          const startLineNumber = i + 1;
          let fullExpectation = singleLineMatch[1].trim();
          let currentLine = i + 1;
          
          // Look for continuation lines that start with // and contain "also:"
          while (currentLine < lines.length) {
            const nextLine = lines[currentLine].trim();
            const continuationMatch = nextLine.match(/\/\/\s*also:\s*(.+)/i);
            if (continuationMatch) {
              fullExpectation += ', ' + continuationMatch[1].trim();
              currentLine++;
            } else {
              // Check for generic continuation (just // followed by text, no "also:")
              const genericContinuation = nextLine.match(/\/\/\s*(.+)/);
              if (genericContinuation && !nextLine.match(/\/\/\s*ensureUI/i)) {
                // Only continue if it looks like part of the expectation
                const continuationText = genericContinuation[1].trim();
                if (continuationText && !continuationText.startsWith('TODO') && !continuationText.startsWith('FIXME') && !continuationText.startsWith('NOTE')) {
                  fullExpectation += ', ' + continuationText;
                  currentLine++;
                } else {
                  break;
                }
              } else {
                break;
              }
            }
          }
          
          // Skip the lines we've already processed
          i = currentLine - 1;
          
          expectations.push({
            text: fullExpectation,
            lineNumber: startLineNumber
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
  generateLLMPrompt(html, expectation) {
    return `You are a Playwright testing expert. Generate ONLY the test code to verify the expectation.

RULES:
- Output ONLY raw Playwright code, no explanations, no markdown
- Use await expect() for assertions
- Use page.click(), page.fill(), page.selectOption() for interactions when needed
- Use simple, robust selectors (prefer text content, roles, or data-testid)
- For static content: verify text presence, element existence, attributes
- For interactions: perform actions then verify results
- Handle both single assertions and multi-step flows
- Be defensive with selectors (use page.locator() with good fallbacks)

HTML:
${html}

User Expectation: "${expectation}"

Generate the Playwright test code:`;
  }

  // Call OpenAI API to generate test code
  async generateTestCode(html, expectation) {
    if (!this.openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    const shrunkenHTML = this.shrinkHTML(html);
    const prompt = this.generateLLMPrompt(shrunkenHTML, expectation);


    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // Cheaper model for this task
          messages: [
            {
              role: 'system',
              content: 'You are a Playwright testing expert. Generate only raw executable Playwright assertion code. No explanations, no markdown, no extra text. No require, import, or module syntax. Use await expect() for assertions.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 500,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const generatedCode = data.choices[0].message.content.trim();

      // Clean up the generated code - remove markdown if present
      const cleanCode = generatedCode
        .replace(/```(?:javascript|js)?\n?/g, '')
        .replace(/```/g, '')
        .trim();

      return cleanCode;
    } catch (error) {
      console.error('OpenAI API call failed:', error);
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

    try {
      // Capture console errors
      page.on('console', msg => {
        if (msg.type() === 'error') {
          testResult.consoleErrors.push(msg.text());
        }
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
        
        console.log(`\n    ${testNum}. Testing: "${expectation.text}"`);

        try {
          const testCode = await this.generateTestCode(htmlContent, expectation.text);
          const testPassed = await this.executeGeneratedTest(page, testCode);

          testResult.generatedTests.push({
            expectation: expectation.text,
            lineNumber: expectation.lineNumber,
            generatedCode: testCode,
            passed: testPassed,
            error: testPassed ? null : 'Assertion failed'
          });

          if (testPassed) {
            console.log(`       ✅ PASSED`);
          } else {
            console.log(`       ❌ FAILED - Assertion failed`);
            console.log(`       Generated: ${testCode}`);
          }

        } catch (error) {
          console.log(`       ❌ FAILED - ${error.message}`);
          testResult.generatedTests.push({
            expectation: expectation.text,
            lineNumber: expectation.lineNumber,
            generatedCode: null,
            passed: false,
            error: error.message
          });
        }
      }

      // Take screenshot
      const screenshotPath = `screenshots/${pageInfo.route.replace(/\//g, '_')}.png`;
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

  // Execute the LLM-generated test code safely
  async executeGeneratedTest(page, testCode) {
    try {
      // Create a safe execution context
      const testFunction = new Function('page', 'expect', `
        return (async () => {
          ${testCode}
          return true;
        })();
      `);
      await testFunction(page, expect);
      return true;
    } catch (error) {
      console.error(`Generated test execution failed: ${error.message}`);
      return false;
    }
  }

  // Simplified report generation - focus on failures
  generateReport() {
    const { totalPages, passedPages, failedPages, pages } = this.results;

    let report = `# 🤖 EnsureUI Test Results\n\n`;
    report += `**Summary:** ${passedPages}/${totalPages} pages passed`;
    
    if (failedPages === 0) {
      report += ` ✅\n\nAll tests passed! 🎉`;
      return report;
    }

    report += `\n\n## ❌ Failed Pages (${failedPages})\n\n`;

    const failedPages_list = pages.filter(p => !p.passed);
    failedPages_list.forEach(page => {
      const failedTests = page.generatedTests.filter(t => !t.passed);
      
      report += `### ${page.route}\n`;
      report += `**Failed tests:** ${failedTests.length}/${page.generatedTests.length}\n\n`;
      
      failedTests.forEach(test => {
        report += `❌ **"${test.expectation}"**\n`;
        if (test.error) {
          report += `   Error: ${test.error}\n`;
        }
        report += `\n`;
      });
    });

    report += `\n_💡 Detailed logs available above for debugging_`;
    return report;
  }

  async postResults(report) {
    const promises = [];

    if (this.githubToken && this.prNumber) {
      promises.push(this.postGitHubComment(report));
    }

    console.log('\n' + report);
    await Promise.allSettled(promises);
  }

  async postGitHubComment(report) {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${this.repository}/issues/${this.prNumber}/comments`,
        {
          method: 'POST',
          headers: {
            'Authorization': `token ${this.githubToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ body: report }),
        }
      );

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to post GitHub comment:', error);
    }
  }

  async run() {
    console.log('🤖 Starting EnsureUI tests with LLM...');

    if (!this.openaiApiKey) {
      console.error('OPENAI_API_KEY environment variable is required');
      process.exit(1);
    }

    const pages = this.findEnsureUIPages();
    const totalExpectations = pages.reduce((sum, page) => sum + page.expectations.length, 0);

    console.log(`Found ${pages.length} pages with ${totalExpectations} expectations`);

    if (pages.length === 0) {
      console.log('No pages found with // ensureUI: comments. Skipping tests.');
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
      console.log(`\n❌ ${this.results.failedPages} page(s) failed - see details above`);
    } else {
      console.log(`\n✅ All tests passed! 🎉`);
    }
    console.log('='.repeat(80));

    const report = this.generateReport();
    await this.postResults(report);

    console.log(`::set-output name=results::${JSON.stringify(this.results)}`);

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
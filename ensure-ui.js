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
      pages: [],
      flows: []
    };
    
    this.flowState = {
      currentStep: 0,
      variables: {},
      cookies: [],
      localStorage: {}
    };
  }

  // Find both page-level tests and flow definition files
  findEnsureUIPages() {
    const pages = [];
    const flows = [];
    const searchDirs = ['pages', 'app', 'src/pages', 'src/app'];
    const root = this.projectRoot || process.cwd();

    // Scan for page-level tests
    for (const dir of searchDirs) {
      const fullDir = path.join(root, dir);
      if (fs.existsSync(fullDir)) {
        console.log(`Scanning directory: ${fullDir}`);
        this.scanDirectory(fullDir, pages);
      }
    }
    
    // Look for ensure.md flow files
    const flowFiles = this.findFlowFiles(root);
    for (const flowFile of flowFiles) {
      const flowTests = this.parseFlowFile(flowFile);
      flows.push(...flowTests);
    }
    
    this.results.flows = flows;
    return pages;
  }

  // Find ensure.md files in the project
  findFlowFiles(rootDir) {
    const flowFiles = [];
    
    const scanDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
          scanDir(fullPath);
        } else if (item === 'ensure.md') {
          flowFiles.push(fullPath);
        }
      }
    };
    
    scanDir(rootDir);
    return flowFiles;
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
        
        // Match: // ensureUI: single line expectation
        const singleLineMatch = line.match(/\/\/\s*ensureUI:\s*(.+)/i);
        if (singleLineMatch) {
          const expectation = singleLineMatch[1].trim();
          expectations.push({
            text: expectation,
            lineNumber: i + 1,
            type: 'static'
          });
          continue;
        }
        
        // Match: // ensureUI (start of multi-line)
        const multiLineStart = line.match(/\/\/\s*ensureUI\s*$/i);
        if (multiLineStart) {
          const multiLineExpectation = this.extractMultiLineExpectation(lines, i);
          if (multiLineExpectation) {
            expectations.push({
              text: multiLineExpectation.text,
              lineNumber: i + 1,
              type: multiLineExpectation.type,
              endLineNumber: multiLineExpectation.endLineNumber
            });
            i = multiLineExpectation.endLineNumber - 1; // Skip processed lines
          }
        }
      }
      return expectations;
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return [];
    }
  }

  // Extract multi-line ensureUI comment block
  extractMultiLineExpectation(lines, startIndex) {
    let expectationText = '';
    let currentIndex = startIndex + 1;
    let isFlow = false;
    
    while (currentIndex < lines.length) {
      const line = lines[currentIndex].trim();
      
      // Check if line is a comment continuation
      const commentMatch = line.match(/\/\/\s*(.*)/);
      if (!commentMatch) {
        break; // End of comment block
      }
      
      const commentText = commentMatch[1].trim();
      if (commentText === '') {
        currentIndex++;
        continue; // Empty comment line
      }
      
      // Detect flow keywords
      if (this.isFlowKeyword(commentText)) {
        isFlow = true;
      }
      
      expectationText += (expectationText ? ' ' : '') + commentText;
      currentIndex++;
    }
    
    if (!expectationText) {
      return null;
    }
    
    return {
      text: expectationText,
      type: isFlow ? 'flow' : 'static',
      endLineNumber: currentIndex - 1
    };
  }

  // Check if comment contains flow keywords
  isFlowKeyword(text) {
    const flowKeywords = [
      'click', 'fill', 'submit', 'navigate', 'type', 'select',
      'then', 'after', 'when', 'should', 'user',
      'login', 'redirect', 'form', 'button', 'input'
    ];
    return flowKeywords.some(keyword => 
      new RegExp(`\\b${keyword}\\b`, 'i').test(text)
    );
  }

  // Validate expectation (now supports both static and flow)
  isValidExpectation(expectation, type = 'static') {
    if (type === 'flow') {
      return true; // Flow expectations support all interactions
    }
    
    // For static expectations, keep original restrictions
    const unsupportedPatterns = [
      /api|request|response|ajax|fetch/i // Only block API patterns for static
    ];

    return !unsupportedPatterns.some(pattern => pattern.test(expectation));
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
    return `HTML:
${html}

User Expectation: "${expectation}"

Generate the Playwright assertion code:`;
  }

  // Call OpenAI API to generate test code
  async generateTestCode(html, expectation) {
    const SYSTEM_PROMPT = `
    You are a Playwright E2E testing expert. Generate raw, executable Playwright test code that follows the full 
    user flow described. Your output must include both actions (form filling, clicks, etc.) and assertions 
    (URL, text, etc.).



STRICT RULES:
You are a Playwright end-to-end testing expert. Generate raw, executable Playwright test code that follows the entire user flow described.

STRICT RULES:
- Include both actions (like form filling, clicking buttons) and assertions (like page content and URL checks).
- Use only stable selectors:
  – Prefer getByRole(), getByLabel(), or getByText() where available.
  – Use data-testid if semantic selectors are not present.
  – Only use placeholders as a last resort.
  – Never use auto-generated IDs or attributes (e.g., :Rxyz:), or structure-based selectors like label + div input.
- If a required element has no stable selector, insert a line like:
// ERROR: No stable selector for [element description].
- Complete the entire described flow — from the initial state to the final expected page.
- Output only raw code. No markdown, no explanations, no comments (except error notes as above). 
- Generate only the test body. Do not include 'test(...)' or import statements. Assume 'page' and 'expect' are already in scope.
    `;
    if (!this.openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    const shrunkenHTML = this.shrinkHTML(html);
    const prompt = this.generateLLMPrompt(shrunkenHTML, expectation);

    console.log(`HTML size: ${html.length} → ${shrunkenHTML.length} (${Math.round(100 - (shrunkenHTML.length / html.length * 100))}% reduction)`);

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
              content: SYSTEM_PROMPT
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 200,
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
      for (const expectation of pageInfo.expectations) {
        console.log(`  Generating test for: "${expectation.text}"`);

        try {
          const testCode = await this.generateTestCode(htmlContent, expectation.text);
          console.log(`  Generated code: ${testCode}`);

          // Execute the generated test code
          const testPassed = await this.executeGeneratedTest(page, testCode);

          testResult.generatedTests.push({
            expectation: expectation.text,
            lineNumber: expectation.lineNumber,
            generatedCode: testCode,
            passed: testPassed,
            error: testPassed ? null : 'Assertion failed'
          });

        } catch (error) {
          console.error(`  Failed to generate/run test for "${expectation.text}":`, error);
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

  // Enhanced report generation
  generateReport() {
    const { totalPages, passedPages, failedPages, pages, flows } = this.results;
    const passedFlows = flows.filter(f => f.passed).length;
    const failedFlows = flows.filter(f => !f.passed).length;

    let report = `# 🤖 EnsureUI Test Results (LLM-Powered)\n\n`;
    report += `**Summary:** ${passedPages}/${totalPages} pages passed, ${passedFlows}/${flows.length} flows passed\n\n`;

    // Failed flows
    if (failedFlows > 0) {
      report += `## ❌ Failed Flows (${failedFlows})\n\n`;
      
      flows.filter(f => !f.passed).forEach(flow => {
        report += `### 🔄 ${flow.name}\n`;
        report += `- **Description:** ${flow.description || 'No description'}\n`;
        report += `- **Steps:** ${flow.steps.length}\n`;
        
        flow.steps.forEach((step, index) => {
          const icon = step.passed ? '✅' : '❌';
          report += `  ${index + 1}. ${icon} ${step.description}\n`;
          if (!step.passed && step.error) {
            report += `     - Error: ${step.error}\n`;
          }
        });
        
        report += '\n';
      });
    }

    // Failed pages
    if (failedPages > 0) {
      report += `## ❌ Failed Pages (${failedPages})\n\n`;

      pages.filter(p => !p.passed).forEach(page => {
        report += `### ${page.route}\n`;
        report += `- **URL:** ${page.url}\n`;

        // Basic checks
        if (!page.basicChecks.pageLoaded) {
          report += `- **Page Load:** ❌ Failed to load\n`;
        }

        // Generated tests
        page.generatedTests.forEach(test => {
          const icon = test.passed ? '✅' : '❌';
          const typeLabel = test.type === 'flow' ? '🔄' : '📝';
          report += `- ${typeLabel} **"${test.expectation}":** ${icon}\n`;
          if (!test.passed && test.error) {
            report += `  - Error: ${test.error}\n`;
          }
          if (test.generatedCode) {
            report += `  - Generated: \`${test.generatedCode}\`\n`;
          }
        });

        if (page.consoleErrors.length > 0) {
          report += `- **Console Errors:**\n`;
          page.consoleErrors.slice(0, 3).forEach(error => {
            report += `  - ${error}\n`;
          });
        }

        report += '\n';
      });
    }

    // Passed flows
    if (passedFlows > 0) {
      report += `## ✅ Passed Flows (${passedFlows})\n\n`;
      
      flows.filter(f => f.passed).forEach(flow => {
        report += `- **🔄 ${flow.name}** - ${flow.steps.length} steps completed ✅\n`;
      });
      
      report += '\n';
    }

    // Passed pages
    if (passedPages > 0) {
      report += `## ✅ Passed Pages (${passedPages})\n\n`;

      pages.filter(p => p.passed).forEach(page => {
        report += `- **${page.route}** - ${page.generatedTests.length} expectations passed ✅\n`;
        page.generatedTests.forEach(test => {
          const typeLabel = test.type === 'flow' ? '🔄' : '📝';
          report += `  - ${typeLabel} "${test.expectation}"\n`;
        });
      });
    }

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

  // Parse ensure.md flow files
  parseFlowFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const flows = [];
      const lines = content.split('\n');
      
      let currentFlow = null;
      let inCodeBlock = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines and code blocks
        if (!line || line.startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          continue;
        }
        
        if (inCodeBlock) continue;
        
        // Flow header: # Flow Name
        if (line.startsWith('# ')) {
          if (currentFlow) {
            flows.push(currentFlow);
          }
          currentFlow = {
            name: line.substring(2).trim(),
            description: '',
            steps: [],
            variables: {},
            passed: false,
            error: null,
            type: 'flow'
          };
          continue;
        }
        
        if (!currentFlow) continue;
        
        // Description
        if (line.startsWith('> ')) {
          currentFlow.description += line.substring(2) + ' ';
          continue;
        }
        
        // Variables: @variable = value
        if (line.startsWith('@')) {
          const varMatch = line.match(/@(\w+)\s*=\s*(.+)/);
          if (varMatch) {
            currentFlow.variables[varMatch[1]] = varMatch[2].replace(/["']/g, '');
          }
          continue;
        }
        
        // Step: 1. Step description
        const stepMatch = line.match(/^(\d+)\. (.+)/);
        if (stepMatch) {
          const stepDescription = stepMatch[2];
          currentFlow.steps.push({
            description: stepDescription,
            url: this.extractUrl(stepDescription),
            passed: false,
            error: null,
            generatedCode: null
          });
        }
      }
      
      if (currentFlow) {
        flows.push(currentFlow);
      }
      
      return flows;
    } catch (error) {
      console.error(`Error parsing flow file ${filePath}:`, error);
      return [];
    }
  }
  
  // Extract URL from step description
  extractUrl(stepDescription) {
    const urlMatch = stepDescription.match(/(?:navigate to|go to|visit|on page)\s+([\w\/\-]+)/i);
    if (urlMatch) {
      const path = urlMatch[1].startsWith('/') ? urlMatch[1] : '/' + urlMatch[1];
      return `${this.deploymentUrl}${path}`;
    }
    return null;
  }
  
  // Run a complete flow test
  async runFlowTest(flowInfo) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();
    
    // Reset flow state for new flow
    this.flowState = {
      currentStep: 0,
      variables: {...flowInfo.variables},
      cookies: [],
      localStorage: {}
    };
    
    const testResult = {
      ...flowInfo,
      passed: false,
      steps: [...flowInfo.steps],
      screenshots: [],
      error: null
    };
    
    try {
      console.log(`  Starting flow: ${flowInfo.name}`);
      
      for (let i = 0; i < flowInfo.steps.length; i++) {
        const step = flowInfo.steps[i];
        console.log(`  Step ${i + 1}: ${step.description}`);
        
        try {
          // Navigate if step has URL
          if (step.url) {
            await page.goto(step.url, {
              waitUntil: 'networkidle',
              timeout: this.timeout
            });
          }
          
          // Get current HTML
          const htmlContent = await page.content();
          
          // Generate test code for this step
          const testCode = await this.generateTestCode(htmlContent, step.description, 'flow');
          step.generatedCode = testCode;
          
          // Execute the generated test code
          const stepPassed = await this.executeGeneratedTest(page, testCode, 'flow');
          step.passed = stepPassed;
          
          if (!stepPassed) {
            step.error = 'Flow step failed';
            break;
          }
          
          // Take screenshot after each step
          const screenshotPath = `screenshots/flow_${flowInfo.name.replace(/\s+/g, '_')}_step_${i + 1}.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true });
          testResult.screenshots.push(screenshotPath);
          
          // Save state after each step
          this.flowState.cookies = await context.cookies();
          this.flowState.localStorage = await page.evaluate(() => {
            const storage = {};
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              storage[key] = localStorage.getItem(key);
            }
            return storage;
          });
          
        } catch (error) {
          step.passed = false;
          step.error = error.message;
          console.error(`  Step ${i + 1} failed:`, error);
          break;
        }
      }
      
      // Overall flow result
      testResult.passed = testResult.steps.every(step => step.passed);
      
    } catch (error) {
      testResult.error = error.message;
      console.error(`Flow ${flowInfo.name} failed:`, error);
    } finally {
      await browser.close();
    }
    
    return testResult;
  }

  async run() {
    console.log('🤖 Starting EnsureUI tests with LLM...');

    if (!this.openaiApiKey) {
      console.error('OPENAI_API_KEY environment variable is required');
      process.exit(1);
    }

    const pages = this.findEnsureUIPages();
    const flows = this.results.flows;
    const totalExpectations = pages.reduce((sum, page) => sum + page.expectations.length, 0);
    const totalFlowSteps = flows.reduce((sum, flow) => sum + flow.steps.length, 0);

    console.log(`Found ${pages.length} pages with ${totalExpectations} expectations`);
    console.log(`Found ${flows.length} flows with ${totalFlowSteps} total steps`);

    if (pages.length === 0 && flows.length === 0) {
      console.log('No tests found. Add // ensureUI comments or create ensure.md files.');
      return;
    }

    this.results.totalPages = pages.length;

    // Run page-level tests
    for (const pageInfo of pages) {
      console.log(`Testing: ${pageInfo.url} (${pageInfo.expectations.length} expectations)`);
      const result = await this.runPageTest(pageInfo);
      this.results.pages.push(result);

      if (result.passed) {
        this.results.passedPages++;
        console.log(`✅ ${pageInfo.route} - PASSED`);
      } else {
        this.results.failedPages++;
        console.log(`❌ ${pageInfo.route} - FAILED`);
      }
    }
    
    // Run flow tests
    for (const flowInfo of flows) {
      console.log(`Testing flow: ${flowInfo.name} (${flowInfo.steps.length} steps)`);
      const result = await this.runFlowTest(flowInfo);
      this.results.flows[this.results.flows.indexOf(flowInfo)] = result;
      
      if (result.passed) {
        console.log(`✅ Flow ${flowInfo.name} - PASSED`);
      } else {
        console.log(`❌ Flow ${flowInfo.name} - FAILED`);
      }
    }

    const report = this.generateReport();
    await this.postResults(report);

    console.log(`::set-output name=results::${JSON.stringify(this.results)}`);

    const totalFailed = this.results.failedPages + this.results.flows.filter(f => !f.passed).length;
    if (totalFailed > 0) {
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
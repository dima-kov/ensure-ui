const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

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

    this.results = {
      totalPages: 0,
      passedPages: 0,
      failedPages: 0,
      pages: []
    };
  }

  // Part 1: Detect // ensureUI comments
  findEnsureUIPages() {
    const pages = [];
    const searchDirs = ['pages', 'app', 'src/pages', 'src/app'];
    const root = this.projectRoot || process.cwd();

    for (const dir of searchDirs) {
      const fullDir = path.join(root, dir);
      if (fs.existsSync(fullDir)) {
        console.log(`Scanning directory: ${fullDir}`);
        const items = fs.readdirSync(fullDir);
        console.log(`Contents of ${fullDir}:`, items);
        this.scanDirectory(fullDir, pages);
      }
    }
    console.log('Project root:', root);
    console.log('Root directory contents:', fs.readdirSync(root));
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
        if (this.hasEnsureUIComment(fullPath)) {
          const route = this.getRouteFromPath(fullPath);
          pages.push({
            filePath: fullPath,
            route: route,
            url: `${this.deploymentUrl}${route}`
          });
        }
      }
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

  hasEnsureUIComment(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return content.includes('// ensureUI') || content.includes('//ensureUI');
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return false;
    }
  }

  getRouteFromPath(filePath) {
    // Convert file path to Next.js route
    let route = filePath;
    route = route.replace(this.projectRoot, '');

    // Remove common prefixes
    route = route.replace(/^(src\/)?pages\//, '');
    route = route.replace(/^(src\/)?app\//, '');

    // Remove file extension
    route = route.replace(/\.(js|jsx|ts|tsx)$/, '');

    // Handle index files
    route = route.replace(/\/index$/, '');
    route = route.replace(/^index$/, '');

    // Handle dynamic routes
    route = route.replace(/\[([^\]]+)\]/g, (match, param) => {
      // For testing, use placeholder values
      if (param === 'id') return '1';
      if (param === 'slug') return 'example';
      return param;
    });

    // Ensure route starts with /
    if (!route.startsWith('/')) {
      route = '/' + route;
    }

    // Handle root route
    if (route === '/') {
      return '/';
    }

    return route;
  }

  // Part 2 & 3: Run headless browser tests
  async runPageTest(pageInfo) {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();

    const testResult = {
      ...pageInfo,
      passed: false,
      checks: {
        pageLoaded: false,
        noConsoleErrors: false,
        hasHeader: false,
        hasInteractiveElement: false
      },
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

      // Navigate to page with timeout
      const response = await page.goto(pageInfo.url, {
        waitUntil: 'networkidle',
        timeout: this.timeout
      });

      // Check 1: Page loaded successfully
      testResult.checks.pageLoaded = response.status() === 200;

      // Check 2: No console errors
      testResult.checks.noConsoleErrors = testResult.consoleErrors.length === 0;

      // Check 3: Has header element
      const headerElements = await page.$$('h1, h2, h3, [role="heading"]');
      testResult.checks.hasHeader = headerElements.length > 0;

      // Check 4: Has interactive elements
      const interactiveElements = await page.$$('button, a[href], input, select, textarea');
      testResult.checks.hasInteractiveElement = interactiveElements.length > 0;

      // Part 4: Capture screenshot
      const screenshotPath = `screenshots/${pageInfo.route.replace(/\//g, '_')}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      testResult.screenshot = screenshotPath;

      // Determine if test passed
      testResult.passed = Object.values(testResult.checks).every(check => check === true);

    } catch (error) {
      testResult.error = error.message;
      console.error(`Error testing ${pageInfo.url}:`, error);
    } finally {
      await browser.close();
    }

    return testResult;
  }

  // Part 5: Generate report
  generateReport() {
    const { totalPages, passedPages, failedPages, pages } = this.results;

    let report = `# 🔍 EnsureUI Test Results\n\n`;
    report += `**Summary:** ${passedPages}/${totalPages} pages passed\n\n`;

    if (failedPages > 0) {
      report += `## ❌ Failed Pages (${failedPages})\n\n`;

      pages.filter(p => !p.passed).forEach(page => {
        report += `### ${page.route}\n`;
        report += `- **URL:** ${page.url}\n`;

        Object.entries(page.checks).forEach(([check, passed]) => {
          const icon = passed ? '✅' : '❌';
          const checkName = check.replace(/([A-Z])/g, ' $1').toLowerCase();
          report += `- **${checkName}:** ${icon}\n`;
        });

        if (page.consoleErrors.length > 0) {
          report += `- **Console Errors:**\n`;
          page.consoleErrors.slice(0, 3).forEach(error => {
            report += `  - ${error}\n`;
          });
        }

        if (page.error) {
          report += `- **Error:** ${page.error}\n`;
        }

        report += '\n';
      });
    }

    if (passedPages > 0) {
      report += `## ✅ Passed Pages (${passedPages})\n\n`;

      pages.filter(p => p.passed).forEach(page => {
        report += `- ${page.route} - All checks passed ✅\n`;
      });
    }

    return report;
  }

  // Part 6: Post results
  async postResults(report) {
    const promises = [];

    // GitHub PR comment
    if (this.githubToken && this.prNumber) {
      promises.push(this.postGitHubComment(report));
    }

    // Console output
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
    console.log('🔍 Starting EnsureUI tests...');

    // Part 1: Find pages with ensureUI comments
    const pages = this.findEnsureUIPages();
    console.log(`Found ${pages.length} pages with // ensureUI comments`);

    if (pages.length === 0) {
      console.log('No pages found with // ensureUI comments. Skipping tests.');
      return;
    }

    this.results.totalPages = pages.length;

    // Part 2-4: Test each page
    for (const pageInfo of pages) {
      console.log(`Testing: ${pageInfo.url}`);
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

    // Part 5: Generate report
    const report = this.generateReport();

    // Part 6: Post results
    await this.postResults(report);

    // Set GitHub Actions output
    console.log(`::set-output name=results::${JSON.stringify(this.results)}`);

    // Exit with error code if tests failed
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

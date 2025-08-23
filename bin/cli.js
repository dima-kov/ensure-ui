#!/usr/bin/env node

const { Command } = require('commander');
const { EnsureUITester } = require('../lib/tester');

const program = new Command();

program
  .name('ensureui')
  .description('LLM-powered automated UI testing for Next.js applications')
  .version('1.0.0');

program
  .command('test')
  .description('Run all tests in the project')
  .option('-p, --project <path>', 'Project root path', process.cwd())
  .option('-u, --url <url>', 'Deployment URL to test against')
  .option('-t, --timeout <seconds>', 'Page load timeout in seconds', '15')
  .option('-k, --api-key <key>', 'EnsureUI API key')
  .action(async (options) => {
    try {
      const tester = new EnsureUITester({
        projectRoot: options.project,
        deploymentUrl: options.url,
        timeout: options.timeout,
        apiKey: options.apiKey
      });
      
      await tester.runAllTests();
    } catch (error) {
      console.error('EnsureUI tests failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('test-page')
  .description('Run tests for a single page')
  .argument('<route>', 'Route to test (e.g., /about, /posts/123)')
  .option('-p, --project <path>', 'Project root path', process.cwd())
  .option('-u, --url <url>', 'Deployment URL to test against')
  .option('-t, --timeout <seconds>', 'Page load timeout in seconds', '15')
  .option('-k, --api-key <key>', 'EnsureUI API key')
  .action(async (route, options) => {
    try {
      const tester = new EnsureUITester({
        projectRoot: options.project,
        deploymentUrl: options.url,
        timeout: options.timeout,
        apiKey: options.apiKey
      });
      
      const page = await tester.findPageByRoute(route);
      
      if (!page) {
        console.error(`❌ No page found with ensureUI comments for route: ${route}`);
        console.log('\nAvailable pages with ensureUI comments:');
        const allPages = await tester.findEnsureUIPages();
        if (allPages.length === 0) {
          console.log('  None found');
        } else {
          allPages.forEach(p => console.log(`  ${p.route} (${p.expectations.length} expectations)`));
        }
        process.exit(1);
      }
      
      console.log(`🌐 Testing single page: ${page.route}`);
      console.log(`URL: ${page.url}`);
      console.log(`Ensure: ${page.rawExpectations}`);
      console.log(`Expectations: ${page.expectations.length}`);
      
      const result = await tester.runPageTest(page);
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🏁 RESULT FOR ${page.route}`);
      
      if (result.passed) {
        console.log(`✅ PASSED - All ${page.expectations.length} expectations met`);
      } else {
        console.log(`❌ FAILED`);
        const failedTests = result.generatedTests.filter(t => !t.passed);
        console.log(`Failed expectations: ${failedTests.length}/${page.expectations.length}`);
        
        failedTests.forEach((test, index) => {
          console.log(`  ${index + 1}. ${test.expectation}`);
          if (test.error) {
            console.log(`     Error: ${test.error}`);
          }
        });
      }
      
      console.log('='.repeat(80));
      
      if (!result.passed) {
        process.exit(1);
      }
    } catch (error) {
      console.error('EnsureUI page test failed:', error.message);
      process.exit(1);
    }
  });

program.parse();
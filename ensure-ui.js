const { EnsureUITester } = require('./lib/tester');

// Run the tests for GitHub Actions
const tester = new EnsureUITester({
  projectRoot: process.env.PROJECT_ROOT,
  deploymentUrl: process.env.DEPLOYMENT_URL,
  timeout: process.env.TIMEOUT,
  apiKey: process.env.ENSURE_API_KEY
});

tester.runAllTests().catch(error => {
  console.error('EnsureUI tests failed:', error);
  process.exit(1);
});
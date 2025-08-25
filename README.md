# EnsureUI

LLM-powered automated UI testing for Next.js applications using natural language expectations. Available as both an npm CLI tool and GitHub Action.

## Installation

### As a CLI Tool

```bash
npm install -g ensureui
```

### In Your Project

```bash
npm install ensureui
```

## Quick Start

### 1. Add test expectations to your Next.js pages

Add comments with `// ensureUI:` followed by your expectations:

```javascript
// pages/about.js
export default function About() {
  return (
    <div>
      <h1>About Us</h1>
      <p>We are a great company</p>
    </div>
  );
}

// ensureUI: the page shows "About Us" heading
// ensureUI: there should be text about being a great company
```

### 2. Run tests

```bash
# Test all pages
ensureui test -u https://your-deployed-site.com -k your-api-key

# Test a single page
ensureui test-page /about -u https://your-deployed-site.com -k your-api-key
```

## CLI Usage

### Commands

#### `ensureui test`
Run tests for all pages with ensureUI comments.

```bash
ensureui test [options]
```

**Options:**
- `-u, --url <url>` - Deployment URL to test against (required)
- `-k, --api-key <key>` - EnsureUI API key (required)
- `-p, --project <path>` - Project root path (default: current directory)
- `-t, --timeout <seconds>` - Page load timeout in seconds (default: 15)

**Example:**
```bash
ensureui test -u https://myapp.vercel.app -k your-api-key
```

#### `ensureui test-page`
Run tests for a single page by route.

```bash
ensureui test-page <route> [options]
```

**Arguments:**
- `<route>` - Route to test (e.g., `/about`, `/posts/123`)

**Options:** Same as `test` command

**Examples:**
```bash
ensureui test-page /about -u https://myapp.vercel.app -k your-api-key
ensureui test-page /posts/123 -u https://myapp.vercel.app -k your-api-key
```

## Writing Test Expectations

### Basic Syntax

Use `// ensureUI:` comments in your page components:

```javascript
// ensureUI: the page loads successfully
// ensureUI: there should be a welcome message
// ensureUI: the navigation menu is visible
```

### Multi-line Expectations

Continue expectations on the next line with `//`:

```javascript
// ensureUI: the contact form should be present
// with name, email, and message fields
// and a submit button
```

### Dynamic Routes

For pages with dynamic parameters, specify values in your expectations:

```javascript
// pages/posts/[id].js
// ensureUI: test page with id 123
// ensureUI: the post title should be visible
```

### Supported Test Types

1. **Page Load Tests**
   ```javascript
   // ensureUI: page loads successfully
   // ensureUI: page responds correctly
   ```

2. **Content Presence Tests**
   ```javascript
   // ensureUI: shows welcome message
   // ensureUI: contains user profile information
   // ensureUI: displays product list
   ```

3. **Interaction Tests**
   ```javascript
   // ensureUI: click the login button then see dashboard
   // ensureUI: fill contact form and submit
   ```

4. **Redirect Tests**
   ```javascript
   // ensureUI: should redirect to login page
   // ensureUI: redirects with 301 status
   ```

## Environment Variables

You can set environment variables instead of CLI options:

- `ENSURE_API_KEY` - Your EnsureUI API key
- `DEPLOYMENT_URL` - URL to test against
- `PROJECT_ROOT` - Project root path
- `TIMEOUT` - Page timeout in seconds

```bash
export ENSURE_API_KEY=your-api-key
export DEPLOYMENT_URL=https://myapp.vercel.app
ensureui test
```

## GitHub Actions Integration

EnsureUI also works as a GitHub Action. Create `.github/workflows/ui-tests.yml`:

```yaml
name: UI Tests
on: [push, pull_request]

jobs:
  ui-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run EnsureUI Tests
        run: node ensure-ui.js
        env:
          PROJECT_ROOT: ${{ github.workspace }}
          DEPLOYMENT_URL: https://your-deployed-app.com
          ENSURE_API_KEY: ${{ secrets.ENSURE_API_KEY }}
```

## Programmatic Usage

You can also use EnsureUI in your Node.js code:

```javascript
const { EnsureUITester } = require('ensureui');

const tester = new EnsureUITester({
  projectRoot: '/path/to/project',
  deploymentUrl: 'https://myapp.com',
  apiKey: 'your-api-key',
  timeout: 15
});

// Test all pages
await tester.runAllTests();

// Test single page
const page = await tester.findPageByRoute('/about');
if (page) {
  const result = await tester.runPageTest(page);
  console.log(result.passed ? 'Passed' : 'Failed');
}
```

## File Structure Support

EnsureUI automatically scans these directories for pages:

- `pages/` (Next.js Pages Router)
- `app/` (Next.js App Router)
- `src/pages/` (Pages Router with src)
- `src/app/` (App Router with src)

Supported file extensions: `.js`, `.jsx`, `.ts`, `.tsx`

## Output

### Test Results
- ✅ **Passed tests** - Expectations met successfully
- ❌ **Failed tests** - Expectations not met or errors occurred
- 📸 **Screenshots** - Automatically captured for each test

### Detailed Logging
- Generated Playwright test code for each expectation
- Console errors from the tested pages
- Redirect chain information for redirect tests
- Line numbers for failed expectations

## API Key

Get your EnsureUI API key from [your dashboard](https://ensureui.com) or contact support.

## Troubleshooting

### Common Issues

1. **"No pages found with ensureUI comments"**
   - Make sure you have `// ensureUI:` comments in your page files
   - Check that files are in supported directories (`pages/`, `app/`, etc.)

2. **"Route parameter required but not specified"**
   - For dynamic routes like `[id].js`, specify the parameter in your expectation:
   ```javascript
   // ensureUI: test page with id 123
   ```

3. **"Page failed to load"**
   - Verify your deployment URL is correct and accessible
   - Check if the page requires authentication or has other restrictions

4. **Test timeouts**
   - Increase timeout with `-t 30` for slower pages
   - Ensure your deployment is stable and responsive

### Debug Mode

For more detailed output, check the generated Playwright code for each test in the console output.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

ISC

## Support

- GitHub Issues: [Report bugs or request features](https://github.com/your-username/ensureui/issues)
- Documentation: [Full documentation](https://ensureui.com/docs)
- Examples: [Example projects](https://github.com/your-username/ensureui/examples)
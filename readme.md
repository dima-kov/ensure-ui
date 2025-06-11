# EnsureUI GitHub Action

A comprehensive GitHub Action that automatically tests Next.js pages marked with `// ensureUI` comments against live deployments to ensure they load correctly and meet basic UI requirements.

## Features

✅ **Automatic Detection** - Scans your codebase for `// ensureUI` comments  
✅ **Deployment-Triggered Testing** - Tests against live deployment URLs  
✅ **Headless Browser Testing** - Uses Playwright for reliable page testing  
✅ **Visual Evidence** - Captures screenshots of tested pages  
✅ **GitHub Integration** - Posts results as PR comments  
✅ **Comprehensive Checks** - Tests page loading, console errors, headers, and interactive elements  
✅ **Zero Configuration** - Works out of the box with deployment events  

## Quick Start

### 1. Add the workflow to your repository

Create `.github/workflows/ensure-ui.yml` in your repository with the provided workflow configuration.

### 2. Mark pages for testing

Add `// ensureUI` comment to any page you want to test:

```javascript
// pages/dashboard.js
// ensureUI
export default function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      <button onClick={() => alert('Hello!')}>Click me</button>
    </div>
  );
}
```

### 3. Create the action directory

Create the directory structure:
```
.github/
  actions/
    ensure-ui/
      action.yml
      ensure-ui.js
```

Copy the provided `action.yml` and `ensure-ui.js` files into this directory.

### 4. Configure your deployment platform

The action triggers automatically on successful deployments. It works with:
- **Vercel** - Automatically detects deployment URLs
- **Netlify** - Uses deployment status webhooks  
- **Custom deployments** - Manual trigger with deployment URL

## Triggers

### Automatic (Deployment Events)
The action runs automatically when:
- A deployment succeeds (via `deployment_status` event)
- Deployment platforms like Vercel/Netlify send status updates

### Manual Trigger
You can also run tests manually:
1. Go to Actions tab in your repository
2. Select "EnsureUI Testing" workflow
3. Click "Run workflow"
4. Enter the deployment URL to test

## What Gets Tested

For each page marked with `// ensureUI`, the action performs these checks:

### ✅ Page Loading
- Page returns HTTP 200 status
- Page loads without timeout (default: 15 seconds)

### ✅ Console Errors  
- No uncaught JavaScript errors in console
- Captures and reports any console errors found

### ✅ Content Structure
- Page contains at least one header element (`h1`, `h2`, `h3`, or `[role="heading"]`)
- Ensures pages have meaningful content structure

### ✅ Interactivity
- Page contains at least one interactive element
- Looks for `button`, `a[href]`, `input`, `select`, or `textarea` elements

### ✅ Visual Evidence
- Captures full-page screenshot (desktop viewport: 1280x720)
- Screenshots saved as artifacts for 7 days

## Configuration Options

### Basic Configuration

```yaml
- name: Run EnsureUI Tests
  uses: ./.github/actions/ensure-ui
  with:
    deployment-url: 'https://your-app.vercel.app'
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Advanced Configuration

```yaml
- name: Run EnsureUI Tests
  uses: ./.github/actions/ensure-ui
  with:
    deployment-url: 'https://your-app.vercel.app'
    github-token: ${{ secrets.GITHUB_TOKEN }}
    timeout: '30'  # Page load timeout in seconds
```

## Notification Setup

### GitHub PR Comments (Automatic)
- Automatically posts results to pull request comments
- Requires `github-token` input (usually `${{ secrets.GITHUB_TOKEN }}`)
- Only posts comments when triggered from pull requests

## Supported File Patterns

The action automatically detects `// ensureUI` comments in these file types:
- `page.js`, `page.jsx`, `page.ts`, `page.tsx` (App Router)
- `index.js`, `index.jsx`, `index.ts`, `index.tsx` (Pages Router)
- Any `.js`, `.jsx`, `.ts`, `.tsx` files in pages directories

### Supported Directory Structures
- `pages/` (Next.js Pages Router)
- `app/` (Next.js App Router)  
- `src/pages/` (Pages Router in src)
- `src/app/` (App Router in src)

## Route Mapping Examples

| File Path | Generated Route | Test URL |
|-----------|----------------|----------|
| `pages/index.js` | `/` | `https://your-app.vercel.app/` |
| `pages/about.js` | `/about` | `https://your-app.vercel.app/about` |
| `pages/blog/[slug].js` | `/blog/example` | `https://your-app.vercel.app/blog/example` |
| `app/dashboard/page.js` | `/dashboard` | `https://your-app.vercel.app/dashboard` |

## Sample Output

### ✅ Passing Test Result
```
🔍 EnsureUI Test Results

Summary: 2/2 pages passed

✅ Passed Pages (2)
- / - All checks passed ✅
- /dashboard - All checks passed ✅
```

### ❌ Failing Test Result
```
🔍 EnsureUI Test Results

Summary: 1/2 pages passed

❌ Failed Pages (1)

### /broken
- URL: http://localhost:3000/broken
- page loaded: ❌
- no console errors: ❌  
- has header: ✅
- has interactive element: ✅
- Console Errors:
  - TypeError: Cannot read property 'foo' of undefined
  - ReferenceError: unknownVariable is not defined

✅ Passed Pages (1)
- /dashboard - All checks passed ✅
```

## Troubleshooting

### Action Not Running
- Ensure workflow file is in `.github/workflows/` directory
- Check that deployment status events are being sent by your platform
- Verify your deployment platform supports GitHub deployment status webhooks

### No Pages Found
- Confirm `// ensureUI` comments are present (case-sensitive)
- Check that files are in supported directories (`pages/`, `app/`, etc.)
- Ensure file extensions are supported (`.js`, `.jsx`, `.ts`, `.tsx`)

### Page Load Failures
- Increase timeout value if pages load slowly
- Check that your deployment URL is accessible
- Verify the deployment is actually successful before tests run
- Test the deployment URL manually in a browser

### Missing Screenshots
- Screenshots are uploaded as GitHub Actions artifacts
- Check the "Actions" tab in your repository for artifact downloads
- Artifacts are retained for 7 days by default

## Integration Examples

### With Vercel Deployments
Vercel automatically sends deployment status events to GitHub, so the action will trigger automatically:

```yaml
# No additional configuration needed!
# The action will automatically run when Vercel deployments succeed
```

### With Netlify Deployments
Configure Netlify to send deployment notifications:

```yaml
# Netlify automatically sends deployment status via webhooks
# Ensure your Netlify site is connected to your GitHub repository
```

### With Custom Deployment Scripts
For custom deployments, you can trigger the workflow manually or via API:

```yaml
- name: Deploy application
  run: ./deploy.sh
  
- name: Trigger EnsureUI tests
  uses: actions/github-script@v7
  with:
    script: |
      await github.rest.actions.createWorkflowDispatch({
        owner: context.repo.owner,
        repo: context.repo.repo,
        workflow_id: 'ensure-ui.yml',
        ref: context.ref,
        inputs: {
          'deployment-url': 'https://your-custom-deployment.com'
        }
      });
```

## Contributing

This action is designed to be self-contained and reusable. To customize for your specific needs:

1. Fork the action files
2. Modify the test criteria in `ensure-ui.js`
3. Update the action configuration in `action.yml`
4. Test with your own repository

## License

This GitHub Action is provided as-is for educational and development purposes. Feel free to modify and distribute according to your needs.
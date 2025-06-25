# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EnsureUI is a GitHub Action that provides LLM-powered automated UI testing for Next.js applications. It uses natural language expectations in code comments to generate and execute Playwright tests against live deployments.

## Core Architecture

The system has two main components:

1. **action.yml** - GitHub Action configuration that sets up the testing environment
2. **ensure-ui.js** - Main testing engine that:
   - Scans codebase for `// ensureUI:` comments with expectations
   - Uses OpenAI API to generate Playwright test code from HTML + expectations
   - Executes generated tests and reports results

### Key Classes and Flow

- **EnsureUITester** (ensure-ui.js:6) - Main orchestrator class
- **Test Discovery**: Scans `pages/`, `app/`, `src/pages/`, `src/app/` directories
- **Comment Parsing**: Extracts `// ensureUI: expectation text` from page files  
- **LLM Integration**: Sends shrunk HTML + expectation to OpenAI for test generation
- **Test Execution**: Runs generated Playwright code safely using Function constructor

### Route Mapping Logic

The `getRouteFromPath()` function (ensure-ui.js:125) converts file paths to Next.js routes:
- Strips project root, src/, pages/, app/ prefixes
- Handles dynamic routes: `[id]` → `1`, `[slug]` → `example`
- Removes page.js suffixes and index files
- Supports both Pages Router and App Router patterns

## Development Commands

Since this is a standalone GitHub Action, there are no build/test commands. The action runs via:

```bash
# In GitHub Actions context:
node ensure-ui.js
```

## Environment Variables Required

- `PROJECT_ROOT` - Path to the project being tested
- `DEPLOYMENT_URL` - URL of deployed application to test
- `OPENAI_API_KEY` - Required for LLM test generation
- `GITHUB_TOKEN` - For posting PR comments
- `TIMEOUT` - Page load timeout (default: 15 seconds)

## Comment Formats

### Single-line Static Tests
```javascript
// ensureUI: the page shows a welcome message
// ensureUI: there should be a navigation menu
```

### Multi-line Static Tests
```javascript
// ensureUI
// the page should display a navigation menu with home, about, and contact links
// the footer should contain copyright information and social media links
```

### Multi-line Flow Tests (Interactive)
```javascript
// ensureUI
// user should be able to click the "Get Started" button
// then user should see a signup form with name, email, and password fields
// user should be able to fill out the form and submit it
// after submission, user should see a success message
```

The system automatically detects flow vs static tests based on keywords like 'click', 'fill', 'submit', 'navigate', 'user', etc.

## HTML Processing

The `shrinkHTML()` function (ensure-ui.js:161) reduces HTML size for LLM processing by:
- Removing scripts, styles, comments
- Stripping most attributes except semantic ones (aria-, role, alt, etc.)
- Collapsing whitespace and empty elements
- Truncating very long text content

## Test Generation Pipeline

1. Extract HTML from page via Playwright
2. Shrink HTML for token efficiency  
3. Send to OpenAI with structured prompt
4. Parse generated Playwright assertions
5. Execute safely using Function constructor
6. Report results with screenshots

## Flow Definition Files (ensure.md)

Create `ensure.md` files to define complex user flows:

```markdown
# User Login Flow

> Test the complete user authentication flow

@username = testuser@example.com
@password = password123

1. Navigate to /login page
2. User should see login form with email and password fields
3. Fill in email field with @username
4. Fill in password field with @password
5. Click the login button
6. User should be redirected to /dashboard
7. User should see welcome message
```

### Flow File Features:
- **Variables**: `@variable = value` syntax for reusable values
- **Steps**: Numbered steps with natural language descriptions
- **Navigation**: Automatic URL detection and navigation
- **State Management**: Maintains cookies and localStorage between steps
- **Screenshots**: Captures screenshots after each step

## File Structure Patterns

The action expects Next.js project structures:
- Pages Router: `pages/*.{js,jsx,ts,tsx}`
- App Router: `app/**/page.{js,jsx,ts,tsx}`
- Supports src/ prefix for both patterns
- Flow files: `ensure.md`, `tests/ensure.md`, `**/ensure.md`

## Testing Capabilities

### Static Tests (Content-focused)
- Text presence and content verification
- Element existence and structure
- Visual layout validation
- Accessibility checks

### Flow Tests (Interactive)
- Form filling and submission
- Button clicks and navigation
- Modal interactions
- Multi-step user journeys
- Authentication flows
- Shopping cart operations
- Complex UI interactions

## New Architecture Features

### Multi-line Comment Parsing
- `extractMultiLineExpectation()` - Processes multi-line comment blocks
- `isFlowKeyword()` - Detects interactive vs static tests
- Automatic type detection based on content

### Flow Execution Engine
- `parseFlowFile()` - Parses ensure.md files into executable flows
- `runFlowTest()` - Executes complete user flows step-by-step
- `flowState` - Maintains state between flow steps (cookies, localStorage)

### Enhanced LLM Integration
- Different prompts for static vs flow tests
- Increased token limits for complex interactions
- Context-aware test generation based on HTML structure
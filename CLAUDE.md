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

## Current Testing Scope

### Static Testing Only
The `isValidExpectation()` function (ensure-ui.js:98) currently **restricts testing to static content only**:
- Text presence and content verification
- Element existence and structure validation
- Basic page health checks

### Blocked Capabilities
Interactive testing patterns are currently disabled:
- Click, navigate, submit, fill operations
- Form validation and redirects
- Multi-step user flows
- Hover interactions and API calls

## Comment Format

Currently supports only single-line expectations:
```javascript
// ensureUI: the page shows a welcome message
// ensureUI: there should be a navigation menu
```

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

## Architecture Limitations

### Current Implementation vs Documentation Gap
- README describes comprehensive interactive testing capabilities
- Implementation actively restricts interactive patterns via validation
- Multi-line comment support mentioned in README but not implemented
- Flow definition files (ensure.md) described but not implemented

### Monolithic Structure
- Single 523-line file contains all logic
- No modular separation of concerns
- No package.json or development dependencies
- No test suite for the testing tool itself

## File Structure Patterns

The action expects Next.js project structures:
- Pages Router: `pages/*.{js,jsx,ts,tsx}`
- App Router: `app/**/page.{js,jsx,ts,tsx}`
- Supports src/ prefix for both patterns

## LLM Integration

- Uses OpenAI `gpt-4o-mini` model for cost efficiency
- Token-optimized HTML processing
- Structured prompts for Playwright code generation
- Safe execution environment for generated code
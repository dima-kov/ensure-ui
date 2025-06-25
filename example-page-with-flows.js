// Example Next.js page demonstrating all EnsureUI features

// Single-line static expectation
// ensureUI: the page should have a welcome message

// Multi-line static expectation
// ensureUI
// the page should display a navigation menu with home, about, and contact links
// the footer should contain copyright information and social media links

// Multi-line flow expectation (interactive)
// ensureUI
// user should be able to click the "Get Started" button
// then user should see a signup form with name, email, and password fields
// user should be able to fill out the form and submit it
// after submission, user should see a success message

// ensureUI: the page should load within 3 seconds

export default function HomePage() {
  return (
    <div>
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
      </nav>
      
      <main>
        <h1>Welcome to Our App</h1>
        <p>Get started with our amazing features!</p>
        <button id="get-started">Get Started</button>
      </main>
      
      <footer>
        <p>&copy; 2024 Our Company. All rights reserved.</p>
        <div className="social-links">
          <a href="#">Facebook</a>
          <a href="#">Twitter</a>
        </div>
      </footer>
    </div>
  );
}
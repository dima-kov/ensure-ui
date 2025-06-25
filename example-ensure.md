# User Login Flow

> Test the complete user authentication flow from login to dashboard access

@username = testuser@example.com
@password = password123
@dashboardUrl = /dashboard

1. Navigate to /login page
2. User should see login form with email and password fields
3. Fill in email field with @username
4. Fill in password field with @password
5. Click the login button
6. User should be redirected to @dashboardUrl
7. User should see welcome message with their name
8. Navigation menu should be visible with logout option

# Shopping Cart Flow

> Test adding items to cart and proceeding through checkout

@productName = Test Product
@quantity = 2

1. Navigate to /products page
2. User should see product listing
3. Click on product named @productName
4. User should see product details page
5. Select quantity @quantity
6. Click add to cart button
7. User should see cart icon with item count
8. Click on cart icon
9. User should see cart with @productName and quantity @quantity
10. Click proceed to checkout button
11. User should see checkout form
12. Fill in shipping information form
13. User should see order summary with correct total

# Modal Interaction Flow

> Test modal opening, interaction, and closing

1. Navigate to /members page
2. User should see member list
3. Click on first member card
4. Modal should open with member details
5. Modal should contain member name and contact info
6. Click close button or outside modal
7. Modal should close and return to member list
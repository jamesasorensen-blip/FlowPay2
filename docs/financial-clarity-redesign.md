# FlowPay2 — Financial clarity redesign (staging plan)

## Navigation
Home: Safe to Spend, key alerts, short forecast, quick actions.
Bills & Calendar: upcoming bills, reserves, schedule, payment status.
Activity: transactions, receipt links, filters.
Credit & Debt: existing debts, APR, payments, educational borrowing simulator.
Shopping: receipts, itemized purchases, shopping cart, checkout screenshot analysis.
Settings: accounts, privacy, authentication, preferences.
Mobile: maximum four primary navigation items plus More; never remove access to Calendar or Activity.
Desktop: responsive navigation with clear active state.

## Financial display contract
Every amount must specify its meaning: balance, spendable, reserved, owed, paid, expected or hypothetical.
Use tabular numerals and consistent currency precision.
Actual, pending, estimated, and simulated values require visible text labels; never rely on color alone.
Expenses in transaction lists show a minus sign; debt balances are positive amounts labeled 'Owed'.
Future obligations are not recorded as completed spending.
Never subtract a reserved amount and the same covered bill twice.
Income is only included when its expected date precedes the obligation; uncertain income is labeled.
Use accessible contrast in light and dark modes and do not remove existing authentication or banking controls.

## Release sequence
1. Audit existing index.html navigation, styles, and Safe to Spend calculations.
2. Integrate shared financial components and responsive layout in staging.
3. Validate current Home, Bills, Calendar, Activity, Settings, and login flows.
4. Add reserve and scenario features using one date-aware forecasting engine.
5. Add debt, receipts, and shopping as separate sections, behind staged flags.
6. Test mobile, desktop, dark mode, keyboard navigation and screen reader labels.
7. Deploy production only after staging verification.

This branch is a design foundation, not a production release.

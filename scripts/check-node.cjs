// Runs before `npm start` / `npm test`. The app uses Node's built-in SQLite
// (`node:sqlite`), which needs Node.js 22.13 or newer. Without this check an
// older Node fails with a confusing "No such built-in module" error.
// CommonJS and old-style syntax on purpose, so it runs even on very old Node.
var parts = process.versions.node.split('.').map(Number);
var ok = parts[0] > 22 || (parts[0] === 22 && parts[1] >= 13);
if (!ok) {
  console.error('\nThis app needs Node.js 22.13 or newer. You have Node.js ' + process.versions.node + '.');
  console.error('Install the current LTS version from https://nodejs.org and try again.\n');
  process.exit(1);
}

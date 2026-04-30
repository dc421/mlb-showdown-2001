const fs = require('fs');
try {
  const code = fs.readFileSync('apps/backend/server.js', 'utf8');
  eval(code);
} catch (e) {
  if (e instanceof SyntaxError) {
    console.error("Syntax Error:", e.message);
    process.exit(1);
  }
}
console.log("No syntax errors found.");

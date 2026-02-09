#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, 'agent-config.json');
if (!fs.existsSync(cfgPath)) {
  console.error('Missing agent-config.json. Create or copy it into the agent folder.');
  process.exit(2);
}

const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

console.log(`Agent: ${config.agent.displayName}`);
console.log(`Configured model: ${config.agent.model}`);
console.log('Note: This runner is a placeholder. Integrate with your provider and supply credentials as environment variables.');

// Example: export PROVIDER_API_KEY=...
// Replace the following with actual provider integration code.

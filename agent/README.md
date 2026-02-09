# Local Agent (config placeholder)

This folder contains a minimal agent configuration and a small runner script.

- Config: [agent/agent-config.json](agent/agent-config.json)
- Runner: [agent/runner.js](agent/runner.js)

Usage:

1. Verify your provider supports the configured model (`opus-4.5`) and set API credentials as environment variables.
2. Run the runner to inspect the config:

```bash
node agent/runner.js
```

Notes:

- This repository file is a configuration placeholder only — it does not enable access to any premium model by itself.
- Update the runner to integrate with your chosen API/provider and secure credentials appropriately.

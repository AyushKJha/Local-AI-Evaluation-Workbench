# Local AI Evaluation Workbench

Developers need repeatable comparisons of model quality, latency and cost.

Manage evaluation dataset, model comparison, comparison report with persistent records, typed forms, search and CSV/JSON import.

## Run
Install Node.js 24 or newer, then run npm start. Open http://127.0.0.1:4320. No npm dependencies or build step. Data persists in data/app.sqlite; back up that directory. Run npm test for acceptance checks.

## Features
Typed collection forms, create/edit/delete, case-insensitive search, JSON export and persistent SQLite data.

## Hosting
Default binding is loopback. For hosting set HOST=0.0.0.0 and APP_PASSWORD (at least 16 characters) in the provider environment and use HTTPS. Durable data requires persistent disk or a database provider; ephemeral free hosting does not preserve SQLite across redeploys.

## Scope
Single-owner application. External integrations, multi-user roles, payments and arbitrary workflows are not implemented. Review the generated schema and workflow before production use.

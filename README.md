# Local AI Evaluation Workbench

<img src="docs/banner.svg" alt="Local AI Evaluation Workbench — project illustration" width="100%">

A small local workspace for organizing AI evaluation datasets, recording model comparisons, and keeping report records together.

**Node.js 24+ · SQLite · Vanilla JavaScript**

## What is implemented

- Create, search, edit, and delete typed dataset, comparison, and report records.
- Import records from CSV or JSON and export JSON.
- Store application records in a local SQLite database.
- Run the built-in acceptance checks with `npm test`.

## Record an evaluation

1. Start the local app and open the address below.
2. In **Evaluation Dataset**, enter a dataset name and optionally a file path. The app records the reference; it does not open or run the dataset.
3. In **Model Comparison**, enter a comparison ID and model name, then optionally add the latency in milliseconds you measured.
4. In **Comparison Report**, save a report ID. Use search to find records and the form controls to edit or delete them; import CSV/JSON using the field names shown for the selected collection, or export that collection as JSON.

The app organizes and stores evaluation records; it does not execute prompts or automatically measure model quality, latency, or cost. Keep the underlying `data/` directory to retain the local SQLite database.

## Run locally

```sh
npm start
```

Open [http://127.0.0.1:4320](http://127.0.0.1:4320).

No npm packages or build step are needed. The database is created at `data/app.sqlite`; back up that directory if you want to preserve records.

## Current scope

This repository currently manages evaluation records. It does **not** run prompts against local models or automatically measure quality, latency, or cost yet. The repository does not include a public deployment. The app is designed for one local owner.

To expose the server on a network, configure `HOST=0.0.0.0`, set a strong `APP_PASSWORD` (at least 16 characters), use HTTPS, and provide durable storage for SQLite.

## Built with

Node.js built-in HTTP server and SQLite, with a browser interface in `workspace.html`, `workspace.css`, and `workspace.js`.

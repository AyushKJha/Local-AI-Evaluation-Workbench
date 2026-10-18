# Local AI Evaluation Workbench

<img src="banner.svg" alt="Local AI Evaluation Workbench project illustration" width="100%">

A private-by-default workspace for organizing evaluation datasets, recording model comparisons, and keeping report records together.

## Public web app

**Open the app:** https://ayushkjha.github.io/Local-AI-Evaluation-Workbench/

The hosted app saves records in this browser on this device. Records are not sent to a server or synchronized across devices. Use **Export JSON** for backups or to move records.

## Features

- Create, search, edit, and delete dataset, comparison, and report records.
- Import CSV or JSON and export JSON backups.

## Limits

It stores measurements you enter; it does not execute models or automatically measure quality, latency, or cost. Dataset paths are references only.

## Run the private local version

Requires Node.js 24 or newer. From this repository, run:

```sh
npm test
node server.mjs
```

The local Node.js version stores records in SQLite under `data/`. The public browser version does not access this database.

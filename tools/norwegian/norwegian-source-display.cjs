'use strict';
// Offline bridge to the same formatter used by the live importer and renderer.
// Only schedule text is read or written; this program makes no network calls.
const fs = require('node:fs');
const core = require('./itinerary-core.js');
if (typeof core.itineraryNclDisplayPlan !== 'function') {
  throw new Error('Shared itineraryNclDisplayPlan formatter is unavailable');
}
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
if (!Array.isArray(input)) throw new Error('Expected schedule array');
process.stdout.write(JSON.stringify(input.map(record =>
  core.itineraryNclDisplayPlan(record.day_plan, record.sail_date))));

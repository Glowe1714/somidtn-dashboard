# SoMidTN Dashboard (public copy)

Economic and community development dashboard for the 13 counties of Southern Middle Tennessee:
Bedford, Coffee, Franklin, Giles, Hickman, Lawrence, Lewis, Lincoln, Marshall, Maury, Moore, Perry and Wayne.

Compiled by Greg Lowe from public sources. **Not an official TNECD publication.**

## How it stays current
- The master copy is a Claude dashboard. Claude scheduled tasks refresh its data every day from BLS, Census, BEA, USDA NASS, TDOE, the Tennessee Department of Tourist Development, EconVitals, FRED and verified news sources.
- A publishing task copies that data here twice a day (about 7:17 AM and 12:17 PM Central) and pushes it to this repository. GitHub Pages then serves the updated site.
- FRED series are downloaded from FRED's public CSV files (`fred.stlouisfed.org/graph/fredgraph.csv`).

## What is in this repository
| Path | What it is |
|---|---|
| `index.html`, `app.js`, `style.css` | The dashboard page, copied from the Claude dashboard |
| `runtime.js`, `theme.css` | Lets the page run in any browser without Claude |
| `data/*.json` | One file per dataset; `data/manifest.json` lists them with titles, descriptions and update times |
| `vendor/d3.min.js` | D3 charting library v7.9.0 (ISC license, d3js.org) |
| `tools/build_site.py`, `tools/shell.html` | Build script the publishing task runs |

Please don't edit the generated files by hand; changes are made in the Claude dashboard and published from there.

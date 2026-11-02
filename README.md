# Folly Surf

**A free surf-conditions dashboard for Folly Beach, South Carolina.**

[Open the dashboard](https://follysurf.com/dashboard/) · [Read the scoring method](https://follysurf.com/dashboard/formula.html)

Folly Surf brings waves, wind, tides and coastal observations into one place. It is built around a practical question: what do the available conditions suggest about a trip to the beach?

## What it does

- Combines nearshore wave forecasts, regional breaking-surf guidance, weather, tides and offshore buoy observations.
- Shows current offshore wave energy, primary and secondary swell direction, and the age of the underlying observations.
- Offers camera views and travel-time estimates to the Pier and the Washout.
- Explains the **Folly Index**, a 0–100 surf-conditions heuristic, with a published formula and visible treatment of missing data.

## How to use it

1. Open the dashboard and compare the forecast periods.
2. Check waves, wind and tides alongside the index.
3. Inspect source timestamps and gaps before relying on a reading.
4. Use the published method to understand how the score was produced.

## Data and method

The dashboard draws on NOAA and National Weather Service observations and guidance, with forecast data from Open-Meteo. It distinguishes offshore measurements, nearshore wave forecasts and regional breaking-surf guidance; they describe different things.

The Folly Index is provisional and has not been calibrated against independent beach observations. It is a planning aid, not a safety score. Missing inputs remain visible rather than being replaced with simulated current conditions.

## Technical overview

The application uses browser JavaScript, portable ESM server modules and Cloudflare Workers. Server-side components handle ingestion, traffic estimates and forecast archives. The dashboard publishes the method alongside the result so visitors can inspect its assumptions.

## About this repository

This is the public project showcase for Folly Surf. The production source and deployment configuration are maintained separately in a private repository. There is no runnable application or installation step in this repository.

The site is free and noncommercial. Forecast data and camera media remain subject to their providers' rights and terms.

## Feedback

[Open an issue](https://github.com/neddonovan1-crypto/follysurf/issues) with the page, approximate time and behaviour you observed, or suggest a useful improvement.

Created by [Ned Donovan](https://neddonovan.co).

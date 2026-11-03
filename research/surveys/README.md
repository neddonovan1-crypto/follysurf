# Imported Folly beach surveys

This is an actual import of the SC DES BERM Folly profile archive, with **925,274 measured points** in **12 annual exports** and **371 survey/transect groups**. It is a research dataset, not a current seabed raster or a calibrated surf forecast.

## Reproduce the import

Python 3.9 or newer and its standard library are sufficient. No additional packages are required.

```sh
python3 scripts/import-folly-surveys.py --zip /path/to/FOLLY_BEACH.zip
```

The [official ZIP](https://des.sc.gov/sites/des/files/Documents/GIS/FOLLY_BEACH.zip) is linked from the [SC DES BERM viewer](https://gis.des.sc.gov/bermexplorer/). The import above was run successfully against the downloaded ZIP. Where network access is available, the importer also provides a standard-library download option:

```sh
python3 scripts/import-folly-surveys.py --download
```

The default expected SHA-256 is `1a1edc05953e0580e2ce8857f699caa5f320cfa3d2312e19687b128e8121987f`. A changed upstream ZIP fails the checksum check. Review its metadata before deliberately passing a different `--expected-sha256`. The upstream URL may replace its archive; the saved normalized bundle and source metadata preserve this import even if that happens. The approved source ZIP is read without modification.

## Contents and persistence

| File or directory | Contents | Persistence |
| --- | --- | --- |
| `manifest.json` | Source URL/hash; annual CSV hashes and schemas; actual survey dates; per-year CRS, units and datum evidence; normalized output hashes | Committed |
| `transects.json` | Counts, source monuments, survey types and numeric ranges from every point in each survey/transect | Committed; derived summaries, not interpolated geometry |
| `profile-samples.csv.gz` | Selected observed points from the latest (2025) survey, with source row numbers, exact source numeric text, dates and datum status | Committed, compressed review sample; count and hash in manifest |
| `validation.json` | Import checks, counts, known date pitfall and confirmed/unconfirmed vertical-datum inventory | Committed; not scientific forecast validation |
| `events.json` | The documented March–October 2024 nourishment event, with month-level dates, reported volume and source | Committed; no inferred effect on surfing quality |
| `normalized/` | All 925,274 normalized observations in annual CSV gzip files, original `.prj` and XML metadata, field definitions, manifest, validation and the 51,551-point all-survey review sample | Ignored working copy; not durable merely because it exists locally |
| `exports/folly-surveys-normalized-1a1edc05953e.zip` | Full normalized dataset and metadata in one reproducible bundle | Ignored transfer artifact for separate durable storage |
| `exports/bundle.json` | Bundle filename, size, SHA-256 and source checksum | Transfer receipt; regenerate with the importer |

The bundle contains the full point data, not just the sample. Keep a copy in durable object or document storage; the repository contains the reproducible importer and compact data products. The original 91.5 MB ZIP is not committed.

## Dates, coordinate systems and missing metadata

- `collection_date` comes from `COL_DATE`. The export named **2014 contains measurements from 2013-10-03**. The source filename year, original date text, source year/day and original identifiers are retained separately. There is no imported survey from calendar year 2014.
- The latest export has **62,811 points on 31 transects**, collected **2025-11-13**: 4,343 topographic and 58,468 bathymetric points. The 2017 export has 30 transects; the other exports have 31. A missing transect is not filled.
- Every supplied projection file specifies NAD83(2011), South Carolina State Plane FIPS 3900, international feet (`0.3048 m/ft`; identified as EPSG:6570). The importer checks projection parameters, retains the original WKT and does not reproject coordinates.
- Elevation and profile distances remain in the source's feet. **Only 2015 and 2016 explicitly name NAVD88 in their metadata.** Other years remain `unconfirmed`. The 2021 processing lineage contains a Folly filename mentioning NAVD88, but that clue is not promoted to a confirmed datum. No vertical conversion or tide-datum join is performed.
- Source longitude/latitude columns are preserved. Their geographic CRS is not independently assigned WGS84 by the importer.
- `DFM` means distance from the collection monument; `DFCP` is the BERM comparison-point distance. The original field definitions explain how its offset accounts for differing survey starts. Keep monument identities and offsets when comparing years.
- Numeric source strings are retained in normalized CSVs. Empty optional values mean the annual export did not provide that field. Earlier point types are left unspecified; they are not classified from whether elevation is positive or negative.

## Observations versus derived products

The full normalized coordinates and elevations are source observations. The per-transect ranges are calculations over those observations. The review sample selects the observed point nearest the center of each 25-foot DFCP bin, plus the minimum/maximum elevation and distance points; ties use the earliest source row. It never creates an interpolated point. Its spacing is a storage/review choice, not a physical-model parameter or an accuracy claim. Use the full normalized points for quantitative terrain work.

The surveys are dated snapshots and sparse cross-shore lines. Importing them does not establish today's sandbars, the surface between transects, local breaking-wave heights or surf quality. Neither the dated terrain nor the nourishment event alters the app's formula.

## Validation

```sh
python3 -m unittest discover -s research/surveys -p 'test_*.py' -v
```

The tests exercise filename/date disagreement, conflicting dates, non-finite values, projection units/parameters, unconfirmed datum clues, exact source-value preservation, checksum rejection and reproducible bundles. The full import also checks the independently inspected annual point/transect counts and collection dates for the pinned source snapshot.

SC DES provides public download access. An explicit redistribution license was not identified; preserve attribution, the original metadata and accuracy disclaimers. Download access and this import do not establish a license for unrestricted redistribution.

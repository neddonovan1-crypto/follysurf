#!/usr/bin/env python3
"""Import the public SC DES Folly profile ZIP using only Python's standard library.

Full normalized points and source metadata go into ignored research storage;
small summaries and a clearly labeled observed-point sample are reproducible
repository artifacts. This does not construct a seabed raster or wave model.
"""

import argparse
import collections
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


SOURCE_URL = "https://des.sc.gov/sites/des/files/Documents/GIS/FOLLY_BEACH.zip"
PINNED_SHA256 = "1a1edc05953e0580e2ce8857f699caa5f320cfa3d2312e19687b128e8121987f"
ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {
    2014: (118317, 31, "2013-10-03"),
    2015: (61251, 31, "2015-11-13"),
    2016: (112870, 31, "2016-12-02"),
    2017: (102119, 30, "2017-12-17"),
    2018: (118718, 31, "2018-11-28"),
    2019: (54694, 31, "2019-11-22"),
    2020: (53654, 31, "2020-12-10"),
    2021: (57003, 31, "2021-11-17"),
    2022: (61403, 31, "2022-10-20"),
    2023: (62458, 31, "2023-12-21"),
    2024: (59976, 31, "2024-11-20"),
    2025: (62811, 31, "2025-11-13"),
}
SOURCE_FIELDS = {
    "fid", "objectid", "location", "monument", "northing", "easting",
    "elevation", "year", "day", "col_date", "beach", "tran_id", "dfm",
    "dfcp", "point_x", "point_y", "static_id", "survey", "dbl",
}
REQUIRED_FIELDS = SOURCE_FIELDS - {"fid", "objectid", "survey", "dbl"}
FIELD_MAP = {
    "source_year": "year", "source_day_of_year": "day", "transect_id": "tran_id",
    "monument": "monument", "source_static_id": "static_id",
    "source_object_id": "objectid", "source_fid": "fid", "location": "location",
    "beach": "beach", "survey_type": "survey", "easting_ft": "easting",
    "northing_ft": "northing", "elevation_ft": "elevation",
    "distance_from_monument_ft": "dfm", "distance_from_comparison_point_ft": "dfcp",
    "source_dbl": "dbl", "longitude_deg": "point_x", "latitude_deg": "point_y",
}
OUTPUT_FIELDS = [
    "survey_id", "source_file", "source_row", "source_file_year", "collection_date",
    "source_collection_date", *FIELD_MAP, "vertical_datum", "vertical_datum_status",
    "geometry_status",
]
SAMPLE_FIELDS = [
    "survey_id", "source_row", "transect_id", "collection_date", "monument",
    "survey_type", "easting_ft", "northing_ft", "elevation_ft",
    "distance_from_monument_ft", "distance_from_comparison_point_ft",
    "longitude_deg", "latitude_deg", "vertical_datum", "vertical_datum_status",
]


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def parse_date(value):
    """COL_DATE, not the export filename, determines the observation date."""
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Invalid collection date: {value!r}")


def finite_number(value, field):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"Invalid {field}: {value!r}") from error
    if not math.isfinite(number):
        raise ValueError(f"Non-finite {field}: {value!r}")
    return number


def projection_metadata(wkt):
    """Identify only the explicit horizontal system; never infer a vertical one."""
    if not all(term in wkt for term in ("NAD_1983_2011", "South_Carolina_FIPS_3900", 'UNIT["Foot",0.3048]')):
        raise ValueError("Unrecognized horizontal projection: review the source .prj")
    parameters = {name: float(value) for name, value in re.findall(r'PARAMETER\["([^"]+)",([-\d.]+)\]', wkt)}
    expected = {"False_Easting": 2000000, "False_Northing": 0, "Central_Meridian": -81,
                "Standard_Parallel_1": 32.5, "Standard_Parallel_2": 34.83333333333333,
                "Latitude_Of_Origin": 31.83333333333333}
    if any(not math.isclose(parameters.get(name, math.inf), value, abs_tol=1e-10) for name, value in expected.items()):
        raise ValueError("Unexpected State Plane projection parameters: review the source .prj")
    return {
        "name": "NAD83(2011) / South Carolina (international feet)",
        "epsg": 6570,
        "identification": "Identified from the supplied .prj parameters",
        "horizontalUnit": "international foot", "horizontalUnitToMetres": 0.3048,
        "sourceWkt": wkt,
        "geographicColumns": "Source POINT_X/POINT_Y longitude/latitude in degrees; their geographic CRS is not separately asserted by this importer",
    }


def vertical_metadata(xml_records):
    evidence, hints, geoid_models = [], [], set()
    for name, raw in xml_records:
        content = " ".join(ET.fromstring(raw).itertext())
        content = re.sub(r"\s+", " ", content)
        match = re.search(r"The vertical datum for all data is NAVD88.{0,150}", content, flags=re.I)
        if match:
            evidence.append({"sourceFile": name, "text": match.group(0)})
            geoid = re.search(r"Geoid model (.+?) with units", match.group(0), flags=re.I)
            if geoid:
                geoid_models.add(geoid.group(1).strip())
        elif re.search(r"BERM_Folly[^'\";]{0,80}NAVD88\.shp", content, flags=re.I):
            hints.append({"sourceFile": name, "text": "A Folly source filename in processing lineage mentions NAVD88; no explicit vertical-datum statement was found."})
    return {
        "datum": "NAVD88" if evidence else None,
        "status": "explicit-source-metadata" if evidence else "unconfirmed",
        "geoidModel": next(iter(geoid_models)) if len(geoid_models) == 1 else None,
        "elevationUnit": "foot",
        "unitEvidence": "International Survey feet in this year's XML" if any("International Survey feet" in item["text"] for item in evidence) else "Feet are the BERM program's published profile units; this year's vertical units were not separately confirmed",
        "evidence": evidence, "lineageHints": hints,
        "transformationApplied": False,
    }


def validate_row(row, source_name, source_row):
    if None in row:
        raise ValueError(f"{source_name}:{source_row}: extra CSV fields")
    canonical = {key.lower(): value for key, value in row.items()}
    if any(value is None for value in canonical.values()):
        raise ValueError(f"{source_name}:{source_row}: truncated CSV row")
    date = parse_date(canonical["col_date"])
    numbers = {field: finite_number(canonical[field], field) for field in
               ("easting", "northing", "elevation", "dfm", "dfcp", "point_x", "point_y", "year", "day")}
    if numbers["year"] != date.year or numbers["day"] != date.timetuple().tm_yday:
        raise ValueError(f"{source_name}:{source_row}: source year/day conflicts with COL_DATE")
    if not (32.5 <= numbers["point_y"] <= 32.8 and -80.0 <= numbers["point_x"] <= -79.8):
        raise ValueError(f"{source_name}:{source_row}: coordinates outside the expected Folly envelope")
    if not canonical["tran_id"].strip() or not canonical["static_id"].strip():
        raise ValueError(f"{source_name}:{source_row}: missing source identifier")
    return canonical, date, numbers


def new_transect(survey_id, transect_id):
    return {"surveyId": survey_id, "transectId": transect_id, "pointCount": 0,
            "monuments": set(), "surveyTypes": collections.Counter(), "ranges": {},
            "sampleBins": {}, "extrema": {}}


def add_to_transect(group, normalized, values, sample_bin_ft):
    group["pointCount"] += 1
    group["monuments"].add(normalized["monument"])
    group["surveyTypes"][normalized["survey_type"] or "unspecified"] += 1
    for key, value in values.items():
        if key in ("year", "day"):
            continue
        old = group["ranges"].get(key, [value, value])
        group["ranges"][key] = [min(old[0], value), max(old[1], value)]
    slot = math.floor(values["dfcp"] / sample_bin_ft)
    distance = abs(values["dfcp"] - (slot + 0.5) * sample_bin_ft)
    candidate = (distance, int(normalized["source_row"]), normalized)
    previous = group["sampleBins"].get(slot)
    if previous is None or candidate[:2] < previous[:2]:
        group["sampleBins"][slot] = candidate
    for name, value in (("minimum_elevation", values["elevation"]), ("maximum_elevation", -values["elevation"]),
                        ("minimum_distance", values["dfcp"]), ("maximum_distance", -values["dfcp"])):
        previous = group["extrema"].get(name)
        if previous is None or (value, candidate[1]) < previous[:2]:
            group["extrema"][name] = (value, candidate[1], normalized)


def gzip_csv_writer(path):
    """A stable gzip header makes identical inputs produce identical bytes."""
    raw = path.open("wb")
    packed = gzip.GzipFile(filename="", mode="wb", compresslevel=6, fileobj=raw, mtime=0)
    text = io.TextIOWrapper(packed, encoding="utf-8", newline="")
    return raw, text, csv.DictWriter(text, fieldnames=OUTPUT_FIELDS, lineterminator="\n")


def write_sample(path, rows):
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as packed:
            with io.TextIOWrapper(packed, encoding="utf-8", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=SAMPLE_FIELDS, extrasaction="ignore", lineterminator="\n")
                writer.writeheader()
                writer.writerows(rows)


def build_import(source, output, expected_sha256=PINNED_SHA256, sample_bin_ft=25.0):
    if not math.isfinite(sample_bin_ft) or sample_bin_ft <= 0:
        raise ValueError("--sample-bin-ft must be positive and finite")
    digest = sha256(source)
    if digest != expected_sha256:
        raise ValueError(f"Source SHA mismatch: expected {expected_sha256}, received {digest}. Review the new archive before changing the expected SHA.")
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".import-", dir=output) as temporary:
        stage = Path(temporary)
        normalized_dir = stage / "normalized"
        metadata_dir = normalized_dir / "source-metadata"
        metadata_dir.mkdir(parents=True)
        surveys, transects, sampled = [], [], []
        with zipfile.ZipFile(source) as archive:
            files = sorted((name for name in archive.namelist() if re.fullmatch(r"FOLLY_BEACH/folly_beach_\d{4}\.csv", name, flags=re.I)), key=str.lower)
            if not files:
                raise ValueError("No Folly survey CSV files found")
            field_definitions = "FOLLY_BEACH/FIELD_DEFINITIONS.txt"
            (metadata_dir / "FIELD_DEFINITIONS.txt").write_bytes(archive.read(field_definitions))
            for source_name in files:
                stem = source_name[:-4]
                export_year = int(stem[-4:])
                source_prj = stem + ".prj"
                projection = projection_metadata(archive.read(source_prj).decode("utf-8-sig"))
                xml_records = [(name, archive.read(name)) for name in archive.namelist() if name.startswith(stem + ".") and name.endswith(".xml")]
                vertical = vertical_metadata(xml_records)
                metadata = []
                for name, content in [(source_prj, archive.read(source_prj)), *xml_records]:
                    (metadata_dir / Path(name).name).write_bytes(content)
                    metadata.append({"sourceFile": name, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)})
                survey_id = f"scdes-folly-export-{export_year}"
                path = normalized_dir / f"{survey_id}.csv.gz"
                raw, text, writer = gzip_csv_writer(path)
                count, groups, dates, types = 0, {}, set(), collections.Counter()
                csv_digest = hashlib.sha256()
                # The source stream is read once for its checksum and again for parsing;
                # no shapefile or arbitrary archive path is extracted.
                with archive.open(source_name) as source_stream:
                    for block in iter(lambda: source_stream.read(1024 * 1024), b""):
                        csv_digest.update(block)
                try:
                    writer.writeheader()
                    with archive.open(source_name) as source_stream:
                        reader = csv.DictReader(io.TextIOWrapper(source_stream, encoding="utf-8-sig", newline=""))
                        fields = reader.fieldnames or []
                        lower = {field.lower() for field in fields}
                        if len(lower) != len(fields) or lower - SOURCE_FIELDS or REQUIRED_FIELDS - lower:
                            raise ValueError(f"{source_name}: unexpected CSV schema {fields!r}")
                        for source_row, row in enumerate(reader, start=2):
                            canonical, date, values = validate_row(row, source_name, source_row)
                            normalized = {"survey_id": survey_id, "source_file": source_name,
                                          "source_row": str(source_row), "source_file_year": str(export_year),
                                          "collection_date": date.isoformat(), "source_collection_date": canonical["col_date"],
                                          **{target: canonical.get(origin, "") for target, origin in FIELD_MAP.items()},
                                          "vertical_datum": vertical["datum"] or "",
                                          "vertical_datum_status": vertical["status"], "geometry_status": "observed-source-point"}
                            writer.writerow(normalized)
                            count += 1
                            dates.add(date.isoformat())
                            types[normalized["survey_type"] or "unspecified"] += 1
                            key = (date.isoformat(), normalized["transect_id"])
                            group = groups.setdefault(key, new_transect(survey_id, normalized["transect_id"]))
                            add_to_transect(group, normalized, values, sample_bin_ft)
                finally:
                    text.close()
                    raw.close()
                if digest == PINNED_SHA256:
                    expected = EXPECTED.get(export_year)
                    actual = (count, len(groups), next(iter(dates)) if len(dates) == 1 else None)
                    if expected != actual:
                        raise ValueError(f"Pinned source validation failed for {export_year}: {actual!r} != {expected!r}")
                warnings = []
                if any(int(date[:4]) != export_year for date in dates):
                    warnings.append("Export filename year differs from actual collection year; COL_DATE retained as authoritative.")
                if vertical["datum"] is None:
                    warnings.append("Vertical datum unconfirmed: do not combine with water levels or another survey datum without confirmation.")
                surveys.append({"surveyId": survey_id, "sourceFile": source_name, "sourceFileYear": export_year,
                                "sourceCsvSha256": csv_digest.hexdigest(), "sourceFields": fields,
                                "collectionDates": sorted(dates), "pointCount": count, "transectCount": len(groups),
                                "surveyTypes": dict(sorted(types.items())), "horizontalCrs": projection, "verticalReference": vertical,
                                "sourceMetadata": metadata, "warnings": warnings,
                                "normalizedFile": path.name, "normalizedSha256": sha256(path), "normalizedBytes": path.stat().st_size})
                for (date, _), group in sorted(groups.items()):
                    selected = {entry[1]: entry[2] for entry in [*group.pop("sampleBins").values(), *group.pop("extrema").values()]}
                    sampled.extend(selected[key] for key in sorted(selected))
                    group["collectionDate"] = date
                    group["monuments"] = sorted(group["monuments"])
                    group["surveyTypes"] = dict(sorted(group["surveyTypes"].items()))
                    group["summaryStatus"] = "derived-range-summary-of-observed-points"
                    group["samplePointCount"] = len(selected)
                    transects.append(group)
                print(f"Imported {export_year}: {count:,} observed points, {len(groups)} transects, dates {', '.join(sorted(dates))}", flush=True)
            if digest == PINNED_SHA256 and {item["sourceFileYear"] for item in surveys} != set(EXPECTED):
                raise ValueError("Pinned source survey inventory mismatch")
        sampled.sort(key=lambda row: (row["collection_date"], row["transect_id"], float(row["distance_from_comparison_point_ft"]), int(row["source_row"])))
        latest_date = max(row["collection_date"] for row in sampled)
        latest_sampled = [row for row in sampled if row["collection_date"] == latest_date]
        write_sample(stage / "profile-samples.csv.gz", latest_sampled)
        write_sample(normalized_dir / "all-profile-samples.csv.gz", sampled)
        manifest = {
            "schemaVersion": 1, "importer": "scripts/import-folly-surveys.py", "importerVersion": 1,
            "importerSha256": sha256(Path(__file__)),
            "datasetId": "scdes-berm-folly-beach", "sourceUrl": SOURCE_URL,
            "sourceArchiveSha256": digest, "sourceArchiveBytes": source.stat().st_size,
            "sourceAccessVerifiedDate": "2026-10-21" if digest == PINNED_SHA256 else None,
            "pinnedSnapshotMatched": digest == PINNED_SHA256,
            "pointCount": sum(item["pointCount"] for item in surveys), "surveyCount": len(surveys),
            "transectSurveyCount": len(transects), "sourceGeometryStatus": "observed-source-points",
            "derivedGeometry": "Per-transect ranges and observed-point selection only; no interpolation, reprojection, vertical transformation, seabed raster or wave simulation",
            "pointSchema": {"columns": OUTPUT_FIELDS, "sourceFieldMap": FIELD_MAP,
                            "sourceRow": "One-based CSV row number including the header; values preserve source numeric text",
                            "blankOptionalFields": "Not supplied by that annual export; never imputed",
                            "collectionDatePrecision": "day", "sourceDbl": "Additional source DBL field in 2017; preserved without assigning a new interpretation"},
            "sample": {"file": "profile-samples.csv.gz", "pointCount": len(latest_sampled), "collectionDates": [latest_date], "binWidthFt": sample_bin_ft,
                       "method": "For each survey/date/transect, select the observed point nearest each DFCP bin centre, plus minimum/maximum elevation and DFCP; earliest source row breaks ties. Never interpolate.",
                       "purpose": "Compact review sample; use full normalized points for quantitative terrain work",
                       "sha256": sha256(stage / "profile-samples.csv.gz")},
            "allSurveySample": {"file": "all-profile-samples.csv.gz", "pointCount": len(sampled),
                                "storage": "Full normalized bundle only", "method": "Same observed-point selection as the compact sample, for every survey",
                                "sha256": sha256(normalized_dir / "all-profile-samples.csv.gz")},
            "distanceReference": "DFM is from the collection monument; DFCP is the source BERM comparison-point offset. Preserve monument identity and source FIELD_DEFINITIONS.txt when comparing years.",
            "rights": "Public SC DES download; no explicit redistribution license identified. Preserve source attribution, metadata and accuracy disclaimers.",
            "surveys": surveys,
        }
        validation = {
            "schemaVersion": 1, "status": "passed", "sourceArchiveSha256": digest,
            "checks": ["Source archive SHA-256 matches the supplied expected checksum", "All source schemas recognized with no dropped unknown columns",
                       "Every normalized row has a valid collection date and matching source year/day", "All numeric coordinates, elevations and distances are finite",
                       "All source longitude/latitude pairs lie within the Folly review envelope", "Horizontal projection confirmed from every .prj",
                       "Vertical datum assigned only from an explicit statement in that year's metadata", "All source rows retained in normalized output"],
            "pinnedInventoryChecked": digest == PINNED_SHA256, "pointCount": manifest["pointCount"],
            "surveyCount": len(surveys), "transectSurveyCount": len(transects),
            "latestSurveySamplePointCount": len(latest_sampled), "allSurveySamplePointCount": len(sampled),
            "knownDatePitfall": next(({"exportYear": s["sourceFileYear"], "collectionDates": s["collectionDates"]} for s in surveys if s["sourceFileYear"] == 2014), None),
            "explicitVerticalDatumSurveys": [s["surveyId"] for s in surveys if s["verticalReference"]["datum"]],
            "unconfirmedVerticalDatumSurveys": [s["surveyId"] for s in surveys if not s["verticalReference"]["datum"]],
            "scientificValidation": "Not evaluated: current sandbar geometry, wave transformation, breaking height or surfing quality",
        }
        write_json(stage / "manifest.json", manifest)
        write_json(stage / "transects.json", {"schemaVersion": 1, "sourceArchiveSha256": digest, "transects": transects})
        write_json(stage / "validation.json", validation)
        for name in ("manifest.json", "validation.json", "transects.json", "profile-samples.csv.gz"):
            shutil.copyfile(stage / name, normalized_dir / name)
        (normalized_dir / "DATA-README.txt").write_text(
            "SC DES Folly Beach normalized research observations\n\n"
            "Source: " + SOURCE_URL + "\nSource SHA-256: " + digest + "\n\n"
            "The .csv.gz files retain every source observation in normalized columns. "
            "Numeric source text is preserved. Source row numbers include the CSV header. "
            "Use collection_date, not the export year in the filename.\n\n"
            "manifest.json records per-survey CRS, units, actual dates, source and normalized hashes. "
            "validation.json records import checks, not scientific model validation. "
            "source-metadata/ contains the original field definitions, projection and XML files. "
            "transects.json is a derived range summary. profile-samples.csv.gz is a thinned selection "
            "of observed points from the latest survey. all-profile-samples.csv.gz includes all survey dates. "
            "These samples are for review, not replacements for the full point files.\n\n"
            "Most annual vertical datums are unconfirmed. No datum conversion, interpolation, "
            "current sandbar reconstruction or wave simulation has been performed. "
            "The event record describes the 2024 nourishment without asserting a surf-quality effect.\n\n"
            "Credit SC DES. Public download access does not establish an unrestricted redistribution license.\n",
            encoding="utf-8")
        event_path = output / "events.json"
        if event_path.exists():
            shutil.copyfile(event_path, normalized_dir / "events.json")
        export_dir = stage / "exports"
        export_dir.mkdir()
        bundle = export_dir / f"folly-surveys-normalized-{digest[:12]}.zip"
        with zipfile.ZipFile(bundle, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(normalized_dir.rglob("*")):
                if path.is_file():
                    info = zipfile.ZipInfo(path.relative_to(normalized_dir).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o644 << 16
                    archive.writestr(info, path.read_bytes())
        bundle_receipt = {"file": bundle.name, "bytes": bundle.stat().st_size, "sha256": sha256(bundle),
                          "sourceArchiveSha256": digest, "pointCount": manifest["pointCount"]}
        write_json(export_dir / "bundle.json", bundle_receipt)
        # Publish only after complete parsing and validation. The manifest is last.
        for folder in ("normalized", "exports"):
            destination = output / folder
            destination.mkdir(exist_ok=True)
            for path in (stage / folder).rglob("*"):
                if path.is_file():
                    target = destination / path.relative_to(stage / folder)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(path, target)
        for name in ("profile-samples.csv.gz", "transects.json", "validation.json", "manifest.json"):
            os.replace(stage / name, output / name)
        print(json.dumps({"status": "passed", "pointCount": manifest["pointCount"], "bundle": str(output / "exports" / bundle.name), **bundle_receipt}, indent=2), flush=True)
        return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--zip", type=Path, help="Previously downloaded, unchanged official Folly ZIP")
    source.add_argument("--download", action="store_true", help="Download the official ZIP using Python's standard library")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "research" / "surveys")
    parser.add_argument("--expected-sha256", default=PINNED_SHA256, help="Review a changed upstream archive before supplying its new checksum")
    parser.add_argument("--sample-bin-ft", type=float, default=25.0, help="Observed-point preview selection spacing; does not alter full normalized output")
    args = parser.parse_args()
    try:
        if args.download:
            with tempfile.TemporaryDirectory(prefix="folly-survey-download-") as temporary:
                path = Path(temporary) / "FOLLY_BEACH.zip"
                request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "FollySurfResearch/1.0"})
                with urllib.request.urlopen(request, timeout=60) as response, path.open("wb") as target:
                    shutil.copyfileobj(response, target)
                build_import(path, args.output_dir.resolve(), args.expected_sha256, args.sample_bin_ft)
        else:
            build_import(args.zip.resolve(), args.output_dir.resolve(), args.expected_sha256, args.sample_bin_ft)
    except (OSError, ValueError, zipfile.BadZipFile, ET.ParseError) as error:
        print(f"Import failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

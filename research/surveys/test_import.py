"""Checks for source-date, datum and preservation errors in the survey importer."""
import contextlib
import csv
import gzip
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("survey_importer", ROOT / "scripts" / "import-folly-surveys.py")
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)
WKT = 'PROJCS["NAD_1983_2011_StatePlane_South_Carolina_FIPS_3900_Ft_Intl",PARAMETER["False_Easting",2000000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-81.0],PARAMETER["Standard_Parallel_1",32.5],PARAMETER["Standard_Parallel_2",34.83333333333334],PARAMETER["Latitude_Of_Origin",31.83333333333333],UNIT["Foot",0.3048]]'


def source_row():
    return {"Location": "Folly", "Monument": "2805E", "Northing": "295832.413999999990000",
            "Easting": "2317865.392000000000000", "Elevation": "7.176000000000000",
            "Year": "2013", "Day": "276", "COL_DATE": "10/3/2013", "BEACH": "Folly Beach",
            "TRAN_ID": "2805", "DFM": "-150.553000000000000", "DFCP": "380.357370828999990",
            "POINT_X": "-79.967358044400001", "POINT_Y": "32.642017125800002", "STATIC_ID": "73010"}


class SurveyImportTests(unittest.TestCase):
    def test_collection_date_overrides_filename(self):
        _, date, _ = IMPORTER.validate_row(source_row(), "FOLLY_BEACH_2014.csv", 2)
        self.assertEqual(date.isoformat(), "2013-10-03")

    def test_conflicting_source_date_and_nonfinite_values_are_rejected(self):
        for change in ({"Year": "2014"}, {"Day": "277"}, {"Elevation": "NaN"}, {"POINT_X": "-100"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                IMPORTER.validate_row({**source_row(), **change}, "source.csv", 2)

    def test_vertical_datum_is_not_inferred_from_a_filename(self):
        hint = b"<metadata>OCRM_BERM_Folly_November2021_NAVD88.shp</metadata>"
        result = IMPORTER.vertical_metadata([("2021.xml", hint)])
        self.assertIsNone(result["datum"])
        self.assertEqual(result["status"], "unconfirmed")
        self.assertTrue(result["lineageHints"])
        explicit = b"<metadata>The vertical datum for all data is NAVD88 using the Geoid model 2012A CONUS with units in International Survey feet.</metadata>"
        result = IMPORTER.vertical_metadata([("2015.xml", explicit)])
        self.assertEqual(result["datum"], "NAVD88")
        self.assertEqual(result["geoidModel"], "2012A CONUS")
        self.assertIsNone(IMPORTER.vertical_metadata([])["datum"])

    def test_projection_parameters_and_foot_definition_are_checked(self):
        self.assertEqual(IMPORTER.projection_metadata(WKT)["horizontalUnitToMetres"], 0.3048)
        for changed in (WKT.replace("-81.0", "-80.0"), WKT.replace("0.3048", "0.3048006096")):
            with self.assertRaises(ValueError):
                IMPORTER.projection_metadata(changed)

    def test_full_import_preserves_values_and_bundle_is_reproducible(self):
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            source = temporary / "source.zip"
            csv_text = io.StringIO(newline="")
            writer = csv.DictWriter(csv_text, fieldnames=list(source_row()), lineterminator="\n")
            writer.writeheader()
            writer.writerow(source_row())
            second = {**source_row(), "Elevation": "-3.2200", "STATIC_ID": "73011", "DFCP": "400.0100"}
            writer.writerow(second)
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("FOLLY_BEACH/FOLLY_BEACH_2014.csv", csv_text.getvalue())
                archive.writestr("FOLLY_BEACH/FOLLY_BEACH_2014.prj", WKT)
                archive.writestr("FOLLY_BEACH/FIELD_DEFINITIONS.txt", "Public source field definitions")
            checksum = IMPORTER.sha256(source)
            output = temporary / "output"
            with contextlib.redirect_stdout(io.StringIO()):
                manifest = IMPORTER.build_import(source, output, expected_sha256=checksum)
            item = manifest["surveys"][0]
            self.assertEqual(manifest["pointCount"], 2)
            self.assertEqual(item["collectionDates"], ["2013-10-03"])
            self.assertIsNone(item["verticalReference"]["datum"])
            with gzip.open(output / "normalized" / item["normalizedFile"], "rt", newline="") as stream:
                rows = list(csv.DictReader(stream))
            self.assertEqual(rows[0]["easting_ft"], source_row()["Easting"])
            self.assertEqual(rows[1]["elevation_ft"], "-3.2200")
            self.assertEqual([row["source_row"] for row in rows], ["2", "3"])
            receipt = json.loads((output / "exports" / "bundle.json").read_text())
            with zipfile.ZipFile(output / "exports" / receipt["file"]) as bundle:
                self.assertIsNone(bundle.testzip())
                self.assertIn("DATA-README.txt", bundle.namelist())
            with contextlib.redirect_stdout(io.StringIO()):
                IMPORTER.build_import(source, output, expected_sha256=checksum)
            self.assertEqual(receipt, json.loads((output / "exports" / "bundle.json").read_text()))
            with self.assertRaisesRegex(ValueError, "SHA mismatch"):
                IMPORTER.build_import(source, output, expected_sha256="0" * 64)


if __name__ == "__main__":
    unittest.main()

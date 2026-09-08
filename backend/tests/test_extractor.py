"""Focused tests for invoice field extraction."""

from pathlib import Path
import sys
import unittest

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.extractor import extract_invoice_fields  # noqa: E402


class ExtractorTests(unittest.TestCase):
    def test_parses_indian_grouped_total(self):
        fields = extract_invoice_fields({"text": "Grand Total: 1,23,456.78"})
        self.assertEqual(fields["total"], 123456.78)

    def test_parses_european_grouped_total(self):
        fields = extract_invoice_fields({"text": "Grand Total: 1.234,56"})
        self.assertEqual(fields["total"], 1234.56)

    def test_rejects_impossible_calendar_date(self):
        fields = extract_invoice_fields({"text": "Date: 31-02-2026"})
        self.assertIsNone(fields["date"])


if __name__ == "__main__":
    unittest.main()

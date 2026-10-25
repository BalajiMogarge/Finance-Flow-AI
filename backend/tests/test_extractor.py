"""Focused tests for invoice field extraction."""

import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.extractor import extract_invoice_fields


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

    def test_extracts_igst_interstate_tax(self):
        fields = extract_invoice_fields({"text": "Subtotal: 1000.00\nIGST @18%: 180.00\nTotal: 1180.00"})
        self.assertEqual(fields["subtotal"], 1000.0)
        self.assertEqual(fields["igst"], 180.0)
        self.assertEqual(fields["total"], 1180.0)

    def test_parses_parenthetical_tax_rates_and_currency_glyphs(self):
        text = "Subtotal\nR60,000.00\nCGST (9%)\n#5,400.00\nSGST (9%)\nR5,400.00\nTotal (INR)\nR70,800.00"
        fields = extract_invoice_fields({"text": text})
        self.assertEqual(fields["subtotal"], 60000.0)
        self.assertEqual(fields["cgst"], 5400.0)
        self.assertEqual(fields["sgst"], 5400.0)
        self.assertEqual(fields["total"], 70800.0)

    def test_extracts_invoice_number_across_columnar_lines(self):
        text = "Invoice No:\nExpress Towers, Nariman Point\nVNG-2026-881\nDate: 22 Aug 2026"
        fields = extract_invoice_fields({"text": text})
        self.assertEqual(fields["invoice_number"], "VNG-2026-881")

    def test_extracts_vendor_around_tax_invoice_title(self):
        text = "Apex CloudTech\nTAX INVOICE\nSolutions Pvt. Ltd.\nPlot 42, Electronic City"
        fields = extract_invoice_fields({"text": text})
        self.assertEqual(fields["vendor"], "Apex CloudTech Solutions Pvt. Ltd")


if __name__ == "__main__":
    unittest.main()

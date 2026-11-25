import unittest
from pathlib import Path

from chart_analyzer import _parse_hover_text, analyze_svg, calibrate, chart_png, parse_instrument, parse_svg, pivot_minute_prices


class ChartAnalyzerTests(unittest.TestCase):
    def test_instrument_metadata(self):
        item = parse_instrument("https://groww.in/options/sp-bse-sensex/SENSEX26O2274100CE")
        self.assertEqual(item["index"], "SENSEX")
        self.assertEqual(item["strike"], 74100)
        self.assertEqual(item["option_type"], "CE")

    def test_transform_and_exclude_area_fill(self):
        svg = (Path(__file__).parent / "fixtures/linear_chart.svg").read_text()
        parsed = parse_svg(svg)
        self.assertEqual(parsed["paths"][0]["points"][0], (30.0, 125.0))
        analysis, rows = analyze_svg("https://groww.in/options/x/SENSEX26O2274100CE", svg)
        self.assertEqual(len(rows), 5)
        self.assertEqual(analysis["scale_type"], "linear")
        self.assertFalse(analysis["prices_exact"])

    def test_linear_reconstruction(self):
        pts = [(0, 0), (1, 50), (2, 100)]
        ticks = [{"y": 0, "value": 200}, {"y": 100, "value": 0}]
        prices, model = calibrate(pts, ticks)
        self.assertEqual(prices, [200, 100, 0])
        self.assertEqual(model["scale_type"], "linear")

    def test_log_reconstruction(self):
        pts = [(0, 0), (1, 50), (2, 100)]
        ticks = [{"y": 0, "value": 100}, {"y": 50, "value": 10}, {"y": 100, "value": 1}]
        prices, model = calibrate(pts, ticks)
        self.assertEqual(model["scale_type"], "logarithmic")
        self.assertAlmostEqual(prices[1], 10)

    def test_png_output(self):
        image = chart_png([{"x_coordinate": 0, "estimated_premium": 10}, {"x_coordinate": 1, "estimated_premium": 20}])
        self.assertTrue(image.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_tooltip_values_and_wide_minute_table(self):
        self.assertEqual(_parse_hover_text("09:15 AM\n₹ 496.45"), ("09:15 AM", 496.45))
        contracts = [{"contract_column": "SENSEX 64000 PE"}, {"contract_column": "SENSEX 64000 CE"}]
        points = [
            {"timestamp": "09:15 AM", "contract": "SENSEX 64000 PE", "estimated_premium": 120.5},
            {"timestamp": "09:15 AM", "contract": "SENSEX 64000 CE", "estimated_premium": 130.0},
            {"timestamp": "09:16 AM", "contract": "SENSEX 64000 CE", "estimated_premium": 131.0},
        ]
        table = pivot_minute_prices(contracts, points)
        self.assertEqual(table["columns"], ["Time", "SENSEX 64000 PE", "SENSEX 64000 CE"])
        self.assertEqual(table["rows"][1], {"Time": "09:16 AM", "SENSEX 64000 CE": 131.0})

    def test_insufficient_ticks_not_fabricated(self):
        analysis, rows = analyze_svg("https://groww.in/options/x/SENSEX26O2274100CE", '<svg><path d="M0 0 L10 10 L20 5 L30 8 L40 7"/></svg>')
        self.assertEqual(rows, [])
        self.assertTrue(analysis["warnings"])


if __name__ == "__main__":
    unittest.main()

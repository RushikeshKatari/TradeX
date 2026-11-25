import unittest
from unittest.mock import patch

import app


class SheetsSnapshotTests(unittest.TestCase):
    def test_scraper_optional_google_sheets(self):
        original_config = app.config
        original_enabled = app.scraping_enabled
        try:
            app.config = {"sheets": {"enabled": False}, "indices": []}
            app.scraping_enabled = False
            response = app.app.test_client().post("/api/scraping", json={"enabled": True})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json["enabled"])
            self.assertTrue(app.scraping_enabled)
        finally:
            app.config = original_config
            app.scraping_enabled = original_enabled

    def test_every_available_strike_is_queued_as_one_wide_sheets_snapshot(self):
        original_config = app.config
        original_state = dict(app.state)
        try:
            app.config = {
                "indices": [{"name": "SENSEX", "url": "https://example.test", "selected_expiry": "", "strikes": ["64000"]}],
                "sheets": {"enabled": True, "spreadsheet_id": "sheet", "worksheet": "Options", "credentials_file": "key.json"},
            }
            rows = [
                {"index": "SENSEX", "expiry": "2026-10-22", "strike": "64000", "call": "100", "put": "110"},
                {"index": "SENSEX", "expiry": "2026-10-22", "strike": "64100", "call": "90", "put": "120"},
            ]
            with patch.object(app, "extract_rows", return_value=rows), patch.object(app.sheets_queue, "put_nowait") as queue_snapshot, patch.object(app, "save_last_snapshot"):
                app.poll_once()
            queued_rows = queue_snapshot.call_args.args[0][0]
            wide = app.make_wide_snapshot(queued_rows)
            self.assertIn("SENSEX 64000 PE", wide)
            self.assertIn("SENSEX 64000 CE", wide)
            self.assertIn("SENSEX 64100 PE", wide)
            self.assertIn("SENSEX 64100 CE", wide)
            self.assertTrue(wide["Time"])
        finally:
            app.config = original_config
            app.state.clear()
            app.state.update(original_state)


if __name__ == "__main__":
    unittest.main()

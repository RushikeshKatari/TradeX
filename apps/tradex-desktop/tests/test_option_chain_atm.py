import unittest
from unittest.mock import patch
import groww_scraper
import app


class OptionChainATMTests(unittest.TestCase):
    def test_groww_scraper_filters_10_above_and_10_below_atm(self):
        # Create 50 mock contracts with strikes 70000 to 74900 (step 100)
        mock_contracts = []
        for strike in range(70000, 75000, 100):
            mock_contracts.append({
                "strikePrice": strike * 100,  # in paise
                "ce": {"liveData": {"ltp": 50.0, "oi": 100}, "growwContractId": f"SENSEX{strike}CE"},
                "pe": {"liveData": {"ltp": 60.0, "oi": 120}, "growwContractId": f"SENSEX{strike}PE"},
            })

        mock_page_data = {
            "props": {
                "pageProps": {
                    "data": {
                        "company": {"liveData": {"ltp": 72540.0}},
                        "optionChain": {
                            "aggregatedDetails": {"currentExpiry": "2026-10-22", "lotSize": 20},
                            "optionContracts": mock_contracts,
                        },
                    }
                }
            }
        }

        with patch.object(groww_scraper, "_extract_next_data", return_value=mock_page_data), \
             patch("requests.Session.get") as mock_get:
            mock_get.return_value.text = "<html></html>"
            mock_get.return_value.raise_for_status = lambda: None

            # With default strikes_above_below=10:
            # Spot is 72540, so ATM strike is 72500
            # 10 below: 71500 .. 72400 (10 strikes)
            # ATM: 72500
            # 10 above: 72600 .. 73500 (10 strikes)
            # Total: 21 strikes
            result = groww_scraper.fetch_option_chain("sp-bse-sensex")
            self.assertEqual(len(result["rows"]), 21)
            strikes = [int(r["strike"]) for r in result["rows"]]
            self.assertEqual(strikes[0], 71500)
            self.assertEqual(strikes[10], 72500)  # ATM
            self.assertEqual(strikes[-1], 73500)

            # When strikes_above_below is None, returns all 50 contracts
            all_result = groww_scraper.fetch_option_chain("sp-bse-sensex", strikes_above_below=None)
            self.assertEqual(len(all_result["rows"]), 50)


if __name__ == "__main__":
    unittest.main()

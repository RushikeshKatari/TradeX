"""Application configuration loaded from environment variables."""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # Flask
    HOST = os.getenv("FLASK_HOST", "0.0.0.0")
    PORT = int(os.getenv("FLASK_PORT", 5000))
    DEBUG = os.getenv("FLASK_DEBUG", "false").lower() == "true"

    # Data
    REFRESH_INTERVAL = int(os.getenv("REFRESH_INTERVAL", 30))
    CACHE_TTL = int(os.getenv("CACHE_TTL", 15))

    # Symbols
    DEFAULT_INDEX = os.getenv("DEFAULT_INDEX", "NIFTY")
    DEFAULT_INDICES = os.getenv("DEFAULT_INDICES", "NIFTY,BANKNIFTY").split(",")

    # Logging
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    LOG_FILE = os.getenv("LOG_FILE", "logs/app.log")

    # Paper Trading
    INITIAL_CAPITAL = float(os.getenv("INITIAL_CAPITAL", 1000000))
    # Lot sizes can be overridden via environment, e.g. LOT_SIZES="NIFTY:25,BANKNIFTY:15,FINNIFTY:25"
    _LOT_SIZES_DEFAULT = {
        "NIFTY": 25,
        "BANKNIFTY": 15,
        "FINNIFTY": 25,
        "MIDCPNIFTY": 50,
    }

    @classmethod
    def get_lot_size(cls, symbol: str) -> int:
        """Get the configured lot size for an instrument."""
        env_lots = os.getenv("LOT_SIZES")
        if env_lots:
            for pair in env_lots.split(","):
                if ":" in pair:
                    s, size = pair.strip().split(":", 1)
                    if s.strip().upper() == symbol.strip().upper():
                        try:
                            return int(size.strip())
                        except ValueError:
                            pass
        return cls._LOT_SIZES_DEFAULT.get(symbol.strip().upper(), 25)

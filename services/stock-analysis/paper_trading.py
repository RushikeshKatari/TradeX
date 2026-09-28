"""
Paper Trading Engine.

Virtual trades only — never places real orders.
Tracks: entry, option, strike, premium, quantity, current price, P&L, exit, trade history.
"""

import json
import logging
import os
from datetime import datetime
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field, asdict

from config import Config

logger = logging.getLogger(__name__)

TRADES_FILE = "paper_trades.json"


@dataclass
class PaperTrade:
    id: str
    timestamp: str
    symbol: str
    option_type: str  # CE or PE
    strike: float
    expiry: str
    entry_premium: float
    quantity: int  # Total units = lots * lot_size
    lots: int = 1
    lot_size: int = 25
    direction: str = "LONG"  # "LONG" (buy) or "SHORT" (sell)
    current_premium: Optional[float] = None
    exit_premium: Optional[float] = None
    exit_timestamp: Optional[str] = None
    status: str = "OPEN"  # OPEN or CLOSED
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None
    signal: str = ""
    regime_at_entry: str = ""
    confidence_at_entry: float = 0


class PaperTrader:
    """Paper trading engine with persistent trade storage and precise lot-size P&L."""

    def __init__(self, initial_capital: float = None):
        self.initial_capital = initial_capital or Config.INITIAL_CAPITAL
        self.capital = self.initial_capital
        self.trades: List[PaperTrade] = []
        self._next_id = 1
        self._load_trades()

    def _load_trades(self):
        """Load trades from file."""
        if os.path.exists(TRADES_FILE):
            try:
                with open(TRADES_FILE, "r") as f:
                    data = json.load(f)
                    trades_raw = data.get("trades", [])
                    self.trades = []
                    for t in trades_raw:
                        # Backwards compatibility defaults for existing saved trades
                        if "lots" not in t:
                            t["lots"] = 1
                        if "lot_size" not in t:
                            t["lot_size"] = Config.get_lot_size(t.get("symbol", "NIFTY"))
                        if "direction" not in t:
                            t["direction"] = "LONG"
                        self.trades.append(PaperTrade(**t))
                    self.capital = data.get("capital", self.initial_capital)
                    self._next_id = data.get("next_id", len(self.trades) + 1)
                    logger.info(f"Loaded {len(self.trades)} paper trades")
            except Exception as e:
                logger.error(f"Error loading trades: {e}")
                self.trades = []

    def _save_trades(self):
        """Persist trades to file."""
        try:
            data = {
                "trades": [asdict(t) for t in self.trades],
                "capital": round(self.capital, 2),
                "next_id": self._next_id,
                "initial_capital": self.initial_capital,
                "last_updated": datetime.now().isoformat(),
            }
            with open(TRADES_FILE, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving trades: {e}")

    def enter_trade(
        self,
        symbol: str,
        option_type: str,
        strike: float,
        expiry: str,
        premium: float,
        lots: int = 1,
        direction: str = "LONG",
        quantity: Optional[int] = None,  # Optional override if client passes total quantity directly
        signal: str = "",
        regime: str = "",
        confidence: float = 0,
    ) -> PaperTrade:
        """Enter a new paper trade.

        P&L and sizing formula:
        Total units = lots * lot_size
        """
        symbol_upper = symbol.strip().upper()
        dir_upper = direction.strip().upper() if direction else "LONG"
        if dir_upper not in ("LONG", "SHORT"):
            dir_upper = "LONG"

        lot_size = Config.get_lot_size(symbol_upper)
        lots_count = max(1, int(lots)) if lots else 1
        total_qty = lots_count * lot_size

        cost = premium * total_qty

        if dir_upper == "LONG":
            if cost > self.capital:
                logger.warning(f"Insufficient capital for LONG: need ₹{cost:.2f}, have ₹{self.capital:.2f}")
            self.capital -= cost
        else:
            # Short option: credit premium received into capital
            self.capital += cost

        trade = PaperTrade(
            id=f"PT-{self._next_id:04d}",
            timestamp=datetime.now().isoformat(),
            symbol=symbol_upper,
            option_type=option_type.upper(),
            strike=float(strike),
            expiry=expiry,
            entry_premium=float(premium),
            lots=lots_count,
            lot_size=lot_size,
            direction=dir_upper,
            quantity=total_qty,
            current_premium=float(premium),
            pnl=0.0,
            pnl_pct=0.0,
            signal=signal,
            regime_at_entry=regime,
            confidence_at_entry=confidence,
        )

        self.trades.append(trade)
        self._next_id += 1
        self._save_trades()
        logger.info(
            f"Paper trade entered: {trade.id} {dir_upper} {symbol_upper} {lots_count} lot(s) "
            f"(qty: {total_qty}) {strike}{option_type} @ ₹{premium}"
        )
        return trade

    def exit_trade(self, trade_id: str, exit_premium: float) -> Optional[PaperTrade]:
        """Exit a paper trade.

        For LONG position:  P&L = lots * lot_size * (exit_premium - entry_premium)
        For SHORT position: P&L = lots * lot_size * (entry_premium - exit_premium)
        """
        for trade in self.trades:
            if trade.id == trade_id and trade.status == "OPEN":
                trade.exit_premium = float(exit_premium)
                trade.exit_timestamp = datetime.now().isoformat()
                trade.status = "CLOSED"

                lots = trade.lots or 1
                lot_size = trade.lot_size or Config.get_lot_size(trade.symbol)
                total_qty = trade.quantity or (lots * lot_size)

                if trade.direction == "SHORT":
                    # Short: Profit when price drops below entry
                    trade.pnl = (trade.entry_premium - trade.exit_premium) * total_qty
                    trade.pnl_pct = (
                        ((trade.entry_premium - trade.exit_premium) / trade.entry_premium * 100)
                        if trade.entry_premium else 0.0
                    )
                    # When closing short: pay exit premium to buy back
                    self.capital -= trade.exit_premium * total_qty
                else:
                    # Long: Profit when price rises above entry
                    trade.pnl = (trade.exit_premium - trade.entry_premium) * total_qty
                    trade.pnl_pct = (
                        ((trade.exit_premium - trade.entry_premium) / trade.entry_premium * 100)
                        if trade.entry_premium else 0.0
                    )
                    # When closing long: receive proceeds from selling
                    self.capital += trade.exit_premium * total_qty

                trade.pnl = round(trade.pnl, 2)
                trade.pnl_pct = round(trade.pnl_pct, 2)

                self._save_trades()
                logger.info(
                    f"Paper trade exited: {trade.id} {trade.direction} {trade.symbol} P&L: ₹{trade.pnl:.2f} ({trade.pnl_pct}%)"
                )
                return trade
        return None

    def update_current_prices(self, chain_data):
        """Update current premiums and open P&L from live option chain data.

        For LONG position:  open_pnl = lots * lot_size * (live_premium - entry_premium)
        For SHORT position: open_pnl = lots * lot_size * (entry_premium - live_premium)
        """
        if not chain_data or not chain_data.strikes:
            return

        has_updates = False
        for trade in self.trades:
            if trade.status != "OPEN":
                continue
            if trade.symbol.upper() != chain_data.symbol.upper():
                continue

            for s in chain_data.strikes:
                if s.strike_price == trade.strike:
                    live_premium = None
                    if trade.option_type == "CE" and s.ce and s.ce.ltp is not None:
                        live_premium = s.ce.ltp
                    elif trade.option_type == "PE" and s.pe and s.pe.ltp is not None:
                        live_premium = s.pe.ltp

                    if live_premium is not None:
                        trade.current_premium = live_premium
                        lots = trade.lots or 1
                        lot_size = trade.lot_size or Config.get_lot_size(trade.symbol)
                        total_qty = trade.quantity or (lots * lot_size)

                        if trade.direction == "SHORT":
                            trade.pnl = (trade.entry_premium - live_premium) * total_qty
                            trade.pnl_pct = (
                                ((trade.entry_premium - live_premium) / trade.entry_premium * 100)
                                if trade.entry_premium else 0.0
                            )
                        else:
                            trade.pnl = (live_premium - trade.entry_premium) * total_qty
                            trade.pnl_pct = (
                                ((live_premium - trade.entry_premium) / trade.entry_premium * 100)
                                if trade.entry_premium else 0.0
                            )

                        trade.pnl = round(trade.pnl, 2)
                        trade.pnl_pct = round(trade.pnl_pct, 2)
                        has_updates = True
                    break

        if has_updates:
            self._save_trades()

    def get_open_trades(self) -> List[Dict]:
        return [asdict(t) for t in self.trades if t.status == "OPEN"]

    def get_closed_trades(self) -> List[Dict]:
        return [asdict(t) for t in self.trades if t.status == "CLOSED"]

    def get_all_trades(self) -> List[Dict]:
        return [asdict(t) for t in self.trades]

    def get_portfolio_summary(self) -> Dict:
        open_trades = [t for t in self.trades if t.status == "OPEN"]
        closed_trades = [t for t in self.trades if t.status == "CLOSED"]

        total_open_pnl = sum(t.pnl or 0 for t in open_trades)
        total_closed_pnl = sum(t.pnl or 0 for t in closed_trades)
        total_pnl = total_open_pnl + total_closed_pnl

        winning = [t for t in closed_trades if t.pnl and t.pnl > 0]
        losing = [t for t in closed_trades if t.pnl and t.pnl < 0]

        return {
            "initial_capital": self.initial_capital,
            "current_capital": round(self.capital, 2),
            "open_positions": len(open_trades),
            "closed_positions": len(closed_trades),
            "total_trades": len(self.trades),
            "open_pnl": round(total_open_pnl, 2),
            "closed_pnl": round(total_closed_pnl, 2),
            "total_pnl": round(total_pnl, 2),
            "total_pnl_pct": round(total_pnl / self.initial_capital * 100, 2) if self.initial_capital else 0,
            "winning_trades": len(winning),
            "losing_trades": len(losing),
            "win_rate": round(len(winning) / len(closed_trades) * 100, 1) if closed_trades else 0,
        }

    def reset(self):
        """Reset all trades and capital."""
        self.trades = []
        self.capital = self.initial_capital
        self._next_id = 1
        self._save_trades()
        logger.info("Paper trading reset")

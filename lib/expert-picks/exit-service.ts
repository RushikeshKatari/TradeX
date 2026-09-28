import { ExpertPickPosition } from '@/types/expert-picks';
import { executePaperOrder } from '@/lib/trading/execution';
import { OrderInput } from '@/types/trading';

// Configurable exit time (IST, 24h format - e.g. "15:15")
export function getConfiguredExitTime(): string {
  return process.env.EXPERT_PICKS_EXIT_TIME_IST || '15:15';
}

export const EXIT_TIME_IST = getConfiguredExitTime();

export type ExitReason =
  | 'STOP_LOSS_50PCT'
  | 'COMBINED_PROFIT_EXIT'
  | 'TIME_EXIT_3_15PM'
  | 'MANUAL_EXIT';

export function isWithinTradingWindowIst(customDate?: Date): boolean {
  const now = customDate || new Date();
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  const [hours, minutes] = time.split(':').map(Number);
  const currentMinutes = hours * 60 + minutes;
  return currentMinutes >= 9 * 60 + 15 && currentMinutes < 15 * 60 + 15;
}

export function shouldStopLossExit(entryPrice: number, currentLtp: number, side: 'BUY' | 'SELL', customDate?: Date): boolean {
  if (entryPrice <= 0 || currentLtp <= 0) return false;
  if (!isWithinTradingWindowIst(customDate)) return false;
  if (side === 'BUY') {
    return currentLtp <= entryPrice * 0.5;
  }
  return currentLtp >= entryPrice * 1.5;
}

export function shouldConfiguredStopLossExit(entryPrice: number, currentLtp: number, stopLossPercent?: number, customDate?: Date): boolean {
  if (!stopLossPercent || stopLossPercent <= 0) return shouldStopLossExit(entryPrice, currentLtp, 'BUY', customDate);
  if (!isWithinTradingWindowIst(customDate) || entryPrice <= 0 || currentLtp <= 0) return false;
  return currentLtp <= entryPrice * (1 - stopLossPercent / 100);
}

export function shouldCombinedProfitExit(
  ceInvestment: number,
  peInvestment: number,
  ceCurrentValue: number,
  peCurrentValue: number
): boolean {
  const combinedInvestment = ceInvestment + peInvestment;
  if (combinedInvestment <= 0) return false;
  const combinedCurrentValue = ceCurrentValue + peCurrentValue;
  const profit = combinedCurrentValue - combinedInvestment;
  // Realized/current profit exceeds the combined investment
  return profit > combinedInvestment;
}

export function shouldTimeExit(exitTimeIst: string = getConfiguredExitTime(), customDate?: Date): boolean {
  const now = customDate || new Date();
  const kolkataTime = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  const [h, m] = kolkataTime.split(':').map(Number);
  const [exitH, exitM] = exitTimeIst.split(':').map(Number);
  const currentMinutes = h * 60 + m;
  const exitMinutes = exitH * 60 + exitM;
  return currentMinutes >= exitMinutes;
}

export interface AutoExitResult {
  positionId: string;
  symbol: string;
  quantity: number;
  reason: ExitReason;
  message: string;
}

export async function evaluateAndExecuteAutoExits(
  userId: string,
  positions: ExpertPickPosition[]
): Promise<AutoExitResult[]> {
  const results: AutoExitResult[] = [];
  const openPositions = positions.filter((p) => p.status === 'OPEN');
  if (openPositions.length === 0) return results;

  const exitTime = getConfiguredExitTime();
  const isTimeExit = shouldTimeExit(exitTime);

  // 1. Time Exit Check (3:15 PM IST)
  if (isTimeExit) {
    for (const pos of openPositions) {
      try {
        const symbol = `${pos.underlying}_${pos.strike}_${pos.optionType}`;
        const orderInput: OrderInput = {
          symbol,
          instrumentType: 'OPTION',
          side: 'SELL',
          orderType: 'MARKET',
          quantity: pos.quantity,
          price: pos.currentLtp,
        };
        await executePaperOrder(userId, orderInput);
        results.push({
          positionId: pos.id,
          symbol,
          quantity: pos.quantity,
          reason: 'TIME_EXIT_3_15PM',
          message: `Auto-closed at ${exitTime} IST market close.`,
        });
        pos.status = 'CLOSED';
        pos.exitReason = `Time Exit (${exitTime} IST)`;
      } catch (err) {
        console.error(`[AUTO_EXIT_ERROR] Failed time exit for ${pos.underlying}_${pos.strike}_${pos.optionType}:`, err);
      }
    }
    return results;
  }

  // 2. 50% loss stop, evaluated only during the market window
  const remainingPositions: ExpertPickPosition[] = [];
  for (const pos of openPositions) {
    if (pos.status === 'CLOSED') continue;
    if (shouldConfiguredStopLossExit(pos.entryPrice, pos.currentLtp, pos.stopLossPercent)) {
      try {
        const symbol = `${pos.underlying}_${pos.strike}_${pos.optionType}`;
        const orderInput: OrderInput = {
          symbol,
          instrumentType: 'OPTION',
          side: 'SELL',
          orderType: 'MARKET',
          quantity: pos.quantity,
          price: pos.currentLtp,
        };
        await executePaperOrder(userId, orderInput);
        results.push({
          positionId: pos.id,
          symbol,
          quantity: pos.quantity,
          reason: 'STOP_LOSS_50PCT',
          message: `50% loss stop triggered (Entry: ₹${pos.entryPrice}, Current LTP: ₹${pos.currentLtp}).`,
        });
        pos.status = 'CLOSED';
        pos.exitReason = '50% Loss Stop';
      } catch (err) {
        console.error(`[AUTO_EXIT_ERROR] Failed stop-loss exit for ${pos.underlying}_${pos.strike}_${pos.optionType}:`, err);
        remainingPositions.push(pos);
      }
    } else {
      remainingPositions.push(pos);
    }
  }

  // 3. Combined-Profit Exit Check
  // Each CE/PE entry creates a tradeGroupId. Evaluate targets per group so
  // opening a second pair cannot cause the first pair to be closed.
  const groupedTrades = new Map<string, { underlying: string; ce: ExpertPickPosition[]; pe: ExpertPickPosition[] }>();
  for (const pos of remainingPositions) {
    const groupKey = pos.tradeGroupId || `${pos.underlying}_${pos.strike}`;
    if (!groupedTrades.has(groupKey)) {
      groupedTrades.set(groupKey, { underlying: pos.underlying, ce: [], pe: [] });
    }
    const group = groupedTrades.get(groupKey)!;
    if (pos.optionType === 'CE') group.ce.push(pos);
    else group.pe.push(pos);
  }

  for (const [, group] of groupedTrades.entries()) {
    if (group.ce.length > 0 && group.pe.length > 0) {
      const ceInv = group.ce.reduce((sum, p) => sum + p.investment, 0);
      const peInv = group.pe.reduce((sum, p) => sum + p.investment, 0);
      const ceVal = group.ce.reduce((sum, p) => sum + p.currentValue, 0);
      const peVal = group.pe.reduce((sum, p) => sum + p.currentValue, 0);

      const target = [...group.ce, ...group.pe].map((p) => p.exitTargetValue || 0).find((v) => v > 0) || 0;
      const combinedCurrentValue = ceVal + peVal;
      if (target > 0 ? combinedCurrentValue >= target : shouldCombinedProfitExit(ceInv, peInv, ceVal, peVal)) {
        const allInGroup = [...group.ce, ...group.pe];
        for (const pos of allInGroup) {
          try {
            const symbol = `${pos.underlying}_${pos.strike}_${pos.optionType}`;
            const orderInput: OrderInput = {
              symbol,
              instrumentType: 'OPTION',
              side: 'SELL',
              orderType: 'MARKET',
              quantity: pos.quantity,
              price: pos.currentLtp,
            };
            await executePaperOrder(userId, orderInput);
            results.push({
              positionId: pos.id,
              symbol,
              quantity: pos.quantity,
              reason: 'COMBINED_PROFIT_EXIT',
              message: `Combined-profit exit triggered (Profit exceeded combined investment of ₹${(ceInv + peInv).toFixed(2)}).`,
            });
            pos.status = 'CLOSED';
            pos.exitReason = 'Combined Profit Exit (>100% ROI)';
          } catch (err) {
            console.error(`[AUTO_EXIT_ERROR] Failed combined profit exit for ${pos.underlying}_${pos.strike}_${pos.optionType}:`, err);
          }
        }
      }
    }
  }

  return results;
}

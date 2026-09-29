import { prisma } from '@/lib/db/prisma';
import { getMarketDataProvider } from '@/lib/market-data';
import { OrderInput, PortfolioSummary, PositionView, HoldingView } from '@/types/trading';
import { toDecimal, roundMoney, calcAveragePrice } from './decimal';
import { logAudit } from '@/lib/security/audit';
import Decimal from 'decimal.js';

export class ExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutionError';
  }
}

type PairedOptionLegInput = {
  symbol: string;
  exchange?: string;
  quantity: number;
  price: number;
  stopLossPercent: number;
  exitTargetValue: number;
  tradeGroupId: string;
};

export async function executePaperOrder(userId: string, input: OrderInput) {
  const provider = getMarketDataProvider();
  const symbol = input.symbol.toUpperCase().trim();
  const quantity = Math.floor(input.quantity);
  const side = input.side;
  const orderType = input.orderType || 'MARKET';

  if (quantity <= 0) {
    throw new ExecutionError('Order quantity must be at least 1.');
  }

  // 1. Fetch current quote from market data provider
  const quote = await provider.getQuote(symbol);
  const currentPrice = quote.lastPrice;

  // Determine effective execution price
  let executedPrice = currentPrice;
  if (orderType === 'LIMIT') {
    if (!input.price || input.price <= 0) {
      throw new ExecutionError('Limit order requires a valid limit price.');
    }
    // Limit BUY: only fill if market price <= limit price
    // Limit SELL: only fill if market price >= limit price
    const limitPrice = input.price;
    if (side === 'BUY' && currentPrice > limitPrice) {
      // Pending limit order: reserve cash and store as OPEN
      return await reserveAndCreateOpenLimitOrder(userId, input, limitPrice);
    } else if (side === 'SELL' && currentPrice < limitPrice) {
      // Pending limit order: verify holding and store as OPEN
      return await reserveAndCreateOpenSellOrder(userId, input, limitPrice);
    }
    // Limit satisfied immediately at limit or better
    executedPrice = side === 'BUY' ? Math.min(currentPrice, limitPrice) : Math.max(currentPrice, limitPrice);
  }

  const decPrice = toDecimal(executedPrice);
  const decQty = new Decimal(quantity);
  const totalValue = decPrice.times(decQty);

  // 2. Atomic Transaction Execution
  return await prisma.$transaction(async (tx) => {
    // Lock virtual account
    const account = await tx.virtualAccount.findUnique({
      where: { userId },
    });

    if (!account) {
      throw new ExecutionError('Virtual trading account not found.');
    }

    const currentBalance = toDecimal(account.balance);

    if (side === 'BUY') {
      if (currentBalance.lessThan(totalValue)) {
        // Record rejected order
        await tx.order.create({
          data: {
            userId,
            symbol,
            exchange: input.exchange || 'NSE',
            instrumentType: input.instrumentType || 'EQUITY',
            side: 'BUY',
            orderType,
            quantity,
            requestedPrice: input.price ? toDecimal(input.price) : decPrice,
            status: 'REJECTED',
            rejectionReason: `Insufficient virtual balance (Required: ₹${roundMoney(totalValue)}, Available: ₹${roundMoney(currentBalance)})`,
          },
        });
        throw new ExecutionError(`Insufficient virtual cash balance. Required: ₹${roundMoney(totalValue)}, Available: ₹${roundMoney(currentBalance)}.`);
      }

      // Deduct balance
      const newBalance = currentBalance.minus(totalValue);
      await tx.virtualAccount.update({
        where: { id: account.id },
        data: { balance: newBalance },
      });

      // Immutable fund ledger
      await tx.fundTransaction.create({
        data: {
          virtualAccountId: account.id,
          userId,
          type: 'TRADE_BUY',
          amount: totalValue,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          reason: `Paper Buy: ${quantity} shares of ${symbol} @ ₹${executedPrice}`,
          createdBy: 'TRADING_ENGINE',
        },
      });

      // Create Order (FILLED)
      const order = await tx.order.create({
        data: {
          userId,
          symbol,
          exchange: input.exchange || 'NSE',
          instrumentType: input.instrumentType || 'EQUITY',
          side: 'BUY',
          orderType,
          quantity,
          requestedPrice: input.price ? toDecimal(input.price) : decPrice,
          executedPrice: decPrice,
          status: 'FILLED',
          executedAt: new Date(),
        },
      });

      // Create Trade record
      const trade = await tx.trade.create({
        data: {
          orderId: order.id,
          userId,
          symbol,
          side: 'BUY',
          quantity,
          price: decPrice,
          value: totalValue,
        },
      });

      // Upsert Position
      const existingPos = await tx.position.findUnique({
        where: { userId_symbol: { userId, symbol } },
      });

      if (existingPos) {
        const newQty = existingPos.quantity + quantity;
        const newAvg = calcAveragePrice(existingPos.quantity, existingPos.averageEntryPrice, quantity, decPrice);
        await tx.position.update({
          where: { id: existingPos.id },
          data: {
            quantity: newQty,
            averageEntryPrice: newAvg,
          },
        });
      } else {
        await tx.position.create({
          data: {
            userId,
            symbol,
            exchange: input.exchange || 'NSE',
            quantity,
            averageEntryPrice: decPrice,
          },
        });
      }

      // Upsert Holding
      const existingHolding = await tx.holding.findUnique({
        where: { userId_symbol: { userId, symbol } },
      });

      if (existingHolding) {
        const newQty = existingHolding.quantity + quantity;
        const newAvg = calcAveragePrice(existingHolding.quantity, existingHolding.averagePrice, quantity, decPrice);
        await tx.holding.update({
          where: { id: existingHolding.id },
          data: {
            quantity: newQty,
            averagePrice: newAvg,
          },
        });
      } else {
        await tx.holding.create({
          data: {
            userId,
            symbol,
            quantity,
            averagePrice: decPrice,
          },
        });
      }

      await logAudit({
        userId,
        action: 'ORDER_FILLED',
        entity: 'ORDER',
        entityId: order.id,
        details: { symbol, side: 'BUY', quantity, price: executedPrice },
      });

      return { order, trade, executedPrice, quantity, totalValue: roundMoney(totalValue) };
    } else {
      // SELL ORDER
      const position = await tx.position.findUnique({
        where: { userId_symbol: { userId, symbol } },
      });

      if (!position || position.quantity < quantity) {
        const holdingQty = position?.quantity ?? 0;
        await tx.order.create({
          data: {
            userId,
            symbol,
            exchange: input.exchange || 'NSE',
            instrumentType: input.instrumentType || 'EQUITY',
            side: 'SELL',
            orderType,
            quantity,
            requestedPrice: input.price ? toDecimal(input.price) : decPrice,
            status: 'REJECTED',
            rejectionReason: `Insufficient shares held (Held: ${holdingQty}, Requested: ${quantity})`,
          },
        });
        throw new ExecutionError(`Insufficient shares in position. You hold ${holdingQty} shares, but tried to sell ${quantity}.`);
      }

      const avgEntry = toDecimal(position.averageEntryPrice);
      // Realized PnL = (executedPrice - avgEntryPrice) * quantity
      const realizedPnL = decPrice.minus(avgEntry).times(decQty);

      // Credit cash balance
      const newBalance = currentBalance.plus(totalValue);
      await tx.virtualAccount.update({
        where: { id: account.id },
        data: { balance: newBalance },
      });

      // Immutable fund ledger
      await tx.fundTransaction.create({
        data: {
          virtualAccountId: account.id,
          userId,
          type: 'TRADE_SELL',
          amount: totalValue,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          reason: `Paper Sell: ${quantity} shares of ${symbol} @ ₹${executedPrice} (Realized P&L: ₹${roundMoney(realizedPnL)})`,
          createdBy: 'TRADING_ENGINE',
        },
      });

      // Create Order (FILLED)
      const order = await tx.order.create({
        data: {
          userId,
          symbol,
          exchange: input.exchange || 'NSE',
          instrumentType: input.instrumentType || 'EQUITY',
          side: 'SELL',
          orderType,
          quantity,
          requestedPrice: input.price ? toDecimal(input.price) : decPrice,
          executedPrice: decPrice,
          status: 'FILLED',
          executedAt: new Date(),
        },
      });

      // Create Trade record
      const trade = await tx.trade.create({
        data: {
          orderId: order.id,
          userId,
          symbol,
          side: 'SELL',
          quantity,
          price: decPrice,
          value: totalValue,
        },
      });

      // Update position
      const remainingQty = position.quantity - quantity;
      const accRealized = toDecimal(position.realizedPnL).plus(realizedPnL);

      if (remainingQty === 0) {
        // Keep the zero-quantity row as the realized-P&L accumulator. This
        // lets portfolio totals continue to include fully closed positions.
        await tx.position.update({
          where: { id: position.id },
          data: {
            quantity: 0,
            realizedPnL: accRealized,
            stopLossPercent: null,
            exitTargetValue: null,
            tradeGroupId: null,
          },
        });
      } else {
        await tx.position.update({
          where: { id: position.id },
          data: {
            quantity: remainingQty,
            realizedPnL: accRealized,
          },
        });
      }

      // Update holding
      const holding = await tx.holding.findUnique({
        where: { userId_symbol: { userId, symbol } },
      });
      if (holding) {
        const remainingHoldingQty = holding.quantity - quantity;
        if (remainingHoldingQty <= 0) {
          await tx.holding.delete({ where: { id: holding.id } });
        } else {
          await tx.holding.update({
            where: { id: holding.id },
            data: { quantity: remainingHoldingQty },
          });
        }
      }

      await logAudit({
        userId,
        action: 'ORDER_FILLED',
        entity: 'ORDER',
        entityId: order.id,
        details: { symbol, side: 'SELL', quantity, price: executedPrice, realizedPnL: roundMoney(realizedPnL) },
      });

      return {
        order,
        trade,
        executedPrice,
        quantity,
        totalValue: roundMoney(totalValue),
        realizedPnL: roundMoney(realizedPnL),
      };
    }
  });
}

/**
 * Enter both legs of an Expert Picks CE+PE strategy as one database transaction.
 * Quotes are resolved before this function is called, so any quote/lot failure
 * happens before either leg changes the user's cash or positions.
 */
export async function executePairedOptionBuys(userId: string, legs: PairedOptionLegInput[]) {
  if (legs.length !== 2) {
    throw new ExecutionError('A paired option trade must contain both CE and PE legs.');
  }

  const normalizedLegs = legs.map((leg) => {
    const symbol = leg.symbol.toUpperCase().trim();
    const quantity = Math.floor(leg.quantity);
    if (!symbol || quantity <= 0 || !Number.isFinite(leg.price) || leg.price <= 0) {
      throw new ExecutionError('Both option legs must have a valid symbol, price, and quantity.');
    }
    return { ...leg, symbol, quantity };
  });

  if (normalizedLegs[0].symbol === normalizedLegs[1].symbol) {
    throw new ExecutionError('The CE and PE legs must use different option symbols.');
  }

  const totalRequired = normalizedLegs.reduce(
    (sum, leg) => sum.plus(toDecimal(leg.price).times(leg.quantity)),
    new Decimal(0),
  );

  const results = await prisma.$transaction(async (tx) => {
    const account = await tx.virtualAccount.findUnique({ where: { userId } });
    if (!account) throw new ExecutionError('Virtual trading account not found.');

    let currentBalance = toDecimal(account.balance);
    if (currentBalance.lessThan(totalRequired)) {
      throw new ExecutionError(
        `Insufficient virtual cash balance for both option legs. Required: ₹${roundMoney(totalRequired)}, Available: ₹${roundMoney(currentBalance)}.`,
      );
    }

    const filledLegs = [];
    for (const leg of normalizedLegs) {
      const decPrice = toDecimal(leg.price);
      const totalValue = decPrice.times(leg.quantity);
      const newBalance = currentBalance.minus(totalValue);

      await tx.virtualAccount.update({
        where: { id: account.id },
        data: { balance: newBalance },
      });

      await tx.fundTransaction.create({
        data: {
          virtualAccountId: account.id,
          userId,
          type: 'TRADE_BUY',
          amount: totalValue,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          reason: `Paper Buy: ${leg.quantity} contracts of ${leg.symbol} @ ₹${leg.price}`,
          createdBy: 'TRADING_ENGINE',
        },
      });

      const order = await tx.order.create({
        data: {
          userId,
          symbol: leg.symbol,
          exchange: leg.exchange || 'NSE',
          instrumentType: 'OPTION',
          side: 'BUY',
          orderType: 'MARKET',
          quantity: leg.quantity,
          requestedPrice: decPrice,
          executedPrice: decPrice,
          status: 'FILLED',
          executedAt: new Date(),
        },
      });

      const trade = await tx.trade.create({
        data: {
          orderId: order.id,
          userId,
          symbol: leg.symbol,
          side: 'BUY',
          quantity: leg.quantity,
          price: decPrice,
          value: totalValue,
        },
      });

      const existingPosition = await tx.position.findUnique({
        where: { userId_symbol: { userId, symbol: leg.symbol } },
      });
      if (existingPosition) {
        const newQuantity = existingPosition.quantity + leg.quantity;
        const newAverage = calcAveragePrice(
          existingPosition.quantity,
          existingPosition.averageEntryPrice,
          leg.quantity,
          decPrice,
        );
        await tx.position.update({
          where: { id: existingPosition.id },
          data: {
            quantity: newQuantity,
            averageEntryPrice: newAverage,
            stopLossPercent: toDecimal(leg.stopLossPercent),
            exitTargetValue: toDecimal(leg.exitTargetValue),
            tradeGroupId: leg.tradeGroupId,
          },
        });
      } else {
        await tx.position.create({
          data: {
            userId,
            symbol: leg.symbol,
            exchange: leg.exchange || 'NSE',
            quantity: leg.quantity,
            averageEntryPrice: decPrice,
            stopLossPercent: toDecimal(leg.stopLossPercent),
            exitTargetValue: toDecimal(leg.exitTargetValue),
            tradeGroupId: leg.tradeGroupId,
          },
        });
      }

      const existingHolding = await tx.holding.findUnique({
        where: { userId_symbol: { userId, symbol: leg.symbol } },
      });
      if (existingHolding) {
        const newQuantity = existingHolding.quantity + leg.quantity;
        const newAverage = calcAveragePrice(
          existingHolding.quantity,
          existingHolding.averagePrice,
          leg.quantity,
          decPrice,
        );
        await tx.holding.update({
          where: { id: existingHolding.id },
          data: { quantity: newQuantity, averagePrice: newAverage },
        });
      } else {
        await tx.holding.create({
          data: {
            userId,
            symbol: leg.symbol,
            quantity: leg.quantity,
            averagePrice: decPrice,
          },
        });
      }

      filledLegs.push({
        order,
        trade,
        executedPrice: leg.price,
        quantity: leg.quantity,
        totalValue: roundMoney(totalValue),
      });
      currentBalance = newBalance;
    }

    return filledLegs;
  });

  await Promise.all(results.map((result) => logAudit({
    userId,
    action: 'ORDER_FILLED',
    entity: 'ORDER',
    entityId: result.order.id,
    details: {
      symbol: result.order.symbol,
      side: 'BUY',
      quantity: result.quantity,
      price: result.executedPrice,
      tradeGroupId: normalizedLegs[0].tradeGroupId,
    },
  })));

  return results;
}

async function reserveAndCreateOpenLimitOrder(userId: string, input: OrderInput, limitPrice: number) {
  const decLimit = toDecimal(limitPrice);
  const decQty = new Decimal(input.quantity);
  const totalCost = decLimit.times(decQty);

  return await prisma.$transaction(async (tx) => {
    const account = await tx.virtualAccount.findUnique({ where: { userId } });
    if (!account) throw new ExecutionError('Virtual trading account not found.');

    const availableCash = toDecimal(account.balance).minus(toDecimal(account.reservedBalance));
    if (availableCash.lessThan(totalCost)) {
      throw new ExecutionError(`Insufficient available virtual balance for limit order. Required: ₹${roundMoney(totalCost)}, Available: ₹${roundMoney(availableCash)}.`);
    }

    // Reserve funds
    const newReserved = toDecimal(account.reservedBalance).plus(totalCost);
    await tx.virtualAccount.update({
      where: { id: account.id },
      data: { reservedBalance: newReserved },
    });

    const order = await tx.order.create({
      data: {
        userId,
        symbol: input.symbol.toUpperCase(),
        exchange: input.exchange || 'NSE',
        instrumentType: input.instrumentType || 'EQUITY',
        side: 'BUY',
        orderType: 'LIMIT',
        quantity: input.quantity,
        requestedPrice: decLimit,
        status: 'OPEN',
      },
    });

    return { order, status: 'OPEN', message: 'Limit buy order placed and funds reserved.' };
  });
}

async function reserveAndCreateOpenSellOrder(userId: string, input: OrderInput, limitPrice: number) {
  const symbol = input.symbol.toUpperCase();
  return await prisma.$transaction(async (tx) => {
    const position = await tx.position.findUnique({
      where: { userId_symbol: { userId, symbol } },
    });
    if (!position || position.quantity < input.quantity) {
      throw new ExecutionError(`Insufficient shares held for limit sell order. Held: ${position?.quantity ?? 0}.`);
    }

    const order = await tx.order.create({
      data: {
        userId,
        symbol,
        exchange: input.exchange || 'NSE',
        instrumentType: input.instrumentType || 'EQUITY',
        side: 'SELL',
        orderType: 'LIMIT',
        quantity: input.quantity,
        requestedPrice: toDecimal(limitPrice),
        status: 'OPEN',
      },
    });

    return { order, status: 'OPEN', message: 'Limit sell order placed and waiting for execution condition.' };
  });
}

export async function cancelOpenOrder(userId: string, orderId: string) {
  return await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
    });

    if (!order || order.userId !== userId) {
      throw new ExecutionError('Order not found or unauthorized.');
    }

    if (order.status !== 'OPEN') {
      throw new ExecutionError(`Cannot cancel order in ${order.status} status.`);
    }

    // If BUY limit order, release reserved funds
    if (order.side === 'BUY' && order.requestedPrice) {
      const releaseAmount = toDecimal(order.requestedPrice).times(new Decimal(order.quantity));
      const account = await tx.virtualAccount.findUnique({ where: { userId } });
      if (account) {
        const newReserved = Decimal.max(0, toDecimal(account.reservedBalance).minus(releaseAmount));
        await tx.virtualAccount.update({
          where: { id: account.id },
          data: { reservedBalance: newReserved },
        });
      }
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });

    return updated;
  });
}

export async function getPortfolioSummary(userId: string): Promise<{
  summary: PortfolioSummary;
  positions: PositionView[];
  holdings: HoldingView[];
}> {
  const provider = getMarketDataProvider();

  // These reads do not depend on one another.
  const [account, rawPositions, rawHoldings] = await Promise.all([
    prisma.virtualAccount.findUnique({ where: { userId } }),
    prisma.position.findMany({ where: { userId } }),
    prisma.holding.findMany({ where: { userId } }),
  ]);

  const cashBalance = account ? roundMoney(toDecimal(account.balance)) : 0;
  const reservedBalance = account ? roundMoney(toDecimal(account.reservedBalance)) : 0;

  // Fetch unique prices concurrently. Previously each position and holding
  // awaited its own quote serially, making portfolio response time grow with
  // every open instrument.
  const symbols = [...new Set([
    ...rawPositions.filter((position) => position.quantity > 0).map((position) => position.symbol),
    ...rawHoldings.map((holding) => holding.symbol),
  ])];
  const quoteEntries = await Promise.all(symbols.map(async (symbol) => {
    const quote = await provider.getQuote(symbol).catch(() => null);
    return [symbol, quote?.lastPrice ?? null] as const;
  }));
  const quotePrices = new Map(quoteEntries);

  let totalInvested = new Decimal(0);
  let totalCurrentValue = new Decimal(0);
  let totalUnrealizedPnL = new Decimal(0);
  let totalRealizedPnL = new Decimal(0);

  const positions: PositionView[] = [];
  const optionLotSizes: Record<string, number> = { NIFTY50: 75, BANKNIFTY: 30, SENSEX: 20, NIFTYIT: 25 };

  for (const pos of rawPositions) {
    const realPnl = toDecimal(pos.realizedPnL);
    totalRealizedPnL = totalRealizedPnL.plus(realPnl);
    if (pos.quantity <= 0) continue;

    const currentPrice = quotePrices.get(pos.symbol) ?? Number(pos.averageEntryPrice);

    const qty = new Decimal(pos.quantity);
    const avg = toDecimal(pos.averageEntryPrice);
    const cur = new Decimal(currentPrice);

    const invested = qty.times(avg);
    const curVal = qty.times(cur);
    const unPnl = curVal.minus(invested);
    const unPnlPct = invested.isZero() ? 0 : unPnl.dividedBy(invested).times(100).toNumber();
    totalInvested = totalInvested.plus(invested);
    totalCurrentValue = totalCurrentValue.plus(curVal);
    totalUnrealizedPnL = totalUnrealizedPnL.plus(unPnl);

    const optionMatch = pos.symbol.match(/^([A-Z0-9]+)_(\d+(?:\.\d+)?)_(CE|PE)$/);
    const optionMetadata = optionMatch ? {
      instrumentType: 'OPTION' as const,
      optionType: optionMatch[3] as 'CE' | 'PE',
      strike: Number(optionMatch[2]),
      lotSize: optionLotSizes[optionMatch[1]] || 75,
      lots: Math.floor(pos.quantity / (optionLotSizes[optionMatch[1]] || 75)),
    } : { instrumentType: 'EQUITY' as const };

    positions.push({
      id: pos.id,
      symbol: pos.symbol,
      exchange: pos.exchange,
      quantity: pos.quantity,
      averageEntryPrice: roundMoney(avg),
      currentPrice: roundMoney(cur),
      investedValue: roundMoney(invested),
      currentValue: roundMoney(curVal),
      unrealizedPnL: roundMoney(unPnl),
      unrealizedPnLPercent: Number(unPnlPct.toFixed(2)),
      realizedPnL: roundMoney(realPnl),
      ...optionMetadata,
    });
  }

  const holdings: HoldingView[] = [];
  for (const h of rawHoldings) {
    const currentPrice = quotePrices.get(h.symbol) ?? Number(h.averagePrice);

    const qty = new Decimal(h.quantity);
    const avg = toDecimal(h.averagePrice);
    const cur = new Decimal(currentPrice);

    const invested = qty.times(avg);
    const curVal = qty.times(cur);
    const pnl = curVal.minus(invested);
    const pnlPct = invested.isZero() ? 0 : pnl.dividedBy(invested).times(100).toNumber();

    holdings.push({
      id: h.id,
      symbol: h.symbol,
      quantity: h.quantity,
      averagePrice: roundMoney(avg),
      currentPrice: roundMoney(cur),
      investedValue: roundMoney(invested),
      currentValue: roundMoney(curVal),
      pnl: roundMoney(pnl),
      pnlPercent: Number(pnlPct.toFixed(2)),
    });
  }

  const summary: PortfolioSummary = {
    cashBalance,
    reservedBalance,
    investedValue: roundMoney(totalInvested),
    currentValue: roundMoney(totalCurrentValue),
    totalAccountValue: roundMoney(toDecimal(cashBalance).plus(totalCurrentValue)),
    totalUnrealizedPnL: roundMoney(totalUnrealizedPnL),
    totalRealizedPnL: roundMoney(totalRealizedPnL),
    todaysPnL: roundMoney(totalUnrealizedPnL.times(0.4)), // Estimated day contribution
  };

  return { summary, positions, holdings };
}

export async function allocateAdminFunds(params: {
  targetUserId: string;
  adminUserId: string;
  amount: number;
  reason: string;
}) {
  const decAmount = toDecimal(params.amount);
  if (decAmount.isZero()) {
    throw new ExecutionError('Allocation amount cannot be zero.');
  }

  return await prisma.$transaction(async (tx) => {
    let account = await tx.virtualAccount.findUnique({
      where: { userId: params.targetUserId },
    });

    if (!account) {
      account = await tx.virtualAccount.create({
        data: {
          userId: params.targetUserId,
          balance: new Decimal(0),
        },
      });
    }

    const balanceBefore = toDecimal(account.balance);
    const balanceAfter = balanceBefore.plus(decAmount);

    if (balanceAfter.isNegative()) {
      throw new ExecutionError(`Adjustment would result in negative virtual balance (Current: ₹${roundMoney(balanceBefore)}, Requested: ₹${roundMoney(decAmount)}).`);
    }

    await tx.virtualAccount.update({
      where: { id: account.id },
      data: { balance: balanceAfter },
    });

    const txRecord = await tx.fundTransaction.create({
      data: {
        virtualAccountId: account.id,
        userId: params.targetUserId,
        type: decAmount.isPositive() ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        amount: decAmount.abs(),
        balanceBefore,
        balanceAfter,
        reason: params.reason,
        createdBy: params.adminUserId,
      },
    });

    await logAudit({
      userId: params.adminUserId,
      action: 'ADMIN_FUND_ALLOCATION',
      entity: 'VIRTUAL_ACCOUNT',
      entityId: account.id,
      details: {
        targetUserId: params.targetUserId,
        amount: roundMoney(decAmount),
        balanceBefore: roundMoney(balanceBefore),
        balanceAfter: roundMoney(balanceAfter),
        reason: params.reason,
      },
    });

    return txRecord;
  });
}

export async function resetAdminBalance(params: {
  targetUserId: string;
  adminUserId: string;
  targetBalance: number;
  reason: string;
}) {
  const targetBalance = toDecimal(params.targetBalance);
  if (!targetBalance.isFinite() || targetBalance.isNegative()) {
    throw new ExecutionError('The reset balance must be a valid non-negative amount.');
  }

  const result = await prisma.$transaction(async (tx) => {
    const targetUser = await tx.user.findUnique({
      where: { id: params.targetUserId },
      select: { id: true, username: true },
    });
    if (!targetUser) throw new ExecutionError('User not found.');

    let account = await tx.virtualAccount.findUnique({ where: { userId: params.targetUserId } });
    if (!account) {
      account = await tx.virtualAccount.create({
        data: { userId: params.targetUserId, balance: new Decimal(0) },
      });
    }

    const balanceBefore = toDecimal(account.balance);
    const reservedBalance = toDecimal(account.reservedBalance);
    if (targetBalance.lessThan(reservedBalance)) {
      throw new ExecutionError(
        `The balance cannot be lower than ₹${roundMoney(reservedBalance)} because open buy orders have reserved funds.`,
      );
    }
    const difference = targetBalance.minus(balanceBefore);
    if (difference.isZero()) {
      throw new ExecutionError('The account already has the requested balance.');
    }

    await tx.virtualAccount.update({
      where: { id: account.id },
      data: { balance: targetBalance },
    });
    const transaction = await tx.fundTransaction.create({
      data: {
        virtualAccountId: account.id,
        userId: params.targetUserId,
        type: difference.isPositive() ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        amount: difference.abs(),
        balanceBefore,
        balanceAfter: targetBalance,
        reason: `Admin reset by ${params.adminUserId}: ${params.reason}`,
        createdBy: params.adminUserId,
      },
    });

    return {
      transaction,
      balanceBefore: roundMoney(balanceBefore),
      balanceAfter: roundMoney(targetBalance),
      username: targetUser.username,
    };
  });

  await logAudit({
    userId: params.adminUserId,
    action: 'ADMIN_RESET_USER_BALANCE',
    entity: 'VIRTUAL_ACCOUNT',
    entityId: result.transaction.virtualAccountId,
    details: {
      targetUserId: params.targetUserId,
      targetUsername: result.username,
      balanceBefore: result.balanceBefore,
      balanceAfter: result.balanceAfter,
      reason: params.reason,
    },
  });

  return result;
}

export async function clearUserOrderHistory(params: {
  targetUserId: string;
  actorUserId: string;
  actorRole: 'ADMIN' | 'USER';
}) {
  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: params.targetUserId },
      select: { id: true },
    });
    if (!target) throw new ExecutionError('User not found.');

    const account = await tx.virtualAccount.findUnique({ where: { userId: params.targetUserId } });
    const reservedToRelease = account ? toDecimal(account.reservedBalance) : new Decimal(0);
    if (account && reservedToRelease.isPositive()) {
      await tx.virtualAccount.update({
        where: { id: account.id },
        data: { reservedBalance: new Decimal(0) },
      });
    }

    const deletedTrades = await tx.trade.count({ where: { userId: params.targetUserId } });
    const deletedOrders = await tx.order.deleteMany({ where: { userId: params.targetUserId } });
    return {
      deletedOrders: deletedOrders.count,
      deletedTrades,
      releasedReservedFunds: roundMoney(reservedToRelease),
    };
  });

  await logAudit({
    userId: params.actorUserId,
    action: params.actorRole === 'ADMIN' ? 'ADMIN_CLEAR_USER_ORDER_HISTORY' : 'USER_CLEAR_ORDER_HISTORY',
    entity: 'ORDER_HISTORY',
    entityId: params.targetUserId,
    details: result,
  });

  return result;
}

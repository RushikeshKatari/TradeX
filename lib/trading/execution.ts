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
        await tx.position.delete({
          where: { id: position.id },
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

  // Get virtual account
  const account = await prisma.virtualAccount.findUnique({
    where: { userId },
  });

  const cashBalance = account ? roundMoney(toDecimal(account.balance)) : 0;
  const reservedBalance = account ? roundMoney(toDecimal(account.reservedBalance)) : 0;

  // Get positions
  const rawPositions = await prisma.position.findMany({
    where: { userId },
  });

  let totalInvested = new Decimal(0);
  let totalCurrentValue = new Decimal(0);
  let totalUnrealizedPnL = new Decimal(0);
  let totalRealizedPnL = new Decimal(0);

  const positions: PositionView[] = [];
  const optionLotSizes: Record<string, number> = { NIFTY50: 75, BANKNIFTY: 30, SENSEX: 20, NIFTYIT: 25 };

  for (const pos of rawPositions) {
    const quote = await provider.getQuote(pos.symbol).catch(() => null);
    const currentPrice = quote ? quote.lastPrice : Number(pos.averageEntryPrice);

    const qty = new Decimal(pos.quantity);
    const avg = toDecimal(pos.averageEntryPrice);
    const cur = new Decimal(currentPrice);

    const invested = qty.times(avg);
    const curVal = qty.times(cur);
    const unPnl = curVal.minus(invested);
    const unPnlPct = invested.isZero() ? 0 : unPnl.dividedBy(invested).times(100).toNumber();
    const realPnl = toDecimal(pos.realizedPnL);

    totalInvested = totalInvested.plus(invested);
    totalCurrentValue = totalCurrentValue.plus(curVal);
    totalUnrealizedPnL = totalUnrealizedPnL.plus(unPnl);
    totalRealizedPnL = totalRealizedPnL.plus(realPnl);

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

  // Holdings
  const rawHoldings = await prisma.holding.findMany({
    where: { userId },
  });

  const holdings: HoldingView[] = [];
  for (const h of rawHoldings) {
    const quote = await provider.getQuote(h.symbol).catch(() => null);
    const currentPrice = quote ? quote.lastPrice : Number(h.averagePrice);

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

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding TradeX platform database...');

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@tradex.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'AdminSecurePassword123!';
  const adminPasswordHash = await bcrypt.hash(adminPassword, 10);

  // 1. Seed Admin
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash: adminPasswordHash },
    create: {
      email: adminEmail,
      username: 'admin',
      displayName: 'System Administrator',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      virtualAccount: {
        create: {
          balance: 5000000.00,
          currency: 'INR',
        },
      },
    },
    include: { virtualAccount: true },
  });

  if (admin.virtualAccount) {
    await prisma.fundTransaction.create({
      data: {
        virtualAccountId: admin.virtualAccount.id,
        userId: admin.id,
        type: 'INITIAL_ALLOCATION',
        amount: 5000000.00,
        balanceBefore: 0,
        balanceAfter: 5000000.00,
        reason: 'Initial administrator virtual capital provisioning',
        createdBy: 'SYSTEM_SEED',
      },
    });
  }
  console.log(`Admin account initialized: ${admin.email}`);

  // 2. Seed Demo User
  const demoEmail = 'user@tradex.local';
  const demoPassword = 'UserSecurePassword123!';
  const demoHash = await bcrypt.hash(demoPassword, 10);

  const demoUser = await prisma.user.upsert({
    where: { email: demoEmail },
    update: { passwordHash: demoHash },
    create: {
      email: demoEmail,
      username: 'demotrader',
      displayName: 'Aarav Sharma (Paper Trader)',
      passwordHash: demoHash,
      role: 'USER',
      status: 'ACTIVE',
      virtualAccount: {
        create: {
          balance: 1000000.00,
          currency: 'INR',
        },
      },
    },
    include: { virtualAccount: true },
  });

  if (demoUser.virtualAccount) {
    await prisma.fundTransaction.create({
      data: {
        virtualAccountId: demoUser.virtualAccount.id,
        userId: demoUser.id,
        type: 'INITIAL_ALLOCATION',
        amount: 1000000.00,
        balanceBefore: 0,
        balanceAfter: 1000000.00,
        reason: 'Standard paper trading onboarding allocation',
        createdBy: 'SYSTEM_SEED',
      },
    });
  }
  console.log(`Demo trader initialized: ${demoUser.email}`);

  // 3. Seed Standard Indian Instruments
  const instruments = [
    { symbol: 'NIFTY50', name: 'NIFTY 50 Index', exchange: 'NSE', type: 'INDEX' as const, lotSize: 75 },
    { symbol: 'SENSEX', name: 'BSE SENSEX Index', exchange: 'BSE', type: 'INDEX' as const, lotSize: 20 },
    { symbol: 'BANKNIFTY', name: 'NIFTY Bank Index', exchange: 'NSE', type: 'INDEX' as const, lotSize: 30 },
    { symbol: 'NIFTYIT', name: 'NIFTY IT Index', exchange: 'NSE', type: 'INDEX' as const, lotSize: 25 },
    { symbol: 'RELIANCE', name: 'Reliance Industries Ltd.', exchange: 'NSE', type: 'EQUITY' as const, lotSize: 1 },
    { symbol: 'TCS', name: 'Tata Consultancy Services Ltd.', exchange: 'NSE', type: 'EQUITY' as const, lotSize: 1 },
    { symbol: 'INFY', name: 'Infosys Ltd.', exchange: 'NSE', type: 'EQUITY' as const, lotSize: 1 },
    { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd.', exchange: 'NSE', type: 'EQUITY' as const, lotSize: 1 },
    { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd.', exchange: 'NSE', type: 'EQUITY' as const, lotSize: 1 },
    { symbol: 'SBIN', name: 'State Bank of India', exchange: 'NSE', type: 'EQUITY' as const, lotSize: 1 },
    { symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd.', exchange: 'NSE', type: 'EQUITY' as const, lotSize: 1 },
    { symbol: 'ITC', name: 'ITC Ltd.', exchange: 'NSE', type: 'EQUITY' as const, lotSize: 1 },
    { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank Ltd.', exchange: 'NSE', type: 'EQUITY' as const, lotSize: 1 },
    { symbol: 'LT', name: 'Larsen & Toubro Ltd.', exchange: 'NSE', type: 'EQUITY' as const, lotSize: 1 },
  ];

  for (const inst of instruments) {
    await prisma.instrument.upsert({
      where: { symbol: inst.symbol },
      update: { name: inst.name, exchange: inst.exchange, lotSize: inst.lotSize },
      create: {
        symbol: inst.symbol,
        name: inst.name,
        exchange: inst.exchange,
        instrumentType: inst.type,
        lotSize: inst.lotSize,
      },
    });
  }
  console.log(`Seeded ${instruments.length} standard Indian market instruments.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import type { Metadata } from 'next';
import './globals.css';
import { DisclaimerBanner } from '@/components/ui/disclaimer-banner';

export const metadata: Metadata = {
  title: 'TradeX — Indian Market Paper Trading & Technical Analysis Terminal',
  description: 'Simulated educational paper trading and deterministic technical analysis platform for Indian markets (NSE / BSE).',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#090d16] text-slate-100 antialiased flex flex-col">
        <DisclaimerBanner />
        <div className="flex-1 flex flex-col">{children}</div>
      </body>
    </html>
  );
}

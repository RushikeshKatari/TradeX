import { MarketStatus, MarketSessionStatus } from '@/types/market';

// Standard NSE / BSE holidays (2025 - 2026 reference)
const NSE_HOLIDAYS_YYYY_MM_DD = new Set([
  '2025-01-26', // Republic Day
  '2025-02-26', // Mahashivratri
  '2025-03-14', // Holi
  '2025-03-31', // Id-Ul-Fitr
  '2025-04-10', // Mahavir Jayanti
  '2025-04-14', // Dr. Ambedkar Jayanti
  '2025-04-18', // Good Friday
  '2025-05-01', // Maharashtra Day
  '2025-08-15', // Independence Day
  '2025-08-27', // Ganesh Chaturthi
  '2025-10-02', // Mahatma Gandhi Jayanti
  '2025-10-21', // Diwali Laxmi Pujan
  '2025-10-22', // Diwali Balipratipada
  '2025-11-05', // Gurunanak Jayanti
  '2025-12-25', // Christmas
  '2026-01-26', // Republic Day
  '2026-03-04', // Holi
  '2026-03-20', // Id-Ul-Fitr
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-08-15', // Independence Day
  '2026-10-02', // Mahatma Gandhi Jayanti
  '2026-11-08', // Diwali Laxmi Pujan
  '2026-12-25', // Christmas
]);

export function getIndianMarketStatus(customDate?: Date): MarketStatus {
  const now = customDate || new Date();
  
  // Format current date & time in Asia/Kolkata
  const kolkataDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
  const kolkataTimeStr = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false }); // HH:MM:SS
  
  const [hourStr, minuteStr] = kolkataTimeStr.split(':');
  const currentMinutes = parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10);
  
  // Determine Day of week in Asia/Kolkata
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(now);
  const isWeekend = dayName === 'Sat' || dayName === 'Sun';
  const isHoliday = NSE_HOLIDAYS_YYYY_MM_DD.has(kolkataDateStr);

  const marketOpenMinutes = 9 * 60 + 15; // 09:15 AM IST
  const marketCloseMinutes = 15 * 60 + 30; // 03:30 PM IST
  const preOpenStartMinutes = 9 * 60; // 09:00 AM IST

  let status: MarketSessionStatus = 'CLOSED';
  let isOpen = false;
  let message = 'Market is closed';

  if (isWeekend) {
    status = 'CLOSED';
    message = 'Market closed for weekend';
  } else if (isHoliday) {
    status = 'HOLIDAY';
    message = 'Market closed for exchange holiday';
  } else if (currentMinutes >= marketOpenMinutes && currentMinutes < marketCloseMinutes) {
    status = 'OPEN';
    isOpen = true;
    message = 'Market is open (Trading Session)';
  } else if (currentMinutes >= preOpenStartMinutes && currentMinutes < marketOpenMinutes) {
    status = 'PRE_OPEN';
    isOpen = false;
    message = 'Pre-open session';
  } else {
    status = 'CLOSED';
    message = currentMinutes >= marketCloseMinutes ? 'Market closed for the day' : 'Market yet to open';
  }

  return {
    isOpen,
    status,
    message,
    nextOpen: '09:15 AM IST',
    nextClose: '03:30 PM IST',
    timezone: 'Asia/Kolkata',
    timestamp: now.toISOString(),
  };
}

export function isIndianTradingDay(customDate?: Date): boolean {
  const now = customDate || new Date();
  const date = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(now);
  return day !== 'Sat' && day !== 'Sun' && !NSE_HOLIDAYS_YYYY_MM_DD.has(date);
}

/** Expert Picks accepts paper entries through the 3:45 PM forced-exit time. */
export function isExpertPickEntryAllowed(customDate?: Date): boolean {
  const now = customDate || new Date();
  if (getIndianMarketStatus(now).isOpen) return true;
  if (!isIndianTradingDay(now)) return false;

  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  const [hours, minutes] = time.split(':').map(Number);
  const currentMinutes = hours * 60 + minutes;
  const lateEntryStartMinutes = 15 * 60 + 15;
  const forcedExitMinutes = 15 * 60 + 45;
  return currentMinutes >= lateEntryStartMinutes && currentMinutes < forcedExitMinutes;
}

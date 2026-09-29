import { runScheduledExpertPickAutoExits } from './exit-service';

const SCHEDULER_INTERVAL_MS = 5_000;

type SchedulerGlobal = typeof globalThis & {
  __tradexExpertPickExitScheduler?: NodeJS.Timeout;
  __tradexExpertPickExitInProgress?: boolean;
};

const schedulerGlobal = globalThis as SchedulerGlobal;

/** Start one in-process worker that evaluates automatic exits for all users. */
export function startExpertPickExitScheduler(): void {
  if (schedulerGlobal.__tradexExpertPickExitScheduler) return;

  const tick = async () => {
    if (schedulerGlobal.__tradexExpertPickExitInProgress) return;
    schedulerGlobal.__tradexExpertPickExitInProgress = true;
    try {
      await runScheduledExpertPickAutoExits();
    } catch (error) {
      console.error('[EXPERT_PICK_EXIT_SCHEDULER_ERROR]', error);
    } finally {
      schedulerGlobal.__tradexExpertPickExitInProgress = false;
    }
  };

  const timer = setInterval(() => void tick(), SCHEDULER_INTERVAL_MS);
  timer.unref?.();
  schedulerGlobal.__tradexExpertPickExitScheduler = timer;
  void tick();
}

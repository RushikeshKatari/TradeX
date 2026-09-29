export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startExpertPickExitScheduler } = await import('./lib/expert-picks/exit-scheduler');
  startExpertPickExitScheduler();
}

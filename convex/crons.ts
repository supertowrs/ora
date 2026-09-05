import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
crons.interval('Process employee schedules', { minutes: 1 }, internal.schedules.tick, {});
export default crons;

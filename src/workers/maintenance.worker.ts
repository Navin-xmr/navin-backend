import { Worker, Job, Queue } from 'bullmq';
import { getBullMQConnection } from '../infra/redis/connection.js';
import { logger } from '../shared/logger/logger.js';
import { Anomaly } from '../modules/anomaly/anomaly.model.js';

// Configuration for maintenance jobs
export interface MaintenanceJobData {
  jobType: 'cleanup_resolved_anomalies';
  retentionDays?: number;
}

const RETENTION_DAYS = 90; // Default retention period for resolved anomalies

/**
 * Cleans up resolved anomalies older than the specified retention period
 * This prevents database bloat over time while preserving recent data
 */
async function cleanupResolvedAnomalies(retentionDays: number = RETENTION_DAYS): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  logger.info({ cutoffDate, retentionDays }, 'Starting cleanup of resolved anomalies');

  try {
    const result = await Anomaly.deleteMany({
      resolved: true,
      updatedAt: { $lt: cutoffDate },
    });

    logger.info(
      { deletedCount: result.deletedCount, cutoffDate },
      'Completed cleanup of resolved anomalies'
    );

    if (result.deletedCount > 0) {
      logger.debug(
        { deletedCount: result.deletedCount },
        'Successfully cleaned up old resolved anomalies'
      );
    }
  } catch (error) {
    logger.error({ error, cutoffDate }, 'Error during anomaly cleanup');
    throw error;
  }
}

/**
 * Main worker processor for maintenance jobs
 */
async function processMaintenance(job: Job<MaintenanceJobData>): Promise<void> {
  const { jobType, retentionDays = RETENTION_DAYS } = job.data;

  logger.info({ jobId: job.id, jobType }, 'Processing maintenance job');

  switch (jobType) {
    case 'cleanup_resolved_anomalies':
      await cleanupResolvedAnomalies(retentionDays);
      break;
    default:
      logger.warn({ jobType }, 'Unknown maintenance job type');
      throw new Error(`Unknown maintenance job type: ${jobType}`);
  }

  logger.info({ jobId: job.id, jobType }, 'Maintenance job completed successfully');
}

/**
 * Starts the maintenance worker with scheduled tasks
 * The worker processes recurring maintenance jobs from the BullMQ queue
 */
export function startMaintenanceWorker(): Worker<MaintenanceJobData> {
  const worker = new Worker<MaintenanceJobData>('maintenance_queue', processMaintenance, {
    connection: getBullMQConnection(),
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, jobType: job?.data?.jobType, err },
      'Maintenance worker job failed'
    );
  });

  worker.on('completed', job => {
    logger.debug({ jobId: job.id, jobType: job.data?.jobType }, 'Maintenance job completed');
  });

  logger.info('Maintenance worker started');

  return worker;
}

/**
 * Schedules recurring maintenance jobs
 * This should be called once during application startup
 */
export async function scheduleMaintenanceJobs(): Promise<void> {
  try {
    const queue = new Queue('maintenance_queue', {
      connection: getBullMQConnection(),
    });

    // Schedule daily cleanup job at 2 AM UTC (can be configured)
    const dailyCleanupJob = await queue.add(
      'cleanup_resolved_anomalies',
      {
        jobType: 'cleanup_resolved_anomalies',
        retentionDays: RETENTION_DAYS,
      },
      {
        repeat: {
          pattern: '0 2 * * *', // 2 AM UTC daily
        },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    logger.info(
      { jobId: dailyCleanupJob.id, pattern: '0 2 * * *' },
      'Scheduled daily maintenance cleanup job'
    );

    await queue.close();
  } catch (error) {
    logger.error({ error }, 'Failed to schedule maintenance jobs');
    throw error;
  }
}

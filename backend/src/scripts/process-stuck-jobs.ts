import { Queue } from 'bullmq';
import redisConfig from '../config/redis';
import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

const emailQueue = new Queue('email-queue', {
  connection: redisConfig,
});

async function processStuckJobs() {
  console.log('🔧 Processing stuck jobs...\n');

  // Find scheduled jobs that are past due
  const stuckJobs: any = await query(`
    SELECT * FROM email_jobs 
    WHERE status = 'scheduled' 
    AND scheduled_time <= NOW()
    ORDER BY scheduled_time ASC
  `);

  console.log(`Found ${stuckJobs.length} stuck jobs\n`);

  if (stuckJobs.length === 0) {
    console.log('✅ No stuck jobs to process');
    await emailQueue.close();
    process.exit(0);
    return;
  }

  for (const job of stuckJobs) {
    console.log(`Processing: ${job.job_id} - ${job.recipient_email}`);
    
    try {
      // Remove old job if exists
      try {
        const oldJob = await emailQueue.getJob(job.job_id);
        if (oldJob) {
          await oldJob.remove();
          console.log(`  ♻️  Removed old queue job`);
        }
      } catch (e) {
        // Job doesn't exist in queue, that's fine
      }

      // Add job to queue with no delay (send immediately)
      await emailQueue.add(
        'send-email',
        {
          jobId: job.job_id,
          userId: job.user_id,
          recipientEmail: job.recipient_email,
          subject: job.subject,
          body: job.body,
          scheduledTime: job.scheduled_time,
        },
        {
          jobId: job.job_id,
          delay: 0, // Send immediately
        }
      );

      console.log(`  ✅ Re-queued for immediate processing`);
    } catch (error: any) {
      console.error(`  ❌ Error processing job: ${error.message}`);
    }
  }

  console.log(`\n✅ Processed ${stuckJobs.length} stuck jobs`);
  console.log('💡 Make sure the worker is running to process these jobs');

  await emailQueue.close();
  process.exit(0);
}

processStuckJobs().catch(console.error);

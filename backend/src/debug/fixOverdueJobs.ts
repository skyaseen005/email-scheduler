import { Queue } from 'bullmq';
import redisConfig from '../config/redis';
import { query } from '../config/database';
import { EmailJob } from '../types';

const emailQueue = new Queue('email-queue', {
  connection: redisConfig,
});

async function fixOverdueJobs() {
  console.log('\n' + '='.repeat(70));
  console.log('🔧 Fixing Overdue Jobs');
  console.log('='.repeat(70) + '\n');

  try {
    // Find all jobs that should have been sent but are still "scheduled"
    const overdueJobs = await query(`
      SELECT *
      FROM email_jobs
      WHERE status = 'scheduled'
      AND scheduled_time < NOW()
      ORDER BY scheduled_time ASC
    `) as EmailJob[];

    console.log(`Found ${overdueJobs.length} overdue jobs\n`);

    if (overdueJobs.length === 0) {
      console.log('✅ No overdue jobs found!');
      await emailQueue.close();
      process.exit(0);
      return;
    }

    // Re-add each job to the queue with immediate processing
    for (const job of overdueJobs) {
      console.log(`📤 Re-queueing job ${job.job_id}`);
      console.log(`   Recipient: ${job.recipient_email}`);
      console.log(`   Was scheduled for: ${job.scheduled_time}`);
      
      // Check if job already exists in BullMQ
      const existingJob = await emailQueue.getJob(job.job_id);
      
      if (existingJob) {
        console.log(`   ⚠️  Job already in queue, skipping...`);
      } else {
        // Add to queue with no delay (process immediately)
        await emailQueue.add(
          'send-email',
          {
            jobId: job.job_id,
            userId: job.user_id,
            recipientEmail: job.recipient_email,
            subject: job.subject,
            body: job.body,
            scheduledTime: new Date().toISOString(), // Set to now
          },
          {
            jobId: job.job_id,
            delay: 0, // Process immediately
          }
        );
        console.log(`   ✅ Re-queued successfully\n`);
      }
    }

    console.log(`\n✅ Finished processing ${overdueJobs.length} overdue jobs`);
    console.log('💡 The worker should process these shortly\n');

  } catch (error) {
    console.error('❌ Error:', error);
  }

  console.log('='.repeat(70) + '\n');
  await emailQueue.close();
  process.exit(0);
}

fixOverdueJobs();

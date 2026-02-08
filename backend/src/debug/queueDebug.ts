import { Queue } from 'bullmq';
import redisConfig from '../config/redis';
import { query } from '../config/database';

const emailQueue = new Queue('email-queue', {
  connection: redisConfig,
});

async function debugQueue() {
  console.log('\n' + '='.repeat(70));
  console.log('🔍 Email Queue Debug Information');
  console.log('='.repeat(70) + '\n');

  try {
    // Get queue counts
    const counts = await emailQueue.getJobCounts();
    console.log('📊 Queue Counts:');
    console.log(`   - Waiting: ${counts.waiting}`);
    console.log(`   - Active: ${counts.active}`);
    console.log(`   - Completed: ${counts.completed}`);
    console.log(`   - Failed: ${counts.failed}`);
    console.log(`   - Delayed: ${counts.delayed}`);
    console.log(`   - Paused: ${counts.paused}\n`);

    // Get waiting jobs
    const waitingJobs = await emailQueue.getWaiting();
    console.log(`⏳ Waiting Jobs (${waitingJobs.length}):`);
    for (const job of waitingJobs.slice(0, 5)) {
      console.log(`   - Job ${job.id}: ${job.data.recipientEmail}`);
      console.log(`     Subject: ${job.data.subject}`);
      console.log(`     Scheduled: ${job.data.scheduledTime}\n`);
    }

    // Get delayed jobs
    const delayedJobs = await emailQueue.getDelayed();
    console.log(`⏰ Delayed Jobs (${delayedJobs.length}):`);
    for (const job of delayedJobs.slice(0, 5)) {
      const delay = job.opts.delay || 0;
      const scheduledDate = new Date(Date.now() + delay);
      console.log(`   - Job ${job.id}: ${job.data.recipientEmail}`);
      console.log(`     Subject: ${job.data.subject}`);
      console.log(`     Will run at: ${scheduledDate.toISOString()}`);
      console.log(`     Delay: ${Math.round(delay / 1000)}s\n`);
    }

    // Get active jobs
    const activeJobs = await emailQueue.getActive();
    console.log(`▶️  Active Jobs (${activeJobs.length}):`);
    for (const job of activeJobs) {
      console.log(`   - Job ${job.id}: ${job.data.recipientEmail}`);
      console.log(`     Subject: ${job.data.subject}\n`);
    }

    // Get database stats
    const dbStats: any = await query(`
      SELECT 
        status,
        COUNT(*) as count,
        MIN(scheduled_time) as earliest,
        MAX(scheduled_time) as latest
      FROM email_jobs
      GROUP BY status
    `);

    console.log('💾 Database Stats:');
    for (const stat of dbStats) {
      console.log(`   - ${stat.status}: ${stat.count} emails`);
      if (stat.earliest) {
        console.log(`     Earliest: ${stat.earliest}`);
        console.log(`     Latest: ${stat.latest}`);
      }
    }

    // Check upcoming jobs
    const upcomingJobs: any = await query(`
      SELECT 
        job_id,
        recipient_email,
        subject,
        scheduled_time,
        status
      FROM email_jobs
      WHERE status = 'scheduled'
      AND scheduled_time >= NOW()
      ORDER BY scheduled_time ASC
      LIMIT 10
    `);

    console.log(`\n📅 Next 10 Upcoming Jobs:`);
    for (const job of upcomingJobs) {
      const timeUntil = new Date(job.scheduled_time).getTime() - Date.now();
      const minutesUntil = Math.round(timeUntil / 1000 / 60);
      console.log(`   - ${job.recipient_email}`);
      console.log(`     Subject: ${job.subject}`);
      console.log(`     Scheduled: ${job.scheduled_time}`);
      console.log(`     In ${minutesUntil} minutes\n`);
    }

    // Check for jobs that should have been sent but weren't
    const overdueJobs: any = await query(`
      SELECT COUNT(*) as count
      FROM email_jobs
      WHERE status = 'scheduled'
      AND scheduled_time < NOW()
    `);

    if (overdueJobs[0].count > 0) {
      console.log(`⚠️  WARNING: ${overdueJobs[0].count} jobs are overdue!\n`);
      
      const overdue: any = await query(`
        SELECT 
          job_id,
          recipient_email,
          subject,
          scheduled_time
        FROM email_jobs
        WHERE status = 'scheduled'
        AND scheduled_time < NOW()
        ORDER BY scheduled_time ASC
        LIMIT 10
      `);
      
      console.log('   Overdue Jobs:');
      for (const job of overdue) {
        console.log(`   - ${job.recipient_email}`);
        console.log(`     Scheduled: ${job.scheduled_time}`);
        console.log(`     Job ID: ${job.job_id}\n`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }

  console.log('='.repeat(70) + '\n');
  await emailQueue.close();
  process.exit(0);
}

debugQueue();

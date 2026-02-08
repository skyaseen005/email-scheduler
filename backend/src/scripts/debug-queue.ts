import { Queue } from 'bullmq';
import redisConfig from '../config/redis';
import { query } from '../config/database';

const emailQueue = new Queue('email-queue', {
  connection: redisConfig,
});

async function debugQueue() {
  console.log('🔍 Debugging Email Queue...\n');

  // Check queue counts
  const counts = await emailQueue.getJobCounts();
  console.log('📊 Queue Status:');
  console.log(`   Waiting: ${counts.waiting}`);
  console.log(`   Active: ${counts.active}`);
  console.log(`   Completed: ${counts.completed}`);
  console.log(`   Failed: ${counts.failed}`);
  console.log(`   Delayed: ${counts.delayed}\n`);

  // Check delayed jobs
  const delayedJobs = await emailQueue.getDelayed(0, 100);
  console.log(`⏰ Delayed Jobs (${delayedJobs.length}):`);
  
  for (const job of delayedJobs) {
    const delay = job.opts.delay || 0;
    const scheduledTime = new Date(job.timestamp + delay);
    const now = new Date();
    const isPastDue = scheduledTime < now;
    
    console.log(`   Job ${job.id}:`);
    console.log(`      Recipient: ${job.data.recipientEmail}`);
    console.log(`      Scheduled: ${scheduledTime.toISOString()}`);
    console.log(`      Current: ${now.toISOString()}`);
    console.log(`      Status: ${isPastDue ? '❌ PAST DUE' : '✅ On schedule'}`);
    
    if (isPastDue) {
      console.log(`      ⚠️  This job should have run already!`);
    }
  }

  // Check database status
  console.log('\n📊 Database Status:');
  const dbStats: any = await query(`
    SELECT status, COUNT(*) as count 
    FROM email_jobs 
    GROUP BY status
  `);
  
  for (const stat of dbStats) {
    console.log(`   ${stat.status}: ${stat.count}`);
  }

  // Check for scheduled jobs that should be sent
  console.log('\n⚠️  Checking for overdue jobs in database:');
  const overdueJobs: any = await query(`
    SELECT job_id, recipient_email, scheduled_time 
    FROM email_jobs 
    WHERE status = 'scheduled' 
    AND scheduled_time < NOW()
    ORDER BY scheduled_time ASC
    LIMIT 10
  `);

  if (overdueJobs.length > 0) {
    console.log(`   Found ${overdueJobs.length} overdue jobs:`);
    for (const job of overdueJobs) {
      console.log(`      ${job.job_id} - ${job.recipient_email} (${job.scheduled_time})`);
    }
  } else {
    console.log('   ✅ No overdue jobs found');
  }

  await emailQueue.close();
  process.exit(0);
}

debugQueue().catch(console.error);

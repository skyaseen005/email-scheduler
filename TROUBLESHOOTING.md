# 🔧 Troubleshooting Guide - Emails Not Sending

## Quick Fix Commands

```bash
# 1. Check if worker is running
ps aux | grep emailWorker

# 2. Check queue status
cd backend
npm run debug:queue

# 3. Fix overdue jobs
npm run fix:overdue

# 4. Restart worker
# Terminal with worker: Ctrl+C
npm run worker
```

## Issue: Emails Stay in "Scheduled" Status

### ✅ Solution Steps

**Step 1: Verify Worker is Running**
```bash
# You should have a terminal running:
cd backend
npm run worker

# Look for output:
🚀 Email Worker Started
👀 Watching for jobs in queue...
```

**Step 2: Check Queue Status**
```bash
cd backend
npm run debug:queue
```

This shows you:
- How many jobs are waiting/delayed/active
- Next 10 upcoming jobs with times
- **⚠️ Any overdue jobs that should have sent**

**Step 3: Fix Overdue Jobs**

If debug shows overdue jobs, run:
```bash
npm run fix:overdue
```

This re-queues all overdue jobs to send immediately.

**Step 4: Check Worker Logs**

When a job processes, you should see:
```
============================================================
🔄 Processing job abc-123
📧 Recipient: user@example.com
📋 Subject: Test Email
⏰ Scheduled for: 2026-02-07T00:00:00Z
🕐 Current time: 2026-02-07T00:01:00Z
============================================================

📤 Sending email to user@example.com...
✅ Email sent successfully!
📧 Message ID: <...>
🔗 Preview URL: https://ethereal.email/message/...
```

If you don't see this, the worker isn't processing jobs.

## Common Causes

### 1. Worker Not Running

**Symptom:** Jobs stay scheduled forever

**Check:**
```bash
ps aux | grep "emailWorker"
```

**Fix:**
```bash
cd backend
npm run worker
```

### 2. Redis Not Running

**Symptom:** Worker crashes or can't connect

**Check:**
```bash
docker ps | grep redis
```

**Fix:**
```bash
docker-compose restart redis
```

### 3. Wrong Scheduled Time

**Symptom:** Jobs scheduled but never process

**Check:**
```bash
# Check database times
docker exec -it email-scheduler-mysql mysql -uroot -ppassword123 email_scheduler

SELECT 
  recipient_email,
  subject,
  scheduled_time,
  NOW() as current_time,
  TIMESTAMPDIFF(MINUTE, NOW(), scheduled_time) as minutes_until
FROM email_jobs 
WHERE status = 'scheduled'
ORDER BY scheduled_time
LIMIT 10;
```

If `minutes_until` is negative, jobs are overdue. Run `npm run fix:overdue`.

### 4. Time Zone Mismatch

**Symptom:** Jobs process at wrong time

**Check System Time:**
```bash
date  # Current system time
```

**Check Database Time:**
```sql
SELECT NOW();
```

Both should match. If not, times in database might be in different timezone.

### 5. BullMQ Queue Stuck

**Symptom:** debug:queue shows delayed jobs not moving to active

**Check:**
```bash
npm run debug:queue

# Look for:
⏰ Delayed Jobs (50):
   - Job xxx: email@example.com
     Will run at: 2026-02-06T23:00:00Z  # In the past!
```

**Fix:**
```bash
npm run fix:overdue
```

## Detailed Debugging

### Check Redis Keys

```bash
docker exec -it email-scheduler-redis redis-cli

# List all keys
KEYS *

# Check a specific job
HGETALL bull:email-queue:job_id_here

# Check delayed queue
ZRANGE bull:email-queue:delayed 0 -1 WITHSCORES
```

### Check MySQL Data

```bash
docker exec -it email-scheduler-mysql mysql -uroot -ppassword123 email_scheduler

# See all scheduled jobs
SELECT * FROM email_jobs WHERE status = 'scheduled';

# See jobs that should have been sent
SELECT * FROM email_jobs 
WHERE status = 'scheduled' 
AND scheduled_time < NOW();

# Update a stuck job manually (last resort)
UPDATE email_jobs 
SET status = 'failed', error_message = 'Manually failed - stuck job' 
WHERE job_id = 'job-id-here';
```

### Enable Verbose Worker Logging

The improved worker now logs extensively. When processing a job you'll see:

```
============================================================
🔄 Processing job 550e8400-e29b-41d4-a716-446655440000
📧 Recipient: test@example.com
📋 Subject: Test Email
⏰ Scheduled for: 2026-02-07T01:30:00.000Z
🕐 Current time: 2026-02-07T01:25:00.000Z
============================================================

⏳ Too early! Waiting 300s until scheduled time...
```

This means the worker picked up the job and is waiting for the right time.

After waiting:
```
✅ Wait complete, proceeding to send...
⏱️  Applying 2000ms throttle delay...
📤 Sending email to test@example.com...
✅ Email sent successfully!
📧 Message ID: <...>
🔗 Preview URL: https://ethereal.email/message/...
============================================================
```

### Manual Job Trigger (For Testing)

```bash
# Connect to Redis
docker exec -it email-scheduler-redis redis-cli

# Move a delayed job to waiting (processes immediately)
# First, find the job ID from debug:queue
# Then:
ZADD bull:email-queue:wait 0 "job_id_here"
ZREM bull:email-queue:delayed "job_id_here"
```

## Prevention

### 1. Keep Worker Running

Use a process manager:
```bash
# Option 1: tmux
tmux new -s email-worker
cd backend && npm run worker
# Detach: Ctrl+B then D
# Reattach: tmux attach -t email-worker

# Option 2: PM2 (production)
npm install -g pm2
pm2 start "npm run worker" --name email-worker
pm2 logs email-worker
```

### 2. Monitor Queue Health

Add to your crontab:
```bash
# Check every 5 minutes
*/5 * * * * cd /path/to/backend && npm run debug:queue > /tmp/queue-status.log
```

### 3. Auto-fix Overdue Jobs

Add to crontab:
```bash
# Every 10 minutes, fix any overdue jobs
*/10 * * * * cd /path/to/backend && npm run fix:overdue
```

## Test End-to-End

```bash
# 1. Stop everything
Ctrl+C  # Stop worker
Ctrl+C  # Stop backend

# 2. Restart
cd backend
npm run dev     # Terminal 1
npm run worker  # Terminal 2

# 3. Schedule a test email
# Frontend: Compose email
# - Recipients: Upload sample-recipients.csv
# - Start Time: Current time + 2 minutes
# - Delay: 5000ms
# - Submit

# 4. Watch worker terminal
# After 2 minutes you should see:
🔄 Processing job ...
⏰ Scheduled for: [2 minutes from now]
📤 Sending email...
✅ Email sent successfully!

# 5. Check dashboard
# Email should move from "Scheduled" to "Sent"

# 6. Check Ethereal
# Go to https://ethereal.email/messages
# Login with your SMTP credentials
# See the sent email
```

## If Nothing Works

**Nuclear Option - Fresh Start:**

```bash
# ⚠️ This deletes all data!

# 1. Stop everything
docker-compose down -v

# 2. Delete node_modules
rm -rf backend/node_modules frontend/node_modules

# 3. Fresh install
docker-compose up -d
cd backend && npm install
npm run db:migrate

# 4. Start services
npm run dev     # Terminal 1
npm run worker  # Terminal 2

# 5. Test with one email scheduled for 1 minute from now
```

## Getting Help

When reporting issues, include:

1. Output of `npm run debug:queue`
2. Worker terminal logs
3. Backend terminal logs
4. MySQL query:
   ```sql
   SELECT * FROM email_jobs WHERE status = 'scheduled' LIMIT 5;
   ```
5. Redis check:
   ```bash
   docker exec -it email-scheduler-redis redis-cli KEYS "*"
   ```

---

**Most Common Fix:**

90% of the time, the issue is:
1. Worker not running → Run `npm run worker`
2. Jobs are delayed correctly → Just wait for scheduled time
3. Jobs are overdue → Run `npm run fix:overdue`

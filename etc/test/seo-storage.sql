-- Run after both migrations in a disposable schema within a rolled-back transaction.
DO $$
DECLARE owner_id uuid; other_id uuid; test_site_id uuid; job_id uuid; duplicate_count integer;
BEGIN
 INSERT INTO users(google_sub,email,is_admin) VALUES('seo-test','seo-test@example.invalid',true) RETURNING id INTO owner_id;
 INSERT INTO users(google_sub,email,is_admin) VALUES('seo-other','seo-other@example.invalid',true) RETURNING id INTO other_id;
 INSERT INTO seo_sites(user_id,site_url,config) VALUES(owner_id,'sc-domain:example.com','{"modules":{"audit":{"enabled":true,"weekly":false}},"keywords":[]}') RETURNING id INTO test_site_id;
 INSERT INTO seo_jobs(site_id,module,config) VALUES(test_site_id,'audit','{}') RETURNING id INTO job_id;
 INSERT INTO seo_jobs(site_id,module,config) VALUES(test_site_id,'audit','{}') ON CONFLICT DO NOTHING;
 SELECT count(*) INTO duplicate_count FROM seo_jobs WHERE seo_jobs.site_id=test_site_id;
 IF duplicate_count<>1 THEN RAISE EXCEPTION 'Active job deduplication failed'; END IF;
 IF EXISTS(SELECT 1 FROM seo_sites WHERE id=test_site_id AND user_id=other_id) THEN RAISE EXCEPTION 'Ownership scope failed'; END IF;
 UPDATE seo_jobs SET status='waiting_browser' WHERE id=job_id;
 UPDATE seo_jobs SET status='cancelled',completed_at=now() WHERE id=job_id;
 UPDATE seo_jobs SET status='succeeded',result='{"should_not_store":true}' WHERE id=job_id AND status='waiting_browser';
 IF EXISTS(SELECT 1 FROM seo_jobs WHERE id=job_id AND status<>'cancelled') THEN RAISE EXCEPTION 'Cancelled job accepted a late result'; END IF;
 INSERT INTO seo_jobs(site_id,module,config) VALUES(test_site_id,'audit','{}');
 INSERT INTO seo_schedules(site_id,module) VALUES(test_site_id,'audit');
 UPDATE seo_schedules SET next_run_at=now()+interval '7 days' WHERE seo_schedules.site_id=test_site_id;
 IF EXISTS(SELECT 1 FROM seo_schedules WHERE next_run_at<=now()) THEN RAISE EXCEPTION 'Schedule coalescing failed'; END IF;
END $$;

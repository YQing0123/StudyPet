
CREATE FUNCTION app.guard_qualified_exposure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'study exposure is retained; withdraw instead'; END IF;
 IF (to_jsonb(NEW)-'withdrawn_at') IS DISTINCT FROM (to_jsonb(OLD)-'withdrawn_at') THEN RAISE EXCEPTION 'exposure provenance is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER exposure_retained BEFORE UPDATE OR DELETE ON app.study_exposures FOR EACH ROW EXECUTE FUNCTION app.guard_qualified_exposure();

CREATE FUNCTION app.check_publish_dependencies() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE qa_column text; latest_fail boolean; has_schema_pass boolean;
BEGIN
 IF NEW.published_at IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.published_at IS NOT NULL THEN RETURN NEW; END IF;
 qa_column:=CASE TG_TABLE_NAME WHEN 'content_versions' THEN 'content_version_id' WHEN 'question_versions' THEN 'question_version_id' WHEN 'asset_packages' THEN 'asset_package_id' ELSE NULL END;
 IF qa_column IS NOT NULL THEN
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM app.quality_reports WHERE family_id=$1 AND %I=$2 AND check_kind=''schema'' AND verdict=''pass''), EXISTS(SELECT 1 FROM (SELECT DISTINCT ON(check_kind) verdict FROM app.quality_reports WHERE family_id=$1 AND %I=$2 ORDER BY check_kind,created_at DESC,id DESC) recent WHERE verdict=''fail'')',qa_column,qa_column)
   INTO has_schema_pass,latest_fail USING NEW.family_id,NEW.id;
   IF NOT has_schema_pass OR latest_fail THEN RAISE EXCEPTION 'publishing requires schema pass and no latest failing quality check'; END IF;
 END IF;
 IF TG_TABLE_NAME='question_versions' THEN
   IF NOT EXISTS(SELECT 1 FROM app.content_versions WHERE family_id=NEW.family_id AND id=NEW.content_version_id AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'source content must be published first'; END IF;
   IF NOT EXISTS(SELECT 1 FROM private.question_answers WHERE family_id=NEW.family_id AND question_version_id=NEW.id) THEN RAISE EXCEPTION 'question needs private answer/rubric'; END IF;
   IF NOT EXISTS(SELECT 1 FROM app.question_sources WHERE family_id=NEW.family_id AND question_version_id=NEW.id AND source_role='assessed') THEN RAISE EXCEPTION 'question needs assessed source'; END IF;
 ELSIF TG_TABLE_NAME='content_releases' THEN
   IF NOT EXISTS(SELECT 1 FROM app.content_versions WHERE family_id=NEW.family_id AND id=NEW.content_version_id AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'release requires published content'; END IF;
   IF NOT EXISTS(SELECT 1 FROM app.release_questions WHERE family_id=NEW.family_id AND content_release_id=NEW.id) THEN RAISE EXCEPTION 'release needs validated question set'; END IF;
   IF EXISTS(SELECT 1 FROM app.release_questions rq JOIN app.question_versions q ON q.family_id=rq.family_id AND q.id=rq.question_version_id WHERE rq.family_id=NEW.family_id AND rq.content_release_id=NEW.id AND (q.published_at IS NULL OR q.retired_at IS NOT NULL)) THEN RAISE EXCEPTION 'release references unpublished or retired question'; END IF;
 ELSIF TG_TABLE_NAME='plan_revisions' THEN
   IF NOT EXISTS(SELECT 1 FROM app.task_occurrences WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND plan_revision_id=NEW.id) AND NEW.planned_learning_days>0 THEN RAISE EXCEPTION 'learning plan requires compiled tasks'; END IF;
   IF EXISTS(SELECT 1 FROM app.task_occurrences t WHERE t.family_id=NEW.family_id AND t.child_id=NEW.child_id AND t.plan_revision_id=NEW.id AND t.is_required AND (NOT EXISTS(SELECT 1 FROM app.task_scopes WHERE family_id=t.family_id AND child_id=t.child_id AND task_occurrence_id=t.id AND scope_role<>'context') OR NOT EXISTS(SELECT 1 FROM app.task_requirements WHERE family_id=t.family_id AND child_id=t.child_id AND task_occurrence_id=t.id AND required))) THEN RAISE EXCEPTION 'required task needs scope and requirements'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER content_publish_dependencies BEFORE INSERT OR UPDATE OF published_at ON app.content_versions FOR EACH ROW EXECUTE FUNCTION app.check_publish_dependencies();
CREATE TRIGGER asset_publish_dependencies BEFORE INSERT OR UPDATE OF published_at ON app.asset_packages FOR EACH ROW EXECUTE FUNCTION app.check_publish_dependencies();
CREATE TRIGGER question_publish_dependencies BEFORE INSERT OR UPDATE OF published_at ON app.question_versions FOR EACH ROW EXECUTE FUNCTION app.check_publish_dependencies();
CREATE TRIGGER release_publish_dependencies BEFORE INSERT OR UPDATE OF published_at ON app.content_releases FOR EACH ROW EXECUTE FUNCTION app.check_publish_dependencies();
CREATE TRIGGER plan_publish_dependencies BEFORE INSERT OR UPDATE OF published_at ON app.plan_revisions FOR EACH ROW EXECUTE FUNCTION app.check_publish_dependencies();

CREATE FUNCTION app.check_task_plan_day() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE day_record app.learning_days%ROWTYPE; plan_record app.plan_revisions%ROWTYPE; week_record app.weekly_plans%ROWTYPE;
BEGIN
 SELECT * INTO STRICT day_record FROM app.learning_days WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.learning_day_id;
 SELECT * INTO STRICT plan_record FROM app.plan_revisions WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.plan_revision_id;
 SELECT * INTO STRICT week_record FROM app.weekly_plans WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=plan_record.weekly_plan_id;
 IF day_record.learning_date<week_record.week_start OR day_record.learning_date>week_record.week_start+6 THEN RAISE EXCEPTION 'task day outside plan week'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_week BEFORE INSERT OR UPDATE ON app.task_occurrences FOR EACH ROW EXECUTE FUNCTION app.check_task_plan_day();

CREATE FUNCTION app.check_session_day() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d app.learning_days%ROWTYPE; t app.task_occurrences%ROWTYPE; dev app.devices%ROWTYPE;
BEGIN
 SELECT * INTO STRICT d FROM app.learning_days WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.learning_day_id;
 SELECT * INTO STRICT dev FROM app.devices WHERE family_id=NEW.family_id AND id=NEW.device_id;
 IF dev.status<>'active' OR (dev.bound_child_id IS NOT NULL AND dev.bound_child_id<>NEW.child_id) THEN RAISE EXCEPTION 'session device not authorized for child'; END IF;
 IF NEW.task_occurrence_id IS NOT NULL THEN
   SELECT * INTO STRICT t FROM app.task_occurrences WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.task_occurrence_id;
   IF t.learning_day_id<>d.id THEN RAISE EXCEPTION 'session task/day mismatch'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-ARRAY['device_id','status','lease_epoch','lease_expires_at','revision','submitted_at','finished_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['device_id','status','lease_epoch','lease_expires_at','revision','submitted_at','finished_at','updated_at']) THEN RAISE EXCEPTION 'session frozen form identity cannot be changed'; END IF;
   IF NEW.lease_epoch<OLD.lease_epoch OR NEW.revision<=OLD.revision THEN RAISE EXCEPTION 'session revisions must advance'; END IF;
   IF NEW.device_id<>OLD.device_id AND NEW.lease_epoch<=OLD.lease_epoch THEN RAISE EXCEPTION 'device transfer requires new fencing epoch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER session_day BEFORE INSERT OR UPDATE ON app.challenge_sessions FOR EACH ROW EXECUTE FUNCTION app.check_session_day();

CREATE FUNCTION app.check_daily_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.learning_days WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.learning_day_id AND learning_date=NEW.learning_date) THEN RAISE EXCEPTION 'pet record learning date mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pet_record_day BEFORE INSERT OR UPDATE ON app.pet_daily_records FOR EACH ROW EXECUTE FUNCTION app.check_daily_record();

CREATE FUNCTION app.check_mastery_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.learning_evidence WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.last_evidence_id AND objective_id=NEW.objective_id AND skill=NEW.skill AND modality=NEW.modality) THEN RAISE EXCEPTION 'mastery last evidence must match objective/skill/modality'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mastery_provenance BEFORE INSERT OR UPDATE ON app.mastery_snapshots FOR EACH ROW EXECUTE FUNCTION app.check_mastery_provenance();

CREATE FUNCTION app.check_pairing_child() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM app.devices WHERE family_id=NEW.family_id AND id IN (NEW.display_device_id,NEW.companion_device_id) AND (status<>'active' OR (bound_child_id IS NOT NULL AND bound_child_id<>NEW.child_id))) THEN RAISE EXCEPTION 'pairing device revoked or bound to another child'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pairing_child BEFORE INSERT OR UPDATE ON app.device_pairings FOR EACH ROW EXECUTE FUNCTION app.check_pairing_child();

CREATE FUNCTION app.check_auth_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE device_child uuid;
BEGIN
 SELECT bound_child_id INTO device_child FROM app.devices WHERE family_id=NEW.family_id AND id=NEW.device_id;
 IF device_child IS NOT NULL AND NEW.child_id IS DISTINCT FROM device_child THEN RAISE EXCEPTION 'auth session cannot switch bound child'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER auth_child BEFORE INSERT OR UPDATE ON app.auth_sessions FOR EACH ROW EXECUTE FUNCTION app.check_auth_child();

-- Operational entities: bounded JSON configuration, relational ownership and one-way finalization.
CREATE FUNCTION app.guard_api_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.revision<=OLD.revision THEN
   RAISE EXCEPTION 'identity cannot change and API revision must advance';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION app.guard_content_issue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_family uuid; replacement_family uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'content issue audit is retained'; END IF;
 IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-ARRAY['status','resolved_by','resolved_at','replacement_question_version_id','resolution_note','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','resolved_by','resolved_at','replacement_question_version_id','resolution_note','revision','updated_at']) THEN
     RAISE EXCEPTION 'reported issue provenance is immutable';
   END IF;
   IF OLD.status IN ('resolved','dismissed') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'resolved issue is immutable'; END IF;
 END IF;
 IF NEW.replacement_question_version_id IS NOT NULL THEN
   SELECT question_family_id INTO STRICT source_family FROM app.question_versions WHERE family_id=NEW.family_id AND id=NEW.question_version_id;
   SELECT question_family_id INTO STRICT replacement_family FROM app.question_versions WHERE family_id=NEW.family_id AND id=NEW.replacement_question_version_id;
   IF source_family<>replacement_family THEN RAISE EXCEPTION 'issue replacement must stay within same question family/objective'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER content_issue_guard BEFORE INSERT OR UPDATE OR DELETE ON app.content_issues FOR EACH ROW EXECUTE FUNCTION app.guard_content_issue();

CREATE FUNCTION app.guard_ai_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cfg app.ai_provider_configs%ROWTYPE; allocated numeric; own_value bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'AI budget record retained; release unused reservation'; END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'reserved' THEN RAISE EXCEPTION 'AI budget must begin reserved'; END IF;
 ELSE
   IF (to_jsonb(NEW)-ARRAY['status','settled_microunits','resolved_at','provider_request_id','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','settled_microunits','resolved_at','provider_request_id','revision','updated_at']) THEN RAISE EXCEPTION 'AI reservation allocation is immutable'; END IF;
   IF OLD.status<>'reserved' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'AI reservation already finalized'; END IF;
 END IF;
 SELECT * INTO STRICT cfg FROM app.ai_provider_configs WHERE family_id=NEW.family_id AND id=NEW.ai_provider_config_id FOR UPDATE;
 IF TG_OP='INSERT' AND (cfg.status<>'active' OR cfg.revision<>NEW.provider_revision OR cfg.currency<>NEW.currency) THEN
   RAISE EXCEPTION 'AI configuration disabled, stale or currency mismatch';
 END IF;
 IF TG_OP='INSERT' THEN
   SELECT coalesce(sum(CASE WHEN status='reserved' THEN reserved_microunits WHEN status='settled' THEN settled_microunits ELSE 0 END),0)
     INTO allocated FROM app.ai_budget_reservations WHERE family_id=NEW.family_id AND ai_provider_config_id=NEW.ai_provider_config_id AND budget_date=NEW.budget_date;
   IF allocated+NEW.reserved_microunits>cfg.daily_budget_microunits THEN RAISE EXCEPTION 'AI daily budget exceeded'; END IF;
   IF (SELECT count(*) FROM app.ai_budget_reservations WHERE family_id=NEW.family_id AND ai_provider_config_id=NEW.ai_provider_config_id AND status='reserved')>=cfg.max_concurrent_calls THEN RAISE EXCEPTION 'AI maximum concurrent reservations reached'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_budget_guard BEFORE INSERT OR UPDATE OR DELETE ON app.ai_budget_reservations FOR EACH ROW EXECUTE FUNCTION app.guard_ai_budget();

CREATE FUNCTION app.guard_outbox_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'delivery audit retained'; END IF;
 IF NEW.outbox_event_id<>OLD.outbox_event_id OR NEW.consumer_key<>OLD.consumer_key OR NEW.max_attempts<>OLD.max_attempts THEN RAISE EXCEPTION 'delivery event, consumer and retry budget are immutable'; END IF;
 IF NEW.attempts<OLD.attempts THEN RAISE EXCEPTION 'delivery attempts cannot decrease'; END IF;
 IF OLD.status='delivered' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'acknowledged delivery is immutable'; END IF;
 IF NEW.status='inflight' AND OLD.status IN ('queued','dead') AND NEW.attempts<>OLD.attempts+1 THEN RAISE EXCEPTION 'delivery claim must increment attempts'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER delivery_guard BEFORE UPDATE OR DELETE ON app.outbox_deliveries FOR EACH ROW EXECUTE FUNCTION app.guard_outbox_delivery();

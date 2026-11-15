-- Database guards. Functions enforce relational invariants; application commands remain in API services.
CREATE FUNCTION app.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; write a compensating row instead', TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME USING ERRCODE='55000';
END $$;

CREATE FUNCTION app.guard_published_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed text[] := ARRAY['retired_at'];
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'published % cannot be deleted',TG_TABLE_NAME USING ERRCODE='55000';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.published_at IS NOT NULL AND (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed) THEN
    RAISE EXCEPTION 'published % payload is immutable',TG_TABLE_NAME USING ERRCODE='55000';
  END IF;
  IF OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
    RAISE EXCEPTION 'retirement is permanent; publish a new version';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION app.guard_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'definition rows are retained; retire instead'; END IF;
  IF (to_jsonb(NEW)-'retired_at') IS DISTINCT FROM (to_jsonb(OLD)-'retired_at') THEN
    RAISE EXCEPTION 'definition % is immutable; create a new identity',TG_TABLE_NAME;
  END IF;
  IF OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
    RAISE EXCEPTION 'retirement is permanent';
  END IF;
  RETURN NEW;
END $$;

-- Arg0 is a schema-qualified parent table, arg1 the local FK, arg2 optional mutable columns.
CREATE FUNCTION app.guard_published_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_old jsonb; row_new jsonb; v_family uuid; parent_id uuid; frozen boolean;
  allowed text[] := CASE WHEN TG_NARGS>2 AND TG_ARGV[2]<>'' THEN string_to_array(TG_ARGV[2],',') ELSE ARRAY[]::text[] END;
BEGIN
  IF TG_OP<>'INSERT' THEN
    row_old:=to_jsonb(OLD); v_family:=(row_old->>'family_id')::uuid; parent_id:=(row_old->>TG_ARGV[1])::uuid;
    EXECUTE format('SELECT published_at IS NOT NULL FROM %s WHERE family_id=$1 AND id=$2 FOR SHARE', TG_ARGV[0]::regclass)
      INTO frozen USING v_family,parent_id;
    IF frozen AND (TG_OP='DELETE' OR (to_jsonb(NEW)-allowed) IS DISTINCT FROM (row_old-allowed)) THEN
      RAISE EXCEPTION '% belongs to published %; payload is frozen',TG_TABLE_NAME,TG_ARGV[0] USING ERRCODE='55000';
    END IF;
  END IF;
  IF TG_OP<>'DELETE' THEN
    row_new:=to_jsonb(NEW);
    IF TG_OP='INSERT' OR row_new->>TG_ARGV[1] IS DISTINCT FROM row_old->>TG_ARGV[1] OR row_new->>'family_id' IS DISTINCT FROM row_old->>'family_id' THEN
      v_family:=(row_new->>'family_id')::uuid; parent_id:=(row_new->>TG_ARGV[1])::uuid;
      EXECUTE format('SELECT published_at IS NOT NULL FROM %s WHERE family_id=$1 AND id=$2 FOR SHARE',TG_ARGV[0]::regclass)
        INTO frozen USING v_family,parent_id;
      IF frozen THEN RAISE EXCEPTION 'cannot attach row to published %',TG_ARGV[0] USING ERRCODE='55000'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;

CREATE FUNCTION app.check_family_timezone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=NEW.timezone) THEN
    RAISE EXCEPTION 'invalid IANA timezone %',NEW.timezone USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER family_timezone BEFORE INSERT OR UPDATE OF timezone ON app.families FOR EACH ROW EXECUTE FUNCTION app.check_family_timezone();

CREATE FUNCTION app.guard_node_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  -- Serialize structural mutation within a content version, including concurrent opposite links.
  PERFORM 1 FROM app.content_versions WHERE family_id=NEW.family_id AND id=NEW.content_version_id FOR UPDATE;
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id,parent_id FROM app.content_nodes WHERE family_id=NEW.family_id AND content_version_id=NEW.content_version_id AND id=NEW.parent_id
      UNION
      SELECT n.id,n.parent_id FROM app.content_nodes n JOIN ancestors a ON n.id=a.parent_id
        WHERE n.family_id=NEW.family_id AND n.content_version_id=NEW.content_version_id
    ) SELECT 1 FROM ancestors WHERE id=NEW.id
  ) THEN RAISE EXCEPTION 'content node hierarchy cycle'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER node_cycle BEFORE INSERT OR UPDATE OF parent_id,content_version_id ON app.content_nodes FOR EACH ROW EXECUTE FUNCTION app.guard_node_cycle();

CREATE FUNCTION app.guard_tenant_and_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.family_id IS DISTINCT FROM OLD.family_id THEN
    RAISE EXCEPTION 'family ownership is immutable';
  END IF;
  IF TG_OP='UPDATE' AND to_jsonb(OLD)?'child_id' AND (to_jsonb(NEW)->'child_id') IS DISTINCT FROM (to_jsonb(OLD)->'child_id') THEN
    RAISE EXCEPTION 'child ownership is immutable';
  END IF;
  IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'UUID primary key is immutable'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION app.check_challenge_relation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sess app.challenge_sessions%ROWTYPE; req app.task_requirements%ROWTYPE;
BEGIN
  SELECT * INTO STRICT sess FROM app.challenge_sessions WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.challenge_session_id FOR KEY SHARE;
  IF NEW.task_requirement_id IS NOT NULL THEN
    SELECT * INTO STRICT req FROM app.task_requirements WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.task_requirement_id;
    IF req.task_occurrence_id IS DISTINCT FROM sess.task_occurrence_id OR req.objective_id<>NEW.objective_id THEN
      RAISE EXCEPTION 'challenge requirement does not belong to session task/objective';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'answer_exposed_at') IS DISTINCT FROM (to_jsonb(OLD)-'answer_exposed_at') THEN
    RAISE EXCEPTION 'challenge form payload is immutable; replace an unused session';
  END IF;
  IF TG_OP='INSERT' AND sess.status NOT IN ('created','active') THEN RAISE EXCEPTION 'cannot append items to finalized form'; END IF;
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM app.answer_attempts WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND challenge_session_id=sess.id) THEN
    RAISE EXCEPTION 'cannot append items after answers have started';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER challenge_item_relation BEFORE INSERT OR UPDATE ON app.challenge_items FOR EACH ROW EXECUTE FUNCTION app.check_challenge_relation();

CREATE FUNCTION app.check_attempt_lease() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sess app.challenge_sessions%ROWTYPE; dev app.devices%ROWTYPE;
BEGIN
  SELECT * INTO STRICT sess FROM app.challenge_sessions WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.challenge_session_id FOR UPDATE;
  SELECT * INTO STRICT dev FROM app.devices WHERE family_id=NEW.family_id AND id=NEW.device_id;
  IF dev.status<>'active' OR (dev.bound_child_id IS NOT NULL AND dev.bound_child_id<>NEW.child_id) THEN
    RAISE EXCEPTION 'device is revoked or bound to another child';
  END IF;
  IF sess.device_id<>NEW.device_id OR sess.lease_epoch<>NEW.lease_epoch OR NOT (sess.status IN ('created','active') OR (sess.status='expired' AND NEW.machine_result='pending_review')) THEN
    RAISE EXCEPTION 'stale or non-writable session lease' USING ERRCODE='40001';
  END IF;
  IF sess.lease_expires_at<CURRENT_TIMESTAMP AND NEW.machine_result<>'pending_review' THEN RAISE EXCEPTION 'expired lease may enter parent review only' USING ERRCODE='40001'; END IF;
  -- Late offline evidence is retained with pending_review, never silently accepted as on-time.
  IF CURRENT_TIMESTAMP>sess.submit_deadline_at AND NEW.machine_result<>'pending_review' THEN
    RAISE EXCEPTION 'late attempt requires parent review';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attempt_lease BEFORE INSERT ON app.answer_attempts FOR EACH ROW EXECUTE FUNCTION app.check_attempt_lease();

CREATE FUNCTION app.check_evidence_relation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a app.answer_attempts%ROWTYPE; i app.challenge_items%ROWTYPE; s app.challenge_sessions%ROWTYPE; r app.review_requests%ROWTYPE; old_e app.learning_evidence%ROWTYPE;
BEGIN
 SELECT * INTO STRICT a FROM app.answer_attempts WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.answer_attempt_id;
 SELECT * INTO STRICT i FROM app.challenge_items WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=a.challenge_item_id;
 SELECT * INTO STRICT s FROM app.challenge_sessions WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=a.challenge_session_id;
 IF i.objective_id<>NEW.objective_id OR s.task_occurrence_id IS DISTINCT FROM NEW.task_occurrence_id THEN
   RAISE EXCEPTION 'evidence objective/task disagrees with actual answer';
 END IF;
 IF NEW.review_request_id IS NOT NULL THEN
   SELECT * INTO STRICT r FROM app.review_requests WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.review_request_id;
   IF r.answer_attempt_id<>a.id OR r.status NOT IN ('approved','needs_help') THEN RAISE EXCEPTION 'review does not resolve this answer'; END IF;
   IF NEW.outcome='passed' AND r.status<>'approved' THEN RAISE EXCEPTION 'parent evidence needs approved review'; END IF;
 END IF;
 IF NEW.evidence_kind='observation' AND NEW.assessment_source<>'parent' AND a.machine_result IN ('unrecognized','pending_review') THEN
   RAISE EXCEPTION 'unrecognized/pending audio cannot become automatic learning evidence';
 END IF;
 IF NEW.evidence_kind='observation' AND NEW.assessment_source<>'parent' AND ((NEW.outcome='passed') IS DISTINCT FROM (a.machine_result='correct')) THEN
   RAISE EXCEPTION 'automatic evidence must agree with immutable machine result';
 END IF;
 IF NEW.supersedes_evidence_id IS NOT NULL THEN
   SELECT * INTO STRICT old_e FROM app.learning_evidence WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.supersedes_evidence_id;
   IF old_e.objective_id<>NEW.objective_id OR old_e.skill<>NEW.skill OR old_e.modality<>NEW.modality OR old_e.answer_attempt_id<>NEW.answer_attempt_id THEN
     RAISE EXCEPTION 'correction must preserve target and provenance';
   END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM app.learning_days d WHERE d.family_id=NEW.family_id AND d.child_id=NEW.child_id AND d.id=s.learning_day_id AND d.learning_date=NEW.learning_date) THEN
   RAISE EXCEPTION 'evidence must retain original learning date';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER evidence_relation BEFORE INSERT ON app.learning_evidence FOR EACH ROW EXECUTE FUNCTION app.check_evidence_relation();

CREATE FUNCTION app.guard_review_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'review records must be retained'; END IF;
 IF OLD.status<>'pending' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'resolved review is immutable'; END IF;
 IF NEW.answer_attempt_id<>OLD.answer_attempt_id OR NEW.requested_reason<>OLD.requested_reason THEN RAISE EXCEPTION 'review provenance is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_resolution BEFORE UPDATE OR DELETE ON app.review_requests FOR EACH ROW EXECUTE FUNCTION app.guard_review_resolution();

CREATE FUNCTION app.check_entitlement_relation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d app.learning_days%ROWTYPE; t app.task_occurrences%ROWTYPE; w app.weekly_plans%ROWTYPE;
BEGIN
 IF NEW.period_kind='day' THEN
   SELECT * INTO STRICT d FROM app.learning_days WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.learning_day_id;
   IF d.learning_date<>NEW.period_key THEN RAISE EXCEPTION 'daily reward key must match learning day'; END IF;
   IF NEW.task_occurrence_id IS NOT NULL THEN
     SELECT * INTO STRICT t FROM app.task_occurrences WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.task_occurrence_id;
     IF t.learning_day_id<>d.id THEN RAISE EXCEPTION 'task reward belongs to another day'; END IF;
   END IF;
 ELSE
   SELECT * INTO STRICT w FROM app.weekly_plans WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.weekly_plan_id;
   IF w.week_start<>NEW.period_key THEN RAISE EXCEPTION 'weekly reward key must match stable week'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-ARRAY['qualified_at','cancelled_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['qualified_at','cancelled_at']) THEN
     RAISE EXCEPTION 'reward entitlement identity, allocation and policy are frozen';
   END IF;
   IF OLD.qualified_at IS NOT NULL AND NEW.qualified_at IS DISTINCT FROM OLD.qualified_at THEN RAISE EXCEPTION 'qualification cannot be rewritten'; END IF;
   IF EXISTS(SELECT 1 FROM app.reward_grants WHERE family_id=OLD.family_id AND child_id=OLD.child_id AND reward_entitlement_id=OLD.id) AND NEW.cancelled_at IS NOT NULL THEN
     RAISE EXCEPTION 'granted entitlement cannot be cancelled';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER entitlement_relation BEFORE INSERT OR UPDATE ON app.reward_entitlements FOR EACH ROW EXECUTE FUNCTION app.check_entitlement_relation();
CREATE TRIGGER entitlement_no_delete BEFORE DELETE ON app.reward_entitlements FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

CREATE FUNCTION app.guard_entitlement_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e app.reward_entitlements%ROWTYPE; item app.item_definitions%ROWTYPE; allocated bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'reward allocations are append-only'; END IF;
 -- All allocation/consumption writers follow child -> entitlement/pet -> inventory order.
 PERFORM 1 FROM app.children WHERE family_id=NEW.family_id AND id=NEW.child_id FOR UPDATE;
 SELECT * INTO STRICT e FROM app.reward_entitlements WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.reward_entitlement_id FOR UPDATE;
 IF e.qualified_at IS NOT NULL OR e.cancelled_at IS NOT NULL OR EXISTS(SELECT 1 FROM app.reward_grants WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND reward_entitlement_id=e.id) THEN
   RAISE EXCEPTION 'cannot allocate into qualified, cancelled or granted entitlement';
 END IF;
 SELECT * INTO STRICT item FROM app.item_definitions WHERE family_id=NEW.family_id AND id=NEW.item_definition_id;
 IF item.item_kind='food' AND e.qualification_kind<>'admin' THEN
   IF e.period_kind<>'day' OR e.qualification_kind<>'task_verified' OR e.task_occurrence_id IS NULL THEN RAISE EXCEPTION 'learning food must be allocated to daily task qualification'; END IF;
   SELECT coalesce(sum(ei.quantity),0) INTO allocated FROM app.entitlement_items ei JOIN app.reward_entitlements re ON re.family_id=ei.family_id AND re.child_id=ei.child_id AND re.id=ei.reward_entitlement_id JOIN app.item_definitions it ON it.family_id=ei.family_id AND it.id=ei.item_definition_id
      WHERE ei.family_id=NEW.family_id AND ei.child_id=NEW.child_id AND re.period_kind='day' AND re.period_key=e.period_key AND re.qualification_kind<>'admin' AND re.cancelled_at IS NULL AND it.item_kind='food';
   IF allocated+NEW.quantity>40 THEN RAISE EXCEPTION 'daily task nutrition allocation exceeds 40'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER entitlement_item_guard BEFORE INSERT OR UPDATE OR DELETE ON app.entitlement_items FOR EACH ROW EXECUTE FUNCTION app.guard_entitlement_item();

CREATE FUNCTION app.check_reward_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e app.reward_entitlements%ROWTYPE;
BEGIN
 PERFORM 1 FROM app.children WHERE family_id=NEW.family_id AND id=NEW.child_id FOR UPDATE;
 SELECT * INTO STRICT e FROM app.reward_entitlements WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.reward_entitlement_id FOR UPDATE;
 IF e.qualified_at IS NULL OR e.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'reward qualification not met'; END IF;
 IF e.qualification_kind='task_verified' AND NOT EXISTS(SELECT 1 FROM app.task_occurrences WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=e.task_occurrence_id AND status='completed') THEN RAISE EXCEPTION 'task is not complete'; END IF;
 IF e.qualification_kind='day_completed' AND NOT EXISTS(SELECT 1 FROM app.learning_days WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=e.learning_day_id AND completed_at IS NOT NULL) THEN RAISE EXCEPTION 'day is not complete'; END IF;
 IF e.qualification_kind='admin' AND NEW.actor_membership_id IS NULL THEN RAISE EXCEPTION 'administrative grant requires an actor'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reward_grant_qualified BEFORE INSERT ON app.reward_grants FOR EACH ROW EXECUTE FUNCTION app.check_reward_grant();

CREATE FUNCTION app.check_grant_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE grant_id uuid; f uuid; ch uuid; e uuid;
BEGIN
 f:=NEW.family_id; ch:=NEW.child_id;
 IF TG_TABLE_NAME='reward_grants' THEN grant_id:=NEW.id; ELSE grant_id:=NEW.reward_grant_id; END IF;
 SELECT reward_entitlement_id INTO STRICT e FROM app.reward_grants WHERE family_id=f AND child_id=ch AND id=grant_id;
 IF NOT EXISTS(SELECT 1 FROM app.entitlement_items WHERE family_id=f AND child_id=ch AND reward_entitlement_id=e) THEN RAISE EXCEPTION 'empty entitlement cannot be granted'; END IF;
 IF EXISTS(
   (SELECT item_definition_id,quantity FROM app.entitlement_items WHERE family_id=f AND child_id=ch AND reward_entitlement_id=e EXCEPT SELECT item_definition_id,quantity FROM app.reward_grant_items WHERE family_id=f AND child_id=ch AND reward_grant_id=grant_id)
   UNION ALL
   (SELECT item_definition_id,quantity FROM app.reward_grant_items WHERE family_id=f AND child_id=ch AND reward_grant_id=grant_id EXCEPT SELECT item_definition_id,quantity FROM app.entitlement_items WHERE family_id=f AND child_id=ch AND reward_entitlement_id=e)
 ) THEN RAISE EXCEPTION 'grant items must exactly equal frozen entitlement allocation'; END IF;
 IF EXISTS(SELECT 1 FROM app.reward_grant_items gi WHERE gi.family_id=f AND gi.child_id=ch AND gi.reward_grant_id=grant_id AND NOT EXISTS(SELECT 1 FROM app.inventory_ledger il WHERE il.family_id=f AND il.child_id=ch AND il.reward_grant_item_id=gi.id AND il.entry_kind='reward' AND il.item_definition_id=gi.item_definition_id AND il.delta=gi.quantity)) THEN
   RAISE EXCEPTION 'every grant item must be posted to ledger in same transaction';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER grant_items_atomic AFTER INSERT ON app.reward_grants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_grant_consistency();
CREATE CONSTRAINT TRIGGER grant_item_atomic AFTER INSERT ON app.reward_grant_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_grant_consistency();

CREATE FUNCTION app.check_ledger_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gi app.reward_grant_items%ROWTYPE; old_entry app.inventory_ledger%ROWTYPE;
BEGIN
 PERFORM 1 FROM app.children WHERE family_id=NEW.family_id AND id=NEW.child_id FOR UPDATE;
 IF NEW.reward_grant_item_id IS NOT NULL THEN
   SELECT * INTO STRICT gi FROM app.reward_grant_items WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.reward_grant_item_id;
   IF gi.item_definition_id<>NEW.item_definition_id OR gi.quantity<>NEW.delta THEN RAISE EXCEPTION 'reward ledger amount/source mismatch'; END IF;
 END IF;
 IF NEW.reverses_entry_id IS NOT NULL THEN
   SELECT * INTO STRICT old_entry FROM app.inventory_ledger WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND id=NEW.reverses_entry_id;
   IF old_entry.item_definition_id<>NEW.item_definition_id OR NEW.delta<>-old_entry.delta OR old_entry.entry_kind='reversal' THEN RAISE EXCEPTION 'reversal must exactly negate one original entry'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_source BEFORE INSERT ON app.inventory_ledger FOR EACH ROW EXECUTE FUNCTION app.check_ledger_source();

CREATE FUNCTION app.post_inventory_balance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE result_qty bigint;
BEGIN
 -- Before-insert guard holds the child's lock, serializing all writers for that child.
 -- UPDATE first: inserting a negative EXCLUDED quantity would violate CHECK before conflict resolution.
 UPDATE app.inventory_balances SET quantity=quantity+NEW.delta,revision=revision+1,updated_at=CURRENT_TIMESTAMP
 WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND item_definition_id=NEW.item_definition_id
   AND (NEW.delta>0 OR quantity>=-NEW.delta)
 RETURNING quantity INTO result_qty;
 IF FOUND THEN RETURN NEW; END IF;
 IF NEW.delta<0 THEN RAISE EXCEPTION 'insufficient inventory' USING ERRCODE='23514'; END IF;
 INSERT INTO app.inventory_balances(id,family_id,child_id,item_definition_id,quantity,revision)
 VALUES(NEW.id,NEW.family_id,NEW.child_id,NEW.item_definition_id,NEW.delta,1);
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_balance AFTER INSERT ON app.inventory_ledger FOR EACH ROW EXECUTE FUNCTION app.post_inventory_balance();

CREATE FUNCTION app.check_feed_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ev app.pet_events%ROWTYPE; lg app.inventory_ledger%ROWTYPE; it app.item_definitions%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='inventory_ledger' THEN
   IF NEW.entry_kind<>'feed' THEN RETURN NULL; END IF;
   SELECT * INTO ev FROM app.pet_events WHERE family_id=NEW.family_id AND child_id=NEW.child_id AND inventory_entry_id=NEW.id AND event_kind='feed';
   IF NOT FOUND THEN RAISE EXCEPTION 'feed ledger requires matching pet event in same transaction'; END IF;
 ELSE
   IF NEW.event_kind<>'feed' THEN RETURN NULL; END IF;
   ev:=NEW;
 END IF;
 SELECT * INTO STRICT lg FROM app.inventory_ledger WHERE family_id=ev.family_id AND child_id=ev.child_id AND id=ev.inventory_entry_id;
 SELECT * INTO STRICT it FROM app.item_definitions WHERE family_id=ev.family_id AND id=ev.item_definition_id;
 IF lg.entry_kind<>'feed' OR lg.pet_id<>ev.pet_id OR lg.item_definition_id<>ev.item_definition_id OR lg.delta<>-ev.applied_units OR it.item_kind<>'food' OR it.unit<>'nutrition_point' THEN RAISE EXCEPTION 'feed event and inventory debit mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.pet_states ps WHERE ps.family_id=ev.family_id AND ps.child_id=ev.child_id AND ps.pet_id=ev.pet_id AND ps.revision>=ev.state_revision_after) THEN RAISE EXCEPTION 'feed state revision was not committed'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER feed_ledger_atomic AFTER INSERT ON app.inventory_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_feed_consistency();
CREATE CONSTRAINT TRIGGER feed_event_atomic AFTER INSERT ON app.pet_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_feed_consistency();

CREATE FUNCTION app.guard_monotonic_cursor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.last_sequence_no IS NOT NULL AND (NEW.last_sequence_no IS NULL OR NEW.last_sequence_no<OLD.last_sequence_no) THEN RAISE EXCEPTION 'sync cursor cannot go backwards'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sync_monotonic BEFORE UPDATE ON app.sync_cursors FOR EACH ROW EXECUTE FUNCTION app.guard_monotonic_cursor();

CREATE FUNCTION app.guard_idempotency_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.operation<>OLD.operation OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.request_digest<>OLD.request_digest THEN RAISE EXCEPTION 'idempotency key/payload cannot be replaced'; END IF;
 IF OLD.status='completed' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'completed idempotent response is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER idempotency_frozen BEFORE UPDATE ON app.idempotency_records FOR EACH ROW EXECUTE FUNCTION app.guard_idempotency_result();

CREATE FUNCTION app.guard_outbox_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'delivered_at') IS DISTINCT FROM (to_jsonb(OLD)-'delivered_at') THEN RAISE EXCEPTION 'outbox payload is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outbox_payload BEFORE UPDATE ON app.outbox_events FOR EACH ROW EXECUTE FUNCTION app.guard_outbox_payload();
CREATE TRIGGER outbox_no_delete BEFORE DELETE ON app.outbox_events FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- Tenant scoping requires an authenticated trusted API transaction SET LOCAL app.family_id='...'.
-- This is a secondary isolation control, not an authentication method; never expose SQL/GUC control to children.
CREATE VIEW app.public_question_forms WITH (security_invoker=true) AS
SELECT id,family_id,question_family_id,objective_id,content_version_id,question_type,prompt_text,instruction_text,public_payload,public_payload_schema_version,image_media_id,audio_media_id,difficulty,estimated_seconds,requires_microphone,requires_typing
FROM app.question_versions WHERE published_at IS NOT NULL;
COMMENT ON VIEW app.public_question_forms IS '儿童题目公开投影；无答案、解释、质量报告、源证据摘录。历史题单可读取退役版本，新组题另过滤retired_at。';
CREATE VIEW app.public_question_options WITH (security_invoker=true) AS
SELECT id,family_id,question_version_id,option_key,ordinal,side,text,image_media_id,audio_media_id FROM app.question_options;
COMMENT ON VIEW app.public_question_options IS '公开选项，不含正确性标记；API仍按已授权challenge_items限制题目集合。';

-- The generator appends table-specific trigger and RLS declarations, grants remain deployment-controlled.

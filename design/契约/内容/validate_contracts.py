"""Offline Draft 2020-12 contracts + bounded domain lint. Never calls a model or the network."""
from pathlib import Path
from collections import Counter
from copy import deepcopy
import argparse
import hashlib
import json
import re
import sys
import unicodedata

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError:
    raise SystemExit("需要本机 jsonschema>=4.16；本脚本不会自动安装依赖。")

ROOT = Path(__file__).resolve().parent
EXAMPLES = ROOT / "examples"
P1 = {"audio_to_picture", "word_to_picture", "picture_to_word", "oral_reading"}
P2 = {"sentence_choice", "cloze_choice", "cloze_text", "matching", "word_order", "reading_choice", "retell"}
EXPECTED_CAPABILITY = {
    "audio_to_picture": ("listening", "audio"), "word_to_picture": ("word_recognition", "text"),
    "picture_to_word": ("word_recognition", "visual"), "oral_reading": ("oral_reading", "speech"),
    "sentence_choice": ("sentence_comprehension", None), "cloze_choice": ("sentence_comprehension", "text"),
    "cloze_text": ("spelling", "text"), "matching": ("word_recognition", None),
    "word_order": ("sentence_comprehension", "text"), "reading_choice": ("sentence_comprehension", "text"),
    "retell": ("oral_expression", "speech")
}

def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def schema_errors(name, data):
    schema = load(ROOT / (name + ".schema.json"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    return ["schema:" + "/".join(map(str, error.absolute_path)) + ":" + error.message for error in validator.iter_errors(data)]

def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def require_unique(items, key, errors, label):
    vals = [item[key] for item in items]
    if len(vals) != len(set(vals)):
        errors.append("duplicate_id:" + label)

def normalize(text, policy=None):
    p = policy or {"trim_whitespace": True, "collapse_whitespace": True, "case_sensitive": False, "punctuation_mode": "strict"}
    text = unicodedata.normalize("NFC", text)
    if p.get("trim_whitespace"):
        text = text.strip()
    if p.get("collapse_whitespace"):
        text = " ".join(text.split())
    if not p.get("case_sensitive", True):
        text = text.casefold()
    if p.get("punctuation_mode") == "ignore":
        text = text.rstrip(".!? ")
    return text

def source_lint(data, all_sources=None):
    errors = []
    sid = data["id"]
    if sha(data["original_text"]) != data["source_hash"]:
        errors.append("source_hash_mismatch")
    if sid in data["context_slice_ids"] or data.get("parent_slice_id") == sid:
        errors.append("self_context")
    if data["provenance"]["origin_kind"] == "publisher_original" and data["provenance"]["extraction_method"] == "ai_draft":
        errors.append("llm_cannot_author_publisher_original")
    loc = data["locator"]
    if "start_char" in loc and loc["end_char"] <= loc["start_char"]:
        errors.append("invalid_character_range")
    for binding in data["media_bindings"]:
        if binding["media_type"] == "audio" and "start_ms" in binding and "end_ms" in binding and binding["end_ms"] <= binding["start_ms"]:
            errors.append("invalid_audio_range")
        if ("start_ms" in binding) != ("end_ms" in binding):
            errors.append("incomplete_audio_range")
        if "region" in binding:
            r = binding["region"]
            if r["x"] + r["width"] > 1.000001 or r["y"] + r["height"] > 1.000001:
                errors.append("image_region_out_of_bounds")
    if all_sources:
        by_id = {s["id"]: s for s in all_sources}
        refs = data["context_slice_ids"] + ([data["parent_slice_id"]] if "parent_slice_id" in data else [])
        for ref in refs:
            if ref not in by_id:
                errors.append("unknown_context_slice:" + ref)
            elif by_id[ref]["content_version_id"] != data["content_version_id"]:
                errors.append("cross_version_context")
        def visit(current, stack):
            if current in stack:
                return True
            item = by_id.get(current)
            if not item:
                return False
            return any(visit(ref, stack | {current}) for ref in item["context_slice_ids"])
        if visit(sid, set()):
            errors.append("context_cycle")
    return errors

def blueprint_lint(bp):
    errors = []
    for name in ["source_snapshots", "objectives", "registered_assets", "candidate_slots"]:
        require_unique(bp[name], "id", errors, name)
    snapshots = {s["id"]: s for s in bp["source_snapshots"]}
    request = bp["request"]
    if request["scope"]["content_version_id"] != bp["content_version_id"] or request["template_version"] != bp["template_version"]:
        errors.append("request_blueprint_version_mismatch")
    targets, contexts = set(bp["source_slice_ids"]), set(bp["context_slice_ids"])
    if targets != set(request["scope"]["source_slice_ids"]) or contexts != set(request["scope"].get("context_slice_ids", [])):
        errors.append("request_scope_mismatch")
    if targets & contexts:
        errors.append("target_context_overlap")
    if set(snapshots) != targets | contexts:
        errors.append("snapshot_scope_mismatch")
    for s in snapshots.values():
        if s["content_version_id"] != bp["content_version_id"]:
            errors.append("snapshot_version_mismatch")
        if sha(s["original_text"]) != s["source_hash"]:
            errors.append("snapshot_hash_mismatch")
        if not set(s["context_slice_ids"]) <= contexts:
            errors.append("snapshot_context_outside_allowed")
    objective_ids = {o["id"] for o in bp["objectives"]}
    for o in bp["objectives"]:
        if not set(o["source_slice_ids"]) <= targets:
            errors.append("objective_source_outside_scope")
    assets = {a["id"]: a for a in bp["registered_assets"]}
    for a in assets.values():
        prefix = "audio/" if a["media_type"] == "audio" else "image/"
        if not a["mime_type"].startswith(prefix):
            errors.append("asset_mime_mismatch")
    for s in snapshots.values():
        if not set(s["media_asset_ids"]) <= set(assets):
            errors.append("snapshot_asset_unregistered")
    for slot in bp["candidate_slots"]:
        if not set(slot["source_slice_ids"]) <= targets or not set(slot["context_slice_ids"]) <= contexts:
            errors.append("slot_source_outside_scope")
        if not set(slot["objective_ids"]) <= objective_ids:
            errors.append("slot_unknown_objective")
        if bp["phase"] == "p1" and slot["question_type"] not in P1:
            errors.append("phase_forbidden")
        if slot["question_type"] == "cloze_text" and not bp["learner_capabilities"]["can_spell"]:
            errors.append("spelling_prerequisite_missing")
    return errors

def candidate_lint(q, bp):
    errors = []
    slots = {s["id"]: s for s in bp["candidate_slots"]}
    slot = slots.get(q["id"])
    if not slot:
        return ["candidate_id_not_allocated"]
    if q["blueprint_id"] != bp["id"] or q["phase"] != bp["phase"]:
        errors.append("blueprint_identity_mismatch")
    for key in ["question_type", "source_slice_ids", "context_slice_ids", "objective_ids", "skill", "modality", "difficulty"]:
        left, right = q[key], slot[key]
        if isinstance(left, list):
            left, right = set(left), set(right)
        if left != right:
            errors.append("slot_mismatch:" + key)
    skill, mode = EXPECTED_CAPABILITY[q["question_type"]]
    if q["skill"] != skill or (mode and q["modality"] != mode):
        errors.append("capability_mismatch")
    if q["question_type"] == "matching" and q["modality"] not in {"text", "visual"}:
        errors.append("matching_modality_unsupported")
    if q["presentation_kind"] != "verbatim" and not bp["generation_policy"]["allow_paraphrase"]:
        errors.append("paraphrase_forbidden")
    sources = {s["id"]: s for s in bp["source_snapshots"]}
    allowed_sources = set(q["source_slice_ids"]) | set(q["context_slice_ids"])
    for quote in q["source_quotes"]:
        sid = quote["slice_id"]
        if sid not in allowed_sources or sid not in sources:
            errors.append("quote_source_outside_scope")
            continue
        text = sources[sid]["original_text"]
        if quote["end_char"] <= quote["start_char"] or text[quote["start_char"]:quote["end_char"]] != quote["quote"]:
            errors.append("quote_text_mismatch")
    if not set(q["source_slice_ids"]) <= {x["slice_id"] for x in q["source_quotes"]}:
        errors.append("missing_target_quote")
    objectives = {o["id"]: o for o in bp["objectives"]}
    for oid in q["objective_ids"]:
        if oid not in objectives:
            errors.append("unknown_objective")
        elif objectives[oid]["skill"] != q["skill"] or objectives[oid]["modality"] != q["modality"]:
            errors.append("objective_capability_mismatch")
    assets = {a["id"]: a for a in bp["registered_assets"]}
    payload = q["public_payload"]
    components = set(slot["component_ids"])
    def check_asset(aid, kind):
        if aid not in assets:
            errors.append("unregistered_asset:" + aid)
        elif assets[aid]["media_type"] != kind:
            errors.append("wrong_asset_type")
    for key, kind in [("image_asset_id", "image"), ("audio_asset_id", "audio")]:
        if key in payload:
            check_asset(payload[key], kind)
    if payload.get("stimulus", {}).get("kind") == "audio":
        check_asset(payload["stimulus"]["asset_id"], "audio")
    for name in ["options", "left_items", "right_items", "tokens"]:
        items = payload.get(name, [])
        if not items:
            continue
        require_unique(items, "id", errors, name)
        if not {x["id"] for x in items} <= components:
            errors.append("component_id_not_allocated")
        texts = [normalize(x["text"]) for x in items if "text" in x]
        if name != "tokens" and len(texts) != len(set(texts)):
            errors.append("duplicate_option_text")
        image_ids = [x["asset_id"] for x in items if "asset_id" in x]
        if len(image_ids) != len(set(image_ids)):
            errors.append("duplicate_option_asset")
        for aid in image_ids:
            check_asset(aid, "image")
    if "gap_id" in payload and payload["gap_id"] not in components:
        errors.append("gap_id_not_allocated")
    answer = q["answer_spec"]
    kind = answer["answer_kind"]
    if kind == "single_choice":
        if not set(answer["accepted_option_ids"]) <= {x["id"] for x in payload["options"]}:
            errors.append("answer_option_not_found")
    elif kind == "text":
        normalized = [normalize(t, answer["normalization"]) for t in answer["accepted_texts"]]
        if len(normalized) != len(set(normalized)):
            errors.append("duplicate_normalized_answer")
        if q["skill"] == "spelling" and answer["normalization"]["punctuation_mode"] != "strict":
            errors.append("spelling_normalization_too_broad")
        for word in answer["accepted_texts"]:
            if not any(word in s["original_text"] for sid, s in sources.items() if sid in q["source_slice_ids"]):
                errors.append("cloze_answer_not_in_source")
    elif kind == "matching":
        left, right = {x["id"] for x in payload["left_items"]}, {x["id"] for x in payload["right_items"]}
        ls, rs = [p["left_id"] for p in answer["pairs"]], [p["right_id"] for p in answer["pairs"]]
        if len(left) != len(right) or set(ls) != left or set(rs) != right or len(ls) != len(set(ls)) or len(rs) != len(set(rs)):
            errors.append("matching_not_bijection")
    elif kind == "sequence":
        token_ids = [x["id"] for x in payload["tokens"]]
        for sequence in answer["accepted_sequences"]:
            if Counter(sequence) != Counter(token_ids):
                errors.append("sequence_token_multiset_mismatch")
    elif kind == "manual_review":
        if q["question_type"] not in {"oral_reading", "retell"}:
            errors.append("manual_review_type_mismatch")
    if q["question_type"] == "sentence_choice":
        expected = "audio" if payload["stimulus"]["kind"] == "audio" else "text"
        if q["modality"] != expected:
            errors.append("sentence_stimulus_modality_mismatch")
    if q["question_type"] in {"cloze_text", "cloze_choice"}:
        prefix, suffix = payload["prefix_text"], payload["suffix_text"]
        if not any(s["original_text"].startswith(prefix) and s["original_text"].endswith(suffix) for sid, s in sources.items() if sid in q["source_slice_ids"]):
            errors.append("cloze_cannot_place")
    return errors

def public_projection(q):
    # Runtime envelope is composed by the server; provider output is never forwarded.
    response_kind = {"cloze_choice": "gaps", "cloze_text": "gaps", "matching": "pairs", "word_order": "tokens", "oral_reading": "recording", "retell": "recording"}.get(q["question_type"], "option")
    payload = deepcopy(q["public_payload"])
    payload["prompt_text"] = q["prompt_text"]
    return {"challenge_item_id": q["id"], "question_version_id": q["id"], "question_type": q["question_type"], "instruction": q["instruction_text"], "public_payload": payload, "required_response_kind": response_kind}

def validate_all():
    count = 0
    sources = [load(p) for p in sorted(EXAMPLES.glob("source-slice.*.valid.json"))]
    for source in sources:
        errors = schema_errors("source-slice", source)
        if not errors:
            errors += source_lint(source, sources)
        if errors:
            raise AssertionError(errors)
        count += 1
    bps = {}
    for path in sorted(EXAMPLES.glob("generation-blueprint.*.valid.json")):
        bp = load(path)
        errors = schema_errors("generation-blueprint", bp)
        if not errors:
            errors += blueprint_lint(bp)
        if errors:
            raise AssertionError(errors)
        bps[bp["id"]] = bp
        count += 1
    candidates = []
    for path in sorted(EXAMPLES.glob("question-candidate.*.valid.json")):
        q = load(path)
        errors = schema_errors("question-candidate", q)
        if not errors:
            errors += candidate_lint(q, bps[q["blueprint_id"]])
        if errors:
            raise AssertionError((str(path), errors))
        projected = json.dumps(public_projection(q), ensure_ascii=False)
        if "answer_spec" in projected or "explanation" in projected or "source_quotes" in projected:
            raise AssertionError("private_answer_leaked")
        candidates.append(q)
        count += 1
    return sources, bps, candidates, count

def negative_checks(sources, bps, candidates):
    tests = []
    base = next(q for q in candidates if q["question_type"] == "word_to_picture")
    for name, mutate in [
        ("family_id_injection", lambda q: q.update(family_id=q["id"])),
        ("public_explanation_injection", lambda q: q["public_payload"].update(explanation="隐藏解释")),
        ("p1_forbidden_type", lambda q: q.update(question_type="retell")),
        ("unknown_source", lambda q: q.update(source_slice_ids=[q["id"]])),
        ("unregistered_asset", lambda q: q["public_payload"]["options"][0].update(asset_id=q["id"])),
        ("answer_option_not_found", lambda q: q["answer_spec"].update(accepted_option_ids=[q["id"]])),
        ("quote_text_mismatch", lambda q: q["source_quotes"][0].update(quote="This is NOT original.")),
        ("duplicate_option", lambda q: q["public_payload"]["options"][1].update(asset_id=q["public_payload"]["options"][0]["asset_id"])),
        ("capability_mismatch", lambda q: q.update(skill="spelling")),
        ("candidate_uuid_not_allocated", lambda q: q.update(id=q["blueprint_id"]))
    ]:
        q = deepcopy(base); mutate(q)
        errors = schema_errors("question-candidate", q)
        if not errors:
            errors += candidate_lint(q, bps[q["blueprint_id"]])
        if not errors:
            raise AssertionError("negative fixture unexpectedly accepted: " + name)
        tests.append({"name": name, "rejected": True, "reason": errors[0]})
    retell = deepcopy(next(q for q in candidates if q["question_type"] == "retell"))
    retell["phase"] = "p1"
    assert any("retell" in e and "is not one of" in e for e in schema_errors("question-candidate", retell))
    tests.append({"name": "p1_complete_retell_payload", "rejected": True, "reason": "p1_phase_forbids_retell"})
    src = deepcopy(sources[0]); src["context_slice_ids"] = [src["id"]]
    assert source_lint(src, sources)
    tests.append({"name": "self_context", "rejected": True, "reason": "self_context"})
    src = deepcopy(sources[0]); src["source_hash"] = "0" * 64
    assert source_lint(src, sources)
    tests.append({"name": "source_hash_mismatch", "rejected": True, "reason": "source_hash_mismatch"})
    src = deepcopy(next(s for s in sources if any(b["media_type"] == "audio" for b in s["media_bindings"])))
    binding = next(b for b in src["media_bindings"] if b["media_type"] == "audio")
    binding["end_ms"] = binding["start_ms"]
    assert source_lint(src, sources)
    tests.append({"name": "invalid_audio_range", "rejected": True, "reason": "invalid_audio_range"})
    word_order = deepcopy(next(q for q in candidates if q["question_type"] == "word_order"))
    word_order["answer_spec"]["accepted_sequences"][0] = word_order["answer_spec"]["accepted_sequences"][0][:-1]
    assert candidate_lint(word_order, bps[word_order["blueprint_id"]])
    tests.append({"name": "sequence_missing_token", "rejected": True, "reason": "sequence_token_multiset_mismatch"})
    matching = deepcopy(next(q for q in candidates if q["question_type"] == "matching"))
    matching["answer_spec"]["pairs"][1]["right_id"] = matching["answer_spec"]["pairs"][0]["right_id"]
    assert candidate_lint(matching, bps[matching["blueprint_id"]])
    tests.append({"name": "matching_reused_right", "rejected": True, "reason": "matching_not_bijection"})
    return tests

def openapi_compatibility(sources, blueprints, candidates):
    api_path = ROOT.parent / "openapi.json"
    if not api_path.exists():
        return {"status": "not_available", "checked": 0}
    components = load(api_path)["components"]
    checked = 0
    def check(name, value):
        nonlocal checked
        validator = Draft202012Validator({"$ref": "#/components/schemas/" + name, "components": components}, format_checker=FormatChecker())
        errors = list(validator.iter_errors(value))
        if errors:
            raise AssertionError((name, [e.message for e in errors]))
        checked += 1
    for source in sources:
        projection = {key: deepcopy(source[key]) for key in ["id", "content_version_id", "node_id", "kind", "original_text", "normalized_text", "source_hash", "locator", "context_slice_ids", "media_asset_ids"]}
        check("SourceSlice", projection)
    for blueprint in blueprints.values():
        check("GenerationRequest", blueprint["request"])
    for q in candidates:
        check("PublicQuestion", public_projection(q))
    return {"status": "pass", "checked": checked, "source_slices": len(sources), "generation_requests": len(blueprints), "public_questions": len(candidates)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="validate bundled valid fixtures and negative mutations")
    parser.add_argument("--schema", choices=["source-slice", "generation-blueprint", "question-candidate"])
    parser.add_argument("--input", type=Path)
    parser.add_argument("--blueprint", type=Path, help="required for candidate domain lint")
    args = parser.parse_args()
    if args.all or not args.schema:
        sources, bps, candidates, count = validate_all()
        tests = negative_checks(sources, bps, candidates)
        compatibility = openapi_compatibility(sources, bps, candidates)
        report = {"schema_draft": "2020-12", "schemas_checked": 3, "valid_examples": count, "candidate_types": len(candidates), "negative_checks": tests, "public_projection_checks": len(candidates), "openapi_compatibility": compatibility, "network_calls": 0, "llm_calls": 0, "result": "pass", "limitations": ["No production DB tenancy/state constraints are tested.", "No semantic correctness, asset bytes, or child pronunciation quality is certified."]}
        (ROOT / "validation-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"result": "pass", "schemas": 3, "valid_examples": count, "candidate_types": len(candidates), "negative_checks": len(tests), "public_projection_checks": len(candidates)}, ensure_ascii=False))
        return
    if not args.input:
        parser.error("--input is required with --schema")
    data = load(args.input)
    errors = schema_errors(args.schema, data)
    if not errors:
        if args.schema == "source-slice": errors += source_lint(data)
        elif args.schema == "generation-blueprint": errors += blueprint_lint(data)
        elif args.blueprint: errors += candidate_lint(data, load(args.blueprint))
        else: parser.error("candidate domain lint requires --blueprint")
    print(json.dumps({"valid": not errors, "errors": errors}, ensure_ascii=False, indent=2))
    if errors:
        sys.exit(1)

if __name__ == "__main__":
    main()

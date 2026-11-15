"""Build the versioned, offline JSON contracts and self-authored fixtures. No network/model calls."""
from pathlib import Path
from copy import deepcopy
import hashlib
import json
import uuid

ROOT = Path(__file__).resolve().parent
EXAMPLES = ROOT / "examples"
EXAMPLES.mkdir(parents=True, exist_ok=True)
DRAFT = "https://json-schema.org/draft/2020-12/schema"
UUID = {"type": "string", "format": "uuid", "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"}
HASH = {"type": "string", "pattern": "^[0-9a-f]{64}$"}
SKILLS = ["listening", "word_recognition", "oral_reading", "sentence_comprehension", "spelling", "oral_expression"]
MODALITIES = ["audio", "visual", "text", "speech"]
P1 = ["audio_to_picture", "word_to_picture", "picture_to_word", "oral_reading"]
P2 = ["sentence_choice", "cloze_choice", "cloze_text", "matching", "word_order", "reading_choice", "retell"]

def string(max_length=500, min_length=1):
    return {"type": "string", "minLength": min_length, "maxLength": max_length}

def array(items, minimum=0, maximum=32, unique=False):
    out = {"type": "array", "items": items, "minItems": minimum, "maxItems": maximum}
    if unique:
        out["uniqueItems"] = True
    return out

def ids(minimum=0, maximum=32):
    return array(deepcopy(UUID), minimum, maximum, True)

def obj(properties, required=None):
    return {"type": "object", "properties": properties, "required": list(properties) if required is None else required, "additionalProperties": False}

def schema(name, body):
    return {"$schema": DRAFT, "$id": f"urn:banxue:content:{name}:1.0.0", "title": name, **body}

def dump(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

region = obj({key: {"type": "number", "minimum": 0, "maximum": 1} for key in ["x", "y", "width", "height"]})
region["properties"]["width"]["exclusiveMinimum"] = 0
region["properties"]["height"]["exclusiveMinimum"] = 0
image_binding = obj({"media_type": {"const": "image"}, "asset_id": deepcopy(UUID), "role": {"enum": ["page_image", "illustration", "source_document"]}, "ordinal": {"type": "integer", "minimum": 0}, "region": region}, ["media_type", "asset_id", "role", "ordinal"])
audio_binding = obj({"media_type": {"const": "audio"}, "asset_id": deepcopy(UUID), "role": {"enum": ["reference_audio", "synthetic_audio"]}, "ordinal": {"type": "integer", "minimum": 0}, "start_ms": {"type": "integer", "minimum": 0}, "end_ms": {"type": "integer", "minimum": 1}, "transcript": string(4000)}, ["media_type", "asset_id", "role", "ordinal"])
locator = obj({"page_index": {"type": "integer", "minimum": 1, "maximum": 100000}, "page_label": string(60), "paragraph_index": {"type": "integer", "minimum": 0}, "record_key": string(120), "start_char": {"type": "integer", "minimum": 0}, "end_char": {"type": "integer", "minimum": 1}}, [])
locator["anyOf"] = [{"required": [key]} for key in ["page_index", "paragraph_index", "record_key"]]
locator["dependentRequired"] = {"start_char": ["end_char"], "end_char": ["start_char"]}
bindings = array({"oneOf": [image_binding, audio_binding]}, 0, 32)
bindings["allOf"] = [{"contains": {"type": "object", "properties": {"media_type": {"const": kind}}, "required": ["media_type"]}, "minContains": 0, "maxContains": 16} for kind in ["image", "audio"]]
source_schema = schema("source-slice", obj({
    "schema_version": {"const": "1.0.0"}, "id": deepcopy(UUID), "content_version_id": deepcopy(UUID), "node_id": deepcopy(UUID), "kind": {"enum": ["context", "sentence", "word"]},
    "original_text": string(8000), "normalized_text": string(8000), "source_hash": deepcopy(HASH), "source_media_id": deepcopy(UUID), "context_slice_ids": ids(0, 16), "media_asset_ids": ids(0, 32),
    "locator": locator, "media_bindings": bindings,
    "provenance": obj({"origin_kind": {"enum": ["publisher_original", "family_authored", "ai_authored"]}, "extraction_method": {"enum": ["trusted_package", "native_text", "ocr", "manual_transcription", "audio_transcription", "ai_draft"]}, "verification_status": {"enum": ["verified", "pending"]}, "adapter_version": string(64), "parser_version": string(64)}),
    "rights": obj({"rights_code": string(64), "usage_scope": {"enum": ["household_only", "redistributable", "public_domain", "unknown"]}, "cloud_processing_allowed": {"type": "boolean"}})
}, ["schema_version", "id", "content_version_id", "node_id", "kind", "original_text", "normalized_text", "source_hash", "source_media_id", "context_slice_ids", "media_asset_ids", "locator", "media_bindings", "provenance", "rights"]))
source_schema["allOf"] = [
    {"if": {"properties": {"provenance": {"properties": {"extraction_method": {"const": "ai_draft"}}, "required": ["extraction_method"]}}, "required": ["provenance"]}, "then": {"properties": {"provenance": {"properties": {"origin_kind": {"const": "ai_authored"}}}}}}
]

source_snapshot = obj({"id": deepcopy(UUID), "content_version_id": deepcopy(UUID), "node_id": deepcopy(UUID), "kind": {"enum": ["context", "sentence", "word"]}, "original_text": string(8000), "normalized_text": string(8000), "source_hash": deepcopy(HASH), "context_slice_ids": ids(0, 16), "media_asset_ids": ids(0, 32), "media_bindings": bindings})
objective = obj({"id": deepcopy(UUID), "skill": {"enum": SKILLS}, "modality": {"enum": MODALITIES}, "target_text": string(500), "source_slice_ids": ids(1, 16)})
registered_asset = obj({"id": deepcopy(UUID), "media_type": {"enum": ["image", "audio"]}, "sha256": deepcopy(HASH), "mime_type": {"enum": ["image/png", "image/webp", "image/jpeg", "audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg"]}, "semantic_tags": array(string(64), 1, 20, True), "verification_status": {"const": "verified"}, "transcript": string(4000), "duration_ms": {"type": "integer", "minimum": 1}}, ["id", "media_type", "sha256", "mime_type", "semantic_tags", "verification_status"])
registered_asset["allOf"] = [{"if": {"properties": {"media_type": {"const": "audio"}}, "required": ["media_type"]}, "then": {"required": ["transcript", "duration_ms"]}, "else": {"not": {"anyOf": [{"required": ["duration_ms"]}, {"required": ["transcript"]}]}}}]
slot = obj({"id": deepcopy(UUID), "question_type": {"enum": P1 + P2}, "component_ids": ids(0, 24), "source_slice_ids": ids(1, 16), "context_slice_ids": ids(0, 16), "objective_ids": ids(1, 1), "skill": {"enum": SKILLS}, "modality": {"enum": MODALITIES}, "difficulty": {"type": "integer", "minimum": 1, "maximum": 5}})
blueprint_schema = schema("generation-blueprint", obj({
    "schema_version": {"const": "1.0.0"}, "id": deepcopy(UUID), "phase": {"enum": ["p1", "p2"]}, "content_version_id": deepcopy(UUID),
    "request": obj({"scope": obj({"content_version_id": deepcopy(UUID), "source_slice_ids": ids(1, 200), "context_slice_ids": ids(0, 200), "objective_ids": ids(1, 100)}, ["content_version_id", "source_slice_ids", "objective_ids"]),
                     "question_types": array({"enum": P1 + P2}, 1, 11, True), "count_per_objective": {"type": "integer", "minimum": 1, "maximum": 6},
                     "difficulty_band": {"type": "integer", "minimum": 1, "maximum": 5}, "template_version": string(64), "budget_limit_microunits": {"type": "string", "pattern": "^(0|[1-9][0-9]*)$"},
                     "expected_content_revision": {"type": "integer", "minimum": 1}}, ["scope", "question_types", "count_per_objective", "difficulty_band", "template_version", "expected_content_revision"]),
    "source_slice_ids": ids(1, 32), "context_slice_ids": ids(0, 32), "source_snapshots": array(source_snapshot, 1, 64), "objectives": array(objective, 1, 32), "registered_assets": array(registered_asset, 0, 64),
    "allowed_vocabulary": array(obj({"vocabulary_sense_id": deepcopy(UUID), "form": string(100), "role": {"enum": ["target", "known_distractor", "approved_instruction"]}}), 1, 128),
    "learner_capabilities": obj({key: {"type": "boolean"} for key in ["can_read_instructions", "can_spell", "supports_touch", "supports_dpad", "supports_recording"]}),
    "candidate_slots": array(slot, 1, 16), "template_version": string(64), "prompt_version": string(64), "quality_policy_id": deepcopy(UUID),
    "generation_policy": obj({"provider_mode": {"enum": ["local", "cloud"]}, "allow_paraphrase": {"type": "boolean"}, "max_output_tokens": {"type": "integer", "minimum": 512, "maximum": 16384}, "timeout_seconds": {"type": "integer", "minimum": 5, "maximum": 180}, "target_question_seconds": {"type": "integer", "minimum": 5, "maximum": 90}})
}))
blueprint_schema["allOf"] = [{"if": {"properties": {"phase": {"const": "p1"}}, "required": ["phase"]}, "then": {"properties": {"candidate_slots": {"items": {"properties": {"question_type": {"enum": P1}}}}}}}]

text_option = obj({"id": deepcopy(UUID), "text": string(200)})
image_option = obj({"id": deepcopy(UUID), "asset_id": deepcopy(UUID)})
item = {"oneOf": [text_option, image_option]}
text_options = array(text_option, 2, 6)
image_options = array(image_option, 2, 6)
instruction = string(240)
payloads = {
    "audio_to_picture": obj({"audio_asset_id": deepcopy(UUID), "options": image_options}),
    "word_to_picture": obj({"options": image_options}),
    "picture_to_word": obj({"image_asset_id": deepcopy(UUID), "options": text_options}),
    "oral_reading": obj({"target_text": string(600), "recording_max_seconds": {"type": "integer", "minimum": 3, "maximum": 30}}),
    "sentence_choice": obj({"stimulus": {"oneOf": [obj({"kind": {"const": "text"}, "text": string(600)}), obj({"kind": {"const": "audio"}, "asset_id": deepcopy(UUID)})]}, "options": text_options}),
    "cloze_choice": obj({"prefix_text": string(600, 0), "suffix_text": string(600, 0), "gap_id": deepcopy(UUID), "options": text_options}),
    "cloze_text": obj({"prefix_text": string(600, 0), "suffix_text": string(600, 0), "gap_id": deepcopy(UUID), "max_answer_characters": {"type": "integer", "minimum": 1, "maximum": 200}}),
    "matching": obj({"left_items": array(item, 2, 6), "right_items": array(item, 2, 6)}),
    "word_order": obj({"tokens": array(text_option, 2, 12)}),
    "reading_choice": obj({"passage_text": string(3000), "question_text": string(300), "options": text_options}),
    "retell": obj({"prompt_text": string(500), "source_text": string(3000), "image_asset_id": deepcopy(UUID), "recording_max_seconds": {"type": "integer", "minimum": 5, "maximum": 60}}, ["prompt_text", "recording_max_seconds"])
}
payloads["retell"]["anyOf"] = [{"required": [key]} for key in ["source_text", "image_asset_id"]]
normalization = obj({"case_sensitive": {"type": "boolean"}, "trim_whitespace": {"type": "boolean"}, "collapse_whitespace": {"type": "boolean"}, "punctuation_mode": {"enum": ["strict", "ignore"]}})
answers = {
    "single_choice": obj({"answer_kind": {"const": "single_choice"}, "accepted_option_ids": ids(1, 1)}),
    "text": obj({"answer_kind": {"const": "text"}, "accepted_texts": array(string(200), 1, 12, True), "normalization": normalization}),
    "matching": obj({"answer_kind": {"const": "matching"}, "pairs": array(obj({"left_id": deepcopy(UUID), "right_id": deepcopy(UUID)}), 2, 6), "one_to_one": {"const": True}}),
    "sequence": obj({"answer_kind": {"const": "sequence"}, "accepted_sequences": array(ids(2, 12), 1, 6)}),
    "manual_review": obj({"answer_kind": {"const": "manual_review"}, "rubric": array(obj({"criterion": {"enum": ["content_accuracy", "readability", "meaning_coverage", "independent_expression"]}, "description": string(300)}), 1, 4), "confirmation_mode": {"const": "parent_confirmation"}})
}
answer_for = {q: "single_choice" for q in ["audio_to_picture", "word_to_picture", "picture_to_word", "sentence_choice", "cloze_choice", "reading_choice"]}
answer_for.update({"cloze_text": "text", "matching": "matching", "word_order": "sequence", "oral_reading": "manual_review", "retell": "manual_review"})
quote = obj({"slice_id": deepcopy(UUID), "source_role": {"enum": ["assessed", "context", "distractor"]}, "quote": string(1000), "start_char": {"type": "integer", "minimum": 0}, "end_char": {"type": "integer", "minimum": 1}})
candidate_schema = schema("question-candidate", obj({
    "schema_version": {"const": "1.0.0"}, "id": deepcopy(UUID), "blueprint_id": deepcopy(UUID), "phase": {"enum": ["p1", "p2"]},
    "question_family_key": {"type": "string", "minLength": 3, "maxLength": 128, "pattern": "^[a-z0-9]+(?:[._-][a-z0-9]+)*$"},
    "question_type": {"enum": P1 + P2}, "source_slice_ids": ids(1, 16), "context_slice_ids": ids(0, 16), "objective_ids": ids(1, 1), "skill": {"enum": SKILLS}, "modality": {"enum": MODALITIES},
    "difficulty": {"type": "integer", "minimum": 1, "maximum": 5}, "estimated_seconds": {"type": "integer", "minimum": 1, "maximum": 600}, "presentation_kind": {"enum": ["verbatim", "paraphrase", "contextualized"]},
    "prompt_text": string(3000, 0), "instruction_text": string(500), "public_payload": {"type": "object"}, "answer_spec": {"type": "object"}, "explanation": string(1000),
    "requires_microphone": {"type": "boolean"}, "requires_typing": {"type": "boolean"}, "quality_risks": array({"enum": ["ambiguous_answer", "context_missing", "source_uncertain", "media_uncertain", "scope_uncertain", "language_variant", "target_leakage", "open_response"]}, 0, 8, True),
    "source_quotes": array(quote, 1, 16)
}))
candidate_schema["$defs"] = {**{"payload_" + q: p for q, p in payloads.items()}, **{"answer_" + a: p for a, p in answers.items()}}
candidate_schema["allOf"] = [
    {"if": {"properties": {"question_type": {"const": q}}, "required": ["question_type"]}, "then": {"properties": {"public_payload": {"$ref": "#/$defs/payload_" + q}, "answer_spec": {"$ref": "#/$defs/answer_" + answer_for[q]}}}} for q in P1 + P2
]
candidate_schema["allOf"].append({"if": {"properties": {"phase": {"const": "p1"}}, "required": ["phase"]}, "then": {"properties": {"question_type": {"enum": P1}}}})
for name, data in [("source-slice", source_schema), ("generation-blueprint", blueprint_schema), ("question-candidate", candidate_schema)]:
    dump(ROOT / (name + ".schema.json"), data)

# Example UUIDs are registered fixtures, not claims about a publisher's textbook.
NS = uuid.UUID("b2c25028-8933-4552-9c09-4876fa7d86a5")
def uid(name): return str(uuid.uuid5(NS, name))
def sha(text): return hashlib.sha256(text.encode("utf-8")).hexdigest()
version_id, node_id, source_media_id = [uid(x) for x in ["content-version", "content-node", "original-document"]]
context_id, bag_id, blue_id = [uid(x) for x in ["context", "bag-sentence", "blue-sentence"]]
texts = {context_id: "This is my bag. It is blue.", bag_id: "This is my bag.", blue_id: "It is blue."}
assets = []
for label in ["bag", "cat", "dog"]:
    assets.append({"id": uid("image-" + label), "media_type": "image", "sha256": sha("fixture-image-" + label), "mime_type": "image/png", "semantic_tags": [label], "verification_status": "verified"})
assets.append({"id": uid("audio-bag"), "media_type": "audio", "sha256": sha("fixture-audio-bag"), "mime_type": "audio/wav", "semantic_tags": ["bag"], "verification_status": "verified", "transcript": "bag", "duration_ms": 900})
assets.append({"id": uid("audio-page"), "media_type": "audio", "sha256": sha("fixture-audio-page"), "mime_type": "audio/wav", "semantic_tags": ["bag", "blue", "page"], "verification_status": "verified", "transcript": texts[context_id], "duration_ms": 3200})
sources = []
for sid in [context_id, bag_id, blue_id]:
    src = {"schema_version": "1.0.0", "id": sid, "content_version_id": version_id, "node_id": node_id,
           "kind": "context" if sid == context_id else "sentence", "original_text": texts[sid], "normalized_text": texts[sid], "source_hash": sha(texts[sid]), "source_media_id": source_media_id,
           "context_slice_ids": [] if sid == context_id else [context_id], "media_asset_ids": [], "locator": {"page_index": 1, "page_label": "自编页1"}, "media_bindings": [],
           "provenance": {"origin_kind": "family_authored", "extraction_method": "trusted_package", "verification_status": "verified", "adapter_version": "family-text-1.0.0", "parser_version": "structured-1.0.0"},
           "rights": {"rights_code": "family-original", "usage_scope": "household_only", "cloud_processing_allowed": False}}
    if sid == bag_id:
        binding = {"media_type": "image", "asset_id": uid("image-bag"), "role": "illustration", "ordinal": 0, "region": {"x": 0, "y": 0, "width": 1, "height": 1}}
        src["media_bindings"] = [binding]
        src["media_asset_ids"] = [binding["asset_id"]]
    if sid == context_id:
        binding = {"media_type": "audio", "asset_id": uid("audio-page"), "role": "reference_audio", "ordinal": 0, "start_ms": 0, "end_ms": 3200, "transcript": texts[context_id]}
        src["media_bindings"] = [binding]
        src["media_asset_ids"] = [binding["asset_id"]]
    sources.append(src)
    dump(EXAMPLES / ("source-slice." + ("context" if sid == context_id else "bag" if sid == bag_id else "blue") + ".valid.json"), src)

specs = {
    "audio_to_picture": ("listening", "audio", "bag"), "word_to_picture": ("word_recognition", "text", "bag"), "picture_to_word": ("word_recognition", "visual", "bag"), "oral_reading": ("oral_reading", "speech", "This is my bag."),
    "sentence_choice": ("sentence_comprehension", "text", "This is my bag."), "cloze_choice": ("sentence_comprehension", "text", "bag"), "cloze_text": ("spelling", "text", "bag"), "matching": ("word_recognition", "text", "bag; blue"),
    "word_order": ("sentence_comprehension", "text", "This is my bag."), "reading_choice": ("sentence_comprehension", "text", "It is blue."), "retell": ("oral_expression", "speech", "This is my bag. It is blue.")}
objectives = [{"id": uid("objective-" + q), "skill": values[0], "modality": values[1], "target_text": values[2], "source_slice_ids": [bag_id, blue_id] if q in ["matching", "reading_choice", "retell"] else [bag_id]} for q, values in specs.items()]
# The blue comprehension objective is grounded in its context-bearing two-sentence scope.
blueprints = []
for phase, qtypes in [("p1", P1), ("p2", P2)]:
    objective_list = [o for q, o in zip(specs, objectives) if q in qtypes]
    slots = []
    for q in qtypes:
        o = next(o for qq, o in zip(specs, objectives) if qq == q)
        slots.append({"id": uid("candidate-" + q), "question_type": q, "component_ids": [uid(q + "-component-" + str(i)) for i in range(12)], "source_slice_ids": o["source_slice_ids"], "context_slice_ids": [context_id], "objective_ids": [o["id"]], "skill": o["skill"], "modality": o["modality"], "difficulty": 1})
    bp = {"schema_version": "1.0.0", "id": uid("blueprint-" + phase), "phase": phase, "content_version_id": version_id, "source_slice_ids": [bag_id, blue_id], "context_slice_ids": [context_id],
          "source_snapshots": [],
          "objectives": objective_list, "registered_assets": assets, "allowed_vocabulary": [{"vocabulary_sense_id": uid("sense-" + w), "form": w, "role": "target" if w in ["bag", "blue"] else "known_distractor"} for w in ["bag", "blue", "cat", "dog", "red", "green"]],
          "learner_capabilities": {"can_read_instructions": False, "can_spell": phase == "p2", "supports_touch": True, "supports_dpad": False, "supports_recording": True}, "candidate_slots": slots,
          "template_version": "english-foundation-1.0.0", "prompt_version": "source-grounded-1.0.0", "quality_policy_id": uid("quality-policy"),
          "generation_policy": {"provider_mode": "local", "allow_paraphrase": False, "max_output_tokens": 8192, "timeout_seconds": 90, "target_question_seconds": 30}}
    bp["request"] = {"scope": {"content_version_id": version_id, "source_slice_ids": [bag_id, blue_id], "context_slice_ids": [context_id], "objective_ids": [o["id"] for o in objective_list]}, "question_types": qtypes, "count_per_objective": 1, "difficulty_band": 1, "template_version": "english-foundation-1.0.0", "budget_limit_microunits": "5000000", "expected_content_revision": 1}
    bp["source_snapshots"] = [{"id": s["id"], "content_version_id": version_id, "node_id": node_id, "kind": s["kind"], "original_text": s["original_text"], "normalized_text": s["normalized_text"], "source_hash": s["source_hash"], "context_slice_ids": s["context_slice_ids"], "media_asset_ids": s["media_asset_ids"], "media_bindings": s["media_bindings"]} for s in sources]
    blueprints.append(bp)
    dump(EXAMPLES / ("generation-blueprint." + phase + ".valid.json"), bp)

candidates = []
for q, values in specs.items():
    phase = "p1" if q in P1 else "p2"
    bp = next(b for b in blueprints if b["phase"] == phase)
    sl = next(s for s in bp["candidate_slots"] if s["question_type"] == q)
    ci = sl["component_ids"]
    picopts = [{"id": ci[i], "asset_id": uid("image-" + label)} for i, label in enumerate(["bag", "cat", "dog"])]
    txtopts = [{"id": ci[i], "text": label} for i, label in enumerate(["bag", "cat", "dog"])]
    payload = {}
    prompt = ""
    instruction_text = ""
    if q == "audio_to_picture": instruction_text = "听单词，选图片。"; payload = {"audio_asset_id": uid("audio-bag"), "options": picopts}
    elif q == "word_to_picture": prompt = "bag"; instruction_text = "选出单词对应的图片。"; payload = {"options": picopts}
    elif q == "picture_to_word": prompt = "看图片，选单词。"; payload = {"image_asset_id": uid("image-bag"), "options": txtopts}
    elif q == "oral_reading": prompt = texts[bag_id]; instruction_text = "读一读这句话，可以请家长帮忙。"; payload = {"target_text": texts[bag_id], "recording_max_seconds": 15}
    elif q == "sentence_choice": prompt = "选出意思相同的一项。"; payload = {"stimulus": {"kind": "text", "text": texts[bag_id]}, "options": [{"id": ci[0], "text": "这是我的包。"}, {"id": ci[1], "text": "这是我的猫。"}, {"id": ci[2], "text": "这是我的狗。"}]}
    elif q in ["cloze_choice", "cloze_text"]:
        prompt = "补全这句话。"
        payload = {"prefix_text": "This is my ", "suffix_text": ".", "gap_id": ci[3]}
        if q == "cloze_choice": payload["options"] = txtopts
        else: payload["max_answer_characters"] = 20
    elif q == "matching": prompt = "把英文和意思配起来。"; payload = {"left_items": [{"id": ci[0], "text": "bag"}, {"id": ci[1], "text": "blue"}], "right_items": [{"id": ci[2], "text": "蓝色"}, {"id": ci[3], "text": "包"}]}
    elif q == "word_order": prompt = "把词块排成原句。"; payload = {"tokens": [{"id": ci[i], "text": w} for i, w in enumerate(["bag", "is", "my", "this"])]}
    elif q == "reading_choice": prompt = "包是什么颜色？"; instruction_text = "读短文，选答案。"; payload = {"passage_text": texts[context_id], "question_text": prompt, "options": [{"id": ci[i], "text": w} for i, w in enumerate(["蓝色", "红色", "绿色"])]}
    elif q == "retell": prompt = "用学过的句子介绍这个包。"; payload = {"prompt_text": "可以说它是谁的、是什么颜色。", "source_text": texts[context_id], "image_asset_id": uid("image-bag"), "recording_max_seconds": 30}
    if not instruction_text: instruction_text = prompt or "按提示完成。"
    if not prompt: prompt = instruction_text
    kind = answer_for[q]
    if kind == "single_choice": answer = {"answer_kind": kind, "accepted_option_ids": [ci[0]]}
    elif kind == "text": answer = {"answer_kind": kind, "accepted_texts": ["bag"], "normalization": {"case_sensitive": True, "trim_whitespace": True, "collapse_whitespace": True, "punctuation_mode": "strict"}}
    elif kind == "matching": answer = {"answer_kind": kind, "pairs": [{"left_id": ci[0], "right_id": ci[3]}, {"left_id": ci[1], "right_id": ci[2]}], "one_to_one": True}
    elif kind == "sequence": answer = {"answer_kind": kind, "accepted_sequences": [[ci[3], ci[1], ci[2], ci[0]]]}
    else: answer = {"answer_kind": kind, "rubric": [{"criterion": "content_accuracy" if q == "oral_reading" else "meaning_coverage", "description": "家长依据源片段确认目标内容；未听清可重录，不计知识错误。"}], "confirmation_mode": "parent_confirmation"}
    qs = [bag_id, blue_id] if q in ["matching", "reading_choice", "retell"] else [bag_id]
    candidate = {"schema_version": "1.0.0", "id": sl["id"], "blueprint_id": bp["id"], "phase": phase, "question_family_key": "fixture." + q.replace("_", "-") + ".bag", "question_type": q,
                 "source_slice_ids": sl["source_slice_ids"], "context_slice_ids": sl["context_slice_ids"], "objective_ids": sl["objective_ids"], "skill": values[0], "modality": values[1], "difficulty": 1,
                 "estimated_seconds": 15 if q in P1 else 30, "presentation_kind": "verbatim", "prompt_text": prompt, "instruction_text": instruction_text, "public_payload": payload, "answer_spec": answer, "explanation": "本题来自家庭自编页句，按所列目标验证。", "requires_microphone": q in ["oral_reading", "retell"], "requires_typing": q == "cloze_text", "quality_risks": ["open_response"] if q in ["oral_reading", "retell"] else [],
                 "source_quotes": [{"slice_id": sid, "source_role": "assessed", "quote": texts[sid], "start_char": 0, "end_char": len(texts[sid])} for sid in qs]}
    candidates.append(candidate)
    dump(EXAMPLES / ("question-candidate." + q + ".valid.json"), candidate)

dump(EXAMPLES / "fixture-registry.json", {"description": "Self-authored, pre-registered contract fixtures; no real textbook or child data.", "content_version_id": version_id, "source_media_id": source_media_id, "source_slice_ids": [context_id, bag_id, blue_id], "registered_asset_ids": [a["id"] for a in assets]})
print(json.dumps({"schemas": 3, "source_examples": len(sources), "blueprint_examples": len(blueprints), "candidate_examples": len(candidates)}, ensure_ascii=False))

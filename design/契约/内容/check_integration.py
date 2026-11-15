"""Read-only integration audit of content contracts against current OpenAPI and DB catalog/DDL."""
from pathlib import Path
from copy import deepcopy
import importlib.util
import hashlib
import json
import re
import sys
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent
DESIGN = ROOT.parent.parent

def load(path): return json.loads(path.read_text(encoding="utf-8"))

def main():
    api_path = DESIGN / "契约/openapi.json"
    catalog_path = DESIGN / "数据库/catalog.json"
    ddl_path = DESIGN / "数据库/schema.sql"
    api, catalog = load(api_path), load(catalog_path)
    components = api["components"]
    tables = {t["name"]: t for t in catalog["tables"]}
    checks = []
    def record(name, ok, detail=""):
        checks.append({"name": name, "passed": bool(ok), "detail": detail})
    def validate(name, data):
        v = Draft202012Validator({"$ref": "#/components/schemas/" + name, "components": components}, format_checker=FormatChecker())
        errors = list(v.iter_errors(data))
        record("openapi_valid:" + name, not errors, "; ".join(e.message for e in errors))
    def enum_from_sql(text, field):
        match = re.search(r"CHECK\s*\(\s*" + field + r"\s+IN\s*\(([^)]*)\)", text, re.I)
        return set(re.findall(r"'([^']+)'", match.group(1))) if match else set()
    question_schema = load(ROOT / "question-candidate.schema.json")
    content_types = set(question_schema["properties"]["question_type"]["enum"])
    api_types = set(components["schemas"]["GenerationRequest"]["properties"]["question_types"]["items"]["enum"])
    db_types = enum_from_sql(" ".join(tables["question_versions"]["constraints"]), "question_type")
    ddl_text = ddl_path.read_text(encoding="utf-8")
    ddl_types = enum_from_sql(ddl_text, "question_type")
    record("question_types:content_vs_openapi", content_types == api_types, "missing_api=" + str(sorted(content_types-api_types)))
    record("question_types:content_vs_catalog", content_types == db_types, "missing_db=" + str(sorted(content_types-db_types)) + "; extra_db=" + str(sorted(db_types-content_types)))
    record("question_types:catalog_vs_ddl", db_types == ddl_types, "catalog=" + str(sorted(db_types)) + "; ddl=" + str(sorted(ddl_types)))
    expected_kinds = {"context", "sentence", "word"}
    record("source_kinds:content", set(load(ROOT/"source-slice.schema.json")["properties"]["kind"]["enum"]) == expected_kinds)
    record("source_kinds:openapi", set(components["schemas"]["SourceSlice"]["properties"]["kind"]["enum"]) == expected_kinds)
    record("source_kinds:catalog", enum_from_sql(" ".join(tables["source_slices"]["constraints"]), "slice_kind") == expected_kinds)
    answer = components["schemas"]["AnswerResponse"]["oneOf"]
    uuid_paths = [
        ("option_id", answer[0]["properties"]["option_id"]),
        ("gap_text.gap_id", answer[1]["properties"]["gaps"]["items"]["oneOf"][0]["properties"]["gap_id"]),
        ("gap_choice.gap_id", answer[1]["properties"]["gaps"]["items"]["oneOf"][1]["properties"]["gap_id"]),
        ("gap_choice.option_id", answer[1]["properties"]["gaps"]["items"]["oneOf"][1]["properties"]["option_id"]),
        ("left_id", answer[2]["properties"]["pairs"]["items"]["properties"]["left_id"]),
        ("right_id", answer[2]["properties"]["pairs"]["items"]["properties"]["right_id"]),
        ("token_ids.items", answer[3]["properties"]["token_ids"]["items"]),
        ("media_asset_id", answer[4]["properties"]["media_asset_id"])
    ]
    for label, field in uuid_paths:
        record("response_id_uuid:"+label, field.get("type")=="string" and field.get("format")=="uuid", json.dumps(field,ensure_ascii=False))
    for table, column in [("question_options","id"),("question_answers","option_id"),("question_answers","match_option_id")]:
        found = next((c for c in tables[table]["columns"] if c["name"] == column),{})
        record("database_uuid:"+table+"."+column, found.get("type")=="uuid")
    spec=importlib.util.spec_from_file_location("content_validator",ROOT/"validate_contracts.py")
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    response_examples=[]
    for path in sorted((ROOT/"examples").glob("question-candidate.*.valid.json")):
        q=load(path); a=q["answer_spec"]; kind=a["answer_kind"]
        if q["question_type"]=="cloze_choice": response={"gaps":[{"gap_id":q["public_payload"]["gap_id"],"option_id":a["accepted_option_ids"][0]}]}
        elif kind=="single_choice": response={"option_id":a["accepted_option_ids"][0]}
        elif kind=="text": response={"gaps":[{"gap_id":q["public_payload"]["gap_id"],"text":a["accepted_texts"][0]}]}
        elif kind=="matching":response={"pairs":a["pairs"]}
        elif kind=="sequence":response={"token_ids":a["accepted_sequences"][0]}
        else:response={"media_asset_id":q["id"]}
        validate("AnswerResponse",response)
        validate("AnswerRequest",{"challenge_item_id":q["id"],"response":response,"expected_revision":1,"lease_epoch":1,"client_event_id":q["blueprint_id"]})
        validate("PublicQuestion",module.public_projection(q))
        response_examples.append({"question_type":q["question_type"],"response":response})
    for label, base in [("fake_option",response_examples[0]["response"]),("extra_correct",response_examples[0]["response"])]:
        value={"option_id":"not-a-uuid"} if label=="fake_option" else {**base,"correct":True}
        v=Draft202012Validator({"$ref":"#/components/schemas/AnswerResponse","components":components},format_checker=FormatChecker())
        record("response_reject:"+label,bool(list(v.iter_errors(value))))
    report={"result":"pass" if all(c["passed"] for c in checks) else "fail","checks":checks,"passed":sum(c["passed"] for c in checks),"total":len(checks),
            "inputs_sha256":{str(p.relative_to(DESIGN)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [api_path,catalog_path,ddl_path]},"network_calls":0,"llm_calls":0,"response_examples":response_examples}
    (ROOT/"integration-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    failed=[c for c in checks if not c["passed"]]
    print(json.dumps({"result":report["result"],"passed":report["passed"],"total":report["total"],"failed":failed},ensure_ascii=False,indent=2))
    if failed:sys.exit(1)

if __name__=="__main__":main()

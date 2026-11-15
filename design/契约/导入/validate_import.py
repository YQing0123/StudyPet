"""题库导入预检：在写入数据库前，把 L1 结构 / L2 引用 / L3 语义 / L4 重复 全部查一遍。

用法：python3 validate_import.py <bundle_dir>
退出码：0 全部通过；1 存在拒绝项。
"""
import json, sys, hashlib
from pathlib import Path
from jsonschema import Draft202012Validator

HERE = Path(__file__).resolve().parent
MANIFEST_SCHEMA = json.loads((HERE / "manifest.schema.json").read_text(encoding="utf-8"))
CAND_SCHEMA = json.loads((HERE / "candidate.external.schema.json").read_text(encoding="utf-8"))
MANIFEST_V = Draft202012Validator(MANIFEST_SCHEMA)
CAND_V = Draft202012Validator(CAND_SCHEMA)


def l3_semantic(c):
    """语义层检查：返回问题列表 [(code, message)]"""
    out = []
    pp = c.get("public_payload") or {}
    ans = c.get("answer_spec") or {}
    kind = ans.get("answer_kind")
    options = pp.get("options") or []

    # 选项数量
    if kind in ("single_choice", "multi_choice"):
        if len(options) < 2:
            out.append(("L3_TOO_FEW_OPTIONS", f"选项仅 {len(options)} 个，至少 2 个"))
        # 选项重复（按 asset 或 text）
        seen = {}
        for i, o in enumerate(options):
            key = o.get("asset") or o.get("text")
            if key is None:
                out.append(("L3_OPTION_SHAPE", f"第 {i+1} 个选项缺少 asset/text"))
                continue
            if key in seen:
                out.append(("L3_DUPLICATE_OPTIONS",
                            f"第 {seen[key]+1} 与第 {i+1} 个选项重复：{key}"))
            else:
                seen[key] = i
        # 答案索引合法性
        idx = ans.get("accepted_option_indices")
        if idx is None:
            out.append(("L3_MISSING_ANSWER", "缺少 accepted_option_indices"))
        else:
            for k in idx:
                if not isinstance(k, int) or k < 0 or k >= len(options):
                    out.append(("L3_ANSWER_OUT_OF_RANGE", f"答案索引 {k} 超出选项范围"))
            if kind == "single_choice" and len(idx) != 1:
                out.append(("L3_ANSWER_COUNT", f"单选题答案数应为 1，实际 {len(idx)}"))

    # 麦克风一致性
    if kind == "speech" and not c.get("requires_microphone"):
        out.append(("L3_MIC_FLAG", "口语题未标记 requires_microphone"))
    if kind != "speech" and c.get("requires_microphone"):
        out.append(("L3_MIC_FLAG", "非口语题却标记需要麦克风"))

    # 题型与能力匹配
    qt, skill = c.get("question_type"), c.get("skill")
    expect = {
        "word_to_picture": "word_recognition", "picture_to_word": "word_recognition",
        "audio_to_picture": "listening", "reading_choice": "sentence_comprehension",
        "cloze_choice": "sentence_comprehension", "cloze_text": "sentence_comprehension",
        "sentence_choice": "sentence_comprehension", "word_order": "sentence_comprehension",
        "matching": "word_recognition", "oral_reading": "oral_reading",
        "retell": "oral_expression",
    }
    if qt in expect and skill != expect[qt]:
        out.append(("L3_SKILL_MISMATCH", f"{qt} 应测 {expect[qt]}，实际声明 {skill}"))

    return out


def l2_assets(c, bundle_dir):
    """引用层：素材相对路径必须存在于 bundle 内"""
    out = []
    pp = c.get("public_payload") or {}
    refs = []
    for key in ("options", "items", "pairs", "pairs_left", "pairs_right"):
        for o in pp.get(key) or []:
            if isinstance(o, dict) and o.get("asset"):
                refs.append(o["asset"])
    for k in ("audio", "image", "prompt_audio"):
        if pp.get(k):
            refs.append(pp[k])
    for r in refs:
        p = (bundle_dir / r).resolve()
        try:
            p.relative_to(bundle_dir.resolve())
        except ValueError:
            out.append(("L2_PATH_TRAVERSAL", f"素材路径越界：{r}"))
            continue
        if not p.is_file():
            out.append(("L2_ASSET_MISSING", f"素材不存在：{r}"))
    return out


def dedupe_key(c):
    raw = "|".join([
        c.get("question_type", ""),
        c.get("question_family_key", ""),
        json.dumps(sorted(c.get("source_refs") or [], key=lambda x: (x.get("page", 0), x.get("sentence_index", 0))), sort_keys=True),
        c.get("prompt_text", ""),
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def main(bundle):
    bundle = Path(bundle).resolve()
    errors, warnings = [], []
    accepted, rejected = 0, []

    mpath = bundle / "manifest.json"
    if not mpath.is_file():
        print(json.dumps({"ok": False, "error": "缺少 manifest.json"}, ensure_ascii=False))
        return 1
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    for e in MANIFEST_V.iter_errors(manifest):
        errors.append({"where": "manifest", "code": "L1_MANIFEST", "message": e.message})

    cpath = bundle / "candidates.jsonl"
    if not cpath.is_file():
        print(json.dumps({"ok": False, "error": "缺少 candidates.jsonl"}, ensure_ascii=False))
        return 1

    seen_keys, seen_fams = {}, set()
    lines = cpath.read_text(encoding="utf-8").splitlines()
    for ln, raw in enumerate(lines, 1):
        if not raw.strip():
            continue
        try:
            c = json.loads(raw)
        except json.JSONDecodeError as ex:
            rejected.append({"line": ln, "code": "L1_JSON", "message": f"JSON 解析失败：{ex.msg}"})
            continue

        problems = []
        # L1
        for e in CAND_V.iter_errors(c):
            path = "/".join(str(x) for x in e.absolute_path) or "(root)"
            problems.append(("L1_SCHEMA", f"{path}: {e.message}"))
        if not problems:                     # 结构不过就不做后续层
            # L2
            problems += l2_assets(c, bundle)
            # L3
            problems += l3_semantic(c)
            # L4
            k = dedupe_key(c)
            if k in seen_keys:
                problems.append(("L4_DUPLICATE",
                                 f"与第 {seen_keys[k]} 行重复（dedupe_key={k}）"))
            else:
                seen_keys[k] = ln
            fam = c.get("question_family_key")
            if fam in seen_fams:
                warnings.append({"line": ln, "code": "W_FAMILY_REUSED",
                                 "message": f"question_family_key 重复：{fam}"})
            seen_fams.add(fam)

        if problems:
            for code, msg in problems:
                rejected.append({"line": ln, "code": code, "message": msg})
        else:
            accepted += 1

    total = sum(1 for l in lines if l.strip())
    if manifest.get("candidate_count") != total:
        warnings.append({"where": "manifest", "code": "W_COUNT_MISMATCH",
                         "message": f"声明 {manifest.get('candidate_count')} 条，实际 {total} 条"})

    result = {
        "ok": not errors and not rejected,
        "bundle": str(bundle),
        "total": total,
        "accepted": accepted,
        "rejected_count": len({r["line"] for r in rejected}),
        "duplicates": len([r for r in rejected if r["code"].startswith("L4")]),
        "rejected": rejected,
        "warnings": warnings,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("用法: python3 validate_import.py <bundle_dir>")
        sys.exit(2)
    sys.exit(main(sys.argv[1]))

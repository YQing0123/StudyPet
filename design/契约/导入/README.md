# 题库导入格式

外部 Agent 出题后的提交规范。三种入口共用同一套校验：MCP 工具、HTTP 上传、界面拖拽。

## 目录结构

```
bundle/
  manifest.json      批次信息（必填）
  candidates.jsonl   每行一个候选题（必填）
  assets/            图片、音频，按相对路径引用
```

## manifest.json

```json
{
  "schema_version": "1.0.0",
  "bundle_id": "demo-raz-b-bag-001",
  "created_by": "agent:claude-code",
  "library_ref": { "series": "RAZ", "level": "B", "book": "The Bag" },
  "generator": { "provider": "openai", "model": "gpt-5", "prompt_version": "v3" },
  "candidate_count": 3,
  "note": "第 3-6 页"
}
```

约束见 `manifest.schema.json`。`bundle_id` 是幂等键，同一 id 重复提交不重复建。

## candidates.jsonl

每行一个 JSON 对象，字段见 `candidate.external.schema.json`。

```jsonl
{"schema_version":"1.0.0","question_type":"word_to_picture","question_family_key":"raz.b.bag.w2p.01","phase":"p1","source_refs":[{"page":3,"sentence_index":1}],"objective_refs":["raz.b.bag.recognize.bag"],"skill":"word_recognition","modality":"visual","difficulty":1,"estimated_seconds":15,"presentation_kind":"verbatim","prompt_text":"bag","instruction_text":"选出单词对应的图片。","public_payload":{"options":[{"asset":"assets/bag.png"},{"asset":"assets/cup.png"},{"asset":"assets/dog.png"}]},"answer_spec":{"answer_kind":"single_choice","accepted_option_indices":[0]},"explanation":"bag 是书包。","quality_risks":[],"requires_microphone":false,"requires_typing":false}
```

## 核心规则：只写自然键

外部**不要**写 UUID。agent 会编造 UUID，但不会编造页码。

| 外部写法 | 系统解析为 |
|---|---|
| `source_refs: [{page, sentence_index}]` | `source_slice_ids` |
| `objective_refs: ["raz.b.bag.recognize.bag"]` | `objective_ids` |
| `public_payload.options[].asset: "assets/x.png"` | `asset_id`（按内容 sha256 注册） |
| `answer_spec.accepted_option_indices: [0]` | `accepted_option_ids` |

解析失败不猜测，直接拒绝并给出行号与原因。

曾出现过 UUID 悬空引用的候选，一律在 L2 层拒绝。

## 校验层级

| 层 | 检查 | 失败 |
|---|---|---|
| L1 结构 | JSON Schema 2020-12 | 拒绝该条 |
| L2 引用 | 素材存在、路径不越界、切片与目标有效 | 拒绝该条 |
| L3 语义 | 选项不重复、答案索引合法、答案数匹配题型、题型与能力一致、麦克风标记一致 | 拒绝该条 |
| L4 重复 | `dedupe_key` 已存在 | 标记 duplicate，不新建 |
| L5 人工 | 按风险抽检 | 进待审队列 |

`dedupe_key = sha256(question_type | question_family_key | sorted(source_refs) | prompt_text)`

## 状态机

```
imported → validated → ready → published → retracted
                ↘ rejected（保留原因，可重跑）
```

已发布不可改，只能撤回后重新导入。

## 预检

```bash
python3 validate_import.py <bundle_dir>
```

退出码 0 表示全部通过，1 表示存在拒绝项。输出逐行定位：

```json
{
  "ok": false,
  "total": 9,
  "accepted": 1,
  "rejected_count": 8,
  "duplicates": 1,
  "rejected": [
    { "line": 4, "code": "L2_PATH_TRAVERSAL", "message": "素材路径越界：../../../../etc/passwd" },
    { "line": 9, "code": "L4_DUPLICATE", "message": "与第 8 行重复（dedupe_key=...）" }
  ]
}
```

## 样例

| 目录 | 内容 | 预期 |
|---|---|---|
| `example/` | 3 条合规候选 + 3 张词图 | 全部通过 |
| `example-bad/` | 9 条，覆盖 L1–L4 各类错误 | 拒绝 8 条，通过 1 条 |

已实测：`example/` 通过 3/3；`example-bad/` 捕获 2×L1、1×L2 缺失、1×L2 路径穿越、4×L3、1×L4。

## MCP 对应

同一套校验，写入侧工具：

- `question.create_batch` —— 传 candidates.jsonl 内容，逐条返回结果
- `asset.register` —— 注册素材，返回 asset_id
- `import.create_bundle` —— 提交完整 bundle

单次 ≤ 200 条；错误逐条定位行号，便于 agent 自我修正重跑。

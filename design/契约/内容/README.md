# 内容契约使用说明

本目录定义内容生产边界，不包含教材全文、模型密钥、远程脚本安装或网络LLM调用。所有样例是家庭自编英文，不对应官方RAZ或新概念课文。

## 文件

| 文件 | 用途 |
|---|---|
| source-slice.schema.json | 不可变上下文/原子源片段，含页定位、主图区域和音频时间片 |
| generation-blueprint.schema.json | 服务端组装的模型输入蓝图，包含真实输入UUID、目标、素材登记和候选槽位 |
| question-candidate.schema.json | 模型候选输出，按11种题型严格区分public_payload及私有answer_spec |
| examples/ | 3个源片段、2个生成蓝图、11个候选有效样例及夹具注册表 |
| build_contracts.py | 从受控定义重建Schema和自编有效样例，无网络调用 |
| validate_contracts.py | Draft2020-12结构验证、领域lint、公开投影检查和负例检查CLI |
| validation-report.json | 最近一次离线检查结果 |
| check_integration.py | 对当前OpenAPI和数据库catalog/schema.sql做只读字段与枚举跨检 |
| integration-report.json | 跨文件检查结论、输入摘要及11种作答响应样例 |
| 运行与落库映射.json | 制作候选到公开题目、私有答案行及任务状态的明确映射 |
| 开源逻辑映射.json | Anzo和Lute实际阅读逻辑、采用/调整/不照搬点及来源 |

## 本机验证

使用已经具备Python 3与jsonschema>=4.16的环境；工具不自动安装依赖。Schema只用本地$defs，不在校验时解析外网引用。UUID除了format还设有形状pattern，FormatChecker显式开启。

```bash
python3 design/契约/内容/build_contracts.py
python3 design/契约/内容/validate_contracts.py --all
python3 design/契约/内容/check_integration.py
```

单独验证候选，并对照生成蓝图做领域检查：

```bash
python3 design/契约/内容/validate_contracts.py --schema question-candidate --input design/契约/内容/examples/question-candidate.word_to_picture.valid.json --blueprint design/契约/内容/examples/generation-blueprint.p1.valid.json
```

结构错误或领域错误返回exit 1，正常返回exit 0。`--all`不写外部文件，只更新本目录的validation-report.json。生成器只覆盖本目录的三个Schema和样例文件；应先评审生成器修改，再统一重建，避免手改生成产物造成漂移。

## 稳定约定

- 规范key统一snake_case；JSON Schema标准关键字遵守Draft2020-12自身拼写。
- 对象实体id采用UUID。family_id不进入蓝图或候选，归属由服务端上下文确定。
- 候选id和选项/词块/gap id来自candidate_slots的预分配UUID；模型只回显，不生成身份。
- source_slice_ids/context_slice_ids/objective_ids/asset id必须来自真实蓝图输入，不接受自由拼接或任意URL。
- question_family_key仅是模型分组建议；服务端根据目标与题目语义归并，分配真实question_families.id。
- objective_id表示具体能力目标。skill为listening、word_recognition、oral_reading、sentence_comprehension、spelling、oral_expression；modality为audio、visual、text、speech。
- P1只允许audio_to_picture、word_to_picture、picture_to_word、oral_reading；前三类服务端客观判分，第四类parent_confirmation。
- P2增加sentence_choice、cloze_choice、cloze_text、matching、word_order、reading_choice、retell。P2 Schema存在不代表P1应用已实现。
- provider候选只在私有生产服务处理；answer_spec和explanation写private server，不随原provider响应返回孩子。
- public_projection按白名单构造PublicQuestion：challenge_item_id、question_version_id、question_type、instruction、public_payload、required_response_kind。验证时没有答案、解释、source_quotes和目标标签；训练解释走单独授权的反馈投影。
- cloze_choice运行响应为gaps[{gap_id,option_id}]，cloze_text为gaps[{gap_id,text}]；两者required_response_kind均为gaps，不把选词空位当普通整题option响应。
- fixture-registry.json中的媒体摘要是结构测试占位摘要，没有伪称对应实际图片/音频字节。上线登记必须重新核验真实文件MIME、摘要、权利、时长和语义。

## 数据库映射

source-slice.node_id直接映射source_slices.node_id，kind映射slice_kind（context/sentence/word），normalized_text直接映射规范化文本列；source_media_id引用统一media_assets。media_bindings写slice_media_bindings，图片区域与音频时间片按binding保存，source_slices主图/主音列可保留默认显示引用。context_slice_ids写slice_contexts，父上下文使用parent_context关系而非额外父字段；同版本与无环约束由持久层及领域lint处理。

candidate的规范家族进入question_families；呈现字段进question_versions/question_options；题源进question_sources；答案与解释分解进private.question_answers。候选每题恰有一个objective_ids主目标，蓝图可含多个目标；难度统一1..5。映射细则见运行与落库映射.json。候选public_payload是制作形状，运行PublicQuestion另带challenge_item_id、question_version_id、instruction、required_response_kind，并把顶层prompt_text放入公开载荷；答案和解释均不在该投影。NFC固定在评分器版本，normalization四字段映射数据库case_sensitive、trim_whitespace、collapse_whitespace、punctuation_mode。

当同级openapi.json存在时，CLI还验证3个SourceSlice投影、2个GenerationRequest、11个PublicQuestion信封与当前OpenAPI兼容。数据库复合家庭外键、发布冻结、事务与审核状态不在这三份传输Schema中重复模拟。

## 已覆盖的检查

当前有效夹具涵盖上下文、两个原句、图像区域、音频片段、四个P1题型、七个P2题型。负例覆盖family_id注入、公开payload夹带解释、P1使用P2题型、未知源片、未登记媒体、答案不在选项、源引文不符、重复图片选项、能力冲突、未分配候选UUID、上下文self引用、源hash不符、音频起止错误、排序缺词块和匹配复用右项。

领域lint还检查源片/目标/槽位的scope、跨版本快照、媒体MIME类别、目标能力、码点引文、答案规范化去重、填空可定位、排序词块多重集以及匹配双射。重放与家庭隔离、数据库事务、运行控件、真实媒体字节、语义唯一性、儿童语音与模型效果仍需后续验收；本机全绿不能替代这些检查。

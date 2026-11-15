
# Assemble the single executable migration plus derived per-table documentation.
from pathlib import Path
import json
import runpy
globals().update(runpy.run_path(str(Path(__file__).with_name('生成数据库设计.py'))))
FROZEN = {
 'content_nodes':('app.content_versions','content_version_id',''),
 'source_slices':('app.content_versions','content_version_id',''),
 'slice_contexts':('app.content_versions','content_version_id',''),
 'slice_objectives':('app.content_versions','content_version_id',''),
 'slice_media_bindings':('app.content_versions','content_version_id',''),
 'question_sources':('app.question_versions','question_version_id',''),
 'question_options':('app.question_versions','question_version_id',''),
 'question_answers':('app.question_versions','question_version_id',''),
 'release_questions':('app.content_releases','content_release_id',''),
 'package_assets':('app.asset_packages','asset_package_id',''),
 'task_occurrences':('app.plan_revisions','plan_revision_id','status,completed_at,cancelled_at,revision,updated_at'),
 'task_scopes':('app.plan_revisions','plan_revision_id',''),
 'task_requirements':('app.plan_revisions','plan_revision_id','')
}
APPEND_ONLY = {'quality_reports','exposure_slices','answer_attempts','learning_evidence','reward_grants','reward_grant_items','inventory_ledger','pet_events','audit_events'}
PUBLISHED = {'content_versions','question_versions','content_releases','plan_revisions','asset_packages','family_settings'}
DEFINITIONS = {'vocabulary_senses','learning_objectives','question_families','item_definitions'}
suffix=[]
for t in TABLES:
 fqn=t['schema']+'.'+t['name']; name=t['name']
 if name not in ('families','accounts'):
  suffix.append('CREATE TRIGGER tenant_owner BEFORE UPDATE ON '+fqn+' FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();')
 if name in {'families','children','devices','curriculum_series','content_issues','ai_provider_configs','ai_budget_reservations','outbox_deliveries'}:
  suffix.append('CREATE TRIGGER api_revision BEFORE UPDATE ON '+fqn+' FOR EACH ROW EXECUTE FUNCTION app.guard_api_revision();')
 if name in FROZEN:
  args=','.join(sql_literal(x) for x in FROZEN[name])
  suffix.append('CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON '+fqn+' FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('+args+');')
 if name in APPEND_ONLY:
  suffix.append('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON '+fqn+' FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();')
 if name in PUBLISHED:
  suffix.append('CREATE TRIGGER published_payload BEFORE UPDATE OR DELETE ON '+fqn+' FOR EACH ROW EXECUTE FUNCTION app.guard_published_row();')
 if name in DEFINITIONS:
  suffix.append('CREATE TRIGGER immutable_definition BEFORE UPDATE OR DELETE ON '+fqn+' FOR EACH ROW EXECUTE FUNCTION app.guard_definition();')
 if name not in ('families','accounts'):
  suffix.append('ALTER TABLE '+fqn+' ENABLE ROW LEVEL SECURITY;')
  suffix.append('ALTER TABLE '+fqn+' FORCE ROW LEVEL SECURITY;')
  expr="family_id = nullif(current_setting('app.family_id',true),'')::uuid"
  suffix.append('CREATE POLICY tenant_scope ON '+fqn+' USING ('+expr+') WITH CHECK ('+expr+');')
# Families and accounts are platform root identities, not unscoped child business tables.
suffix += [
 "ALTER TABLE app.families ENABLE ROW LEVEL SECURITY;",
 "ALTER TABLE app.families FORCE ROW LEVEL SECURITY;",
 "CREATE POLICY family_root_scope ON app.families USING (id=nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (id=nullif(current_setting('app.family_id',true),'')::uuid);",
 "ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;",
 "ALTER TABLE app.accounts FORCE ROW LEVEL SECURITY;",
 "CREATE POLICY account_member_scope ON app.accounts FOR SELECT USING (EXISTS(SELECT 1 FROM app.family_memberships fm WHERE fm.account_id=accounts.id AND fm.family_id=nullif(current_setting('app.family_id',true),'')::uuid AND fm.status='active'));",
 "REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;",
 "REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC;",
 "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;",
 "REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC;",
 "-- Provision non-owner API/auth/worker roles separately. Never grant child clients direct SQL access.",
 "-- API SELECT grant uses public_question_forms/options; private.question_answers only to grader/admin connection.",
 "-- Do not grant UPDATE/INSERT/DELETE on inventory_balances; ledger trigger is the sole balance writer.",
 "COMMIT;"
]
full=(OUT/'schema.tables.sql').read_text(encoding='utf-8')+'\n'+(OUT/'schema.guards.sql').read_text(encoding='utf-8')+'\n'+(OUT/'schema.extra-guards.sql').read_text(encoding='utf-8')+'\n'+'\n'.join(suffix)+'\n'
(OUT/'schema.sql').write_text(full,encoding='utf-8')
# Add guard/index metadata to the public catalog, without hidden generator internals.
for t in TABLES:
 c=t['constraints']
 if t['name'] in FROZEN:c.append('TRIGGER published_parent: frozen under '+FROZEN[t['name']][0])
 if t['name'] in APPEND_ONLY:c.append('TRIGGER append_only: reject UPDATE/DELETE')
 if t['name'] in PUBLISHED:c.append('TRIGGER published_payload: payload immutable after published_at')
 if t['name'] not in ('families','accounts'):c.append('RLS FORCE tenant_scope: family_id = trusted transaction family')
 for name,target,expr,pred,unique in INDEXES:
  if target==t['schema']+'.'+t['name']:
   c.append(('UNIQUE ' if unique else '')+'INDEX '+name+' '+expr+(' WHERE '+pred if pred else ''))
(OUT/'catalog.json').write_text(json.dumps({'database':'PostgreSQL 16','uuid_strategy':'application_generated','timezone':'UTC','state_unit':'centipoint, 100cp = display 1','food_unit':'nutrition_point, 1 food unit=100cp','tables':[{k:v for k,v in t.items() if k not in ('child',)} for t in TABLES]},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

INTRO='''# 数据库设计

## 1. 基础约定

数据库使用PostgreSQL 16，迁移不依赖扩展。所有UUID由应用生成，不设置随机UUID默认值；日期时间使用timestamptz并将连接时区固定UTC，家庭学习日使用date，家庭IANA时区保存于families。所有余额、营养份额和材料数量使用bigint最小单位，不使用浮点数。

宠物六项身体状态使用smallint centipoint（0..10000，100cp=界面1点），食物库存1单位=1营养点=100cp。食物消耗为min(requested_units, stock, floor((10000-satiety_cp)/100))；小于1营养点的缺口不消耗整点食物，余粮保留。被动衰减保留余秒并按规则版本结算，不靠客户端动画帧数推进身体状态。

物理表包含70张，除平台身份accounts和租户根families外均含family_id NOT NULL。孩子业务表采用(family_id,child_id,id)唯一键与对应复合FK；同家庭其他孩子的宠物、账本、作答或录音也不能互相引用。教材、场景等家庭共享资源只需(family_id,id)FK。outbox/audit的aggregate_id/entity_id属于历史路由元数据，非关系真源，不用于绕过正式FK。

| 公共字段 | 类型 | 可空 | 含义与例外 |
|---|---|---|---|
| id | uuid | 否 | 每表主键，应用生成且不可变；不依赖UUID数据库扩展 |
| family_id | uuid | 否 | 家庭业务表租户键；families本身以id代表家庭，accounts为全局身份不含此列 |
| child_id | uuid | 依表 | 孩子业务表非空并带复合FK；家庭共用内容表不含；录音/审计等多用途表可空且按用途约束 |
| created_at | timestamptz | 否 | 记录创建时刻，默认CURRENT_TIMESTAMP，连接使用UTC |
| updated_at | timestamptz | 否（若存在） | 可维护实体最近更新时刻；追加事实表通常没有该列 |
| revision | bigint | 否（若存在） | 乐观并发版本；领域命令成功后递增，不作为学习证据 |
| published_at | timestamptz | 是 | 内容/计划/资产第一次发布时刻；非空后payload冻结 |
| retired_at | timestamptz | 是 | 可发布版本/定义停止新使用的时间，历史仍保留；不是覆盖payload |

每表字典省略重复的id/family_id/created_at，沿用本共同字段定义；child_id在实际含有的表逐项展示。family_memberships、devices、auth_sessions等属于家庭共享身份表，孩子字段的可空性按表中用途处理。

schema.sql是单一迁移入口；catalog.json为同源机器可读数据字典。DDL创建app、private两个schema，不创建或猜测运行账号和口令，不授予PUBLIC表访问。private.question_answers保存答案、讲解与量规，公开题目表和公开视图不含答案。媒体文件本体位于NAS受控目录，数据库只存键、摘要、大小、权利和引用。

## 2. 关系与不可变边界

教材关系为curriculum_series→curriculum_editions→content_versions→content_nodes/source_slices；上下文通过slice_contexts，词义与目标通过vocabulary_senses/learning_objectives/slice_objectives关联。生成批次的精确输入单列generation_inputs；候选题发布为question_versions，题源、选项、答案关系化保存，content_releases/release_questions冻结一次可分配题库。

孩子关系为weekly_plans→plan_revisions→learning_days/task_occurrences→task_scopes/task_requirements；外部学习声明进入study_exposures/exposure_slices，训练或验证作答进入challenge_sessions/challenge_items/answer_attempts。家长复核写review_requests，能力事实追加learning_evidence；mastery_snapshots可从有效证据重新计算。计划到期、声明学习、训练答对均不自动等价掌握。

content_versions、question_versions、content_releases、plan_revisions、asset_packages、family_settings设置published_at后payload不可更新或删除；只允许retired_at从空变为首次退役时刻。其子表通过发布父级触发器冻结，父行FOR SHARE锁与发布写锁排他，避免发布过程中并发插子项。题目退役阻止新组题，历史会话保留原版本。词义、目标、题族和物品定义创建后不可变，变更用新身份/版本并保留旧证据。

RLS为二次租户隔离：可信API在认证后事务内SET LOCAL app.family_id，所有家庭表FORCE RLS；值来自账号/设备授权结果，不来自请求体直接信任。用户与浏览器不获得SQL连接或设置GUC权限。auth专用连接访问全局身份，worker专用连接按内部已授权job取得家庭上下文，不能仅凭用户传family_id运行。RLS不替代角色校验、child授权或答案字段投影。

部署时仅迁移owner拥有DDL权限。API非owner角色只获各命令所需表权限；inventory_balances仅SELECT，触发器为唯一写入者；private答案仅评分/受权管理连接可读。认证bootstrap和家庭创建使用专用受控管理路径，普通家庭连接不能创建任意租户或全局账号。不可用同一个超管连接服务所有API。

## 3. 奖励、库存与事务

reward_entitlements唯一键为(family_id,child_id,period_kind,period_key,stable_slot)。period_key为日日期或周一日期，policy_version只作为冻结数据，不进入唯一键。任务替换、题目升级、政策升级不能获得另一份资格。entitlement_items冻结应发物品，reward_grants每资格最多一条，reward_grant_items复制该份额；延迟约束要求发放明细与资格完全一致且每项在同事务写一条正向库存账。

日粮40营养点按已冻结的任务槽位分配；例如两项任务各20，而不是每新建任务发40。entitlement_items触发器对同孩子同日非管理食物总量限制不超过40；发布计划时必须进一步检查“恰好40”，因为数据库允许未完成草稿分配。日建材2木料/1布料、周4木料/2布料使用各自稳定资格一次；材料种类由item_definitions稳定键识别，具体额度在计划编译和政策回归检查，不能在任意内容包中声明增发。

inventory_ledger追加不可修改或删除。reward条目必须与同家庭同孩子同物品的grant item一致且只可写一次；余额触发器在ledger插入后更新inventory_balances并由CHECK阻止负数。管理纠错写compensation或引用原账的reversal（只能全额反向一条且不能冲正另一条冲正）；普通客户端没有该权限。题目本身错误不得倒扣孩子既得食物。

### 3.1 完成与发奖事务顺序

1. 认证并SET LOCAL家庭；插入/锁定idempotency_records，验证同键request_digest一致。
2. 锁children行，再按learning_days→task_occurrences→reward_entitlements→inventory_balances固定顺序锁行；检查租约、题单版本、每个必需目标的证据和家长复核。
3. 将任务标记完成，按冻结条件标记日完成/资格qualified_at；插入reward_grants及其明细。
4. 插入inventory_ledger、更新可重算证据/快照、写outbox与最小响应；提交时延迟约束核实完整发放。
5. 响应丢失时使用同幂等键查询原结果；不重新发一份。次日口语复核仍归原学习日，家长操作不受儿童新开挑战窗口限制。

### 3.2 喂食事务顺序

1. 按同幂等键处理，锁顺序固定为children→pets/pet_states→inventory_balances（多物品按ID排序）。后台衰减也遵守同孩子/宠物锁顺序。
2. 按服务端时间与rules_version结算身体状态，核实物种兼容、库存、请求营养、期望state revision，计算实际消耗整数营养点。
3. 实际消耗为0时不扣库存；否则插入负向feed账目、更新状态增加applied_units×100cp及revision，追加pet_events引用该账目，再写outbox与幂等结果。
4. 延迟约束检查feed账目与宠物事件的孩子、物品、数量、宠物一致；整个事务成功后才向客户端返回动画事件。动画跳过、切后台、WebGL失效均不取消/重复消费。

DDL不提供第二套feed_pet业务函数；上面是后续服务实现必须遵循的事务边界。数据库检查负责归属、金额来源、非负与关联完整性，服务负责具体状态衰减与通过规则。

## 4. 挑战、内容质量与同步约束

验证会话partial unique约束同task最多一个created/active/submitted/pending_review的verification；训练可另开。challenge_sessions使用lease_epoch栅栏代数和revision，设备转移须递增epoch；answer_attempts提交epoch不匹配、设备不符会被拒绝。租约已过期但仍为当前epoch的录音可走独立late-review intake接口，以pending_review写入原会话证据并生成late_sync复核请求；expired会话仅允许这条待复核路径，不能自动计分。已经被新epoch取代的旧设备仍不得写旧会话，文件可先作为media_assets staging保留，再由受权家长重新提交到当前或诊断复核会话，不伪装原窗口内提交。跨收尾时间补传同样只接受pending_review。客户端先查询幂等结果后重试，避免已提交成功的重放成为新尝试。

### 4.1 持久状态与领域DTO的明确映射

| 数据库状态 | 领域/界面状态 | 唯一解释与进入条件 |
|---|---|---|
| 尚无challenge_sessions行 | created | API正在事务中校验范围和构建题单；不得把不完整题单提交为ready |
| created | ready | 创建事务同时插入完整challenge_items和form_digest后提交；开始前的可恢复题单 |
| active | active | 孩子已经开始本轮，租约设备可追加作答 |
| active（请求未确认） | submitting | 仅客户端瞬时状态，数据库尚未确认最后提交；超时查幂等结果，不猜已失败 |
| submitted | submitting，phase=evaluating | 服务端已收齐本轮输入，正在确定性/异步评估；尚不代表请求家长复核 |
| pending_review，reason=oral或unrecognized | awaiting_review | 已存在pending review_requests，等待受权家长；不再允许孩子继续写验证 |
| pending_review，reason=late_sync | late_review | 窗口后或租约已到期的证据已进入复核队列，没有自动计分 |
| completed＋有效要求全部满足 | completed，outcome=passed | 按task_requirements和有效证据得到通过；奖励仍独立幂等结算 |
| completed＋要求未满足 | completed，outcome=needs_help | 本轮评估结束但不代表任务完成；孩子可按规则帮助后另开训练或新一轮验证 |
| expired，无pending晚到复核 | expired | 已过租约/时限且没有待复核证据，不能自动通过 |
| expired，有pending late_sync复核 | late_review，underlying_session=expired | 晚到intake保留原存储终态，仅增加复核请求；不重新占用活动验证租约 |
| cancelled | cancelled | 家长取消、任务被替代或内容故障撤销本轮；已写尝试和审计保留 |

submitted只映射“服务端评估中”，不能在没有review_requests时显示awaiting_review。completed的outcome由关联证据与冻结要求计算，不能仅凭status判断通过。结果物化于task_occurrences.completed_at和证据/奖励关联，题单本身不存答案或客户端自报总分。

care_mode的normal/hosted分别映射active/boarding，resting仍为resting；成长baby/young/adult/elder_reserved分别映射juvenile/adolescent/adult/senior_reserved，首版不启用衰老死亡。家长表示“仍未识别”时review_requests保持pending并附review_note，或明确结案needs_help且不产生通过证据，不能把未识别映射approved。复核终态只有approved/needs_help/cancelled，模型的unrecognized是作答机器结果，不混成家长决定。

### 4.2 暂停与保留机制

内容缺题、错误题或发布撤回使task_occurrences.status=content_blocked，这是任务执行暂停，不是孩子失败；不可改写已发布scope和要求。阻止新验证，保留既有作答/证据，当前本轮由服务取消或结案后等待同目标替代；需要改变范围时发新plan_revision与supersedes_task_id，沿用原奖励资格，不能在原冻结payload中塞新题源。

pending_review是待复核保留态，自动租约过期worker不得将其改expired或删除；它继续占用同task活动验证唯一槽，训练仍可另开。正常流程家长结案后更新证据，session结案completed或cancelled；次日决定仍归原学习日。expired会话的late intake不复活为active，仅新增待复核事实；即使有另一轮完成，原资格唯一键仍防重复结算。

暂停不通过虚构“hold”枚举表达：任务内容暂停用content_blocked，会话人工等待用pending_review，作业等待重试用queued+available_at，宠物托管用care_mode=hosted。各状态在自己的领域内含义固定，暂停解除应有审计和revision，不允许客户端任意更改。

发布任务守卫只冻结定义，白名单明确允许status、completed_at、cancelled_at、revision、updated_at更新；task_scopes和task_requirements没有此白名单，已发布范围和通过条件不可就地修改。

challenge_items冻结题目、目标、题序和选项顺序，不含答案；只允许追加answer_exposed_at提示暴露标记。题单目标要求必须属于同会话task。正式question_type持久值与候选契约完全一致：audio_to_picture、word_to_picture、picture_to_word、oral_reading、sentence_choice、cloze_choice、cloze_text、matching、word_order、reading_choice、retell；P1启用前四种，其他类型由阶段能力开关启用，不能使用word_reading等旧别名入库。private.question_answers将single_choice/text/matching/sequence/manual_review依次展开为option/text/match/order/rubric行，NFC是固定规范化步骤，不作为可配置开关；仅case_sensitive、trim_whitespace、collapse_whitespace、punctuation_mode可配置。

question_versions.public_payload为NOT NULL的版本化JSON object，public_payload_schema_version明确对应应用维护的题型Schema。prompt_text与instruction_text是统一题干/指令的关系列；public_payload补充cloze上下文/缺口、阅读材料和匹配/排序的公开布局配置，不放answer_spec、答案、解析、量规或source_quotes。question_options仍是可提交选项、matching左右项目、word_order词块与媒体FK的关系真源；API组装public_payload中相应项目时校验UUID、side与同题归属一致，不能仅在JSON里定义一套数据库不存在的选项。内容候选按一个主目标落question_versions.objective_id，禁止把objective_ids数组塞入公开配置绕过主目标关系。公开视图包含public_payload与schema版本但不含private答案；嵌套禁止键与每题型布局的完整检查由发布validator执行，数据库顶层禁止键仅作额外防护。

题目是否满足scope、蓝图题型与上下文、选项是否完整排列、答案是否唯一仍由编译/出题检查器核验；数据库对主目标、源内容版本和发布依赖提供关系约束，不能凭SQL CHECK证明自然语言正确。

quality_reports追加记录，题目与资产发布须采用可追溯检查集合。错误题撤回时不覆盖旧answer_attempts；learning_evidence用correction/retraction引用旧证据，唯一后继阻止重复修订；mastery快照重新计算。模型输出、录音转写、复杂检测详情仅保存在受版本schema约束的payload，不用JSON替代家长、孩子、教材、目标、题源、奖励和物品关系。

outbox_events按同事务写入，sequence_no为数据库bigint identity同步游标，payload追加不改而delivered_at可作兼容汇总维护；每个实际消费者的投递事实保存outbox_deliveries，其(family_id,consumer_key,outbox_event_id)唯一键、attempts、available_at、lease与delivered_at独立。不能因一个消费者确认就把其他消费者视为成功。消费者至少一次投递，领域副作用使用自己的业务唯一键。sync_cursors只前进并复合FK引用同家庭outbox。background_jobs以FOR UPDATE SKIP LOCKED和租约领取，失败有限重试；重跑不绕过领域幂等。

### 4.3 家庭政策、内容问题与AI调用预算

family_settings保存版本号、schema、政策JSON、发布者、effective_from和发布/退役时间；发布后payload冻结，新的设置对未来任务和命令生效，不改旧计划与资格。它只容纳受Schema约束的政策参数，不承担孩子、教材、题目等实体列表。families、children、devices、curriculum_series有revision bigint DEFAULT 1、CHECK>0，数据库守卫要求每次UPDATE递增；API用expected_revision条件更新，维护worker同样遵守。

content_issues通过三个明确可空FK且恰一非空定位question_version/media_asset/source_slice，保存报告孩子或家长、设备、问题类型、说明和处理人。报告出处创建后冻结，处理状态open→triaged→resolved/dismissed并递增revision；替代题须同题族/同目标。题目停用和修订发布另走受权内容命令，报告结案本身不改作答事实或扣孩子奖励。

ai_provider_configs存capability、provider/model、受运维允许的endpoint、secret_ref、白名单选项、币种、日额度、超时和并发上限，不保存API密钥、Token或请求Authorization。secret_ref只是秘密管理器/环境键引用；读取配置的公开DTO应隐藏它或只显示已配置。SQL阻止URL嵌凭据及常见顶层secret字段，服务端还需校验允许列表、DNS/重定向与内网地址防护，不能把正则当完整SSRF防线。

ai_budget_reservations以同家庭provider与generation_run或background_job建立唯一预算预留（run/job恰一），另有reservation_key幂等。预留事务先锁ai_provider_configs行，核验配置revision/币种，累加当日reserved最大金额与settled实际金额，不超过日额度，并校验未决预留并发上限。reserved→settled或released单向结束，费用bigint最小单位且实际额不得超过已批准预留；上游输出/token上限须使最坏费用受预留覆盖，否则先取消尚未发出的调用并重新审批，不能结算后无声超支。

预留过期不等于供应商取消成功。网络结果不明保留reserved并查询供应商请求状态，不能马上释放后用新key重复调用；只有已知未执行/已取消才released=0，已执行用实际费用settled。预算日期按家庭时区形成，保留原date不随时区修改重算；配置额度降低可能低于已有预留，但不撤回既有账。预算行终态不可改或删除，误差补偿由后续审计管理流程处理。

## 5. 生命周期、留存与删除

所有业务FK采用RESTRICT，避免删除教材或孩子时级联抹去账本/证据。正常业务以归档、退役、录音到期物理删除和元数据保留处理。auth_sessions、配对短码只保存摘要，审计与outbox不写密码、原令牌或私有答案。media_assets删除只更新元数据并清除文件本体，历史证据仍能显示“录音已到期”。

家庭整体清除采用专用离线purge维护角色和审批管理操作：先验证导出/删除请求、撤销会话、停止家庭worker并锁families；创建受控删除manifest；在单独连接事务内临时禁用目标表USER触发器并按依赖从叶到根DELETE；保持FK约束和家庭过滤，恢复触发器后提交；清媒体文件与到期备份。遇到循环FK时可先解除尚未发布且允许清除的可空引用；正式purge脚本需在一次性副本演练。purge角色是表owner或明确授予的维护身份，API/worker无此权限，DDL不提供可由任意请求打开的purge GUC绕过。append-only约束不意味着法律/管理要求下永远无法清除，只是不允许普通业务篡改。

## 6. 表级设计

'''
sections=[INTRO]
module_names={'identity':'身份与家庭','media':'媒体','content':'教材与发布','content_ops':'导入、生成与质量','questions':'题库与私有评分','assets':'资产包','planning':'计划','learning':'学习事实与能力','challenge':'挑战与复核','inventory':'物品与库存','rewards':'奖励资格与发放','pets':'宠物生活','scenes':'场景布置','ops':'作业与同步','ai_ops':'AI配置与预算'}
for module in dict.fromkeys(t['module'] for t in TABLES):
 sections.append('### '+module_names[module]+'\n')
 for t in [x for x in TABLES if x['module']==module]:
  sections.append('#### '+t['schema']+'.'+t['name']+'\n\n'+t['description']+'。\n')
  rel=[x for x in t['constraints'] if x.startswith('FOREIGN KEY')]
  if rel:sections.append('关系：'+'；'.join(x.replace(' ON DELETE RESTRICT','') for x in rel if x!='FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT')+'。\n')
  cols=[x for x in t['columns'] if x['name'] not in ('id','family_id','created_at')]
  sections.append('| 字段 | 类型 | 可空 | 用途 |\n|---|---|---|---|\n'+'\n'.join('| '+x['name']+' | '+x['type']+' | '+('是' if x['nullable'] else '否')+' | '+x['description']+' |' for x in cols)+'\n')
  key=[x for x in t['constraints'] if x.startswith(('UNIQUE','CHECK','TRIGGER')) or x.startswith('UNIQUE INDEX')]
  if key:sections.append('关键约束：\n\n'+'\n'.join('- '+x for x in key)+'\n')
  if t['rules']:sections.append('规则：'+'；'.join(t['rules'])+'\n')
  sections.append('阶段：'+t['phase']+'。\n')
sections.append('''## 7. 迁移与验证

迁移顺序为先创建全部字段，再依次添加主键/唯一键/FK/CHECK，然后索引、关系守卫、发布冻结与RLS。运行角色授权另行部署；schema.sql不能在已有同名对象的业务库重复执行作为升级脚本，后续变更需编号迁移并在执行前备份。

当前交付只完成Python语法、结构目录、字段/复合FK引用、必要唯一键、发布守卫、家庭列及静态SQL边界检查。本机未发现PostgreSQL服务端/psql，也未发现可用PostgreSQL AST parser；未实际在PostgreSQL16执行，不宣称数据库运行验收通过。后续必须在隔离PG16实例以ON_ERROR_STOP执行DDL，再运行跨家庭/跨孩子拒绝、发布冻结、重复奖励、并发负库存、迟到租约、坏题撤回与purge副本演练。
''')
(ROOT/'章节'/'数据库设计.md').parent.mkdir(parents=True,exist_ok=True)
(ROOT/'章节'/'数据库设计.md').write_text('\n'.join(sections),encoding='utf-8')
print('schema.sql bytes:',(OUT/'schema.sql').stat().st_size)
print('chapter bytes:',(ROOT/'章节'/'数据库设计.md').stat().st_size)

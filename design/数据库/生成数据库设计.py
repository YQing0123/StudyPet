from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '数据库'
TABLES = []

def col(name, typ, desc, nullable=False, default=None):
    return dict(name=name, type=typ, nullable=nullable, description=desc, default=default)

def table(name, desc, module, columns, constraints=None, phase='P1', rules=None, schema='app', child=False):
    base=[col('id','uuid','应用生成的不可变UUID主键')]
    if name not in ('families','accounts'):
        base.append(col('family_id','uuid','所属家庭；不可为空、不可跨家庭引用'))
    if child:
        base.append(col('child_id','uuid','所属孩子；所有孩子业务链保持同一归属'))
    base += columns
    base += [col('created_at','timestamptz','数据库记录创建时刻，UTC存储','False' == 'True','CURRENT_TIMESTAMP')]
    cs=['PRIMARY KEY (id)']
    if name not in ('families','accounts'):
        cs += ['UNIQUE (family_id, id)', 'FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT']
    if child:
        cs += ['UNIQUE (family_id, child_id, id)', 'FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT']
    cs += constraints or []
    TABLES.append(dict(name=name,description=desc,module=module,columns=base,constraints=cs,phase=phase,rules=rules or [],schema=schema,child=child))

def fk(cols, target, refs=None):
    if isinstance(cols,str): cols=[cols]
    return 'FOREIGN KEY ('+', '.join(['family_id']+cols)+') REFERENCES '+target+'('+', '.join(['family_id']+(refs or ['id']))+') ON DELETE RESTRICT'
def cfk(cols,target,refs=None):
    if isinstance(cols,str):cols=[cols]
    return 'FOREIGN KEY ('+', '.join(['family_id','child_id']+cols)+') REFERENCES '+target+'('+', '.join(['family_id','child_id']+(refs or ['id']))+') ON DELETE RESTRICT'
def check(s): return 'CHECK ('+s+')'
def enum(field, values): return check(field+' IN ('+', '.join("'"+x+"'" for x in values.split('|'))+')')
def status(values, default): return col('status','text','状态：'+values,default="'"+default+"'")
def retired(): return col('retired_at','timestamptz','退役时刻；不改写既有发布payload',True)
def published(): return col('published_at','timestamptz','首次发布时间；一旦设置不再清除',True)
def rev(): return col('revision','bigint','乐观并发修订号，按成功更新递增',default='1')
def updated(): return col('updated_at','timestamptz','最近维护时刻；UTC',default='CURRENT_TIMESTAMP')
def payload(): return col('payload','jsonb','受版本化schema约束的事件/作业附加数据；不替代实体外键',default="'{}'::jsonb")

# Identity / family.
table('families','家庭租户与固定学习时区','identity',[
 col('name','text','家庭显示名称'),col('timezone','text','IANA学习时区，例如Asia/Shanghai',default="'Asia/Shanghai'"),
 col('week_starts_on','smallint','周起始ISO星期，固定周一',default='1'),status('active|suspended|deleting','active'),updated()],
 [check("length(btrim(name)) BETWEEN 1 AND 100"),check('week_starts_on = 1'),enum('status','active|suspended|deleting')],
 rules=['家庭为业务租户根；时区存在性由数据库pg_timezone_names触发检查。','调整时区仅用于未来学习日，历史learning_date与UTC窗口不回算。'])
table('accounts','跨家庭的家长登录身份','identity',[
 col('login_name','text','规范化登录名；非孩子昵称'),col('password_hash','text','服务端生成的Argon2id等口令哈希，不保存明文'),
 col('display_name','text','家长显示名'),status('active|locked|disabled','active'),col('password_changed_at','timestamptz','最近口令更新UTC时刻',True),updated()],
 ['UNIQUE (login_name)',check('length(login_name) BETWEEN 3 AND 254'),enum('status','active|locked|disabled')],
 rules=['平台身份表为全局身份，例外不含family_id；业务权限来自family_memberships。','登录查询由专用认证连接执行；家庭业务连接通过RLS只看当前家庭成员账号。'])
table('family_memberships','家长账号在家庭中的成员关系和角色','identity',[
 col('account_id','uuid','全局家长账号'),col('role','text','owner/admin/parent/content_editor/reviewer'),status('active|revoked','active'),updated()],
 ['FOREIGN KEY (account_id) REFERENCES app.accounts(id) ON DELETE RESTRICT','UNIQUE (family_id, account_id)','UNIQUE (family_id, account_id, id)',enum('role','owner|admin|parent|content_editor|reviewer'),enum('status','active|revoked')],rules=['同账号可加入多个家庭，但所有业务请求必须明确当前家庭。','最后一个owner的撤销由管理事务加锁检查。'])
table('children','孩子档案及操作能力设置','identity',[
 col('nickname','text','孩子昵称，不要求真实姓名'),col('reading_mode','text','pre_reader/early_reader/reader'),col('can_type','boolean','是否具备独立键盘拼写操作能力',default='false'),
 col('speech_enabled','boolean','是否启用录音任务',default='false'),col('ai_enabled','boolean','家长是否启用外部AI互动',default='false'),
 col('recording_retention_days','smallint','原始录音保留日数，0表示处理后删除',default='30'),status('active|archived','active'),updated()],
 [check('length(btrim(nickname)) BETWEEN 1 AND 40'),enum('reading_mode','pre_reader|early_reader|reader'),check('recording_retention_days BETWEEN 0 AND 365'),enum('status','active|archived')])
table('devices','家庭设备与允许的孩子绑定','identity',[
 col('bound_child_id','uuid','儿童/电视设备绑定孩子；家长设备可空',True),col('name','text','设备显示名称'),col('device_kind','text','ipad/web/phone/android_tv'),
 col('public_key','text','可选设备公钥，不保存设备私钥',True),col('capabilities','jsonb','版本化设备检测结果：WebGL、录音MIME、D-pad等',default="'{}'::jsonb"),
 status('active|revoked','active'),col('last_seen_at','timestamptz','最近服务端在线时刻',True),updated()],
 [fk('bound_child_id','app.children'),enum('device_kind','ipad|web|phone|android_tv'),enum('status','active|revoked'),check("jsonb_typeof(capabilities) = 'object'")])
table('auth_sessions','家长/孩子受控登录会话','identity',[
 col('device_id','uuid','当前设备'),col('membership_id','uuid','家长成员身份；儿童会话为空',True),col('child_id','uuid','孩子身份；家长会话可为空',True),
 col('session_kind','text','parent/child/tv'),col('token_digest','text','随机会话令牌的安全摘要，原令牌不入库'),
 col('expires_at','timestamptz','过期UTC时刻'),col('revoked_at','timestamptz','撤销UTC时刻',True),updated()],
 [fk('device_id','app.devices'),fk('membership_id','app.family_memberships'),fk('child_id','app.children'),'UNIQUE (token_digest)',
 check("(session_kind='parent' AND membership_id IS NOT NULL) OR (session_kind IN ('child','tv') AND child_id IS NOT NULL AND membership_id IS NULL)"),enum('session_kind','parent|child|tv'),check('expires_at > created_at')])

# Media and textbook relational model.
table('media_assets','家庭媒体对象的存储、来源、权利与保留元数据','media',[
 col('child_id','uuid','儿童录音所属孩子；教材/公用素材为空',True),col('asset_kind','text','source_document/image/audio/recording/atlas/model/report'),
 col('storage_key','text','受控媒体目录相对键，不是任意主机路径'),col('sha256','text','文件内容SHA-256'),col('mime_type','text','真实媒体MIME'),col('byte_size','bigint','压缩文件字节数'),
 col('width_px','integer','图片宽像素',True),col('height_px','integer','图片高像素',True),col('duration_ms','bigint','音视频时长毫秒',True),
 col('origin_kind','text','licensed_upload/family_authored/generated/recorded'),col('rights_code','text','许可或家庭使用范围编码'),col('rights_note','text','可追溯权利说明'),
 col('retention_until','timestamptz','对象保留到期时间',True),status('staging|ready|quarantined|deleted','staging'),col('deleted_at','timestamptz','物理媒体删除登记；保留证据元数据',True),updated()],
 [fk('child_id','app.children'),'UNIQUE (family_id, child_id, id)','UNIQUE (family_id, storage_key)',check("sha256 ~ '^[0-9a-f]{64}$'"),check('byte_size >= 0'),check('width_px IS NULL OR width_px > 0'),check('height_px IS NULL OR height_px > 0'),check('duration_ms IS NULL OR duration_ms >= 0'),
 check("storage_key <> '' AND storage_key !~ '(^/|(^|/)\\.\\.(/|$))'"),enum('asset_kind','source_document|image|audio|recording|atlas|model|report'),enum('origin_kind','licensed_upload|family_authored|generated|recorded'),enum('status','staging|ready|quarantined|deleted'),check("asset_kind <> 'recording' OR child_id IS NOT NULL")],rules=['child录音通过(family_id,child_id,id)被作答引用，不能引用同家其他孩子录音。','物理文件删除不删除媒体元数据行；签名URL由权限层短期生成。'])
table('curriculum_series','教材系列与适配器入口','content',[
 col('stable_key','text','家庭内稳定系列键，如raz/new_concept'),col('title','text','教材系列名'),col('language_tag','text','学习语言标签，如en'),col('adapter_key','text','应用白名单教材结构适配器键'),retired()],['UNIQUE (family_id, stable_key)'])
table('curriculum_editions','教材具体版本与来源映射','content',[
 col('series_id','uuid','教材系列'),col('edition_key','text','同系列稳定版本键'),col('edition_label','text','版次名称'),col('publisher','text','出版/家庭原创主体'),
 col('isbn','text','可选ISBN',True),col('language_variant','text','语言变体，如en-GB/en-US'),col('rights_code','text','内容使用/共享权限编码'),retired()],
 [fk('series_id','app.curriculum_series'),'UNIQUE (family_id, series_id, edition_key)'])
table('content_versions','教材一份不可变的结构化内容快照','content',[
 col('edition_id','uuid','所属教材版次'),col('version_no','integer','版次内内容修订序号'),col('source_media_id','uuid','原始文档对象'),col('source_hash','text','原文/结构快照摘要'),
 col('schema_version','integer','内容schema版本'),status('draft|checking|ready','draft'),published(),retired()],
 [fk('edition_id','app.curriculum_editions'),fk('source_media_id','app.media_assets'),'UNIQUE (family_id, edition_id, version_no)',check('version_no > 0 AND schema_version > 0'),check("source_hash ~ '^[0-9a-f]{64}$'"),enum('status','draft|checking|ready'),check("published_at IS NULL OR status='ready'")],rules=['published_at第一次设置后冻结自身与子结构payload；retired_at只控制今后分配。'])
table('content_nodes','教材树的级别/书/课/页/段/句节点','content',[
 col('content_version_id','uuid','所属冻结内容版本'),col('parent_id','uuid','同版本父节点',True),col('stable_key','text','同版本内节点稳定键'),
 col('node_kind','text','level/book/unit/lesson/page/passage/dialogue/sentence'),col('title','text','节点展示标题'),col('ordinal','integer','父节点内顺序，从0开始'),
 col('external_locator','text','原书/APP中的书名课号页码等可读定位'),col('page_number','integer','实际书页号',True),col('speaker','text','对话说话人',True)],
 [fk('content_version_id','app.content_versions'),'UNIQUE (family_id, content_version_id, id)',fk(['content_version_id','parent_id'],'app.content_nodes',['content_version_id','id']),
 'UNIQUE (family_id, content_version_id, stable_key)',check('ordinal >= 0'),check('parent_id IS NULL OR parent_id <> id'),enum('node_kind','level|book|unit|lesson|page|passage|dialogue|sentence'),check('page_number IS NULL OR page_number > 0')],rules=['复合父FK保证同家庭同版本；多层循环由递归触发器阻断。'])
table('source_slices','可追溯的语义上下文片与原子片','content',[
 col('content_version_id','uuid','所属内容版本'),col('node_id','uuid','原教材节点'),col('stable_key','text','版本内切片稳定键'),col('slice_kind','text','context/sentence/word'),
 col('original_text','text','提取后忠实保留的原文'),col('normalized_text','text','受控规范化文字；不覆盖原文'),col('source_hash','text','本切片源内容摘要'),
 col('source_media_id','uuid','原始文档/页图对象'),col('image_media_id','uuid','对应图片',True),col('audio_media_id','uuid','教材或示范音频',True),
 col('audio_start_ms','bigint','音频切片起点',True),col('audio_end_ms','bigint','音频切片终点',True),col('region_x','numeric(8,6)','页图归一化区域x',True),col('region_y','numeric(8,6)','页图归一化区域y',True),col('region_w','numeric(8,6)','归一化区域宽',True),col('region_h','numeric(8,6)','归一化区域高',True),
 col('language_variant','text','语种变体'),col('slice_schema_version','integer','切片规则版本')],
 [fk(['content_version_id','node_id'],'app.content_nodes',['content_version_id','id']),'UNIQUE (family_id, content_version_id, id)',fk('source_media_id','app.media_assets'),fk('image_media_id','app.media_assets'),fk('audio_media_id','app.media_assets'),
 'UNIQUE (family_id, content_version_id, stable_key)',check("source_hash ~ '^[0-9a-f]{64}$'"),enum('slice_kind','context|sentence|word'),check('slice_schema_version > 0'),
 check('(num_nonnulls(audio_start_ms,audio_end_ms)=0) OR (num_nonnulls(audio_start_ms,audio_end_ms)=2 AND audio_media_id IS NOT NULL AND audio_start_ms >= 0 AND audio_end_ms > audio_start_ms)'),
 check('(num_nonnulls(region_x,region_y,region_w,region_h)=0) OR (num_nonnulls(region_x,region_y,region_w,region_h)=4 AND region_x>=0 AND region_y>=0 AND region_w>0 AND region_h>0 AND region_x+region_w<=1 AND region_y+region_h<=1)')])
table('slice_contexts','同版本切片的必要上下文关系','content',[
 col('content_version_id','uuid','共同所属内容版本'),col('slice_id','uuid','被解释的原子切片'),col('context_slice_id','uuid','提供问答/指代/图文上下文的切片'),col('relation_kind','text','parent_context/pronoun_reference/question_answer/visual_context'),col('ordinal','integer','上下文拼接顺序')],
 [fk(['content_version_id','slice_id'],'app.source_slices',['content_version_id','id']),fk(['content_version_id','context_slice_id'],'app.source_slices',['content_version_id','id']),
 'UNIQUE (family_id, slice_id, context_slice_id, relation_kind)',check('slice_id <> context_slice_id'),check('ordinal >= 0'),enum('relation_kind','parent_context|pronoun_reference|question_answer|visual_context')],rules=['上下文充分性与循环依赖在发布lint检查；不会跨版本自动拼接。'])
table('vocabulary_senses','词形/词义标识而非仅字符串词典','content',[
 col('lemma','text','词元'),col('surface_form','text','目标词形'),col('part_of_speech','text','词性编码'),col('meaning','text','本义项解释'),col('language_variant','text','语种变体'),col('sense_key','text','家庭内稳定词义键'),retired()],['UNIQUE (family_id, sense_key)'],rules=['定义创建后不可改；纠错新建义项并在新内容版本映射，旧证据不偷偷换义。'])
table('learning_objectives','可被测量的能力目标','content',[
 col('vocabulary_sense_id','uuid','可选所测词义',True),col('stable_key','text','目标稳定键'),col('title','text','目标描述'),col('skill','text','所测能力'),col('modality','text','主要呈现/输出模态'),col('target_text','text','目标词、原句或句型'),retired()],
 [fk('vocabulary_sense_id','app.vocabulary_senses'),'UNIQUE (family_id, stable_key)','UNIQUE (family_id, id, skill, modality)',enum('skill','listening|word_recognition|oral_reading|sentence_comprehension|spelling|oral_expression'),enum('modality','audio|visual|text|speech')],rules=['目标定义不可变；听辨与口语即使词相同也分别建目标。'])
table('slice_objectives','原片段与学习目标的多对多映射','content',[
 col('content_version_id','uuid','源内容版本'),col('slice_id','uuid','源片段'),col('objective_id','uuid','目标'),col('is_primary','boolean','是否该片段主目标',default='true')],
 [fk(['content_version_id','slice_id'],'app.source_slices',['content_version_id','id']),fk('objective_id','app.learning_objectives'),'UNIQUE (family_id, slice_id, objective_id)'])
table('import_jobs','资料导入阶段、断点及差异清单','content_ops',[
 col('edition_id','uuid','目标教材版次'),col('source_media_id','uuid','上传源文件'),col('output_content_version_id','uuid','导入产出的结构化版本',True),
 col('input_digest','text','导入内容及配置摘要，用于去重'),col('stage','text','received/validated/parsing/aligning/slicing/generating/qa/ready/failed'),
 col('parser_version','text','固定的解析器及配置版本'),col('checkpoint','jsonb','版本化断点与差异统计，不保存教材树',default="'{}'::jsonb"),col('error_code','text','机器可读错误码',True),col('requested_by','uuid','发起家长成员'),updated()],
 [fk('edition_id','app.curriculum_editions'),fk('source_media_id','app.media_assets'),fk('output_content_version_id','app.content_versions'),fk('requested_by','app.family_memberships'),
 enum('stage','received|validated|parsing|aligning|slicing|generating|qa|ready|failed'),check("input_digest ~ '^[0-9a-f]{64}$'"),check("jsonb_typeof(checkpoint)='object'")],rules=['同摘要的有效导入partial unique，不以标题相同覆盖历史；失败作业可重开另一次。'])
table('generation_runs','AI或模板出题批次及可重现生产信息','content_ops',[
 col('content_version_id','uuid','出题源内容版本'),col('requested_by','uuid','发起成员'),col('provider','text','模型供应商/模板引擎标识'),col('model','text','模型或确定性生成器版本'),
 col('prompt_version','text','提示版本'),col('template_version','text','题型模板版本'),col('input_digest','text','蓝图与源片段摘要'),col('blueprint','jsonb','版本化出题蓝图参数；源片段另存generation_inputs'),
 status('queued|running|checking|completed|failed|cancelled','queued'),col('input_tokens','bigint','输入token用量',default='0'),col('output_tokens','bigint','输出token用量',default='0'),col('cost_microunits','bigint','计价币种的百万分之一最小单位',default='0'),col('currency','text','ISO币种或内部计量币种'),col('retry_count','smallint','重试次数',default='0'),col('finished_at','timestamptz','结束时刻',True),updated()],
 [fk('content_version_id','app.content_versions'),fk('requested_by','app.family_memberships'),'UNIQUE (family_id, content_version_id, id)',check("input_digest ~ '^[0-9a-f]{64}$'"),check('input_tokens>=0 AND output_tokens>=0 AND cost_microunits>=0 AND retry_count>=0'),check("jsonb_typeof(blueprint)='object'"),enum('status','queued|running|checking|completed|failed|cancelled')])
table('generation_inputs','生成批次允许使用的源片段与用途','content_ops',[
 col('content_version_id','uuid','共同内容版本'),col('generation_run_id','uuid','生成批次'),col('slice_id','uuid','精确允许的切片'),col('input_role','text','target/context/allowed_distractor')],
 [fk(['content_version_id','generation_run_id'],'app.generation_runs',['content_version_id','id']),fk(['content_version_id','slice_id'],'app.source_slices',['content_version_id','id']),
 'UNIQUE (family_id, generation_run_id, slice_id, input_role)',enum('input_role','target|context|allowed_distractor')])
table('question_families','同一知识目标与题意的题目家族','questions',[
 col('objective_id','uuid','主能力目标'),col('stable_key','text','服务端规范化题族键'),col('description','text','题意/同质变式说明'),retired()],
 [fk('objective_id','app.learning_objectives'),'UNIQUE (family_id, stable_key)','UNIQUE (family_id, objective_id, id)'],rules=['选项换序仍属同题族，训练暴露通过家族关联。'])
table('question_versions','题目版本的公开呈现字段，不含答案和讲解','questions',[
 col('question_family_id','uuid','题目家族'),col('objective_id','uuid','主能力目标'),col('content_version_id','uuid','源教材版本'),col('generation_run_id','uuid','可选来源生成批次',True),col('version_no','integer','题族内修订序号'),
 col('question_type','text','题型执行器白名单'),col('prompt_text','text','对孩子公开的题干'),col('instruction_text','text','操作说明，不能泄露被测答案'),col('image_media_id','uuid','题干配图',True),col('audio_media_id','uuid','题干音频',True),
 col('difficulty','smallint','内部难度档1到5'),col('estimated_seconds','integer','预计用时秒'),col('is_source_quote','boolean','是否教材原句，false为受约束变式'),col('requires_microphone','boolean','是否必须录音',default='false'),col('requires_typing','boolean','是否必须键盘输入',default='false'),
 col('payload_digest','text','包含private答案的受控题目内容摘要'),status('draft|machine_checked|review_required|ready','draft'),published(),retired()],
 [fk(['objective_id','question_family_id'],'app.question_families',['objective_id','id']),fk('content_version_id','app.content_versions'),fk(['content_version_id','generation_run_id'],'app.generation_runs',['content_version_id','id']),fk('image_media_id','app.media_assets'),fk('audio_media_id','app.media_assets'),
 'UNIQUE (family_id, content_version_id, id)','UNIQUE (family_id, objective_id, id)','UNIQUE (family_id, question_family_id, version_no)',check('version_no>0 AND difficulty BETWEEN 1 AND 5 AND estimated_seconds BETWEEN 1 AND 600'),
 enum('question_type','audio_to_picture|word_to_picture|picture_to_word|oral_reading|sentence_choice|cloze_choice|cloze_text|matching|word_order|reading_choice|retell'),enum('status','draft|machine_checked|review_required|ready'),check("published_at IS NULL OR status='ready'"),check("payload_digest ~ '^[0-9a-f]{64}$'")],rules=['发布后冻结题干、选项、private答案和题源；退役不改payload。','不返回generation蓝图、质量报告或答案摘要给儿童端。'])
table('question_sources','题目与教材证据片段的明确关系','questions',[
 col('content_version_id','uuid','共同源内容版本'),col('question_version_id','uuid','题目版本'),col('slice_id','uuid','题源切片'),col('source_role','text','assessed/context/distractor'),col('evidence_quote','text','仅管理/复核使用的原文证据摘录')],
 [fk(['content_version_id','question_version_id'],'app.question_versions',['content_version_id','id']),fk(['content_version_id','slice_id'],'app.source_slices',['content_version_id','id']),
 'UNIQUE (family_id, question_version_id, slice_id, source_role)',enum('source_role','assessed|context|distractor')])
table('question_options','题目公开选项、匹配两侧或排序词块','questions',[
 col('question_version_id','uuid','题目版本'),col('option_key','text','题内稳定选项键，API提交此键'),col('ordinal','integer','源配置顺序，运行时可按题单换序'),col('side','text','choice/left/right/token'),col('text','text','可选公开文字',True),col('image_media_id','uuid','公开图片',True),col('audio_media_id','uuid','公开音频',True)],
 [fk('question_version_id','app.question_versions'),fk('image_media_id','app.media_assets'),fk('audio_media_id','app.media_assets'),'UNIQUE (family_id, question_version_id, id)','UNIQUE (family_id, question_version_id, option_key)',check('ordinal>=0'),check('num_nonnulls(text,image_media_id,audio_media_id)>0'),enum('side','choice|left|right|token')])
table('question_answers','私有标准答案、允许变体与评分规范','questions',[
 col('question_version_id','uuid','题目版本'),col('answer_key','text','题内答案行稳定键/允许变体键'),col('answer_kind','text','option/text/match/order/rubric'),col('option_id','uuid','正确选项/左项/词块',True),col('match_option_id','uuid','匹配右项',True),
 col('gap_key','text','填空位置键',True),col('expected_text','text','允许文本答案',True),col('ordering_position','integer','排序目标位置',True),col('rubric_text','text','人工/模型复核量规',True),col('explanation','text','仅训练反馈或提交后返回的讲解'),
 col('case_sensitive','boolean','大小写是否严格',default='false'),col('trim_whitespace','boolean','是否裁剪边缘空白',default='true'),col('collapse_whitespace','boolean','是否规范连续空白',default='true'),col('punctuation_mode','text','strict/ignore'),col('score_units','integer','评分整数单位',default='1')],
 [fk('question_version_id','app.question_versions'),fk(['question_version_id','option_id'],'app.question_options',['question_version_id','id']),fk(['question_version_id','match_option_id'],'app.question_options',['question_version_id','id']),
 'UNIQUE (family_id, question_version_id, answer_key)',enum('answer_kind','option|text|match|order|rubric'),enum('punctuation_mode','strict|ignore'),check('score_units>0'),
 check("(answer_kind='option' AND option_id IS NOT NULL AND num_nonnulls(match_option_id,expected_text,ordering_position,rubric_text)=0) OR (answer_kind='text' AND expected_text IS NOT NULL AND num_nonnulls(option_id,match_option_id,ordering_position,rubric_text)=0) OR (answer_kind='match' AND option_id IS NOT NULL AND match_option_id IS NOT NULL AND option_id<>match_option_id AND num_nonnulls(expected_text,ordering_position,rubric_text)=0) OR (answer_kind='order' AND option_id IS NOT NULL AND ordering_position IS NOT NULL AND ordering_position>=0 AND num_nonnulls(match_option_id,expected_text,rubric_text)=0) OR (answer_kind='rubric' AND rubric_text IS NOT NULL AND num_nonnulls(option_id,match_option_id,expected_text,ordering_position)=0)")],schema='private',rules=['private schema从PUBLIC撤销USAGE；仅评分/受权家长管理连接可获SELECT。','儿童题单由公开视图+显式字段投影读取，不JOIN此表。'])
table('asset_packages','宠物/场景/道具包版本与自动构建清单','assets',[
 col('package_key','text','稳定包键'),col('version_label','text','语义版本'),col('package_kind','text','pet/scene/item'),col('generator_version','text','脚本生成器/模型配置版本'),col('seed','bigint','可复现随机种子'),col('input_digest','text','源输入摘要'),col('manifest_media_id','uuid','校验后的manifest媒体对象'),col('minimum_runtime','text','最低应用版本'),
 status('draft|checking|ready','draft'),published(),retired()],
 [fk('manifest_media_id','app.media_assets'),'UNIQUE (family_id, package_key, version_label)',enum('package_kind','pet|scene|item'),enum('status','draft|checking|ready'),check("published_at IS NULL OR status='ready'"),check("input_digest ~ '^[0-9a-f]{64}$'")])
table('package_assets','资源包中的媒体及可兼容稳定资源键','assets',[
 col('asset_package_id','uuid','资源包版本'),col('media_asset_id','uuid','具体文件'),col('asset_key','text','包内稳定资源键'),col('asset_role','text','texture/atlas/animation/manifest/preview/model/sound'),col('lod','smallint','资源档0标准1低配2静态'),col('anchor_x','numeric(10,6)','归一化主锚点x'),col('anchor_y','numeric(10,6)','归一化主锚点y')],
 [fk('asset_package_id','app.asset_packages'),fk('media_asset_id','app.media_assets'),'UNIQUE (family_id, asset_package_id, asset_key, lod)',check('lod BETWEEN 0 AND 2'),enum('asset_role','texture|atlas|animation|manifest|preview|model|sound')])
table('quality_reports','内容/题目/生成批次/资产包的质量检查证据','content_ops',[
 col('content_version_id','uuid','目标内容版本',True),col('question_version_id','uuid','目标题目版本',True),col('generation_run_id','uuid','目标生成批次',True),col('asset_package_id','uuid','目标资产包',True),
 col('check_kind','text','schema/reference/semantic/media/runtime/visual'),col('checker_version','text','检查脚本或模型版本'),col('verdict','text','pass/warn/fail'),col('issue_code','text','机器可读问题码；通过用OK'),col('message','text','明确检查结论'),col('details','jsonb','受版本约束的检测定位、统计与证据',default="'{}'::jsonb"),col('reviewer_membership_id','uuid','人工复核者，自动检查为空',True)],
 [fk('content_version_id','app.content_versions'),fk('question_version_id','app.question_versions'),fk('generation_run_id','app.generation_runs'),fk('asset_package_id','app.asset_packages'),fk('reviewer_membership_id','app.family_memberships'),check('num_nonnulls(content_version_id,question_version_id,generation_run_id,asset_package_id)=1'),enum('check_kind','schema|reference|semantic|media|runtime|visual'),enum('verdict','pass|warn|fail'),check("jsonb_typeof(details)='object'")],rules=['追加式报告，不以覆盖旧fail报告伪造通过；发布检查取明确的报告集。'])
table('content_releases','经校验的教材内容与题库发布集合','content',[
 col('content_version_id','uuid','源教材内容版本'),col('release_no','integer','内容版本内发布序号'),col('released_by','uuid','发布家长/内容管理员'),col('qa_digest','text','发布采用的检查集合摘要'),col('manifest_digest','text','发布清单摘要'),published(),retired()],
 [fk('content_version_id','app.content_versions'),fk('released_by','app.family_memberships'),'UNIQUE (family_id, content_version_id, release_no)','UNIQUE (family_id, content_version_id, id)',check('release_no>0'),check("qa_digest ~ '^[0-9a-f]{64}$' AND manifest_digest ~ '^[0-9a-f]{64}$'")])
table('release_questions','发布集合中精确包含的题目版本','content',[
 col('content_version_id','uuid','共同教材版本'),col('content_release_id','uuid','发布集合'),col('question_version_id','uuid','已发布题目版本')],
 [fk(['content_version_id','content_release_id'],'app.content_releases',['content_version_id','id']),fk(['content_version_id','question_version_id'],'app.question_versions',['content_version_id','id']),
 'UNIQUE (family_id, content_release_id, question_version_id)'],rules=['发布集合冻结后禁止增删题；题目退役单独影响新会话选择，历史题单不变。'])

# Plans, learning facts, challenges.
table('weekly_plans','孩子一个家庭学习周的稳定计划身份','planning',[
 col('week_start','date','家庭时区周一日期'),col('title','text','周计划名称'),status('draft|active|archived','draft'),updated()],
 ['UNIQUE (family_id, child_id, week_start)',check('extract(isodow FROM week_start)=1'),enum('status','draft|active|archived')],child=True)
table('plan_revisions','周计划经过编译与发布的不可变修订','planning',[
 col('weekly_plan_id','uuid','周计划稳定身份'),col('revision_no','integer','递增计划修订号'),col('published_by','uuid','发布成员',True),col('goal_learning_days','smallint','周约定所需完成日数'),col('planned_learning_days','smallint','本修订计划学习日总数'),col('policy_version','text','冻结的结算与通过规则版本'),col('payload_digest','text','计划定义与任务/要求集合摘要'),status('draft|validated','draft'),published(),retired()],
 [cfk('weekly_plan_id','app.weekly_plans'),fk('published_by','app.family_memberships'),'UNIQUE (family_id, child_id, weekly_plan_id, revision_no)',check('revision_no>0 AND goal_learning_days BETWEEN 0 AND 7 AND planned_learning_days BETWEEN 0 AND 7 AND goal_learning_days<=planned_learning_days'),enum('status','draft|validated'),check("published_at IS NULL OR (status='validated' AND published_by IS NOT NULL)"),check("payload_digest ~ '^[0-9a-f]{64}$'")],child=True)
table('learning_days','孩子稳定学习日及编译后的UTC挑战窗口','planning',[
 col('learning_date','date','按家庭时区确定的学习日'),col('plan_revision_id','uuid','当前有效计划修订'),col('day_kind','text','learning/rest/leave'),col('window_start_at','timestamptz','允许挑战开始UTC时刻',True),col('last_start_at','timestamptz','最后新开挑战UTC时刻',True),col('window_end_at','timestamptz','常规结束UTC时刻',True),col('grace_end_at','timestamptz','已开始挑战最晚收尾UTC时刻',True),
 col('interaction_budget_seconds','integer','每日自由宠物互动预算',default='180'),col('completed_at','timestamptz','当日必需条件完成UTC时刻',True),col('leave_reason','text','家长请假说明',True),rev(),updated()],
 [cfk('plan_revision_id','app.plan_revisions'),'UNIQUE (family_id, child_id, learning_date)',enum('day_kind','learning|rest|leave'),check('interaction_budget_seconds BETWEEN 0 AND 3600'),check('revision>0'),
 check("(day_kind='learning' AND num_nonnulls(window_start_at,last_start_at,window_end_at,grace_end_at)=4 AND window_start_at<=last_start_at AND last_start_at<=window_end_at AND window_end_at<=grace_end_at) OR (day_kind IN ('rest','leave') AND num_nonnulls(window_start_at,last_start_at,window_end_at,grace_end_at)=0)")],child=True)
table('task_occurrences','计划修订下的具体任务实例，生命周期与scope分离','planning',[
 col('plan_revision_id','uuid','冻结计划修订'),col('learning_day_id','uuid','稳定学习日'),col('stable_task_key','text','逻辑任务键，换题拆任务不铸造奖励资格'),col('supersedes_task_id','uuid','替代的旧任务',True),
 col('title','text','儿童可见短任务名'),col('external_instructions','text','原APP或点读笔的学习说明'),col('estimated_seconds','integer','预计外部学习和验证用时'),col('is_required','boolean','是否为冻结每日必需任务'),
 status('scheduled|active|pending_review|completed|cancelled|content_blocked','scheduled'),col('completed_at','timestamptz','真实完成UTC时刻',True),col('cancelled_at','timestamptz','取消UTC时刻',True),rev(),updated()],
 [cfk('plan_revision_id','app.plan_revisions'),cfk('learning_day_id','app.learning_days'),cfk('supersedes_task_id','app.task_occurrences'),
 'UNIQUE (family_id, child_id, plan_revision_id, id)','UNIQUE (family_id, child_id, learning_day_id, plan_revision_id, stable_task_key)',check('supersedes_task_id IS NULL OR supersedes_task_id<>id'),check('estimated_seconds BETWEEN 1 AND 7200 AND revision>0'),enum('status','scheduled|active|pending_review|completed|cancelled|content_blocked')],child=True,rules=['发布后title、范围、能力、必需项不可变；仅受控生命周期可更新。','替换任务保留原奖励stable_slot；同日多任务营养总预算为40，不随任务数增发。'])
table('task_scopes','任务允许的精确新学/复习切片集合','planning',[
 col('task_occurrence_id','uuid','任务实例'),col('plan_revision_id','uuid','任务所属冻结修订'),col('content_version_id','uuid','教材版本'),col('slice_id','uuid','精确页句片段'),col('scope_role','text','new_learning/review/context'),col('content_release_id','uuid','使用的发布集合')],
 [cfk(['plan_revision_id','task_occurrence_id'],'app.task_occurrences',['plan_revision_id','id']),fk(['content_version_id','slice_id'],'app.source_slices',['content_version_id','id']),fk(['content_version_id','content_release_id'],'app.content_releases',['content_version_id','id']),
 'UNIQUE (family_id, child_id, task_occurrence_id, slice_id, scope_role)',enum('scope_role','new_learning|review|context')],child=True)
table('task_requirements','任务每个必需目标的独立通过条件','planning',[
 col('task_occurrence_id','uuid','任务实例'),col('plan_revision_id','uuid','冻结计划修订'),col('objective_id','uuid','能力目标'),col('skill','text','与目标一致的所测能力'),col('modality','text','与目标一致的模态'),col('required','boolean','是否必须覆盖'),
 col('min_evidence_count','smallint','最低有效证据数'),col('min_score_units','integer','客观项最低整数得分'),col('max_score_units','integer','客观项明确分母'),col('allow_assisted','boolean','是否接受提示后完成'),col('allow_parent_review','boolean','是否接受家长复核')],
 [cfk(['plan_revision_id','task_occurrence_id'],'app.task_occurrences',['plan_revision_id','id']),fk(['objective_id','skill','modality'],'app.learning_objectives',['id','skill','modality']),
 'UNIQUE (family_id, child_id, task_occurrence_id, objective_id)',check('min_evidence_count>0 AND max_score_units>0 AND min_score_units BETWEEN 0 AND max_score_units')],child=True)
table('study_exposures','原工具学习完成声明、历史导入与应用训练参与事实','learning',[
 col('task_occurrence_id','uuid','可选关联任务，历史声明可空',True),col('device_id','uuid','产生记录的设备',True),col('declared_by','uuid','家长确认成员；孩子自报为空',True),col('source_kind','text','self_report/parent_report/historical/authorized_external/training'),
 col('occurred_at','timestamptz','实际声明或训练发生时刻',True),col('learning_date','date','归属家庭学习日'),col('date_precision','text','instant/day/approximate'),col('external_reference','text','可信外部记录引用；不存令牌',True),col('event_key','text','同孩子声明/训练事件幂等键'),col('withdrawn_at','timestamptz','声明撤回标记；不删除作答证据',True)],
 [cfk('task_occurrence_id','app.task_occurrences'),fk('device_id','app.devices'),fk('declared_by','app.family_memberships'),'UNIQUE (family_id, child_id, event_key)',enum('source_kind','self_report|parent_report|historical|authorized_external|training'),enum('date_precision','instant|day|approximate'),check("date_precision<>'instant' OR occurred_at IS NOT NULL")],child=True)
table('exposure_slices','孩子声明接触/训练过的精确教材片段','learning',[
 col('study_exposure_id','uuid','学习事实'),col('content_version_id','uuid','教材版本'),col('slice_id','uuid','实际学习范围切片')],
 [cfk('study_exposure_id','app.study_exposures'),fk(['content_version_id','slice_id'],'app.source_slices',['content_version_id','id']),'UNIQUE (family_id, child_id, study_exposure_id, slice_id)'],child=True)
table('challenge_sessions','训练/验证/诊断会话与设备租约','challenge',[
 col('task_occurrence_id','uuid','具体任务；诊断会话可空',True),col('learning_day_id','uuid','原归属学习日'),col('device_id','uuid','当前持有租约的设备'),col('mode','text','training/verification/diagnostic'),col('scene_key','text','home/park/hospital等场景键'),
 status('created|active|submitted|pending_review|completed|expired|cancelled','created'),col('lease_epoch','bigint','转移租约的栅栏代数',default='1'),col('lease_expires_at','timestamptz','租约过期时刻'),rev(),
 col('form_digest','text','冻结题单/选项排列/评分规则摘要'),col('random_seed','bigint','稳定题单种子'),col('rules_version','text','会话评分规则版本'),col('started_at','timestamptz','服务端开始时刻'),col('submit_deadline_at','timestamptz','原窗口收尾提交截止'),col('submitted_at','timestamptz','提交时刻',True),col('finished_at','timestamptz','结案时刻',True),updated()],
 [cfk('task_occurrence_id','app.task_occurrences'),cfk('learning_day_id','app.learning_days'),fk('device_id','app.devices'),
 'UNIQUE (family_id, child_id, task_occurrence_id, id)',enum('mode','training|verification|diagnostic'),enum('status','created|active|submitted|pending_review|completed|expired|cancelled'),check("mode<>'verification' OR task_occurrence_id IS NOT NULL"),check('lease_epoch>0 AND revision>0 AND submit_deadline_at>=started_at AND lease_expires_at>=started_at'),check("form_digest ~ '^[0-9a-f]{64}$'")],child=True,rules=['partial unique保证同task最多一个未结案验证；training会话不受此唯一键阻挡。','租约转移原会话增epoch/revision；迟到答题由数据库检查提交epoch并拒绝。'])
table('challenge_items','已冻结公开题单，绝不包含标准答案','challenge',[
 col('challenge_session_id','uuid','会话'),col('question_version_id','uuid','公开题目版本'),col('objective_id','uuid','对应目标'),col('task_requirement_id','uuid','关联任务要求；训练/诊断可空',True),col('ordinal','integer','会话题序'),col('option_order','text[]','选项稳定键顺序，不含正确标记'),col('is_required','boolean','是否必做验证项'),col('answer_exposed_at','timestamptz','该会话提示/解析首次暴露时刻',True)],
 [cfk('challenge_session_id','app.challenge_sessions'),fk(['objective_id','question_version_id'],'app.question_versions',['objective_id','id']),cfk('task_requirement_id','app.task_requirements'),
 'UNIQUE (family_id, child_id, challenge_session_id, id)','UNIQUE (family_id, child_id, challenge_session_id, ordinal)',check('ordinal>=0')],child=True,rules=['题目、目标、顺序在首次答题后冻结，answer_exposed_at可追加。','题单与task_requirement必须属于会话对应task，跨关系触发检查。'])
table('answer_attempts','每次作答的输入、机器判定和提示事实','challenge',[
 col('challenge_session_id','uuid','会话'),col('challenge_item_id','uuid','题单项'),col('device_id','uuid','提交设备'),col('attempt_key','text','设备生成的本次作答幂等键'),col('lease_epoch','bigint','提交时持有的租约代数'),col('attempt_no','smallint','该题尝试序号'),
 col('response_kind','text','choice/text/matching/ordering/recording'),col('response_payload','jsonb','版本化作答值，如option_keys/text/pairs，不放任意实体或评分代码'),col('response_schema_version','integer','作答结构版本'),col('recording_media_id','uuid','孩子录音，强制同孩子归属',True),
 col('machine_result','text','correct/incorrect/unrecognized/pending_review'),col('score_units','integer','本次机器得分；未识别/待评为空',True),col('max_score_units','integer','评分分母'),col('assistance','text','independent/hinted/demonstrated'),col('grader_version','text','实际评分器/模型版本'),col('received_at','timestamptz','服务端收到时刻',default='CURRENT_TIMESTAMP')],
 [cfk(['challenge_session_id','challenge_item_id'],'app.challenge_items',['challenge_session_id','id']),cfk('recording_media_id','app.media_assets'),fk('device_id','app.devices'),
 'UNIQUE (family_id, child_id, attempt_key)','UNIQUE (family_id, child_id, challenge_item_id, attempt_no)','UNIQUE (family_id, child_id, challenge_item_id, id)',enum('response_kind','choice|text|matching|ordering|recording'),enum('machine_result','correct|incorrect|unrecognized|pending_review'),enum('assistance','independent|hinted|demonstrated'),
 check('attempt_no>0 AND response_schema_version>0 AND lease_epoch>0 AND max_score_units>0 AND (score_units IS NULL OR score_units BETWEEN 0 AND max_score_units)'),check("jsonb_typeof(response_payload)='object'"),check("(response_kind='recording') = (recording_media_id IS NOT NULL)")],child=True,rules=['追加不可改，人工结论另写review_requests/learning_evidence，不覆盖机器结果。','JSON仅为多题型答案值；option_keys存在性与格式由相应固定评分器核验，身份/题目/媒体均关系外键。'])
table('review_requests','口语、超时离线或坏题的家长复核结果','challenge',[
 col('answer_attempt_id','uuid','待复核作答'),col('requested_reason','text','oral/unrecognized/late_sync/question_error'),status('pending|approved|needs_help|cancelled','pending'),col('reviewed_by','uuid','受权家长成员',True),col('reviewed_at','timestamptz','复核UTC时刻',True),col('review_note','text','复核说明',True),rev(),updated()],
 [cfk('answer_attempt_id','app.answer_attempts'),fk('reviewed_by','app.family_memberships'),'UNIQUE (family_id, child_id, answer_attempt_id)',enum('requested_reason','oral|unrecognized|late_sync|question_error'),enum('status','pending|approved|needs_help|cancelled'),check("(status='pending' AND reviewed_at IS NULL) OR (status<>'pending' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)"),check('revision>0')],child=True,rules=['结案后不可改；误复核以新增证据修订/审计处理，不覆盖原结论。','可次日复核，归属学习日从原task/session取得，不因当前门禁拒绝家长。'])
table('learning_evidence','能力目标的不可变验证证据或修订事件','learning',[
 col('objective_id','uuid','所测目标'),col('skill','text','与目标一致的能力'),col('modality','text','与目标一致的模态'),col('answer_attempt_id','uuid','证据源作答'),col('review_request_id','uuid','人工证据对应复核',True),col('task_occurrence_id','uuid','证据归属任务；诊断可空',True),
 col('evidence_key','text','确定性来源/目标幂等键'),col('evidence_kind','text','observation/correction/retraction'),col('supersedes_evidence_id','uuid','被修订/撤回的旧证据',True),col('outcome','text','passed/needs_help/invalid'),col('assistance','text','independent/hinted/demonstrated/parent_confirmed'),col('assessment_source','text','deterministic/asr/parent/calibrated_speech'),col('observed_at','timestamptz','证据实际发生时刻'),col('learning_date','date','归属原学习日'),col('reason','text','判定/修订原因')],
 [fk(['objective_id','skill','modality'],'app.learning_objectives',['id','skill','modality']),cfk('answer_attempt_id','app.answer_attempts'),cfk('review_request_id','app.review_requests'),cfk('task_occurrence_id','app.task_occurrences'),cfk('supersedes_evidence_id','app.learning_evidence'),
 'UNIQUE (family_id, child_id, evidence_key)',enum('evidence_kind','observation|correction|retraction'),enum('outcome','passed|needs_help|invalid'),enum('assistance','independent|hinted|demonstrated|parent_confirmed'),enum('assessment_source','deterministic|asr|parent|calibrated_speech'),
 check("(evidence_kind='observation' AND supersedes_evidence_id IS NULL) OR (evidence_kind IN ('correction','retraction') AND supersedes_evidence_id IS NOT NULL)"),check("(assessment_source='parent') = (review_request_id IS NOT NULL)"),check("evidence_kind<>'retraction' OR outcome='invalid'")],child=True,rules=['证据修订追加行；每条原证据最多一个直接后继，禁止旧证据重复生效。','review、attempt、task与目标的一致性触发器检查。'])
table('mastery_snapshots','可重算的孩子目标能力掌握/复习快照','learning',[
 col('objective_id','uuid','目标'),col('skill','text','能力'),col('modality','text','模态'),col('last_evidence_id','uuid','最近纳入的有效证据'),col('algorithm_version','text','规则/调度算法版本'),col('evidence_count','integer','已纳入有效证据数'),col('mastery_level','text','unassessed/introduced/practicing/emerging/retained'),col('due_learning_date','date','建议下一复习日',True),col('computed_at','timestamptz','计算时刻'),rev()],
 [fk(['objective_id','skill','modality'],'app.learning_objectives',['id','skill','modality']),cfk('last_evidence_id','app.learning_evidence'),'UNIQUE (family_id, child_id, objective_id, skill, modality)',check('evidence_count>=0 AND revision>0'),enum('mastery_level','unassessed|introduced|practicing|emerging|retained')],child=True)

# Inventory / pets; IDs are added after all tables for circular links.
table('item_definitions','稳定物品定义与最小计量单位','inventory',[
 col('stable_key','text','物品稳定键'),col('name','text','儿童物品名'),col('item_kind','text','food/material/decoration/care'),col('unit','text','nutrition_point/piece'),col('compatible_species','text[]','适用宠物种类白名单'),col('asset_package_id','uuid','外观资源包',True),col('asset_key','text','包内外观键',True),retired()],
 [fk('asset_package_id','app.asset_packages'),'UNIQUE (family_id, stable_key)',enum('item_kind','food|material|decoration|care'),enum('unit','nutrition_point|piece'),check("(item_kind='food' AND unit='nutrition_point') OR (item_kind<>'food' AND unit='piece')"),check('cardinality(compatible_species)>0')],rules=['食物库存的1单位就是1营养点，不以一整包导致饱腹截断浪费。','种类与单位创建后不可变；外观以新资源包关联更新。'])
table('reward_entitlements','与可变政策版本无关的稳定日/周奖励资格','rewards',[
 col('period_kind','text','day/week'),col('period_key','date','day为学习日；week为周一日期'),col('stable_slot','text','nutrition.task_x/day.materials/week.materials等逻辑槽位'),col('learning_day_id','uuid','日资格对应学习日；周资格为空',True),col('task_occurrence_id','uuid','任务营养资格可关联任务',True),col('weekly_plan_id','uuid','周资格对应稳定周计划；日资格可空',True),
 col('policy_version','text','创建资格时冻结政策版本，不进入唯一键'),col('qualification_kind','text','task_verified/day_completed/week_goal/admin'),col('qualified_at','timestamptz','条件满足UTC时刻',True),col('cancelled_at','timestamptz','仅未发放资格可取消',True)],
 [cfk('learning_day_id','app.learning_days'),cfk('task_occurrence_id','app.task_occurrences'),cfk('weekly_plan_id','app.weekly_plans'),
 'UNIQUE (family_id, child_id, period_kind, period_key, stable_slot)',enum('period_kind','day|week'),enum('qualification_kind','task_verified|day_completed|week_goal|admin'),check("(period_kind='day' AND learning_day_id IS NOT NULL) OR (period_kind='week' AND weekly_plan_id IS NOT NULL AND learning_day_id IS NULL AND task_occurrence_id IS NULL AND extract(isodow FROM period_key)=1)"),check('qualified_at IS NULL OR cancelled_at IS NULL')],child=True,rules=['唯一资格绝不包含policy_version、内容版本或新任务UUID。','任务、learning_day、period_key及孩子由触发器核实一致；周资格与周计划日期一致。'])
table('entitlement_items','资格冻结的物品与整数份额，不随执行时政策变化','rewards',[
 col('reward_entitlement_id','uuid','稳定奖励资格'),col('item_definition_id','uuid','奖励物品'),col('quantity','bigint','最小单位数量，食物为营养点')],
 [cfk('reward_entitlement_id','app.reward_entitlements'),fk('item_definition_id','app.item_definitions'),'UNIQUE (family_id, child_id, reward_entitlement_id, item_definition_id)',check('quantity>0')],child=True,rules=['日任务食物资格合计40营养点；分任务只是分配，不新增当日预算。','日建设材料一个稳定资格，周材料一个稳定资格；发布/发放时跨行预算触发检查。'])
table('reward_grants','已经结算的一次资格发放，追加不可改','rewards',[
 col('reward_entitlement_id','uuid','实际使用的稳定资格'),col('grant_key','text','发放幂等业务键'),col('granted_at','timestamptz','服务端结算时刻'),col('actor_membership_id','uuid','家长赠予/补偿时的操作者，正常系统发放为空',True)],
 [cfk('reward_entitlement_id','app.reward_entitlements'),fk('actor_membership_id','app.family_memberships'),'UNIQUE (family_id, child_id, reward_entitlement_id)','UNIQUE (family_id, child_id, grant_key)'],child=True)
table('reward_grant_items','一次发放内每种物品的冻结数量','rewards',[
 col('reward_grant_id','uuid','发放事件'),col('item_definition_id','uuid','奖励物品'),col('quantity','bigint','最小单位数量')],
 [cfk('reward_grant_id','app.reward_grants'),fk('item_definition_id','app.item_definitions'),'UNIQUE (family_id, child_id, reward_grant_id, item_definition_id)','UNIQUE (family_id, child_id, item_definition_id, id)',check('quantity>0')],child=True)
table('inventory_balances','由追加账本维护的孩子物品余额投影','inventory',[
 col('item_definition_id','uuid','物品定义'),col('quantity','bigint','最小单位可用余额，不得负数',default='0'),rev(),updated()],
 [fk('item_definition_id','app.item_definitions'),'UNIQUE (family_id, child_id, item_definition_id)',check('quantity>=0 AND revision>0')],child=True,rules=['不允许业务连接直接改余额；ledger AFTER INSERT触发器原子更新并阻止负库存。'])
table('pets','孩子宠物身份、资源选择与生命周期','pets',[
 col('nickname','text','宠物昵称'),col('species','text','dog/cat/rabbit，后续通过迁移扩展'),col('personality','text','性格模板键'),col('asset_package_id','uuid','宠物资源版本'),col('lifecycle','text','active/retired/deceased_reserved'),col('life_mode','text','companion；真实生命模式首版关闭'),col('adopted_at','timestamptz','领养时刻'),col('retired_at','timestamptz','归档时刻',True)],
 [fk('asset_package_id','app.asset_packages'),enum('species','dog|cat|rabbit'),enum('lifecycle','active|retired|deceased_reserved'),check("life_mode='companion'"),check("lifecycle<>'deceased_reserved'")],child=True,rules=['partial unique保证首版每孩子一个active主宠；死亡值保留但CHECK禁止使用。'])
table('pet_states','宠物当前身体状态与时间结算快照','pets',[
 col('pet_id','uuid','宠物'),col('satiety_cp','smallint','饱腹0到10000 centipoint；100cp=界面1点'),col('hydration_cp','smallint','水分0到10000cp'),col('energy_cp','smallint','精力0到10000cp'),col('mood_cp','smallint','心情0到10000cp'),col('health_cp','smallint','健康0到10000cp'),col('hygiene_cp','smallint','清洁0到10000cp'),col('decay_remainder_seconds','bigint','被动衰减尚未折算的余秒',default='0'),
 col('growth_points','bigint','不可消费成长点',default='0'),col('bond_points','bigint','关系里程碑点，不因漏学扣减',default='0'),col('growth_stage','text','baby/young/adult/elder_reserved'),col('location_key','text','home/nest/park/hospital等场所'),col('care_mode','text','normal/resting/hosted'),
 col('rules_version','text','状态衰减与照护规则版本'),col('last_evaluated_at','timestamptz','服务端上次结算时刻'),rev(),updated()],
 [cfk('pet_id','app.pets'),'UNIQUE (family_id, child_id, pet_id)',check('satiety_cp BETWEEN 0 AND 10000 AND hydration_cp BETWEEN 0 AND 10000 AND energy_cp BETWEEN 0 AND 10000 AND mood_cp BETWEEN 0 AND 10000 AND health_cp BETWEEN 0 AND 10000 AND hygiene_cp BETWEEN 0 AND 10000'),check('growth_points>=0 AND bond_points>=0 AND revision>0 AND decay_remainder_seconds>=0'),enum('growth_stage','baby|young|adult|elder_reserved'),enum('care_mode','normal|resting|hosted')],child=True)
table('inventory_ledger','孩子物品增减的不可变权威账本','inventory',[
 col('item_definition_id','uuid','物品'),col('delta','bigint','有符号最小单位增减，非零'),col('entry_kind','text','reward/feed/craft/admin/compensation/reversal'),col('operation_key','text','同孩子命令/账目幂等业务键'),
 col('reward_grant_item_id','uuid','奖励来源行，普通消费为空',True),col('pet_id','uuid','喂食宠物，其他可空',True),col('reverses_entry_id','uuid','全额冲正的原账目',True),col('actor_membership_id','uuid','管理/补偿操作者',True),col('reason','text','可审计账目原因'),col('occurred_at','timestamptz','业务时刻')],
 [fk('item_definition_id','app.item_definitions'),cfk(['item_definition_id','reward_grant_item_id'],'app.reward_grant_items',['item_definition_id','id']),cfk('pet_id','app.pets'),cfk('reverses_entry_id','app.inventory_ledger'),fk('actor_membership_id','app.family_memberships'),
 'UNIQUE (family_id, child_id, operation_key)',check('delta<>0'),enum('entry_kind','reward|feed|craft|admin|compensation|reversal'),check("(entry_kind='reward')=(reward_grant_item_id IS NOT NULL)"),check("entry_kind<>'reward' OR delta>0"),check("entry_kind<>'feed' OR (delta<0 AND pet_id IS NOT NULL)"),check("(entry_kind='reversal')=(reverses_entry_id IS NOT NULL)"),check("entry_kind NOT IN ('admin','compensation','reversal') OR actor_membership_id IS NOT NULL")],child=True,rules=['每grant item只能一条正向reward账；数量必须与发放行一致。','账本禁止UPDATE/DELETE；纠错追加补偿/全额冲正，不能覆写余额。','奖励错题不追扣学习所得；管理冲正须另有明确理由与权限。'])
table('pet_events','已确认宠物动作与状态变化事件','pets',[
 col('pet_id','uuid','宠物'),col('command_key','text','宠物命令幂等业务键'),col('event_kind','text','adopt/feed/drink/rest/walk/clean/heal/grow/host/evaluate'),col('item_definition_id','uuid','使用的物品',True),col('inventory_entry_id','uuid','对应消费账目',True),
 col('requested_units','bigint','请求食物营养点，非进食事件可0',default='0'),col('applied_units','bigint','实际吃下/应用的整数单位',default='0'),col('state_revision_after','bigint','事务确认后的状态修订'),col('occurred_at','timestamptz','服务端事件时间'),payload()],
 [cfk('pet_id','app.pets'),fk('item_definition_id','app.item_definitions'),cfk('inventory_entry_id','app.inventory_ledger'),'UNIQUE (family_id, child_id, command_key)',check('requested_units>=0 AND applied_units>=0 AND applied_units<=requested_units AND state_revision_after>0'),enum('event_kind','adopt|feed|drink|rest|walk|clean|heal|grow|host|evaluate'),check("jsonb_typeof(payload)='object'"),check("event_kind<>'feed' OR (item_definition_id IS NOT NULL AND inventory_entry_id IS NOT NULL AND applied_units>0)")],child=True,rules=['账本与状态事务成功后才播动画；动画中断不撤销消费。'])
table('pet_daily_records','宠物每日照顾与成长的去重统计','pets',[
 col('pet_id','uuid','宠物'),col('learning_day_id','uuid','学习日'),col('learning_date','date','家庭日期'),col('growth_awarded','boolean','当日是否已记录一次成长',default='false'),col('interaction_used_seconds','integer','已确认互动用时',default='0'),col('outdoor_confirmed_by','uuid','真实户外家长确认者',True),col('care_completed','boolean','当日照顾约定是否完成',default='false'),rev(),updated()],
 [cfk('pet_id','app.pets'),cfk('learning_day_id','app.learning_days'),fk('outdoor_confirmed_by','app.family_memberships'),'UNIQUE (family_id, child_id, pet_id, learning_date)',check('interaction_used_seconds BETWEEN 0 AND 86400 AND revision>0')],child=True)
table('hospital_cases','宠物就诊及替代复习任务的关联','pets',[
 col('pet_id','uuid','同孩子宠物'),col('task_occurrence_id','uuid','抵扣的既有复习任务；体检可空',True),col('condition_key','text','可解释且白名单的轻症/体检剧情键'),status('open|in_care|recovering|closed','open'),col('opened_at','timestamptz','就诊开始'),col('closed_at','timestamptz','结案时刻',True),rev(),updated()],
 [cfk('pet_id','app.pets'),cfk('task_occurrence_id','app.task_occurrences'),enum('status','open|in_care|recovering|closed'),check('closed_at IS NULL OR closed_at>=opened_at'),check('revision>0')],child=True,rules=['医院不另设发粮资格；复习调用同task/证据链。'])
table('pet_memories','宠物共同经历与受控长期记忆','pets',[
 col('pet_id','uuid','宠物'),col('memory_key','text','同宠物稳定里程碑键'),col('memory_kind','text','preference/milestone/short_story'),col('text','text','已检查的简短回忆'),col('source_evidence_id','uuid','学习来源证据',True),col('source_event_id','uuid','生活来源事件',True),col('visible_to_child','boolean','是否可展示',default='true'),col('erased_at','timestamptz','家长删除记忆标记',True),updated()],
 [cfk('pet_id','app.pets'),cfk('source_evidence_id','app.learning_evidence'),cfk('source_event_id','app.pet_events'),'UNIQUE (family_id, child_id, pet_id, memory_key)',enum('memory_kind','preference|milestone|short_story')],child=True)
table('scene_layouts','孩子已保存的场景布置版本','scenes',[
 col('pet_id','uuid','主宠'),col('scene_key','text','场所稳定键'),col('asset_package_id','uuid','场景资源包'),col('layout_version','integer','布置版本号'),col('is_current','boolean','是否当前布置'),col('is_locked','boolean','防误拖动布置锁',default='false'),col('saved_at','timestamptz','保存时刻')],
 [cfk('pet_id','app.pets'),fk('asset_package_id','app.asset_packages'),'UNIQUE (family_id, child_id, pet_id, scene_key, layout_version)',check('layout_version>0')],child=True)
table('scene_placements','布置内物品槽位及变换，预览不消费','scenes',[
 col('scene_layout_id','uuid','场景布置'),col('item_definition_id','uuid','已拥有装饰物'),col('slot_key','text','受控场景槽位'),col('position_x','numeric(10,6)','归一化水平位置'),col('position_y','numeric(10,6)','归一化垂直位置'),col('scale','numeric(8,4)','缩放比例'),col('rotation_deg','numeric(8,3)','角度'),col('layer_order','integer','遮挡层顺序')],
 [cfk('scene_layout_id','app.scene_layouts'),fk('item_definition_id','app.item_definitions'),'UNIQUE (family_id, child_id, scene_layout_id, slot_key)',check('position_x BETWEEN 0 AND 1 AND position_y BETWEEN 0 AND 1 AND scale>0 AND scale<=4')],child=True,rules=['购买/制作消费另走ledger；预览和移动本表不发奖不扣库存。'])

table('slice_media_bindings','切片多媒体绑定与区域/音频时间片','content',[
 col('content_version_id','uuid','同教材内容版本'),col('slice_id','uuid','语义切片'),col('media_asset_id','uuid','绑定媒体'),col('binding_role','text','page_image/illustration/reference_audio/synthetic_audio/source_document'),col('ordinal','integer','同角色媒体顺序'),col('start_ms','bigint','音频起点',True),col('end_ms','bigint','音频终点',True),col('region_x','numeric(8,6)','页图区域x',True),col('region_y','numeric(8,6)','页图区域y',True),col('region_w','numeric(8,6)','区域宽',True),col('region_h','numeric(8,6)','区域高',True)],
 [fk(['content_version_id','slice_id'],'app.source_slices',['content_version_id','id']),fk('media_asset_id','app.media_assets'),'UNIQUE (family_id, slice_id, binding_role, ordinal)',enum('binding_role','page_image|illustration|reference_audio|synthetic_audio|source_document'),check('ordinal>=0'),check('(num_nonnulls(start_ms,end_ms)=0) OR (num_nonnulls(start_ms,end_ms)=2 AND start_ms>=0 AND end_ms>start_ms)'),check('(num_nonnulls(region_x,region_y,region_w,region_h)=0) OR (num_nonnulls(region_x,region_y,region_w,region_h)=4 AND region_x>=0 AND region_y>=0 AND region_w>0 AND region_h>0 AND region_x+region_w<=1 AND region_y+region_h<=1)')])

# Operations and sync.
table('background_jobs','家庭范围后台导入/出题/语音/备份作业队列','ops',[
 col('job_kind','text','应用白名单作业类型'),col('dedupe_key','text','业务去重键'),status('queued|running|succeeded|failed|cancelled','queued'),col('available_at','timestamptz','可领取时刻'),col('lease_owner','text','当前worker实例',True),col('lease_until','timestamptz','领取租约到期',True),col('attempts','integer','尝试次数',default='0'),col('max_attempts','smallint','最大尝试次数',default='3'),col('input_schema_version','integer','作业payload schema版本'),payload(),col('last_error_code','text','最近错误码',True),updated()],
 ['UNIQUE (family_id, job_kind, dedupe_key)',enum('status','queued|running|succeeded|failed|cancelled'),check('attempts>=0 AND max_attempts>0 AND attempts<=max_attempts AND input_schema_version>0'),check("jsonb_typeof(payload)='object'"),check("status<>'running' OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL)")],rules=['FOR UPDATE SKIP LOCKED领取；租约过期可重试但领域命令仍幂等。'])
table('outbox_events','同业务事务写入的追加领域事件与同步游标','ops',[
 col('sequence_no','bigint','数据库生成的递增全局游标',default='GENERATED ALWAYS AS IDENTITY'),col('child_id','uuid','仅属于某孩子的事件；家庭事件为空',True),col('event_key','text','家庭内唯一事件键'),col('event_type','text','版本化白名单事件类型'),col('aggregate_type','text','实体类型路由键'),col('aggregate_id','uuid','聚合标识；按event_type由服务端验证'),col('aggregate_revision','bigint','聚合修订号'),col('schema_version','integer','事件schema版本'),payload(),col('occurred_at','timestamptz','业务时刻'),col('delivered_at','timestamptz','worker投递确认时刻',True)],
 [fk('child_id','app.children'),'UNIQUE (sequence_no)','UNIQUE (family_id, sequence_no)','UNIQUE (family_id, event_key)',check('aggregate_revision>0 AND schema_version>0'),check("jsonb_typeof(payload)='object'")],rules=['事件payload追加不可改，允许delivered_at维护。','aggregate_id为事件路由元数据，不作为关系真源；事件通过event_type schema校验且敏感答案不进入payload。'])
table('idempotency_records','设备/家长命令幂等键与已确认响应','ops',[
 col('device_id','uuid','客户端设备',True),col('membership_id','uuid','家长身份',True),col('child_id','uuid','孩子身份',True),col('operation','text','命令类型'),col('idempotency_key','text','请求幂等键'),col('request_digest','text','规范化请求摘要'),status('processing|completed','processing'),col('http_status','smallint','已确认HTTP状态',True),col('response_body','jsonb','版本化最小响应，不含私有题目答案',True),col('expires_at','timestamptz','保留截止时刻'),updated()],
 [fk('device_id','app.devices'),fk('membership_id','app.family_memberships'),fk('child_id','app.children'),'UNIQUE (family_id, operation, idempotency_key)',check('num_nonnulls(device_id,membership_id)>0'),check("request_digest ~ '^[0-9a-f]{64}$'"),enum('status','processing|completed'),check("(status='processing' AND http_status IS NULL AND response_body IS NULL) OR (status='completed' AND http_status BETWEEN 100 AND 599 AND response_body IS NOT NULL)"),check('expires_at>created_at')],rules=['同键不同摘要报冲突；完成响应不可被第二请求覆盖；过期清理由维护角色执行。'])
table('audit_events','家长管理、发布、复核和异常操作审计','ops',[
 col('actor_membership_id','uuid','家长操作者；系统事件可空',True),col('device_id','uuid','来源设备',True),col('child_id','uuid','受影响孩子',True),col('action','text','审计动作'),col('entity_type','text','受影响实体类型'),col('entity_id','uuid','目标标识，仅审计路由'),col('request_id','uuid','关联请求链路ID'),col('reason','text','操作原因'),col('metadata','jsonb','已脱敏的差异/结果，不含密码令牌和录音内容',default="'{}'::jsonb")],
 [fk('actor_membership_id','app.family_memberships'),fk('device_id','app.devices'),fk('child_id','app.children'),check("jsonb_typeof(metadata)='object'")],rules=['追加不可改；仅受控归档策略处理保留。','entity_id是审计路由非业务关系，不以动态实体ID替代正式FK。'])
table('device_pairings','短时一次性电视与伴侣设备配对','identity',[
 col('child_id','uuid','本次配对限定孩子'),col('display_device_id','uuid','电视/展示设备'),col('companion_device_id','uuid','确认后的录音伴侣',True),col('challenge_session_id','uuid','可选绑定会话',True),col('code_digest','text','短码的加盐摘要，不保存原码'),status('pending|confirmed|expired|revoked','pending'),col('attempts','smallint','错误尝试次数',default='0'),col('expires_at','timestamptz','短时过期'),col('confirmed_by','uuid','授权家长',True),col('confirmed_at','timestamptz','确认时刻',True)],
 [fk('child_id','app.children'),fk('display_device_id','app.devices'),fk('companion_device_id','app.devices'),'FOREIGN KEY (family_id, child_id, challenge_session_id) REFERENCES app.challenge_sessions(family_id, child_id, id) ON DELETE RESTRICT',fk('confirmed_by','app.family_memberships'),'UNIQUE (code_digest)',check('attempts BETWEEN 0 AND 10 AND expires_at>created_at'),enum('status','pending|confirmed|expired|revoked'),check("status<>'confirmed' OR (companion_device_id IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)"),check('companion_device_id IS NULL OR companion_device_id<>display_device_id')])
table('sync_cursors','设备已确认接收的家庭事件游标','ops',[
 col('device_id','uuid','同步设备'),col('child_id','uuid','设备限定孩子；家长可空',True),col('last_sequence_no','bigint','最近确认的同家庭outbox游标',True),col('last_sync_at','timestamptz','最近成功同步时刻'),col('client_schema_version','integer','客户端同步协议版本'),rev()],
 [fk('device_id','app.devices'),fk('child_id','app.children'),fk('last_sequence_no','app.outbox_events',['sequence_no']),'UNIQUE (family_id, device_id)',check('client_schema_version>0 AND revision>0')],rules=['游标只前进；RLS限定家庭，儿童过滤仍由事件授权规则限制。'])

# Final integration additions: public typed question config, API revisions and relational operations entities.
for existing in TABLES:
    if existing['name'] in ('families','children','devices','curriculum_series'):
        existing['columns'].insert(-1,rev())
        existing['constraints'].append(check('revision>0'))
    if existing['name']=='question_versions':
        existing['columns'].insert(-1,col('public_payload','jsonb','按question_type和public_payload_schema_version校验的公开题型配置；不含答案、讲解、源引用或任意可执行内容',default="'{}'::jsonb"))
        existing['columns'].insert(-1,col('public_payload_schema_version','integer','公开题型配置schema版本',default='1'))
        existing['constraints'] += [check("jsonb_typeof(public_payload)='object'"),check('public_payload_schema_version>0'),check("NOT (public_payload ?| ARRAY['answer_spec','correct_answer','correct_answers','correct_option_ids','accepted_option_ids','accepted_texts','explanation','rubric','source_quotes','source_slice_ids','context_slice_ids'])")]
        existing['rules'] += ['prompt_text与instruction_text保存统一题干/指令；public_payload只存题型特定上下文、缺口及布局，question_options仍是选项/左右项/词块的关系真源。','公开配置中引用选项与媒体必须与同题版本关系行一致；发布lint校验全部嵌套字段，SQL顶层禁用键只是纵深防御。']

table('family_settings','家庭版本化政策与开关快照','identity',[
 col('version_no','integer','家庭内递增政策版本号'),col('schema_version','integer','应用维护的政策schema版本'),col('policy','jsonb','窗口默认值、自动发布、隐私和调用额度等声明式政策；无密钥、脚本及业务实体列表'),col('changed_by','uuid','制定或发布家长成员'),col('effective_from','timestamptz','仅对之后新任务/命令生效的UTC时刻'),published(),retired()],
 [fk('changed_by','app.family_memberships'),'UNIQUE (family_id, version_no)',check('version_no>0 AND schema_version>0'),check("jsonb_typeof(policy)='object'"),check("NOT (policy ?| ARRAY['api_key','token','password','secret','script','javascript'])")],rules=['政策发布payload冻结，retired_at只控制未来使用；既有任务、学习日和奖励资格保留原冻结政策。','生效时选择已发布未退役且effective_from<=命令时间的最高版本；更新须新版本，不直接改历史任务分母。'])

table('content_issues','题目/媒体/原片段错误报告及修复闭环','content_ops',[
 col('question_version_id','uuid','被报告题目版本',True),col('media_asset_id','uuid','被报告媒体',True),col('source_slice_id','uuid','被报告原片段',True),col('reporter_child_id','uuid','孩子报告者，可空',True),col('reporter_membership_id','uuid','家长报告者，可空',True),col('device_id','uuid','报告设备',True),col('issue_kind','text','wrong_answer/ambiguous/out_of_scope/media_error/source_error/other'),col('description','text','报告说明，不复制录音或敏感身份'),status('open|triaged|resolved|dismissed','open'),col('resolved_by','uuid','处理成员',True),col('resolved_at','timestamptz','处理时刻',True),col('replacement_question_version_id','uuid','修复后的新题版本',True),col('resolution_note','text','修复/驳回原因',True),rev(),updated()],
 [fk('question_version_id','app.question_versions'),fk('media_asset_id','app.media_assets'),fk('source_slice_id','app.source_slices'),fk('reporter_child_id','app.children'),fk('reporter_membership_id','app.family_memberships'),fk('device_id','app.devices'),fk('resolved_by','app.family_memberships'),fk('replacement_question_version_id','app.question_versions'),check('num_nonnulls(question_version_id,media_asset_id,source_slice_id)=1'),check('num_nonnulls(reporter_child_id,reporter_membership_id,device_id)>0'),check('revision>0'),enum('issue_kind','wrong_answer|ambiguous|out_of_scope|media_error|source_error|other'),enum('status','open|triaged|resolved|dismissed'),check("(status IN ('open','triaged') AND resolved_at IS NULL AND resolved_by IS NULL) OR (status IN ('resolved','dismissed') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL)"),check('replacement_question_version_id IS NULL OR (question_version_id IS NOT NULL AND replacement_question_version_id<>question_version_id)')],rules=['目标、报告者和描述创建后不可改；处理状态可递增修订；撤回坏题和生成修订走独立发布事务。','replacement题必须同目标/同题族，由处理触发器校验；不追扣孩子旧奖励。'])

table('ai_provider_configs','家庭AI能力配置与服务器密钥引用','ai_ops',[
 col('config_key','text','家庭内配置稳定键'),col('capability','text','generation/qa/asr/tts/pet_dialogue/image_generation'),col('provider','text','供应商或本地服务适配器键'),col('model','text','固定模型/推理版本'),col('endpoint_url','text','受运维允许列表限制的HTTPS或本地服务地址'),col('secret_ref','text','服务端秘密管理器/环境引用名，仅引用不含秘密值',True),col('options_schema_version','integer','声明式选项schema版本',default='1'),col('options','jsonb','温度、输出长度等白名单选项；禁止嵌入凭据或任意代码',default="'{}'::jsonb"),col('daily_budget_microunits','bigint','每日最多成本最小单位'),col('currency','text','成本币种'),col('timeout_seconds','integer','调用超时秒'),col('max_concurrent_calls','smallint','该配置同时调用上限'),col('created_by','uuid','创建家长成员'),status('active|disabled','active'),rev(),updated()],
 [fk('created_by','app.family_memberships'),'UNIQUE (family_id, config_key)',enum('capability','generation|qa|asr|tts|pet_dialogue|image_generation'),enum('status','active|disabled'),check("endpoint_url ~ '^https?://' AND position('@' IN endpoint_url)=0 AND position('?' IN endpoint_url)=0 AND position('#' IN endpoint_url)=0"),check("secret_ref IS NULL OR secret_ref ~ '^[A-Za-z][A-Za-z0-9_:/.-]{0,199}$'"),check('daily_budget_microunits>=0 AND timeout_seconds BETWEEN 1 AND 600 AND max_concurrent_calls BETWEEN 1 AND 16 AND revision>0 AND options_schema_version>0'),check("jsonb_typeof(options)='object' AND NOT (options ?| ARRAY['api_key','token','password','secret','authorization','script','javascript'])")],rules=['secret_ref由受权运维解析，API与日志不返回秘密值；不允许家长从任意URL抓取内网资源，发布前执行endpoint允许列表与SSRF检查。','运行预算按当次冻结配置revision与price_version结算；修改预算不回写已经预留的账。'])

table('ai_budget_reservations','AI调用预算预留、结算及释放记录','ai_ops',[
 col('ai_provider_config_id','uuid','所属能力配置'),col('provider_revision','bigint','本次冻结配置修订号'),col('generation_run_id','uuid','对应出题批次，和background_job二选一',True),col('background_job_id','uuid','对应AI作业，和generation_run二选一',True),col('reservation_key','text','调用/重试共享业务键'),col('budget_date','date','按家庭时区的预算日'),col('price_version','text','本次价格/估算规则版本'),col('currency','text','冻结成本币种'),col('reserved_microunits','bigint','最大获准费用，int64最小计价单位'),col('settled_microunits','bigint','实际结算费用，未结案为空',True),status('reserved|settled|released','reserved'),col('expires_at','timestamptz','预留租约到期，不表示供应商已经停止调用'),col('resolved_at','timestamptz','最终结算或释放时刻',True),col('provider_request_id','text','供应商请求号，无凭据',True),rev(),updated()],
 [fk('ai_provider_config_id','app.ai_provider_configs'),fk('generation_run_id','app.generation_runs'),fk('background_job_id','app.background_jobs'),'UNIQUE (family_id, reservation_key)',check('num_nonnulls(generation_run_id,background_job_id)=1'),check('provider_revision>0 AND reserved_microunits>=0 AND (settled_microunits IS NULL OR settled_microunits BETWEEN 0 AND reserved_microunits) AND revision>0'),enum('status','reserved|settled|released'),check("(status='reserved' AND settled_microunits IS NULL AND resolved_at IS NULL) OR (status='settled' AND settled_microunits IS NOT NULL AND resolved_at IS NOT NULL) OR (status='released' AND settled_microunits=0 AND resolved_at IS NOT NULL)"),check('expires_at>created_at')],rules=['配置行FOR UPDATE串行预留，日内reserved上限与settled实际额共同占用预算；终态不可改，网络不明不立即释放以免重复调用。','同配置每个run或job只有一份预留；重复网络尝试沿用request键，需额外额度的新调用必须新作业/明确授权。'])

table('outbox_deliveries','每消费者每事件的投递租约、重试与确认','ops',[
 col('outbox_event_id','uuid','不可变领域事件'),col('consumer_key','text','应用维护的消费者稳定键'),status('queued|inflight|delivered|dead','queued'),col('attempts','integer','实际领取尝试次数',default='0'),col('max_attempts','smallint','最大次数',default='5'),col('available_at','timestamptz','下次可领取时间'),col('lease_owner','text','worker实例标识',True),col('lease_until','timestamptz','当前投递租约过期',True),col('delivered_at','timestamptz','本消费者确认时刻',True),col('last_error_code','text','最近错误码，不含内容秘密',True),rev(),updated()],
 [fk('outbox_event_id','app.outbox_events'),'UNIQUE (family_id, consumer_key, outbox_event_id)',enum('status','queued|inflight|delivered|dead'),check('attempts>=0 AND max_attempts>0 AND attempts<=max_attempts AND revision>0'),check("status<>'inflight' OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL)"),check("(status='delivered')=(delivered_at IS NOT NULL)")],rules=['消费者领取FOR UPDATE SKIP LOCKED；事件本体不可变，单一delivered_at不能代表所有消费者。','投递成功与领域副作用的幂等性分开，消费者以event id+consumer去重，delivered终态不可回滚。'])

# Suffix objects are supplied separately to keep the relational catalog inspectable.
HEADER = '''-- 伴学小岛 PostgreSQL 16 数据库详设
-- 应用生成UUID；不安装扩展。请在全新数据库以迁移所有者执行。
-- SET TIME ZONE 仅固定当前连接；生产连接也应固定UTC。
BEGIN;
SET TIME ZONE 'UTC';
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
'''
def sql_literal(s): return "'"+s.replace("'","''")+"'"
lines=[HEADER]
# Tables may reference later tables: define all fields first, all constraints afterwards.
for t in TABLES:
    fqn=t['schema']+'.'+t['name']
    fields=[]
    for c in t['columns']:
        s='    '+c['name']+' '+c['type']
        if c['default'] and c['default'].startswith('GENERATED '): s+=' '+c['default']
        elif c['default'] is not None:s+=' DEFAULT '+c['default']
        if not c['nullable']:s+=' NOT NULL'
        fields.append(s)
    lines += ['\nCREATE TABLE '+fqn+' (\n'+',\n'.join(fields)+'\n);', 'COMMENT ON TABLE '+fqn+' IS '+sql_literal(t['description'])+';']
    for c in t['columns']:
        lines.append('COMMENT ON COLUMN '+fqn+'.'+c['name']+' IS '+sql_literal(c['description'])+';')
for t in TABLES:
    for i,c in enumerate(t['constraints'],1):
        lines.append('ALTER TABLE '+t['schema']+'.'+t['name']+' ADD CONSTRAINT '+t['name']+'_c'+str(i)+' '+c+';')

INDEXES = [
 ('settings_active_version','app.family_settings','(family_id, effective_from, version_no)',"published_at IS NOT NULL AND retired_at IS NULL",False),
 ('content_issue_inbox','app.content_issues','(family_id, status, created_at)',"status IN ('open','triaged')",False),
 ('budget_one_run','app.ai_budget_reservations','(family_id, ai_provider_config_id, generation_run_id)','generation_run_id IS NOT NULL',True),
 ('budget_one_job','app.ai_budget_reservations','(family_id, ai_provider_config_id, background_job_id)','background_job_id IS NOT NULL',True),
 ('budget_daily_usage','app.ai_budget_reservations','(family_id, ai_provider_config_id, budget_date, status)',None,False),
 ('delivery_ready','app.outbox_deliveries','(family_id, consumer_key, available_at, id)',"status='queued'",False),
 ('delivery_expired','app.outbox_deliveries','(family_id, lease_until)',"status='inflight'",False),
 ('members_active','app.family_memberships','(family_id, account_id)',"status='active'",False),
 ('import_active_digest','app.import_jobs','(family_id, edition_id, input_digest)',"stage<>'failed'",True),
 ('question_live_objective','app.question_versions','(family_id, objective_id, question_type)',"published_at IS NOT NULL AND retired_at IS NULL",False),
 ('active_verification_task','app.challenge_sessions','(family_id, child_id, task_occurrence_id)',"mode='verification' AND status IN ('created','active','submitted','pending_review')",True),
 ('evidence_one_observation','app.learning_evidence','(family_id, child_id, answer_attempt_id, objective_id)',"evidence_kind='observation'",True),
 ('pet_event_one_ledger','app.pet_events','(family_id, child_id, inventory_entry_id)','inventory_entry_id IS NOT NULL',True),
 ('evidence_one_successor','app.learning_evidence','(family_id, child_id, supersedes_evidence_id)','supersedes_evidence_id IS NOT NULL',True),
 ('reward_one_ledger','app.inventory_ledger','(family_id, child_id, reward_grant_item_id)','reward_grant_item_id IS NOT NULL',True),
 ('ledger_one_reversal','app.inventory_ledger','(family_id, child_id, reverses_entry_id)','reverses_entry_id IS NOT NULL',True),
 ('one_active_pet','app.pets','(family_id, child_id)',"lifecycle='active'",True),
 ('one_open_hospital','app.hospital_cases','(family_id, child_id, pet_id)',"status<>'closed'",True),
 ('one_current_layout','app.scene_layouts','(family_id, child_id, pet_id, scene_key)','is_current',True),
 ('ledger_history','app.inventory_ledger','(family_id, child_id, item_definition_id, occurred_at, id)',None,False),
 ('evidence_objective','app.learning_evidence','(family_id, child_id, objective_id, observed_at)',None,False),
 ('exposure_lookup','app.exposure_slices','(family_id, child_id, slice_id)',None,False),
 ('review_inbox','app.review_requests','(family_id, status, created_at)',"status='pending'",False),
 ('job_ready','app.background_jobs','(family_id, available_at, id)',"status='queued'",False),
 ('job_expired','app.background_jobs','(family_id, lease_until)',"status='running'",False),
 ('outbox_pending','app.outbox_events','(family_id, sequence_no)','delivered_at IS NULL',False),
 ('task_day','app.task_occurrences','(family_id, child_id, learning_day_id, status)',None,False),
 ('media_retention','app.media_assets','(family_id, retention_until)',"status<>'deleted' AND retention_until IS NOT NULL",False)
]
for name,t,expr,pred,unique in INDEXES:
    lines.append('CREATE '+('UNIQUE ' if unique else '')+'INDEX '+name+' ON '+t+' '+expr+(' WHERE '+pred if pred else '')+';')
# Automatically index FK source columns not already covered by an identical declared prefix.
for t in TABLES:
    import re
    cols_seen=set()
    for c in t['constraints']:
        m=re.match(r'FOREIGN KEY \(([^)]+)\)',c)
        if not m:continue
        columns=m.group(1)
        if columns=='family_id':continue
        if columns in cols_seen:continue
        cols_seen.add(columns)
        idx=t['name']+'_fk'+str(len(cols_seen))
        lines.append('CREATE INDEX '+idx+' ON '+t['schema']+'.'+t['name']+' ('+columns+');')

(OUT/'schema.tables.sql').write_text('\n'.join(lines)+'\n',encoding='utf-8')
(OUT/'catalog.json').write_text(json.dumps({'database':'PostgreSQL 16','uuid_strategy':'application_generated','timezone':'UTC','tables':[{k:v for k,v in t.items() if k not in ('child',)} for t in TABLES]},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(OUT/'definition-data.json').write_text(json.dumps({'tables':TABLES,'indexes':INDEXES},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('tables:',len(TABLES))
print('tables with family_id:',sum(any(c['name']=='family_id' for c in t['columns']) for t in TABLES))

-- 伴学小岛 PostgreSQL 16 数据库详设
-- 应用生成UUID；不安装扩展。请在全新数据库以迁移所有者执行。
-- SET TIME ZONE 仅固定当前连接；生产连接也应固定UTC。
BEGIN;
SET TIME ZONE 'UTC';
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM PUBLIC;


CREATE TABLE app.families (
    id uuid NOT NULL,
    name text NOT NULL,
    timezone text DEFAULT 'Asia/Shanghai' NOT NULL,
    week_starts_on smallint DEFAULT 1 NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.families IS '家庭租户与固定学习时区';
COMMENT ON COLUMN app.families.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.families.name IS '家庭显示名称';
COMMENT ON COLUMN app.families.timezone IS 'IANA学习时区，例如Asia/Shanghai';
COMMENT ON COLUMN app.families.week_starts_on IS '周起始ISO星期，固定周一';
COMMENT ON COLUMN app.families.status IS '状态：active|suspended|deleting';
COMMENT ON COLUMN app.families.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.families.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.families.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.accounts (
    id uuid NOT NULL,
    login_name text NOT NULL,
    password_hash text NOT NULL,
    display_name text NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    password_changed_at timestamptz,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.accounts IS '跨家庭的家长登录身份';
COMMENT ON COLUMN app.accounts.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.accounts.login_name IS '规范化登录名；非孩子昵称';
COMMENT ON COLUMN app.accounts.password_hash IS '服务端生成的Argon2id等口令哈希，不保存明文';
COMMENT ON COLUMN app.accounts.display_name IS '家长显示名';
COMMENT ON COLUMN app.accounts.status IS '状态：active|locked|disabled';
COMMENT ON COLUMN app.accounts.password_changed_at IS '最近口令更新UTC时刻';
COMMENT ON COLUMN app.accounts.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.accounts.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.family_memberships (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    account_id uuid NOT NULL,
    role text NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.family_memberships IS '家长账号在家庭中的成员关系和角色';
COMMENT ON COLUMN app.family_memberships.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.family_memberships.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.family_memberships.account_id IS '全局家长账号';
COMMENT ON COLUMN app.family_memberships.role IS 'owner/admin/parent/content_editor/reviewer';
COMMENT ON COLUMN app.family_memberships.status IS '状态：active|revoked';
COMMENT ON COLUMN app.family_memberships.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.family_memberships.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.children (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    nickname text NOT NULL,
    reading_mode text NOT NULL,
    can_type boolean DEFAULT false NOT NULL,
    speech_enabled boolean DEFAULT false NOT NULL,
    ai_enabled boolean DEFAULT false NOT NULL,
    recording_retention_days smallint DEFAULT 30 NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.children IS '孩子档案及操作能力设置';
COMMENT ON COLUMN app.children.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.children.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.children.nickname IS '孩子昵称，不要求真实姓名';
COMMENT ON COLUMN app.children.reading_mode IS 'pre_reader/early_reader/reader';
COMMENT ON COLUMN app.children.can_type IS '是否具备独立键盘拼写操作能力';
COMMENT ON COLUMN app.children.speech_enabled IS '是否启用录音任务';
COMMENT ON COLUMN app.children.ai_enabled IS '家长是否启用外部AI互动';
COMMENT ON COLUMN app.children.recording_retention_days IS '原始录音保留日数，0表示处理后删除';
COMMENT ON COLUMN app.children.status IS '状态：active|archived';
COMMENT ON COLUMN app.children.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.children.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.children.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.devices (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    bound_child_id uuid,
    name text NOT NULL,
    device_kind text NOT NULL,
    public_key text,
    capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    last_seen_at timestamptz,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.devices IS '家庭设备与允许的孩子绑定';
COMMENT ON COLUMN app.devices.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.devices.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.devices.bound_child_id IS '儿童/电视设备绑定孩子；家长设备可空';
COMMENT ON COLUMN app.devices.name IS '设备显示名称';
COMMENT ON COLUMN app.devices.device_kind IS 'ipad/web/phone/android_tv';
COMMENT ON COLUMN app.devices.public_key IS '可选设备公钥，不保存设备私钥';
COMMENT ON COLUMN app.devices.capabilities IS '版本化设备检测结果：WebGL、录音MIME、D-pad等';
COMMENT ON COLUMN app.devices.status IS '状态：active|revoked';
COMMENT ON COLUMN app.devices.last_seen_at IS '最近服务端在线时刻';
COMMENT ON COLUMN app.devices.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.devices.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.devices.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.auth_sessions (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    device_id uuid NOT NULL,
    membership_id uuid,
    child_id uuid,
    session_kind text NOT NULL,
    token_digest text NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.auth_sessions IS '家长/孩子受控登录会话';
COMMENT ON COLUMN app.auth_sessions.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.auth_sessions.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.auth_sessions.device_id IS '当前设备';
COMMENT ON COLUMN app.auth_sessions.membership_id IS '家长成员身份；儿童会话为空';
COMMENT ON COLUMN app.auth_sessions.child_id IS '孩子身份；家长会话可为空';
COMMENT ON COLUMN app.auth_sessions.session_kind IS 'parent/child/tv';
COMMENT ON COLUMN app.auth_sessions.token_digest IS '随机会话令牌的安全摘要，原令牌不入库';
COMMENT ON COLUMN app.auth_sessions.expires_at IS '过期UTC时刻';
COMMENT ON COLUMN app.auth_sessions.revoked_at IS '撤销UTC时刻';
COMMENT ON COLUMN app.auth_sessions.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.auth_sessions.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.media_assets (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid,
    asset_kind text NOT NULL,
    storage_key text NOT NULL,
    sha256 text NOT NULL,
    mime_type text NOT NULL,
    byte_size bigint NOT NULL,
    width_px integer,
    height_px integer,
    duration_ms bigint,
    origin_kind text NOT NULL,
    rights_code text NOT NULL,
    rights_note text NOT NULL,
    retention_until timestamptz,
    status text DEFAULT 'staging' NOT NULL,
    deleted_at timestamptz,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.media_assets IS '家庭媒体对象的存储、来源、权利与保留元数据';
COMMENT ON COLUMN app.media_assets.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.media_assets.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.media_assets.child_id IS '儿童录音所属孩子；教材/公用素材为空';
COMMENT ON COLUMN app.media_assets.asset_kind IS 'source_document/image/audio/recording/atlas/model/report';
COMMENT ON COLUMN app.media_assets.storage_key IS '受控媒体目录相对键，不是任意主机路径';
COMMENT ON COLUMN app.media_assets.sha256 IS '文件内容SHA-256';
COMMENT ON COLUMN app.media_assets.mime_type IS '真实媒体MIME';
COMMENT ON COLUMN app.media_assets.byte_size IS '压缩文件字节数';
COMMENT ON COLUMN app.media_assets.width_px IS '图片宽像素';
COMMENT ON COLUMN app.media_assets.height_px IS '图片高像素';
COMMENT ON COLUMN app.media_assets.duration_ms IS '音视频时长毫秒';
COMMENT ON COLUMN app.media_assets.origin_kind IS 'licensed_upload/family_authored/generated/recorded';
COMMENT ON COLUMN app.media_assets.rights_code IS '许可或家庭使用范围编码';
COMMENT ON COLUMN app.media_assets.rights_note IS '可追溯权利说明';
COMMENT ON COLUMN app.media_assets.retention_until IS '对象保留到期时间';
COMMENT ON COLUMN app.media_assets.status IS '状态：staging|ready|quarantined|deleted';
COMMENT ON COLUMN app.media_assets.deleted_at IS '物理媒体删除登记；保留证据元数据';
COMMENT ON COLUMN app.media_assets.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.media_assets.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.curriculum_series (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    stable_key text NOT NULL,
    title text NOT NULL,
    language_tag text NOT NULL,
    adapter_key text NOT NULL,
    retired_at timestamptz,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.curriculum_series IS '教材系列与适配器入口';
COMMENT ON COLUMN app.curriculum_series.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.curriculum_series.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.curriculum_series.stable_key IS '家庭内稳定系列键，如raz/new_concept';
COMMENT ON COLUMN app.curriculum_series.title IS '教材系列名';
COMMENT ON COLUMN app.curriculum_series.language_tag IS '学习语言标签，如en';
COMMENT ON COLUMN app.curriculum_series.adapter_key IS '应用白名单教材结构适配器键';
COMMENT ON COLUMN app.curriculum_series.retired_at IS '退役时刻；不改写既有发布payload';
COMMENT ON COLUMN app.curriculum_series.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.curriculum_series.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.curriculum_editions (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    series_id uuid NOT NULL,
    edition_key text NOT NULL,
    edition_label text NOT NULL,
    publisher text NOT NULL,
    isbn text,
    language_variant text NOT NULL,
    rights_code text NOT NULL,
    retired_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.curriculum_editions IS '教材具体版本与来源映射';
COMMENT ON COLUMN app.curriculum_editions.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.curriculum_editions.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.curriculum_editions.series_id IS '教材系列';
COMMENT ON COLUMN app.curriculum_editions.edition_key IS '同系列稳定版本键';
COMMENT ON COLUMN app.curriculum_editions.edition_label IS '版次名称';
COMMENT ON COLUMN app.curriculum_editions.publisher IS '出版/家庭原创主体';
COMMENT ON COLUMN app.curriculum_editions.isbn IS '可选ISBN';
COMMENT ON COLUMN app.curriculum_editions.language_variant IS '语言变体，如en-GB/en-US';
COMMENT ON COLUMN app.curriculum_editions.rights_code IS '内容使用/共享权限编码';
COMMENT ON COLUMN app.curriculum_editions.retired_at IS '退役时刻；不改写既有发布payload';
COMMENT ON COLUMN app.curriculum_editions.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.content_versions (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    edition_id uuid NOT NULL,
    version_no integer NOT NULL,
    source_media_id uuid NOT NULL,
    source_hash text NOT NULL,
    schema_version integer NOT NULL,
    status text DEFAULT 'draft' NOT NULL,
    published_at timestamptz,
    retired_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.content_versions IS '教材一份不可变的结构化内容快照';
COMMENT ON COLUMN app.content_versions.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.content_versions.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.content_versions.edition_id IS '所属教材版次';
COMMENT ON COLUMN app.content_versions.version_no IS '版次内内容修订序号';
COMMENT ON COLUMN app.content_versions.source_media_id IS '原始文档对象';
COMMENT ON COLUMN app.content_versions.source_hash IS '原文/结构快照摘要';
COMMENT ON COLUMN app.content_versions.schema_version IS '内容schema版本';
COMMENT ON COLUMN app.content_versions.status IS '状态：draft|checking|ready';
COMMENT ON COLUMN app.content_versions.published_at IS '首次发布时间；一旦设置不再清除';
COMMENT ON COLUMN app.content_versions.retired_at IS '退役时刻；不改写既有发布payload';
COMMENT ON COLUMN app.content_versions.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.content_nodes (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    content_version_id uuid NOT NULL,
    parent_id uuid,
    stable_key text NOT NULL,
    node_kind text NOT NULL,
    title text NOT NULL,
    ordinal integer NOT NULL,
    external_locator text NOT NULL,
    page_number integer,
    speaker text,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.content_nodes IS '教材树的级别/书/课/页/段/句节点';
COMMENT ON COLUMN app.content_nodes.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.content_nodes.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.content_nodes.content_version_id IS '所属冻结内容版本';
COMMENT ON COLUMN app.content_nodes.parent_id IS '同版本父节点';
COMMENT ON COLUMN app.content_nodes.stable_key IS '同版本内节点稳定键';
COMMENT ON COLUMN app.content_nodes.node_kind IS 'level/book/unit/lesson/page/passage/dialogue/sentence';
COMMENT ON COLUMN app.content_nodes.title IS '节点展示标题';
COMMENT ON COLUMN app.content_nodes.ordinal IS '父节点内顺序，从0开始';
COMMENT ON COLUMN app.content_nodes.external_locator IS '原书/APP中的书名课号页码等可读定位';
COMMENT ON COLUMN app.content_nodes.page_number IS '实际书页号';
COMMENT ON COLUMN app.content_nodes.speaker IS '对话说话人';
COMMENT ON COLUMN app.content_nodes.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.source_slices (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    content_version_id uuid NOT NULL,
    node_id uuid NOT NULL,
    stable_key text NOT NULL,
    slice_kind text NOT NULL,
    original_text text NOT NULL,
    normalized_text text NOT NULL,
    source_hash text NOT NULL,
    source_media_id uuid NOT NULL,
    image_media_id uuid,
    audio_media_id uuid,
    audio_start_ms bigint,
    audio_end_ms bigint,
    region_x numeric(8,6),
    region_y numeric(8,6),
    region_w numeric(8,6),
    region_h numeric(8,6),
    language_variant text NOT NULL,
    slice_schema_version integer NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.source_slices IS '可追溯的语义上下文片与原子片';
COMMENT ON COLUMN app.source_slices.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.source_slices.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.source_slices.content_version_id IS '所属内容版本';
COMMENT ON COLUMN app.source_slices.node_id IS '原教材节点';
COMMENT ON COLUMN app.source_slices.stable_key IS '版本内切片稳定键';
COMMENT ON COLUMN app.source_slices.slice_kind IS 'context/sentence/word';
COMMENT ON COLUMN app.source_slices.original_text IS '提取后忠实保留的原文';
COMMENT ON COLUMN app.source_slices.normalized_text IS '受控规范化文字；不覆盖原文';
COMMENT ON COLUMN app.source_slices.source_hash IS '本切片源内容摘要';
COMMENT ON COLUMN app.source_slices.source_media_id IS '原始文档/页图对象';
COMMENT ON COLUMN app.source_slices.image_media_id IS '对应图片';
COMMENT ON COLUMN app.source_slices.audio_media_id IS '教材或示范音频';
COMMENT ON COLUMN app.source_slices.audio_start_ms IS '音频切片起点';
COMMENT ON COLUMN app.source_slices.audio_end_ms IS '音频切片终点';
COMMENT ON COLUMN app.source_slices.region_x IS '页图归一化区域x';
COMMENT ON COLUMN app.source_slices.region_y IS '页图归一化区域y';
COMMENT ON COLUMN app.source_slices.region_w IS '归一化区域宽';
COMMENT ON COLUMN app.source_slices.region_h IS '归一化区域高';
COMMENT ON COLUMN app.source_slices.language_variant IS '语种变体';
COMMENT ON COLUMN app.source_slices.slice_schema_version IS '切片规则版本';
COMMENT ON COLUMN app.source_slices.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.slice_contexts (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    content_version_id uuid NOT NULL,
    slice_id uuid NOT NULL,
    context_slice_id uuid NOT NULL,
    relation_kind text NOT NULL,
    ordinal integer NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.slice_contexts IS '同版本切片的必要上下文关系';
COMMENT ON COLUMN app.slice_contexts.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.slice_contexts.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.slice_contexts.content_version_id IS '共同所属内容版本';
COMMENT ON COLUMN app.slice_contexts.slice_id IS '被解释的原子切片';
COMMENT ON COLUMN app.slice_contexts.context_slice_id IS '提供问答/指代/图文上下文的切片';
COMMENT ON COLUMN app.slice_contexts.relation_kind IS 'parent_context/pronoun_reference/question_answer/visual_context';
COMMENT ON COLUMN app.slice_contexts.ordinal IS '上下文拼接顺序';
COMMENT ON COLUMN app.slice_contexts.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.vocabulary_senses (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    lemma text NOT NULL,
    surface_form text NOT NULL,
    part_of_speech text NOT NULL,
    meaning text NOT NULL,
    language_variant text NOT NULL,
    sense_key text NOT NULL,
    retired_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.vocabulary_senses IS '词形/词义标识而非仅字符串词典';
COMMENT ON COLUMN app.vocabulary_senses.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.vocabulary_senses.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.vocabulary_senses.lemma IS '词元';
COMMENT ON COLUMN app.vocabulary_senses.surface_form IS '目标词形';
COMMENT ON COLUMN app.vocabulary_senses.part_of_speech IS '词性编码';
COMMENT ON COLUMN app.vocabulary_senses.meaning IS '本义项解释';
COMMENT ON COLUMN app.vocabulary_senses.language_variant IS '语种变体';
COMMENT ON COLUMN app.vocabulary_senses.sense_key IS '家庭内稳定词义键';
COMMENT ON COLUMN app.vocabulary_senses.retired_at IS '退役时刻；不改写既有发布payload';
COMMENT ON COLUMN app.vocabulary_senses.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.learning_objectives (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    vocabulary_sense_id uuid,
    stable_key text NOT NULL,
    title text NOT NULL,
    skill text NOT NULL,
    modality text NOT NULL,
    target_text text NOT NULL,
    retired_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.learning_objectives IS '可被测量的能力目标';
COMMENT ON COLUMN app.learning_objectives.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.learning_objectives.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.learning_objectives.vocabulary_sense_id IS '可选所测词义';
COMMENT ON COLUMN app.learning_objectives.stable_key IS '目标稳定键';
COMMENT ON COLUMN app.learning_objectives.title IS '目标描述';
COMMENT ON COLUMN app.learning_objectives.skill IS '所测能力';
COMMENT ON COLUMN app.learning_objectives.modality IS '主要呈现/输出模态';
COMMENT ON COLUMN app.learning_objectives.target_text IS '目标词、原句或句型';
COMMENT ON COLUMN app.learning_objectives.retired_at IS '退役时刻；不改写既有发布payload';
COMMENT ON COLUMN app.learning_objectives.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.slice_objectives (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    content_version_id uuid NOT NULL,
    slice_id uuid NOT NULL,
    objective_id uuid NOT NULL,
    is_primary boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.slice_objectives IS '原片段与学习目标的多对多映射';
COMMENT ON COLUMN app.slice_objectives.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.slice_objectives.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.slice_objectives.content_version_id IS '源内容版本';
COMMENT ON COLUMN app.slice_objectives.slice_id IS '源片段';
COMMENT ON COLUMN app.slice_objectives.objective_id IS '目标';
COMMENT ON COLUMN app.slice_objectives.is_primary IS '是否该片段主目标';
COMMENT ON COLUMN app.slice_objectives.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.import_jobs (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    edition_id uuid NOT NULL,
    source_media_id uuid NOT NULL,
    output_content_version_id uuid,
    input_digest text NOT NULL,
    stage text NOT NULL,
    parser_version text NOT NULL,
    checkpoint jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_code text,
    requested_by uuid NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.import_jobs IS '资料导入阶段、断点及差异清单';
COMMENT ON COLUMN app.import_jobs.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.import_jobs.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.import_jobs.edition_id IS '目标教材版次';
COMMENT ON COLUMN app.import_jobs.source_media_id IS '上传源文件';
COMMENT ON COLUMN app.import_jobs.output_content_version_id IS '导入产出的结构化版本';
COMMENT ON COLUMN app.import_jobs.input_digest IS '导入内容及配置摘要，用于去重';
COMMENT ON COLUMN app.import_jobs.stage IS 'received/validated/parsing/aligning/slicing/generating/qa/ready/failed';
COMMENT ON COLUMN app.import_jobs.parser_version IS '固定的解析器及配置版本';
COMMENT ON COLUMN app.import_jobs.checkpoint IS '版本化断点与差异统计，不保存教材树';
COMMENT ON COLUMN app.import_jobs.error_code IS '机器可读错误码';
COMMENT ON COLUMN app.import_jobs.requested_by IS '发起家长成员';
COMMENT ON COLUMN app.import_jobs.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.import_jobs.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.generation_runs (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    content_version_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    prompt_version text NOT NULL,
    template_version text NOT NULL,
    input_digest text NOT NULL,
    blueprint jsonb NOT NULL,
    status text DEFAULT 'queued' NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    cost_microunits bigint DEFAULT 0 NOT NULL,
    currency text NOT NULL,
    retry_count smallint DEFAULT 0 NOT NULL,
    finished_at timestamptz,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.generation_runs IS 'AI或模板出题批次及可重现生产信息';
COMMENT ON COLUMN app.generation_runs.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.generation_runs.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.generation_runs.content_version_id IS '出题源内容版本';
COMMENT ON COLUMN app.generation_runs.requested_by IS '发起成员';
COMMENT ON COLUMN app.generation_runs.provider IS '模型供应商/模板引擎标识';
COMMENT ON COLUMN app.generation_runs.model IS '模型或确定性生成器版本';
COMMENT ON COLUMN app.generation_runs.prompt_version IS '提示版本';
COMMENT ON COLUMN app.generation_runs.template_version IS '题型模板版本';
COMMENT ON COLUMN app.generation_runs.input_digest IS '蓝图与源片段摘要';
COMMENT ON COLUMN app.generation_runs.blueprint IS '版本化出题蓝图参数；源片段另存generation_inputs';
COMMENT ON COLUMN app.generation_runs.status IS '状态：queued|running|checking|completed|failed|cancelled';
COMMENT ON COLUMN app.generation_runs.input_tokens IS '输入token用量';
COMMENT ON COLUMN app.generation_runs.output_tokens IS '输出token用量';
COMMENT ON COLUMN app.generation_runs.cost_microunits IS '计价币种的百万分之一最小单位';
COMMENT ON COLUMN app.generation_runs.currency IS 'ISO币种或内部计量币种';
COMMENT ON COLUMN app.generation_runs.retry_count IS '重试次数';
COMMENT ON COLUMN app.generation_runs.finished_at IS '结束时刻';
COMMENT ON COLUMN app.generation_runs.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.generation_runs.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.generation_inputs (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    content_version_id uuid NOT NULL,
    generation_run_id uuid NOT NULL,
    slice_id uuid NOT NULL,
    input_role text NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.generation_inputs IS '生成批次允许使用的源片段与用途';
COMMENT ON COLUMN app.generation_inputs.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.generation_inputs.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.generation_inputs.content_version_id IS '共同内容版本';
COMMENT ON COLUMN app.generation_inputs.generation_run_id IS '生成批次';
COMMENT ON COLUMN app.generation_inputs.slice_id IS '精确允许的切片';
COMMENT ON COLUMN app.generation_inputs.input_role IS 'target/context/allowed_distractor';
COMMENT ON COLUMN app.generation_inputs.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.question_families (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    objective_id uuid NOT NULL,
    stable_key text NOT NULL,
    description text NOT NULL,
    retired_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.question_families IS '同一知识目标与题意的题目家族';
COMMENT ON COLUMN app.question_families.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.question_families.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.question_families.objective_id IS '主能力目标';
COMMENT ON COLUMN app.question_families.stable_key IS '服务端规范化题族键';
COMMENT ON COLUMN app.question_families.description IS '题意/同质变式说明';
COMMENT ON COLUMN app.question_families.retired_at IS '退役时刻；不改写既有发布payload';
COMMENT ON COLUMN app.question_families.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.question_versions (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    question_family_id uuid NOT NULL,
    objective_id uuid NOT NULL,
    content_version_id uuid NOT NULL,
    generation_run_id uuid,
    version_no integer NOT NULL,
    question_type text NOT NULL,
    prompt_text text NOT NULL,
    instruction_text text NOT NULL,
    image_media_id uuid,
    audio_media_id uuid,
    difficulty smallint NOT NULL,
    estimated_seconds integer NOT NULL,
    is_source_quote boolean NOT NULL,
    requires_microphone boolean DEFAULT false NOT NULL,
    requires_typing boolean DEFAULT false NOT NULL,
    payload_digest text NOT NULL,
    status text DEFAULT 'draft' NOT NULL,
    published_at timestamptz,
    retired_at timestamptz,
    public_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    public_payload_schema_version integer DEFAULT 1 NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.question_versions IS '题目版本的公开呈现字段，不含答案和讲解';
COMMENT ON COLUMN app.question_versions.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.question_versions.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.question_versions.question_family_id IS '题目家族';
COMMENT ON COLUMN app.question_versions.objective_id IS '主能力目标';
COMMENT ON COLUMN app.question_versions.content_version_id IS '源教材版本';
COMMENT ON COLUMN app.question_versions.generation_run_id IS '可选来源生成批次';
COMMENT ON COLUMN app.question_versions.version_no IS '题族内修订序号';
COMMENT ON COLUMN app.question_versions.question_type IS '题型执行器白名单';
COMMENT ON COLUMN app.question_versions.prompt_text IS '对孩子公开的题干';
COMMENT ON COLUMN app.question_versions.instruction_text IS '操作说明，不能泄露被测答案';
COMMENT ON COLUMN app.question_versions.image_media_id IS '题干配图';
COMMENT ON COLUMN app.question_versions.audio_media_id IS '题干音频';
COMMENT ON COLUMN app.question_versions.difficulty IS '内部难度档1到5';
COMMENT ON COLUMN app.question_versions.estimated_seconds IS '预计用时秒';
COMMENT ON COLUMN app.question_versions.is_source_quote IS '是否教材原句，false为受约束变式';
COMMENT ON COLUMN app.question_versions.requires_microphone IS '是否必须录音';
COMMENT ON COLUMN app.question_versions.requires_typing IS '是否必须键盘输入';
COMMENT ON COLUMN app.question_versions.payload_digest IS '包含private答案的受控题目内容摘要';
COMMENT ON COLUMN app.question_versions.status IS '状态：draft|machine_checked|review_required|ready';
COMMENT ON COLUMN app.question_versions.published_at IS '首次发布时间；一旦设置不再清除';
COMMENT ON COLUMN app.question_versions.retired_at IS '退役时刻；不改写既有发布payload';
COMMENT ON COLUMN app.question_versions.public_payload IS '按question_type和public_payload_schema_version校验的公开题型配置；不含答案、讲解、源引用或任意可执行内容';
COMMENT ON COLUMN app.question_versions.public_payload_schema_version IS '公开题型配置schema版本';
COMMENT ON COLUMN app.question_versions.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.question_sources (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    content_version_id uuid NOT NULL,
    question_version_id uuid NOT NULL,
    slice_id uuid NOT NULL,
    source_role text NOT NULL,
    evidence_quote text NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.question_sources IS '题目与教材证据片段的明确关系';
COMMENT ON COLUMN app.question_sources.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.question_sources.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.question_sources.content_version_id IS '共同源内容版本';
COMMENT ON COLUMN app.question_sources.question_version_id IS '题目版本';
COMMENT ON COLUMN app.question_sources.slice_id IS '题源切片';
COMMENT ON COLUMN app.question_sources.source_role IS 'assessed/context/distractor';
COMMENT ON COLUMN app.question_sources.evidence_quote IS '仅管理/复核使用的原文证据摘录';
COMMENT ON COLUMN app.question_sources.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.question_options (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    question_version_id uuid NOT NULL,
    option_key text NOT NULL,
    ordinal integer NOT NULL,
    side text NOT NULL,
    text text,
    image_media_id uuid,
    audio_media_id uuid,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.question_options IS '题目公开选项、匹配两侧或排序词块';
COMMENT ON COLUMN app.question_options.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.question_options.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.question_options.question_version_id IS '题目版本';
COMMENT ON COLUMN app.question_options.option_key IS '题内稳定选项键，API提交此键';
COMMENT ON COLUMN app.question_options.ordinal IS '源配置顺序，运行时可按题单换序';
COMMENT ON COLUMN app.question_options.side IS 'choice/left/right/token';
COMMENT ON COLUMN app.question_options.text IS '可选公开文字';
COMMENT ON COLUMN app.question_options.image_media_id IS '公开图片';
COMMENT ON COLUMN app.question_options.audio_media_id IS '公开音频';
COMMENT ON COLUMN app.question_options.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE private.question_answers (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    question_version_id uuid NOT NULL,
    answer_key text NOT NULL,
    answer_kind text NOT NULL,
    option_id uuid,
    match_option_id uuid,
    gap_key text,
    expected_text text,
    ordering_position integer,
    rubric_text text,
    explanation text NOT NULL,
    case_sensitive boolean DEFAULT false NOT NULL,
    trim_whitespace boolean DEFAULT true NOT NULL,
    collapse_whitespace boolean DEFAULT true NOT NULL,
    punctuation_mode text NOT NULL,
    score_units integer DEFAULT 1 NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE private.question_answers IS '私有标准答案、允许变体与评分规范';
COMMENT ON COLUMN private.question_answers.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN private.question_answers.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN private.question_answers.question_version_id IS '题目版本';
COMMENT ON COLUMN private.question_answers.answer_key IS '题内答案行稳定键/允许变体键';
COMMENT ON COLUMN private.question_answers.answer_kind IS 'option/text/match/order/rubric';
COMMENT ON COLUMN private.question_answers.option_id IS '正确选项/左项/词块';
COMMENT ON COLUMN private.question_answers.match_option_id IS '匹配右项';
COMMENT ON COLUMN private.question_answers.gap_key IS '填空位置键';
COMMENT ON COLUMN private.question_answers.expected_text IS '允许文本答案';
COMMENT ON COLUMN private.question_answers.ordering_position IS '排序目标位置';
COMMENT ON COLUMN private.question_answers.rubric_text IS '人工/模型复核量规';
COMMENT ON COLUMN private.question_answers.explanation IS '仅训练反馈或提交后返回的讲解';
COMMENT ON COLUMN private.question_answers.case_sensitive IS '大小写是否严格';
COMMENT ON COLUMN private.question_answers.trim_whitespace IS '是否裁剪边缘空白';
COMMENT ON COLUMN private.question_answers.collapse_whitespace IS '是否规范连续空白';
COMMENT ON COLUMN private.question_answers.punctuation_mode IS 'strict/ignore';
COMMENT ON COLUMN private.question_answers.score_units IS '评分整数单位';
COMMENT ON COLUMN private.question_answers.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.asset_packages (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    package_key text NOT NULL,
    version_label text NOT NULL,
    package_kind text NOT NULL,
    generator_version text NOT NULL,
    seed bigint NOT NULL,
    input_digest text NOT NULL,
    manifest_media_id uuid NOT NULL,
    minimum_runtime text NOT NULL,
    status text DEFAULT 'draft' NOT NULL,
    published_at timestamptz,
    retired_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.asset_packages IS '宠物/场景/道具包版本与自动构建清单';
COMMENT ON COLUMN app.asset_packages.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.asset_packages.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.asset_packages.package_key IS '稳定包键';
COMMENT ON COLUMN app.asset_packages.version_label IS '语义版本';
COMMENT ON COLUMN app.asset_packages.package_kind IS 'pet/scene/item';
COMMENT ON COLUMN app.asset_packages.generator_version IS '脚本生成器/模型配置版本';
COMMENT ON COLUMN app.asset_packages.seed IS '可复现随机种子';
COMMENT ON COLUMN app.asset_packages.input_digest IS '源输入摘要';
COMMENT ON COLUMN app.asset_packages.manifest_media_id IS '校验后的manifest媒体对象';
COMMENT ON COLUMN app.asset_packages.minimum_runtime IS '最低应用版本';
COMMENT ON COLUMN app.asset_packages.status IS '状态：draft|checking|ready';
COMMENT ON COLUMN app.asset_packages.published_at IS '首次发布时间；一旦设置不再清除';
COMMENT ON COLUMN app.asset_packages.retired_at IS '退役时刻；不改写既有发布payload';
COMMENT ON COLUMN app.asset_packages.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.package_assets (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    asset_package_id uuid NOT NULL,
    media_asset_id uuid NOT NULL,
    asset_key text NOT NULL,
    asset_role text NOT NULL,
    lod smallint NOT NULL,
    anchor_x numeric(10,6) NOT NULL,
    anchor_y numeric(10,6) NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.package_assets IS '资源包中的媒体及可兼容稳定资源键';
COMMENT ON COLUMN app.package_assets.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.package_assets.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.package_assets.asset_package_id IS '资源包版本';
COMMENT ON COLUMN app.package_assets.media_asset_id IS '具体文件';
COMMENT ON COLUMN app.package_assets.asset_key IS '包内稳定资源键';
COMMENT ON COLUMN app.package_assets.asset_role IS 'texture/atlas/animation/manifest/preview/model/sound';
COMMENT ON COLUMN app.package_assets.lod IS '资源档0标准1低配2静态';
COMMENT ON COLUMN app.package_assets.anchor_x IS '归一化主锚点x';
COMMENT ON COLUMN app.package_assets.anchor_y IS '归一化主锚点y';
COMMENT ON COLUMN app.package_assets.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.quality_reports (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    content_version_id uuid,
    question_version_id uuid,
    generation_run_id uuid,
    asset_package_id uuid,
    check_kind text NOT NULL,
    checker_version text NOT NULL,
    verdict text NOT NULL,
    issue_code text NOT NULL,
    message text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    reviewer_membership_id uuid,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.quality_reports IS '内容/题目/生成批次/资产包的质量检查证据';
COMMENT ON COLUMN app.quality_reports.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.quality_reports.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.quality_reports.content_version_id IS '目标内容版本';
COMMENT ON COLUMN app.quality_reports.question_version_id IS '目标题目版本';
COMMENT ON COLUMN app.quality_reports.generation_run_id IS '目标生成批次';
COMMENT ON COLUMN app.quality_reports.asset_package_id IS '目标资产包';
COMMENT ON COLUMN app.quality_reports.check_kind IS 'schema/reference/semantic/media/runtime/visual';
COMMENT ON COLUMN app.quality_reports.checker_version IS '检查脚本或模型版本';
COMMENT ON COLUMN app.quality_reports.verdict IS 'pass/warn/fail';
COMMENT ON COLUMN app.quality_reports.issue_code IS '机器可读问题码；通过用OK';
COMMENT ON COLUMN app.quality_reports.message IS '明确检查结论';
COMMENT ON COLUMN app.quality_reports.details IS '受版本约束的检测定位、统计与证据';
COMMENT ON COLUMN app.quality_reports.reviewer_membership_id IS '人工复核者，自动检查为空';
COMMENT ON COLUMN app.quality_reports.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.content_releases (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    content_version_id uuid NOT NULL,
    release_no integer NOT NULL,
    released_by uuid NOT NULL,
    qa_digest text NOT NULL,
    manifest_digest text NOT NULL,
    published_at timestamptz,
    retired_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.content_releases IS '经校验的教材内容与题库发布集合';
COMMENT ON COLUMN app.content_releases.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.content_releases.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.content_releases.content_version_id IS '源教材内容版本';
COMMENT ON COLUMN app.content_releases.release_no IS '内容版本内发布序号';
COMMENT ON COLUMN app.content_releases.released_by IS '发布家长/内容管理员';
COMMENT ON COLUMN app.content_releases.qa_digest IS '发布采用的检查集合摘要';
COMMENT ON COLUMN app.content_releases.manifest_digest IS '发布清单摘要';
COMMENT ON COLUMN app.content_releases.published_at IS '首次发布时间；一旦设置不再清除';
COMMENT ON COLUMN app.content_releases.retired_at IS '退役时刻；不改写既有发布payload';
COMMENT ON COLUMN app.content_releases.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.release_questions (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    content_version_id uuid NOT NULL,
    content_release_id uuid NOT NULL,
    question_version_id uuid NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.release_questions IS '发布集合中精确包含的题目版本';
COMMENT ON COLUMN app.release_questions.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.release_questions.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.release_questions.content_version_id IS '共同教材版本';
COMMENT ON COLUMN app.release_questions.content_release_id IS '发布集合';
COMMENT ON COLUMN app.release_questions.question_version_id IS '已发布题目版本';
COMMENT ON COLUMN app.release_questions.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.weekly_plans (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    week_start date NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'draft' NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.weekly_plans IS '孩子一个家庭学习周的稳定计划身份';
COMMENT ON COLUMN app.weekly_plans.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.weekly_plans.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.weekly_plans.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.weekly_plans.week_start IS '家庭时区周一日期';
COMMENT ON COLUMN app.weekly_plans.title IS '周计划名称';
COMMENT ON COLUMN app.weekly_plans.status IS '状态：draft|active|archived';
COMMENT ON COLUMN app.weekly_plans.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.weekly_plans.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.plan_revisions (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    weekly_plan_id uuid NOT NULL,
    revision_no integer NOT NULL,
    published_by uuid,
    goal_learning_days smallint NOT NULL,
    planned_learning_days smallint NOT NULL,
    policy_version text NOT NULL,
    payload_digest text NOT NULL,
    status text DEFAULT 'draft' NOT NULL,
    published_at timestamptz,
    retired_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.plan_revisions IS '周计划经过编译与发布的不可变修订';
COMMENT ON COLUMN app.plan_revisions.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.plan_revisions.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.plan_revisions.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.plan_revisions.weekly_plan_id IS '周计划稳定身份';
COMMENT ON COLUMN app.plan_revisions.revision_no IS '递增计划修订号';
COMMENT ON COLUMN app.plan_revisions.published_by IS '发布成员';
COMMENT ON COLUMN app.plan_revisions.goal_learning_days IS '周约定所需完成日数';
COMMENT ON COLUMN app.plan_revisions.planned_learning_days IS '本修订计划学习日总数';
COMMENT ON COLUMN app.plan_revisions.policy_version IS '冻结的结算与通过规则版本';
COMMENT ON COLUMN app.plan_revisions.payload_digest IS '计划定义与任务/要求集合摘要';
COMMENT ON COLUMN app.plan_revisions.status IS '状态：draft|validated';
COMMENT ON COLUMN app.plan_revisions.published_at IS '首次发布时间；一旦设置不再清除';
COMMENT ON COLUMN app.plan_revisions.retired_at IS '退役时刻；不改写既有发布payload';
COMMENT ON COLUMN app.plan_revisions.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.learning_days (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    learning_date date NOT NULL,
    plan_revision_id uuid NOT NULL,
    day_kind text NOT NULL,
    window_start_at timestamptz,
    last_start_at timestamptz,
    window_end_at timestamptz,
    grace_end_at timestamptz,
    interaction_budget_seconds integer DEFAULT 180 NOT NULL,
    completed_at timestamptz,
    leave_reason text,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.learning_days IS '孩子稳定学习日及编译后的UTC挑战窗口';
COMMENT ON COLUMN app.learning_days.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.learning_days.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.learning_days.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.learning_days.learning_date IS '按家庭时区确定的学习日';
COMMENT ON COLUMN app.learning_days.plan_revision_id IS '当前有效计划修订';
COMMENT ON COLUMN app.learning_days.day_kind IS 'learning/rest/leave';
COMMENT ON COLUMN app.learning_days.window_start_at IS '允许挑战开始UTC时刻';
COMMENT ON COLUMN app.learning_days.last_start_at IS '最后新开挑战UTC时刻';
COMMENT ON COLUMN app.learning_days.window_end_at IS '常规结束UTC时刻';
COMMENT ON COLUMN app.learning_days.grace_end_at IS '已开始挑战最晚收尾UTC时刻';
COMMENT ON COLUMN app.learning_days.interaction_budget_seconds IS '每日自由宠物互动预算';
COMMENT ON COLUMN app.learning_days.completed_at IS '当日必需条件完成UTC时刻';
COMMENT ON COLUMN app.learning_days.leave_reason IS '家长请假说明';
COMMENT ON COLUMN app.learning_days.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.learning_days.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.learning_days.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.task_occurrences (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    plan_revision_id uuid NOT NULL,
    learning_day_id uuid NOT NULL,
    stable_task_key text NOT NULL,
    supersedes_task_id uuid,
    title text NOT NULL,
    external_instructions text NOT NULL,
    estimated_seconds integer NOT NULL,
    is_required boolean NOT NULL,
    status text DEFAULT 'scheduled' NOT NULL,
    completed_at timestamptz,
    cancelled_at timestamptz,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.task_occurrences IS '计划修订下的具体任务实例，生命周期与scope分离';
COMMENT ON COLUMN app.task_occurrences.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.task_occurrences.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.task_occurrences.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.task_occurrences.plan_revision_id IS '冻结计划修订';
COMMENT ON COLUMN app.task_occurrences.learning_day_id IS '稳定学习日';
COMMENT ON COLUMN app.task_occurrences.stable_task_key IS '逻辑任务键，换题拆任务不铸造奖励资格';
COMMENT ON COLUMN app.task_occurrences.supersedes_task_id IS '替代的旧任务';
COMMENT ON COLUMN app.task_occurrences.title IS '儿童可见短任务名';
COMMENT ON COLUMN app.task_occurrences.external_instructions IS '原APP或点读笔的学习说明';
COMMENT ON COLUMN app.task_occurrences.estimated_seconds IS '预计外部学习和验证用时';
COMMENT ON COLUMN app.task_occurrences.is_required IS '是否为冻结每日必需任务';
COMMENT ON COLUMN app.task_occurrences.status IS '状态：scheduled|active|pending_review|completed|cancelled|content_blocked';
COMMENT ON COLUMN app.task_occurrences.completed_at IS '真实完成UTC时刻';
COMMENT ON COLUMN app.task_occurrences.cancelled_at IS '取消UTC时刻';
COMMENT ON COLUMN app.task_occurrences.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.task_occurrences.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.task_occurrences.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.task_scopes (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    task_occurrence_id uuid NOT NULL,
    plan_revision_id uuid NOT NULL,
    content_version_id uuid NOT NULL,
    slice_id uuid NOT NULL,
    scope_role text NOT NULL,
    content_release_id uuid NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.task_scopes IS '任务允许的精确新学/复习切片集合';
COMMENT ON COLUMN app.task_scopes.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.task_scopes.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.task_scopes.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.task_scopes.task_occurrence_id IS '任务实例';
COMMENT ON COLUMN app.task_scopes.plan_revision_id IS '任务所属冻结修订';
COMMENT ON COLUMN app.task_scopes.content_version_id IS '教材版本';
COMMENT ON COLUMN app.task_scopes.slice_id IS '精确页句片段';
COMMENT ON COLUMN app.task_scopes.scope_role IS 'new_learning/review/context';
COMMENT ON COLUMN app.task_scopes.content_release_id IS '使用的发布集合';
COMMENT ON COLUMN app.task_scopes.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.task_requirements (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    task_occurrence_id uuid NOT NULL,
    plan_revision_id uuid NOT NULL,
    objective_id uuid NOT NULL,
    skill text NOT NULL,
    modality text NOT NULL,
    required boolean NOT NULL,
    min_evidence_count smallint NOT NULL,
    min_score_units integer NOT NULL,
    max_score_units integer NOT NULL,
    allow_assisted boolean NOT NULL,
    allow_parent_review boolean NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.task_requirements IS '任务每个必需目标的独立通过条件';
COMMENT ON COLUMN app.task_requirements.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.task_requirements.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.task_requirements.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.task_requirements.task_occurrence_id IS '任务实例';
COMMENT ON COLUMN app.task_requirements.plan_revision_id IS '冻结计划修订';
COMMENT ON COLUMN app.task_requirements.objective_id IS '能力目标';
COMMENT ON COLUMN app.task_requirements.skill IS '与目标一致的所测能力';
COMMENT ON COLUMN app.task_requirements.modality IS '与目标一致的模态';
COMMENT ON COLUMN app.task_requirements.required IS '是否必须覆盖';
COMMENT ON COLUMN app.task_requirements.min_evidence_count IS '最低有效证据数';
COMMENT ON COLUMN app.task_requirements.min_score_units IS '客观项最低整数得分';
COMMENT ON COLUMN app.task_requirements.max_score_units IS '客观项明确分母';
COMMENT ON COLUMN app.task_requirements.allow_assisted IS '是否接受提示后完成';
COMMENT ON COLUMN app.task_requirements.allow_parent_review IS '是否接受家长复核';
COMMENT ON COLUMN app.task_requirements.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.study_exposures (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    task_occurrence_id uuid,
    device_id uuid,
    declared_by uuid,
    source_kind text NOT NULL,
    occurred_at timestamptz,
    learning_date date NOT NULL,
    date_precision text NOT NULL,
    external_reference text,
    event_key text NOT NULL,
    withdrawn_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.study_exposures IS '原工具学习完成声明、历史导入与应用训练参与事实';
COMMENT ON COLUMN app.study_exposures.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.study_exposures.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.study_exposures.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.study_exposures.task_occurrence_id IS '可选关联任务，历史声明可空';
COMMENT ON COLUMN app.study_exposures.device_id IS '产生记录的设备';
COMMENT ON COLUMN app.study_exposures.declared_by IS '家长确认成员；孩子自报为空';
COMMENT ON COLUMN app.study_exposures.source_kind IS 'self_report/parent_report/historical/authorized_external/training';
COMMENT ON COLUMN app.study_exposures.occurred_at IS '实际声明或训练发生时刻';
COMMENT ON COLUMN app.study_exposures.learning_date IS '归属家庭学习日';
COMMENT ON COLUMN app.study_exposures.date_precision IS 'instant/day/approximate';
COMMENT ON COLUMN app.study_exposures.external_reference IS '可信外部记录引用；不存令牌';
COMMENT ON COLUMN app.study_exposures.event_key IS '同孩子声明/训练事件幂等键';
COMMENT ON COLUMN app.study_exposures.withdrawn_at IS '声明撤回标记；不删除作答证据';
COMMENT ON COLUMN app.study_exposures.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.exposure_slices (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    study_exposure_id uuid NOT NULL,
    content_version_id uuid NOT NULL,
    slice_id uuid NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.exposure_slices IS '孩子声明接触/训练过的精确教材片段';
COMMENT ON COLUMN app.exposure_slices.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.exposure_slices.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.exposure_slices.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.exposure_slices.study_exposure_id IS '学习事实';
COMMENT ON COLUMN app.exposure_slices.content_version_id IS '教材版本';
COMMENT ON COLUMN app.exposure_slices.slice_id IS '实际学习范围切片';
COMMENT ON COLUMN app.exposure_slices.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.challenge_sessions (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    task_occurrence_id uuid,
    learning_day_id uuid NOT NULL,
    device_id uuid NOT NULL,
    mode text NOT NULL,
    scene_key text NOT NULL,
    status text DEFAULT 'created' NOT NULL,
    lease_epoch bigint DEFAULT 1 NOT NULL,
    lease_expires_at timestamptz NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    form_digest text NOT NULL,
    random_seed bigint NOT NULL,
    rules_version text NOT NULL,
    started_at timestamptz NOT NULL,
    submit_deadline_at timestamptz NOT NULL,
    submitted_at timestamptz,
    finished_at timestamptz,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.challenge_sessions IS '训练/验证/诊断会话与设备租约';
COMMENT ON COLUMN app.challenge_sessions.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.challenge_sessions.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.challenge_sessions.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.challenge_sessions.task_occurrence_id IS '具体任务；诊断会话可空';
COMMENT ON COLUMN app.challenge_sessions.learning_day_id IS '原归属学习日';
COMMENT ON COLUMN app.challenge_sessions.device_id IS '当前持有租约的设备';
COMMENT ON COLUMN app.challenge_sessions.mode IS 'training/verification/diagnostic';
COMMENT ON COLUMN app.challenge_sessions.scene_key IS 'home/park/hospital等场景键';
COMMENT ON COLUMN app.challenge_sessions.status IS '状态：created|active|submitted|pending_review|completed|expired|cancelled';
COMMENT ON COLUMN app.challenge_sessions.lease_epoch IS '转移租约的栅栏代数';
COMMENT ON COLUMN app.challenge_sessions.lease_expires_at IS '租约过期时刻';
COMMENT ON COLUMN app.challenge_sessions.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.challenge_sessions.form_digest IS '冻结题单/选项排列/评分规则摘要';
COMMENT ON COLUMN app.challenge_sessions.random_seed IS '稳定题单种子';
COMMENT ON COLUMN app.challenge_sessions.rules_version IS '会话评分规则版本';
COMMENT ON COLUMN app.challenge_sessions.started_at IS '服务端开始时刻';
COMMENT ON COLUMN app.challenge_sessions.submit_deadline_at IS '原窗口收尾提交截止';
COMMENT ON COLUMN app.challenge_sessions.submitted_at IS '提交时刻';
COMMENT ON COLUMN app.challenge_sessions.finished_at IS '结案时刻';
COMMENT ON COLUMN app.challenge_sessions.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.challenge_sessions.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.challenge_items (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    challenge_session_id uuid NOT NULL,
    question_version_id uuid NOT NULL,
    objective_id uuid NOT NULL,
    task_requirement_id uuid,
    ordinal integer NOT NULL,
    option_order text[] NOT NULL,
    is_required boolean NOT NULL,
    answer_exposed_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.challenge_items IS '已冻结公开题单，绝不包含标准答案';
COMMENT ON COLUMN app.challenge_items.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.challenge_items.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.challenge_items.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.challenge_items.challenge_session_id IS '会话';
COMMENT ON COLUMN app.challenge_items.question_version_id IS '公开题目版本';
COMMENT ON COLUMN app.challenge_items.objective_id IS '对应目标';
COMMENT ON COLUMN app.challenge_items.task_requirement_id IS '关联任务要求；训练/诊断可空';
COMMENT ON COLUMN app.challenge_items.ordinal IS '会话题序';
COMMENT ON COLUMN app.challenge_items.option_order IS '选项稳定键顺序，不含正确标记';
COMMENT ON COLUMN app.challenge_items.is_required IS '是否必做验证项';
COMMENT ON COLUMN app.challenge_items.answer_exposed_at IS '该会话提示/解析首次暴露时刻';
COMMENT ON COLUMN app.challenge_items.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.answer_attempts (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    challenge_session_id uuid NOT NULL,
    challenge_item_id uuid NOT NULL,
    device_id uuid NOT NULL,
    attempt_key text NOT NULL,
    lease_epoch bigint NOT NULL,
    attempt_no smallint NOT NULL,
    response_kind text NOT NULL,
    response_payload jsonb NOT NULL,
    response_schema_version integer NOT NULL,
    recording_media_id uuid,
    machine_result text NOT NULL,
    score_units integer,
    max_score_units integer NOT NULL,
    assistance text NOT NULL,
    grader_version text NOT NULL,
    received_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.answer_attempts IS '每次作答的输入、机器判定和提示事实';
COMMENT ON COLUMN app.answer_attempts.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.answer_attempts.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.answer_attempts.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.answer_attempts.challenge_session_id IS '会话';
COMMENT ON COLUMN app.answer_attempts.challenge_item_id IS '题单项';
COMMENT ON COLUMN app.answer_attempts.device_id IS '提交设备';
COMMENT ON COLUMN app.answer_attempts.attempt_key IS '设备生成的本次作答幂等键';
COMMENT ON COLUMN app.answer_attempts.lease_epoch IS '提交时持有的租约代数';
COMMENT ON COLUMN app.answer_attempts.attempt_no IS '该题尝试序号';
COMMENT ON COLUMN app.answer_attempts.response_kind IS 'choice/text/matching/ordering/recording';
COMMENT ON COLUMN app.answer_attempts.response_payload IS '版本化作答值，如option_keys/text/pairs，不放任意实体或评分代码';
COMMENT ON COLUMN app.answer_attempts.response_schema_version IS '作答结构版本';
COMMENT ON COLUMN app.answer_attempts.recording_media_id IS '孩子录音，强制同孩子归属';
COMMENT ON COLUMN app.answer_attempts.machine_result IS 'correct/incorrect/unrecognized/pending_review';
COMMENT ON COLUMN app.answer_attempts.score_units IS '本次机器得分；未识别/待评为空';
COMMENT ON COLUMN app.answer_attempts.max_score_units IS '评分分母';
COMMENT ON COLUMN app.answer_attempts.assistance IS 'independent/hinted/demonstrated';
COMMENT ON COLUMN app.answer_attempts.grader_version IS '实际评分器/模型版本';
COMMENT ON COLUMN app.answer_attempts.received_at IS '服务端收到时刻';
COMMENT ON COLUMN app.answer_attempts.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.review_requests (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    answer_attempt_id uuid NOT NULL,
    requested_reason text NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamptz,
    review_note text,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.review_requests IS '口语、超时离线或坏题的家长复核结果';
COMMENT ON COLUMN app.review_requests.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.review_requests.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.review_requests.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.review_requests.answer_attempt_id IS '待复核作答';
COMMENT ON COLUMN app.review_requests.requested_reason IS 'oral/unrecognized/late_sync/question_error';
COMMENT ON COLUMN app.review_requests.status IS '状态：pending|approved|needs_help|cancelled';
COMMENT ON COLUMN app.review_requests.reviewed_by IS '受权家长成员';
COMMENT ON COLUMN app.review_requests.reviewed_at IS '复核UTC时刻';
COMMENT ON COLUMN app.review_requests.review_note IS '复核说明';
COMMENT ON COLUMN app.review_requests.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.review_requests.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.review_requests.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.learning_evidence (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    objective_id uuid NOT NULL,
    skill text NOT NULL,
    modality text NOT NULL,
    answer_attempt_id uuid NOT NULL,
    review_request_id uuid,
    task_occurrence_id uuid,
    evidence_key text NOT NULL,
    evidence_kind text NOT NULL,
    supersedes_evidence_id uuid,
    outcome text NOT NULL,
    assistance text NOT NULL,
    assessment_source text NOT NULL,
    observed_at timestamptz NOT NULL,
    learning_date date NOT NULL,
    reason text NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.learning_evidence IS '能力目标的不可变验证证据或修订事件';
COMMENT ON COLUMN app.learning_evidence.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.learning_evidence.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.learning_evidence.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.learning_evidence.objective_id IS '所测目标';
COMMENT ON COLUMN app.learning_evidence.skill IS '与目标一致的能力';
COMMENT ON COLUMN app.learning_evidence.modality IS '与目标一致的模态';
COMMENT ON COLUMN app.learning_evidence.answer_attempt_id IS '证据源作答';
COMMENT ON COLUMN app.learning_evidence.review_request_id IS '人工证据对应复核';
COMMENT ON COLUMN app.learning_evidence.task_occurrence_id IS '证据归属任务；诊断可空';
COMMENT ON COLUMN app.learning_evidence.evidence_key IS '确定性来源/目标幂等键';
COMMENT ON COLUMN app.learning_evidence.evidence_kind IS 'observation/correction/retraction';
COMMENT ON COLUMN app.learning_evidence.supersedes_evidence_id IS '被修订/撤回的旧证据';
COMMENT ON COLUMN app.learning_evidence.outcome IS 'passed/needs_help/invalid';
COMMENT ON COLUMN app.learning_evidence.assistance IS 'independent/hinted/demonstrated/parent_confirmed';
COMMENT ON COLUMN app.learning_evidence.assessment_source IS 'deterministic/asr/parent/calibrated_speech';
COMMENT ON COLUMN app.learning_evidence.observed_at IS '证据实际发生时刻';
COMMENT ON COLUMN app.learning_evidence.learning_date IS '归属原学习日';
COMMENT ON COLUMN app.learning_evidence.reason IS '判定/修订原因';
COMMENT ON COLUMN app.learning_evidence.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.mastery_snapshots (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    objective_id uuid NOT NULL,
    skill text NOT NULL,
    modality text NOT NULL,
    last_evidence_id uuid NOT NULL,
    algorithm_version text NOT NULL,
    evidence_count integer NOT NULL,
    mastery_level text NOT NULL,
    due_learning_date date,
    computed_at timestamptz NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.mastery_snapshots IS '可重算的孩子目标能力掌握/复习快照';
COMMENT ON COLUMN app.mastery_snapshots.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.mastery_snapshots.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.mastery_snapshots.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.mastery_snapshots.objective_id IS '目标';
COMMENT ON COLUMN app.mastery_snapshots.skill IS '能力';
COMMENT ON COLUMN app.mastery_snapshots.modality IS '模态';
COMMENT ON COLUMN app.mastery_snapshots.last_evidence_id IS '最近纳入的有效证据';
COMMENT ON COLUMN app.mastery_snapshots.algorithm_version IS '规则/调度算法版本';
COMMENT ON COLUMN app.mastery_snapshots.evidence_count IS '已纳入有效证据数';
COMMENT ON COLUMN app.mastery_snapshots.mastery_level IS 'unassessed/introduced/practicing/emerging/retained';
COMMENT ON COLUMN app.mastery_snapshots.due_learning_date IS '建议下一复习日';
COMMENT ON COLUMN app.mastery_snapshots.computed_at IS '计算时刻';
COMMENT ON COLUMN app.mastery_snapshots.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.mastery_snapshots.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.item_definitions (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    stable_key text NOT NULL,
    name text NOT NULL,
    item_kind text NOT NULL,
    unit text NOT NULL,
    compatible_species text[] NOT NULL,
    asset_package_id uuid,
    asset_key text,
    retired_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.item_definitions IS '稳定物品定义与最小计量单位';
COMMENT ON COLUMN app.item_definitions.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.item_definitions.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.item_definitions.stable_key IS '物品稳定键';
COMMENT ON COLUMN app.item_definitions.name IS '儿童物品名';
COMMENT ON COLUMN app.item_definitions.item_kind IS 'food/material/decoration/care';
COMMENT ON COLUMN app.item_definitions.unit IS 'nutrition_point/piece';
COMMENT ON COLUMN app.item_definitions.compatible_species IS '适用宠物种类白名单';
COMMENT ON COLUMN app.item_definitions.asset_package_id IS '外观资源包';
COMMENT ON COLUMN app.item_definitions.asset_key IS '包内外观键';
COMMENT ON COLUMN app.item_definitions.retired_at IS '退役时刻；不改写既有发布payload';
COMMENT ON COLUMN app.item_definitions.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.reward_entitlements (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    period_kind text NOT NULL,
    period_key date NOT NULL,
    stable_slot text NOT NULL,
    learning_day_id uuid,
    task_occurrence_id uuid,
    weekly_plan_id uuid,
    policy_version text NOT NULL,
    qualification_kind text NOT NULL,
    qualified_at timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.reward_entitlements IS '与可变政策版本无关的稳定日/周奖励资格';
COMMENT ON COLUMN app.reward_entitlements.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.reward_entitlements.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.reward_entitlements.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.reward_entitlements.period_kind IS 'day/week';
COMMENT ON COLUMN app.reward_entitlements.period_key IS 'day为学习日；week为周一日期';
COMMENT ON COLUMN app.reward_entitlements.stable_slot IS 'nutrition.task_x/day.materials/week.materials等逻辑槽位';
COMMENT ON COLUMN app.reward_entitlements.learning_day_id IS '日资格对应学习日；周资格为空';
COMMENT ON COLUMN app.reward_entitlements.task_occurrence_id IS '任务营养资格可关联任务';
COMMENT ON COLUMN app.reward_entitlements.weekly_plan_id IS '周资格对应稳定周计划；日资格可空';
COMMENT ON COLUMN app.reward_entitlements.policy_version IS '创建资格时冻结政策版本，不进入唯一键';
COMMENT ON COLUMN app.reward_entitlements.qualification_kind IS 'task_verified/day_completed/week_goal/admin';
COMMENT ON COLUMN app.reward_entitlements.qualified_at IS '条件满足UTC时刻';
COMMENT ON COLUMN app.reward_entitlements.cancelled_at IS '仅未发放资格可取消';
COMMENT ON COLUMN app.reward_entitlements.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.entitlement_items (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    reward_entitlement_id uuid NOT NULL,
    item_definition_id uuid NOT NULL,
    quantity bigint NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.entitlement_items IS '资格冻结的物品与整数份额，不随执行时政策变化';
COMMENT ON COLUMN app.entitlement_items.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.entitlement_items.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.entitlement_items.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.entitlement_items.reward_entitlement_id IS '稳定奖励资格';
COMMENT ON COLUMN app.entitlement_items.item_definition_id IS '奖励物品';
COMMENT ON COLUMN app.entitlement_items.quantity IS '最小单位数量，食物为营养点';
COMMENT ON COLUMN app.entitlement_items.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.reward_grants (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    reward_entitlement_id uuid NOT NULL,
    grant_key text NOT NULL,
    granted_at timestamptz NOT NULL,
    actor_membership_id uuid,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.reward_grants IS '已经结算的一次资格发放，追加不可改';
COMMENT ON COLUMN app.reward_grants.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.reward_grants.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.reward_grants.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.reward_grants.reward_entitlement_id IS '实际使用的稳定资格';
COMMENT ON COLUMN app.reward_grants.grant_key IS '发放幂等业务键';
COMMENT ON COLUMN app.reward_grants.granted_at IS '服务端结算时刻';
COMMENT ON COLUMN app.reward_grants.actor_membership_id IS '家长赠予/补偿时的操作者，正常系统发放为空';
COMMENT ON COLUMN app.reward_grants.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.reward_grant_items (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    reward_grant_id uuid NOT NULL,
    item_definition_id uuid NOT NULL,
    quantity bigint NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.reward_grant_items IS '一次发放内每种物品的冻结数量';
COMMENT ON COLUMN app.reward_grant_items.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.reward_grant_items.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.reward_grant_items.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.reward_grant_items.reward_grant_id IS '发放事件';
COMMENT ON COLUMN app.reward_grant_items.item_definition_id IS '奖励物品';
COMMENT ON COLUMN app.reward_grant_items.quantity IS '最小单位数量';
COMMENT ON COLUMN app.reward_grant_items.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.inventory_balances (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    item_definition_id uuid NOT NULL,
    quantity bigint DEFAULT 0 NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.inventory_balances IS '由追加账本维护的孩子物品余额投影';
COMMENT ON COLUMN app.inventory_balances.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.inventory_balances.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.inventory_balances.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.inventory_balances.item_definition_id IS '物品定义';
COMMENT ON COLUMN app.inventory_balances.quantity IS '最小单位可用余额，不得负数';
COMMENT ON COLUMN app.inventory_balances.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.inventory_balances.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.inventory_balances.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.pets (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    nickname text NOT NULL,
    species text NOT NULL,
    personality text NOT NULL,
    asset_package_id uuid NOT NULL,
    lifecycle text NOT NULL,
    life_mode text NOT NULL,
    adopted_at timestamptz NOT NULL,
    retired_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.pets IS '孩子宠物身份、资源选择与生命周期';
COMMENT ON COLUMN app.pets.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.pets.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.pets.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.pets.nickname IS '宠物昵称';
COMMENT ON COLUMN app.pets.species IS 'dog/cat/rabbit，后续通过迁移扩展';
COMMENT ON COLUMN app.pets.personality IS '性格模板键';
COMMENT ON COLUMN app.pets.asset_package_id IS '宠物资源版本';
COMMENT ON COLUMN app.pets.lifecycle IS 'active/retired/deceased_reserved';
COMMENT ON COLUMN app.pets.life_mode IS 'companion；真实生命模式首版关闭';
COMMENT ON COLUMN app.pets.adopted_at IS '领养时刻';
COMMENT ON COLUMN app.pets.retired_at IS '归档时刻';
COMMENT ON COLUMN app.pets.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.pet_states (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    pet_id uuid NOT NULL,
    satiety_cp smallint NOT NULL,
    hydration_cp smallint NOT NULL,
    energy_cp smallint NOT NULL,
    mood_cp smallint NOT NULL,
    health_cp smallint NOT NULL,
    hygiene_cp smallint NOT NULL,
    decay_remainder_seconds bigint DEFAULT 0 NOT NULL,
    growth_points bigint DEFAULT 0 NOT NULL,
    bond_points bigint DEFAULT 0 NOT NULL,
    growth_stage text NOT NULL,
    location_key text NOT NULL,
    care_mode text NOT NULL,
    rules_version text NOT NULL,
    last_evaluated_at timestamptz NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.pet_states IS '宠物当前身体状态与时间结算快照';
COMMENT ON COLUMN app.pet_states.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.pet_states.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.pet_states.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.pet_states.pet_id IS '宠物';
COMMENT ON COLUMN app.pet_states.satiety_cp IS '饱腹0到10000 centipoint；100cp=界面1点';
COMMENT ON COLUMN app.pet_states.hydration_cp IS '水分0到10000cp';
COMMENT ON COLUMN app.pet_states.energy_cp IS '精力0到10000cp';
COMMENT ON COLUMN app.pet_states.mood_cp IS '心情0到10000cp';
COMMENT ON COLUMN app.pet_states.health_cp IS '健康0到10000cp';
COMMENT ON COLUMN app.pet_states.hygiene_cp IS '清洁0到10000cp';
COMMENT ON COLUMN app.pet_states.decay_remainder_seconds IS '被动衰减尚未折算的余秒';
COMMENT ON COLUMN app.pet_states.growth_points IS '不可消费成长点';
COMMENT ON COLUMN app.pet_states.bond_points IS '关系里程碑点，不因漏学扣减';
COMMENT ON COLUMN app.pet_states.growth_stage IS 'baby/young/adult/elder_reserved';
COMMENT ON COLUMN app.pet_states.location_key IS 'home/nest/park/hospital等场所';
COMMENT ON COLUMN app.pet_states.care_mode IS 'normal/resting/hosted';
COMMENT ON COLUMN app.pet_states.rules_version IS '状态衰减与照护规则版本';
COMMENT ON COLUMN app.pet_states.last_evaluated_at IS '服务端上次结算时刻';
COMMENT ON COLUMN app.pet_states.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.pet_states.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.pet_states.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.inventory_ledger (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    item_definition_id uuid NOT NULL,
    delta bigint NOT NULL,
    entry_kind text NOT NULL,
    operation_key text NOT NULL,
    reward_grant_item_id uuid,
    pet_id uuid,
    reverses_entry_id uuid,
    actor_membership_id uuid,
    reason text NOT NULL,
    occurred_at timestamptz NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.inventory_ledger IS '孩子物品增减的不可变权威账本';
COMMENT ON COLUMN app.inventory_ledger.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.inventory_ledger.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.inventory_ledger.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.inventory_ledger.item_definition_id IS '物品';
COMMENT ON COLUMN app.inventory_ledger.delta IS '有符号最小单位增减，非零';
COMMENT ON COLUMN app.inventory_ledger.entry_kind IS 'reward/feed/craft/admin/compensation/reversal';
COMMENT ON COLUMN app.inventory_ledger.operation_key IS '同孩子命令/账目幂等业务键';
COMMENT ON COLUMN app.inventory_ledger.reward_grant_item_id IS '奖励来源行，普通消费为空';
COMMENT ON COLUMN app.inventory_ledger.pet_id IS '喂食宠物，其他可空';
COMMENT ON COLUMN app.inventory_ledger.reverses_entry_id IS '全额冲正的原账目';
COMMENT ON COLUMN app.inventory_ledger.actor_membership_id IS '管理/补偿操作者';
COMMENT ON COLUMN app.inventory_ledger.reason IS '可审计账目原因';
COMMENT ON COLUMN app.inventory_ledger.occurred_at IS '业务时刻';
COMMENT ON COLUMN app.inventory_ledger.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.pet_events (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    pet_id uuid NOT NULL,
    command_key text NOT NULL,
    event_kind text NOT NULL,
    item_definition_id uuid,
    inventory_entry_id uuid,
    requested_units bigint DEFAULT 0 NOT NULL,
    applied_units bigint DEFAULT 0 NOT NULL,
    state_revision_after bigint NOT NULL,
    occurred_at timestamptz NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.pet_events IS '已确认宠物动作与状态变化事件';
COMMENT ON COLUMN app.pet_events.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.pet_events.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.pet_events.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.pet_events.pet_id IS '宠物';
COMMENT ON COLUMN app.pet_events.command_key IS '宠物命令幂等业务键';
COMMENT ON COLUMN app.pet_events.event_kind IS 'adopt/feed/drink/rest/walk/clean/heal/grow/host/evaluate';
COMMENT ON COLUMN app.pet_events.item_definition_id IS '使用的物品';
COMMENT ON COLUMN app.pet_events.inventory_entry_id IS '对应消费账目';
COMMENT ON COLUMN app.pet_events.requested_units IS '请求食物营养点，非进食事件可0';
COMMENT ON COLUMN app.pet_events.applied_units IS '实际吃下/应用的整数单位';
COMMENT ON COLUMN app.pet_events.state_revision_after IS '事务确认后的状态修订';
COMMENT ON COLUMN app.pet_events.occurred_at IS '服务端事件时间';
COMMENT ON COLUMN app.pet_events.payload IS '受版本化schema约束的事件/作业附加数据；不替代实体外键';
COMMENT ON COLUMN app.pet_events.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.pet_daily_records (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    pet_id uuid NOT NULL,
    learning_day_id uuid NOT NULL,
    learning_date date NOT NULL,
    growth_awarded boolean DEFAULT false NOT NULL,
    interaction_used_seconds integer DEFAULT 0 NOT NULL,
    outdoor_confirmed_by uuid,
    care_completed boolean DEFAULT false NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.pet_daily_records IS '宠物每日照顾与成长的去重统计';
COMMENT ON COLUMN app.pet_daily_records.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.pet_daily_records.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.pet_daily_records.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.pet_daily_records.pet_id IS '宠物';
COMMENT ON COLUMN app.pet_daily_records.learning_day_id IS '学习日';
COMMENT ON COLUMN app.pet_daily_records.learning_date IS '家庭日期';
COMMENT ON COLUMN app.pet_daily_records.growth_awarded IS '当日是否已记录一次成长';
COMMENT ON COLUMN app.pet_daily_records.interaction_used_seconds IS '已确认互动用时';
COMMENT ON COLUMN app.pet_daily_records.outdoor_confirmed_by IS '真实户外家长确认者';
COMMENT ON COLUMN app.pet_daily_records.care_completed IS '当日照顾约定是否完成';
COMMENT ON COLUMN app.pet_daily_records.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.pet_daily_records.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.pet_daily_records.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.hospital_cases (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    pet_id uuid NOT NULL,
    task_occurrence_id uuid,
    condition_key text NOT NULL,
    status text DEFAULT 'open' NOT NULL,
    opened_at timestamptz NOT NULL,
    closed_at timestamptz,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.hospital_cases IS '宠物就诊及替代复习任务的关联';
COMMENT ON COLUMN app.hospital_cases.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.hospital_cases.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.hospital_cases.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.hospital_cases.pet_id IS '同孩子宠物';
COMMENT ON COLUMN app.hospital_cases.task_occurrence_id IS '抵扣的既有复习任务；体检可空';
COMMENT ON COLUMN app.hospital_cases.condition_key IS '可解释且白名单的轻症/体检剧情键';
COMMENT ON COLUMN app.hospital_cases.status IS '状态：open|in_care|recovering|closed';
COMMENT ON COLUMN app.hospital_cases.opened_at IS '就诊开始';
COMMENT ON COLUMN app.hospital_cases.closed_at IS '结案时刻';
COMMENT ON COLUMN app.hospital_cases.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.hospital_cases.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.hospital_cases.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.pet_memories (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    pet_id uuid NOT NULL,
    memory_key text NOT NULL,
    memory_kind text NOT NULL,
    text text NOT NULL,
    source_evidence_id uuid,
    source_event_id uuid,
    visible_to_child boolean DEFAULT true NOT NULL,
    erased_at timestamptz,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.pet_memories IS '宠物共同经历与受控长期记忆';
COMMENT ON COLUMN app.pet_memories.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.pet_memories.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.pet_memories.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.pet_memories.pet_id IS '宠物';
COMMENT ON COLUMN app.pet_memories.memory_key IS '同宠物稳定里程碑键';
COMMENT ON COLUMN app.pet_memories.memory_kind IS 'preference/milestone/short_story';
COMMENT ON COLUMN app.pet_memories.text IS '已检查的简短回忆';
COMMENT ON COLUMN app.pet_memories.source_evidence_id IS '学习来源证据';
COMMENT ON COLUMN app.pet_memories.source_event_id IS '生活来源事件';
COMMENT ON COLUMN app.pet_memories.visible_to_child IS '是否可展示';
COMMENT ON COLUMN app.pet_memories.erased_at IS '家长删除记忆标记';
COMMENT ON COLUMN app.pet_memories.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.pet_memories.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.scene_layouts (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    pet_id uuid NOT NULL,
    scene_key text NOT NULL,
    asset_package_id uuid NOT NULL,
    layout_version integer NOT NULL,
    is_current boolean NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    saved_at timestamptz NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.scene_layouts IS '孩子已保存的场景布置版本';
COMMENT ON COLUMN app.scene_layouts.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.scene_layouts.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.scene_layouts.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.scene_layouts.pet_id IS '主宠';
COMMENT ON COLUMN app.scene_layouts.scene_key IS '场所稳定键';
COMMENT ON COLUMN app.scene_layouts.asset_package_id IS '场景资源包';
COMMENT ON COLUMN app.scene_layouts.layout_version IS '布置版本号';
COMMENT ON COLUMN app.scene_layouts.is_current IS '是否当前布置';
COMMENT ON COLUMN app.scene_layouts.is_locked IS '防误拖动布置锁';
COMMENT ON COLUMN app.scene_layouts.saved_at IS '保存时刻';
COMMENT ON COLUMN app.scene_layouts.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.scene_placements (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    scene_layout_id uuid NOT NULL,
    item_definition_id uuid NOT NULL,
    slot_key text NOT NULL,
    position_x numeric(10,6) NOT NULL,
    position_y numeric(10,6) NOT NULL,
    scale numeric(8,4) NOT NULL,
    rotation_deg numeric(8,3) NOT NULL,
    layer_order integer NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.scene_placements IS '布置内物品槽位及变换，预览不消费';
COMMENT ON COLUMN app.scene_placements.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.scene_placements.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.scene_placements.child_id IS '所属孩子；所有孩子业务链保持同一归属';
COMMENT ON COLUMN app.scene_placements.scene_layout_id IS '场景布置';
COMMENT ON COLUMN app.scene_placements.item_definition_id IS '已拥有装饰物';
COMMENT ON COLUMN app.scene_placements.slot_key IS '受控场景槽位';
COMMENT ON COLUMN app.scene_placements.position_x IS '归一化水平位置';
COMMENT ON COLUMN app.scene_placements.position_y IS '归一化垂直位置';
COMMENT ON COLUMN app.scene_placements.scale IS '缩放比例';
COMMENT ON COLUMN app.scene_placements.rotation_deg IS '角度';
COMMENT ON COLUMN app.scene_placements.layer_order IS '遮挡层顺序';
COMMENT ON COLUMN app.scene_placements.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.slice_media_bindings (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    content_version_id uuid NOT NULL,
    slice_id uuid NOT NULL,
    media_asset_id uuid NOT NULL,
    binding_role text NOT NULL,
    ordinal integer NOT NULL,
    start_ms bigint,
    end_ms bigint,
    region_x numeric(8,6),
    region_y numeric(8,6),
    region_w numeric(8,6),
    region_h numeric(8,6),
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.slice_media_bindings IS '切片多媒体绑定与区域/音频时间片';
COMMENT ON COLUMN app.slice_media_bindings.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.slice_media_bindings.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.slice_media_bindings.content_version_id IS '同教材内容版本';
COMMENT ON COLUMN app.slice_media_bindings.slice_id IS '语义切片';
COMMENT ON COLUMN app.slice_media_bindings.media_asset_id IS '绑定媒体';
COMMENT ON COLUMN app.slice_media_bindings.binding_role IS 'page_image/illustration/reference_audio/synthetic_audio/source_document';
COMMENT ON COLUMN app.slice_media_bindings.ordinal IS '同角色媒体顺序';
COMMENT ON COLUMN app.slice_media_bindings.start_ms IS '音频起点';
COMMENT ON COLUMN app.slice_media_bindings.end_ms IS '音频终点';
COMMENT ON COLUMN app.slice_media_bindings.region_x IS '页图区域x';
COMMENT ON COLUMN app.slice_media_bindings.region_y IS '页图区域y';
COMMENT ON COLUMN app.slice_media_bindings.region_w IS '区域宽';
COMMENT ON COLUMN app.slice_media_bindings.region_h IS '区域高';
COMMENT ON COLUMN app.slice_media_bindings.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.background_jobs (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    job_kind text NOT NULL,
    dedupe_key text NOT NULL,
    status text DEFAULT 'queued' NOT NULL,
    available_at timestamptz NOT NULL,
    lease_owner text,
    lease_until timestamptz,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts smallint DEFAULT 3 NOT NULL,
    input_schema_version integer NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_error_code text,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.background_jobs IS '家庭范围后台导入/出题/语音/备份作业队列';
COMMENT ON COLUMN app.background_jobs.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.background_jobs.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.background_jobs.job_kind IS '应用白名单作业类型';
COMMENT ON COLUMN app.background_jobs.dedupe_key IS '业务去重键';
COMMENT ON COLUMN app.background_jobs.status IS '状态：queued|running|succeeded|failed|cancelled';
COMMENT ON COLUMN app.background_jobs.available_at IS '可领取时刻';
COMMENT ON COLUMN app.background_jobs.lease_owner IS '当前worker实例';
COMMENT ON COLUMN app.background_jobs.lease_until IS '领取租约到期';
COMMENT ON COLUMN app.background_jobs.attempts IS '尝试次数';
COMMENT ON COLUMN app.background_jobs.max_attempts IS '最大尝试次数';
COMMENT ON COLUMN app.background_jobs.input_schema_version IS '作业payload schema版本';
COMMENT ON COLUMN app.background_jobs.payload IS '受版本化schema约束的事件/作业附加数据；不替代实体外键';
COMMENT ON COLUMN app.background_jobs.last_error_code IS '最近错误码';
COMMENT ON COLUMN app.background_jobs.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.background_jobs.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.outbox_events (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    sequence_no bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    child_id uuid,
    event_key text NOT NULL,
    event_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    aggregate_revision bigint NOT NULL,
    schema_version integer NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamptz NOT NULL,
    delivered_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.outbox_events IS '同业务事务写入的追加领域事件与同步游标';
COMMENT ON COLUMN app.outbox_events.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.outbox_events.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.outbox_events.sequence_no IS '数据库生成的递增全局游标';
COMMENT ON COLUMN app.outbox_events.child_id IS '仅属于某孩子的事件；家庭事件为空';
COMMENT ON COLUMN app.outbox_events.event_key IS '家庭内唯一事件键';
COMMENT ON COLUMN app.outbox_events.event_type IS '版本化白名单事件类型';
COMMENT ON COLUMN app.outbox_events.aggregate_type IS '实体类型路由键';
COMMENT ON COLUMN app.outbox_events.aggregate_id IS '聚合标识；按event_type由服务端验证';
COMMENT ON COLUMN app.outbox_events.aggregate_revision IS '聚合修订号';
COMMENT ON COLUMN app.outbox_events.schema_version IS '事件schema版本';
COMMENT ON COLUMN app.outbox_events.payload IS '受版本化schema约束的事件/作业附加数据；不替代实体外键';
COMMENT ON COLUMN app.outbox_events.occurred_at IS '业务时刻';
COMMENT ON COLUMN app.outbox_events.delivered_at IS 'worker投递确认时刻';
COMMENT ON COLUMN app.outbox_events.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.idempotency_records (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    device_id uuid,
    membership_id uuid,
    child_id uuid,
    operation text NOT NULL,
    idempotency_key text NOT NULL,
    request_digest text NOT NULL,
    status text DEFAULT 'processing' NOT NULL,
    http_status smallint,
    response_body jsonb,
    expires_at timestamptz NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.idempotency_records IS '设备/家长命令幂等键与已确认响应';
COMMENT ON COLUMN app.idempotency_records.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.idempotency_records.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.idempotency_records.device_id IS '客户端设备';
COMMENT ON COLUMN app.idempotency_records.membership_id IS '家长身份';
COMMENT ON COLUMN app.idempotency_records.child_id IS '孩子身份';
COMMENT ON COLUMN app.idempotency_records.operation IS '命令类型';
COMMENT ON COLUMN app.idempotency_records.idempotency_key IS '请求幂等键';
COMMENT ON COLUMN app.idempotency_records.request_digest IS '规范化请求摘要';
COMMENT ON COLUMN app.idempotency_records.status IS '状态：processing|completed';
COMMENT ON COLUMN app.idempotency_records.http_status IS '已确认HTTP状态';
COMMENT ON COLUMN app.idempotency_records.response_body IS '版本化最小响应，不含私有题目答案';
COMMENT ON COLUMN app.idempotency_records.expires_at IS '保留截止时刻';
COMMENT ON COLUMN app.idempotency_records.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.idempotency_records.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.audit_events (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    actor_membership_id uuid,
    device_id uuid,
    child_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    request_id uuid NOT NULL,
    reason text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.audit_events IS '家长管理、发布、复核和异常操作审计';
COMMENT ON COLUMN app.audit_events.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.audit_events.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.audit_events.actor_membership_id IS '家长操作者；系统事件可空';
COMMENT ON COLUMN app.audit_events.device_id IS '来源设备';
COMMENT ON COLUMN app.audit_events.child_id IS '受影响孩子';
COMMENT ON COLUMN app.audit_events.action IS '审计动作';
COMMENT ON COLUMN app.audit_events.entity_type IS '受影响实体类型';
COMMENT ON COLUMN app.audit_events.entity_id IS '目标标识，仅审计路由';
COMMENT ON COLUMN app.audit_events.request_id IS '关联请求链路ID';
COMMENT ON COLUMN app.audit_events.reason IS '操作原因';
COMMENT ON COLUMN app.audit_events.metadata IS '已脱敏的差异/结果，不含密码令牌和录音内容';
COMMENT ON COLUMN app.audit_events.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.device_pairings (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    child_id uuid NOT NULL,
    display_device_id uuid NOT NULL,
    companion_device_id uuid,
    challenge_session_id uuid,
    code_digest text NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    attempts smallint DEFAULT 0 NOT NULL,
    expires_at timestamptz NOT NULL,
    confirmed_by uuid,
    confirmed_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.device_pairings IS '短时一次性电视与伴侣设备配对';
COMMENT ON COLUMN app.device_pairings.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.device_pairings.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.device_pairings.child_id IS '本次配对限定孩子';
COMMENT ON COLUMN app.device_pairings.display_device_id IS '电视/展示设备';
COMMENT ON COLUMN app.device_pairings.companion_device_id IS '确认后的录音伴侣';
COMMENT ON COLUMN app.device_pairings.challenge_session_id IS '可选绑定会话';
COMMENT ON COLUMN app.device_pairings.code_digest IS '短码的加盐摘要，不保存原码';
COMMENT ON COLUMN app.device_pairings.status IS '状态：pending|confirmed|expired|revoked';
COMMENT ON COLUMN app.device_pairings.attempts IS '错误尝试次数';
COMMENT ON COLUMN app.device_pairings.expires_at IS '短时过期';
COMMENT ON COLUMN app.device_pairings.confirmed_by IS '授权家长';
COMMENT ON COLUMN app.device_pairings.confirmed_at IS '确认时刻';
COMMENT ON COLUMN app.device_pairings.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.sync_cursors (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    device_id uuid NOT NULL,
    child_id uuid,
    last_sequence_no bigint,
    last_sync_at timestamptz NOT NULL,
    client_schema_version integer NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.sync_cursors IS '设备已确认接收的家庭事件游标';
COMMENT ON COLUMN app.sync_cursors.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.sync_cursors.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.sync_cursors.device_id IS '同步设备';
COMMENT ON COLUMN app.sync_cursors.child_id IS '设备限定孩子；家长可空';
COMMENT ON COLUMN app.sync_cursors.last_sequence_no IS '最近确认的同家庭outbox游标';
COMMENT ON COLUMN app.sync_cursors.last_sync_at IS '最近成功同步时刻';
COMMENT ON COLUMN app.sync_cursors.client_schema_version IS '客户端同步协议版本';
COMMENT ON COLUMN app.sync_cursors.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.sync_cursors.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.family_settings (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    version_no integer NOT NULL,
    schema_version integer NOT NULL,
    policy jsonb NOT NULL,
    changed_by uuid NOT NULL,
    effective_from timestamptz NOT NULL,
    published_at timestamptz,
    retired_at timestamptz,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.family_settings IS '家庭版本化政策与开关快照';
COMMENT ON COLUMN app.family_settings.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.family_settings.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.family_settings.version_no IS '家庭内递增政策版本号';
COMMENT ON COLUMN app.family_settings.schema_version IS '应用维护的政策schema版本';
COMMENT ON COLUMN app.family_settings.policy IS '窗口默认值、自动发布、隐私和调用额度等声明式政策；无密钥、脚本及业务实体列表';
COMMENT ON COLUMN app.family_settings.changed_by IS '制定或发布家长成员';
COMMENT ON COLUMN app.family_settings.effective_from IS '仅对之后新任务/命令生效的UTC时刻';
COMMENT ON COLUMN app.family_settings.published_at IS '首次发布时间；一旦设置不再清除';
COMMENT ON COLUMN app.family_settings.retired_at IS '退役时刻；不改写既有发布payload';
COMMENT ON COLUMN app.family_settings.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.content_issues (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    question_version_id uuid,
    media_asset_id uuid,
    source_slice_id uuid,
    reporter_child_id uuid,
    reporter_membership_id uuid,
    device_id uuid,
    issue_kind text NOT NULL,
    description text NOT NULL,
    status text DEFAULT 'open' NOT NULL,
    resolved_by uuid,
    resolved_at timestamptz,
    replacement_question_version_id uuid,
    resolution_note text,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.content_issues IS '题目/媒体/原片段错误报告及修复闭环';
COMMENT ON COLUMN app.content_issues.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.content_issues.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.content_issues.question_version_id IS '被报告题目版本';
COMMENT ON COLUMN app.content_issues.media_asset_id IS '被报告媒体';
COMMENT ON COLUMN app.content_issues.source_slice_id IS '被报告原片段';
COMMENT ON COLUMN app.content_issues.reporter_child_id IS '孩子报告者，可空';
COMMENT ON COLUMN app.content_issues.reporter_membership_id IS '家长报告者，可空';
COMMENT ON COLUMN app.content_issues.device_id IS '报告设备';
COMMENT ON COLUMN app.content_issues.issue_kind IS 'wrong_answer/ambiguous/out_of_scope/media_error/source_error/other';
COMMENT ON COLUMN app.content_issues.description IS '报告说明，不复制录音或敏感身份';
COMMENT ON COLUMN app.content_issues.status IS '状态：open|triaged|resolved|dismissed';
COMMENT ON COLUMN app.content_issues.resolved_by IS '处理成员';
COMMENT ON COLUMN app.content_issues.resolved_at IS '处理时刻';
COMMENT ON COLUMN app.content_issues.replacement_question_version_id IS '修复后的新题版本';
COMMENT ON COLUMN app.content_issues.resolution_note IS '修复/驳回原因';
COMMENT ON COLUMN app.content_issues.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.content_issues.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.content_issues.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.ai_provider_configs (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    config_key text NOT NULL,
    capability text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    endpoint_url text NOT NULL,
    secret_ref text,
    options_schema_version integer DEFAULT 1 NOT NULL,
    options jsonb DEFAULT '{}'::jsonb NOT NULL,
    daily_budget_microunits bigint NOT NULL,
    currency text NOT NULL,
    timeout_seconds integer NOT NULL,
    max_concurrent_calls smallint NOT NULL,
    created_by uuid NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.ai_provider_configs IS '家庭AI能力配置与服务器密钥引用';
COMMENT ON COLUMN app.ai_provider_configs.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.ai_provider_configs.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.ai_provider_configs.config_key IS '家庭内配置稳定键';
COMMENT ON COLUMN app.ai_provider_configs.capability IS 'generation/qa/asr/tts/pet_dialogue/image_generation';
COMMENT ON COLUMN app.ai_provider_configs.provider IS '供应商或本地服务适配器键';
COMMENT ON COLUMN app.ai_provider_configs.model IS '固定模型/推理版本';
COMMENT ON COLUMN app.ai_provider_configs.endpoint_url IS '受运维允许列表限制的HTTPS或本地服务地址';
COMMENT ON COLUMN app.ai_provider_configs.secret_ref IS '服务端秘密管理器/环境引用名，仅引用不含秘密值';
COMMENT ON COLUMN app.ai_provider_configs.options_schema_version IS '声明式选项schema版本';
COMMENT ON COLUMN app.ai_provider_configs.options IS '温度、输出长度等白名单选项；禁止嵌入凭据或任意代码';
COMMENT ON COLUMN app.ai_provider_configs.daily_budget_microunits IS '每日最多成本最小单位';
COMMENT ON COLUMN app.ai_provider_configs.currency IS '成本币种';
COMMENT ON COLUMN app.ai_provider_configs.timeout_seconds IS '调用超时秒';
COMMENT ON COLUMN app.ai_provider_configs.max_concurrent_calls IS '该配置同时调用上限';
COMMENT ON COLUMN app.ai_provider_configs.created_by IS '创建家长成员';
COMMENT ON COLUMN app.ai_provider_configs.status IS '状态：active|disabled';
COMMENT ON COLUMN app.ai_provider_configs.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.ai_provider_configs.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.ai_provider_configs.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.ai_budget_reservations (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    ai_provider_config_id uuid NOT NULL,
    provider_revision bigint NOT NULL,
    generation_run_id uuid,
    background_job_id uuid,
    reservation_key text NOT NULL,
    budget_date date NOT NULL,
    price_version text NOT NULL,
    currency text NOT NULL,
    reserved_microunits bigint NOT NULL,
    settled_microunits bigint,
    status text DEFAULT 'reserved' NOT NULL,
    expires_at timestamptz NOT NULL,
    resolved_at timestamptz,
    provider_request_id text,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.ai_budget_reservations IS 'AI调用预算预留、结算及释放记录';
COMMENT ON COLUMN app.ai_budget_reservations.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.ai_budget_reservations.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.ai_budget_reservations.ai_provider_config_id IS '所属能力配置';
COMMENT ON COLUMN app.ai_budget_reservations.provider_revision IS '本次冻结配置修订号';
COMMENT ON COLUMN app.ai_budget_reservations.generation_run_id IS '对应出题批次，和background_job二选一';
COMMENT ON COLUMN app.ai_budget_reservations.background_job_id IS '对应AI作业，和generation_run二选一';
COMMENT ON COLUMN app.ai_budget_reservations.reservation_key IS '调用/重试共享业务键';
COMMENT ON COLUMN app.ai_budget_reservations.budget_date IS '按家庭时区的预算日';
COMMENT ON COLUMN app.ai_budget_reservations.price_version IS '本次价格/估算规则版本';
COMMENT ON COLUMN app.ai_budget_reservations.currency IS '冻结成本币种';
COMMENT ON COLUMN app.ai_budget_reservations.reserved_microunits IS '最大获准费用，int64最小计价单位';
COMMENT ON COLUMN app.ai_budget_reservations.settled_microunits IS '实际结算费用，未结案为空';
COMMENT ON COLUMN app.ai_budget_reservations.status IS '状态：reserved|settled|released';
COMMENT ON COLUMN app.ai_budget_reservations.expires_at IS '预留租约到期，不表示供应商已经停止调用';
COMMENT ON COLUMN app.ai_budget_reservations.resolved_at IS '最终结算或释放时刻';
COMMENT ON COLUMN app.ai_budget_reservations.provider_request_id IS '供应商请求号，无凭据';
COMMENT ON COLUMN app.ai_budget_reservations.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.ai_budget_reservations.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.ai_budget_reservations.created_at IS '数据库记录创建时刻，UTC存储';

CREATE TABLE app.outbox_deliveries (
    id uuid NOT NULL,
    family_id uuid NOT NULL,
    outbox_event_id uuid NOT NULL,
    consumer_key text NOT NULL,
    status text DEFAULT 'queued' NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts smallint DEFAULT 5 NOT NULL,
    available_at timestamptz NOT NULL,
    lease_owner text,
    lease_until timestamptz,
    delivered_at timestamptz,
    last_error_code text,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
COMMENT ON TABLE app.outbox_deliveries IS '每消费者每事件的投递租约、重试与确认';
COMMENT ON COLUMN app.outbox_deliveries.id IS '应用生成的不可变UUID主键';
COMMENT ON COLUMN app.outbox_deliveries.family_id IS '所属家庭；不可为空、不可跨家庭引用';
COMMENT ON COLUMN app.outbox_deliveries.outbox_event_id IS '不可变领域事件';
COMMENT ON COLUMN app.outbox_deliveries.consumer_key IS '应用维护的消费者稳定键';
COMMENT ON COLUMN app.outbox_deliveries.status IS '状态：queued|inflight|delivered|dead';
COMMENT ON COLUMN app.outbox_deliveries.attempts IS '实际领取尝试次数';
COMMENT ON COLUMN app.outbox_deliveries.max_attempts IS '最大次数';
COMMENT ON COLUMN app.outbox_deliveries.available_at IS '下次可领取时间';
COMMENT ON COLUMN app.outbox_deliveries.lease_owner IS 'worker实例标识';
COMMENT ON COLUMN app.outbox_deliveries.lease_until IS '当前投递租约过期';
COMMENT ON COLUMN app.outbox_deliveries.delivered_at IS '本消费者确认时刻';
COMMENT ON COLUMN app.outbox_deliveries.last_error_code IS '最近错误码，不含内容秘密';
COMMENT ON COLUMN app.outbox_deliveries.revision IS '乐观并发修订号，按成功更新递增';
COMMENT ON COLUMN app.outbox_deliveries.updated_at IS '最近维护时刻；UTC';
COMMENT ON COLUMN app.outbox_deliveries.created_at IS '数据库记录创建时刻，UTC存储';
ALTER TABLE app.families ADD CONSTRAINT families_c1 PRIMARY KEY (id);
ALTER TABLE app.families ADD CONSTRAINT families_c2 CHECK (length(btrim(name)) BETWEEN 1 AND 100);
ALTER TABLE app.families ADD CONSTRAINT families_c3 CHECK (week_starts_on = 1);
ALTER TABLE app.families ADD CONSTRAINT families_c4 CHECK (status IN ('active', 'suspended', 'deleting'));
ALTER TABLE app.families ADD CONSTRAINT families_c5 CHECK (revision>0);
ALTER TABLE app.accounts ADD CONSTRAINT accounts_c1 PRIMARY KEY (id);
ALTER TABLE app.accounts ADD CONSTRAINT accounts_c2 UNIQUE (login_name);
ALTER TABLE app.accounts ADD CONSTRAINT accounts_c3 CHECK (length(login_name) BETWEEN 3 AND 254);
ALTER TABLE app.accounts ADD CONSTRAINT accounts_c4 CHECK (status IN ('active', 'locked', 'disabled'));
ALTER TABLE app.family_memberships ADD CONSTRAINT family_memberships_c1 PRIMARY KEY (id);
ALTER TABLE app.family_memberships ADD CONSTRAINT family_memberships_c2 UNIQUE (family_id, id);
ALTER TABLE app.family_memberships ADD CONSTRAINT family_memberships_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.family_memberships ADD CONSTRAINT family_memberships_c4 FOREIGN KEY (account_id) REFERENCES app.accounts(id) ON DELETE RESTRICT;
ALTER TABLE app.family_memberships ADD CONSTRAINT family_memberships_c5 UNIQUE (family_id, account_id);
ALTER TABLE app.family_memberships ADD CONSTRAINT family_memberships_c6 UNIQUE (family_id, account_id, id);
ALTER TABLE app.family_memberships ADD CONSTRAINT family_memberships_c7 CHECK (role IN ('owner', 'admin', 'parent', 'content_editor', 'reviewer'));
ALTER TABLE app.family_memberships ADD CONSTRAINT family_memberships_c8 CHECK (status IN ('active', 'revoked'));
ALTER TABLE app.children ADD CONSTRAINT children_c1 PRIMARY KEY (id);
ALTER TABLE app.children ADD CONSTRAINT children_c2 UNIQUE (family_id, id);
ALTER TABLE app.children ADD CONSTRAINT children_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.children ADD CONSTRAINT children_c4 CHECK (length(btrim(nickname)) BETWEEN 1 AND 40);
ALTER TABLE app.children ADD CONSTRAINT children_c5 CHECK (reading_mode IN ('pre_reader', 'early_reader', 'reader'));
ALTER TABLE app.children ADD CONSTRAINT children_c6 CHECK (recording_retention_days BETWEEN 0 AND 365);
ALTER TABLE app.children ADD CONSTRAINT children_c7 CHECK (status IN ('active', 'archived'));
ALTER TABLE app.children ADD CONSTRAINT children_c8 CHECK (revision>0);
ALTER TABLE app.devices ADD CONSTRAINT devices_c1 PRIMARY KEY (id);
ALTER TABLE app.devices ADD CONSTRAINT devices_c2 UNIQUE (family_id, id);
ALTER TABLE app.devices ADD CONSTRAINT devices_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.devices ADD CONSTRAINT devices_c4 FOREIGN KEY (family_id, bound_child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.devices ADD CONSTRAINT devices_c5 CHECK (device_kind IN ('ipad', 'web', 'phone', 'android_tv'));
ALTER TABLE app.devices ADD CONSTRAINT devices_c6 CHECK (status IN ('active', 'revoked'));
ALTER TABLE app.devices ADD CONSTRAINT devices_c7 CHECK (jsonb_typeof(capabilities) = 'object');
ALTER TABLE app.devices ADD CONSTRAINT devices_c8 CHECK (revision>0);
ALTER TABLE app.auth_sessions ADD CONSTRAINT auth_sessions_c1 PRIMARY KEY (id);
ALTER TABLE app.auth_sessions ADD CONSTRAINT auth_sessions_c2 UNIQUE (family_id, id);
ALTER TABLE app.auth_sessions ADD CONSTRAINT auth_sessions_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.auth_sessions ADD CONSTRAINT auth_sessions_c4 FOREIGN KEY (family_id, device_id) REFERENCES app.devices(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.auth_sessions ADD CONSTRAINT auth_sessions_c5 FOREIGN KEY (family_id, membership_id) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.auth_sessions ADD CONSTRAINT auth_sessions_c6 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.auth_sessions ADD CONSTRAINT auth_sessions_c7 UNIQUE (token_digest);
ALTER TABLE app.auth_sessions ADD CONSTRAINT auth_sessions_c8 CHECK ((session_kind='parent' AND membership_id IS NOT NULL) OR (session_kind IN ('child','tv') AND child_id IS NOT NULL AND membership_id IS NULL));
ALTER TABLE app.auth_sessions ADD CONSTRAINT auth_sessions_c9 CHECK (session_kind IN ('parent', 'child', 'tv'));
ALTER TABLE app.auth_sessions ADD CONSTRAINT auth_sessions_c10 CHECK (expires_at > created_at);
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c1 PRIMARY KEY (id);
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c2 UNIQUE (family_id, id);
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c4 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c5 UNIQUE (family_id, child_id, id);
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c6 UNIQUE (family_id, storage_key);
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c7 CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c8 CHECK (byte_size >= 0);
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c9 CHECK (width_px IS NULL OR width_px > 0);
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c10 CHECK (height_px IS NULL OR height_px > 0);
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c11 CHECK (duration_ms IS NULL OR duration_ms >= 0);
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c12 CHECK (storage_key <> '' AND storage_key !~ '(^/|(^|/)\.\.(/|$))');
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c13 CHECK (asset_kind IN ('source_document', 'image', 'audio', 'recording', 'atlas', 'model', 'report'));
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c14 CHECK (origin_kind IN ('licensed_upload', 'family_authored', 'generated', 'recorded'));
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c15 CHECK (status IN ('staging', 'ready', 'quarantined', 'deleted'));
ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_c16 CHECK (asset_kind <> 'recording' OR child_id IS NOT NULL);
ALTER TABLE app.curriculum_series ADD CONSTRAINT curriculum_series_c1 PRIMARY KEY (id);
ALTER TABLE app.curriculum_series ADD CONSTRAINT curriculum_series_c2 UNIQUE (family_id, id);
ALTER TABLE app.curriculum_series ADD CONSTRAINT curriculum_series_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.curriculum_series ADD CONSTRAINT curriculum_series_c4 UNIQUE (family_id, stable_key);
ALTER TABLE app.curriculum_series ADD CONSTRAINT curriculum_series_c5 CHECK (revision>0);
ALTER TABLE app.curriculum_editions ADD CONSTRAINT curriculum_editions_c1 PRIMARY KEY (id);
ALTER TABLE app.curriculum_editions ADD CONSTRAINT curriculum_editions_c2 UNIQUE (family_id, id);
ALTER TABLE app.curriculum_editions ADD CONSTRAINT curriculum_editions_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.curriculum_editions ADD CONSTRAINT curriculum_editions_c4 FOREIGN KEY (family_id, series_id) REFERENCES app.curriculum_series(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.curriculum_editions ADD CONSTRAINT curriculum_editions_c5 UNIQUE (family_id, series_id, edition_key);
ALTER TABLE app.content_versions ADD CONSTRAINT content_versions_c1 PRIMARY KEY (id);
ALTER TABLE app.content_versions ADD CONSTRAINT content_versions_c2 UNIQUE (family_id, id);
ALTER TABLE app.content_versions ADD CONSTRAINT content_versions_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.content_versions ADD CONSTRAINT content_versions_c4 FOREIGN KEY (family_id, edition_id) REFERENCES app.curriculum_editions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_versions ADD CONSTRAINT content_versions_c5 FOREIGN KEY (family_id, source_media_id) REFERENCES app.media_assets(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_versions ADD CONSTRAINT content_versions_c6 UNIQUE (family_id, edition_id, version_no);
ALTER TABLE app.content_versions ADD CONSTRAINT content_versions_c7 CHECK (version_no > 0 AND schema_version > 0);
ALTER TABLE app.content_versions ADD CONSTRAINT content_versions_c8 CHECK (source_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE app.content_versions ADD CONSTRAINT content_versions_c9 CHECK (status IN ('draft', 'checking', 'ready'));
ALTER TABLE app.content_versions ADD CONSTRAINT content_versions_c10 CHECK (published_at IS NULL OR status='ready');
ALTER TABLE app.content_nodes ADD CONSTRAINT content_nodes_c1 PRIMARY KEY (id);
ALTER TABLE app.content_nodes ADD CONSTRAINT content_nodes_c2 UNIQUE (family_id, id);
ALTER TABLE app.content_nodes ADD CONSTRAINT content_nodes_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.content_nodes ADD CONSTRAINT content_nodes_c4 FOREIGN KEY (family_id, content_version_id) REFERENCES app.content_versions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_nodes ADD CONSTRAINT content_nodes_c5 UNIQUE (family_id, content_version_id, id);
ALTER TABLE app.content_nodes ADD CONSTRAINT content_nodes_c6 FOREIGN KEY (family_id, content_version_id, parent_id) REFERENCES app.content_nodes(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_nodes ADD CONSTRAINT content_nodes_c7 UNIQUE (family_id, content_version_id, stable_key);
ALTER TABLE app.content_nodes ADD CONSTRAINT content_nodes_c8 CHECK (ordinal >= 0);
ALTER TABLE app.content_nodes ADD CONSTRAINT content_nodes_c9 CHECK (parent_id IS NULL OR parent_id <> id);
ALTER TABLE app.content_nodes ADD CONSTRAINT content_nodes_c10 CHECK (node_kind IN ('level', 'book', 'unit', 'lesson', 'page', 'passage', 'dialogue', 'sentence'));
ALTER TABLE app.content_nodes ADD CONSTRAINT content_nodes_c11 CHECK (page_number IS NULL OR page_number > 0);
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c1 PRIMARY KEY (id);
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c2 UNIQUE (family_id, id);
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c4 FOREIGN KEY (family_id, content_version_id, node_id) REFERENCES app.content_nodes(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c5 UNIQUE (family_id, content_version_id, id);
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c6 FOREIGN KEY (family_id, source_media_id) REFERENCES app.media_assets(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c7 FOREIGN KEY (family_id, image_media_id) REFERENCES app.media_assets(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c8 FOREIGN KEY (family_id, audio_media_id) REFERENCES app.media_assets(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c9 UNIQUE (family_id, content_version_id, stable_key);
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c10 CHECK (source_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c11 CHECK (slice_kind IN ('context', 'sentence', 'word'));
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c12 CHECK (slice_schema_version > 0);
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c13 CHECK ((num_nonnulls(audio_start_ms,audio_end_ms)=0) OR (num_nonnulls(audio_start_ms,audio_end_ms)=2 AND audio_media_id IS NOT NULL AND audio_start_ms >= 0 AND audio_end_ms > audio_start_ms));
ALTER TABLE app.source_slices ADD CONSTRAINT source_slices_c14 CHECK ((num_nonnulls(region_x,region_y,region_w,region_h)=0) OR (num_nonnulls(region_x,region_y,region_w,region_h)=4 AND region_x>=0 AND region_y>=0 AND region_w>0 AND region_h>0 AND region_x+region_w<=1 AND region_y+region_h<=1));
ALTER TABLE app.slice_contexts ADD CONSTRAINT slice_contexts_c1 PRIMARY KEY (id);
ALTER TABLE app.slice_contexts ADD CONSTRAINT slice_contexts_c2 UNIQUE (family_id, id);
ALTER TABLE app.slice_contexts ADD CONSTRAINT slice_contexts_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.slice_contexts ADD CONSTRAINT slice_contexts_c4 FOREIGN KEY (family_id, content_version_id, slice_id) REFERENCES app.source_slices(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.slice_contexts ADD CONSTRAINT slice_contexts_c5 FOREIGN KEY (family_id, content_version_id, context_slice_id) REFERENCES app.source_slices(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.slice_contexts ADD CONSTRAINT slice_contexts_c6 UNIQUE (family_id, slice_id, context_slice_id, relation_kind);
ALTER TABLE app.slice_contexts ADD CONSTRAINT slice_contexts_c7 CHECK (slice_id <> context_slice_id);
ALTER TABLE app.slice_contexts ADD CONSTRAINT slice_contexts_c8 CHECK (ordinal >= 0);
ALTER TABLE app.slice_contexts ADD CONSTRAINT slice_contexts_c9 CHECK (relation_kind IN ('parent_context', 'pronoun_reference', 'question_answer', 'visual_context'));
ALTER TABLE app.vocabulary_senses ADD CONSTRAINT vocabulary_senses_c1 PRIMARY KEY (id);
ALTER TABLE app.vocabulary_senses ADD CONSTRAINT vocabulary_senses_c2 UNIQUE (family_id, id);
ALTER TABLE app.vocabulary_senses ADD CONSTRAINT vocabulary_senses_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.vocabulary_senses ADD CONSTRAINT vocabulary_senses_c4 UNIQUE (family_id, sense_key);
ALTER TABLE app.learning_objectives ADD CONSTRAINT learning_objectives_c1 PRIMARY KEY (id);
ALTER TABLE app.learning_objectives ADD CONSTRAINT learning_objectives_c2 UNIQUE (family_id, id);
ALTER TABLE app.learning_objectives ADD CONSTRAINT learning_objectives_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.learning_objectives ADD CONSTRAINT learning_objectives_c4 FOREIGN KEY (family_id, vocabulary_sense_id) REFERENCES app.vocabulary_senses(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.learning_objectives ADD CONSTRAINT learning_objectives_c5 UNIQUE (family_id, stable_key);
ALTER TABLE app.learning_objectives ADD CONSTRAINT learning_objectives_c6 UNIQUE (family_id, id, skill, modality);
ALTER TABLE app.learning_objectives ADD CONSTRAINT learning_objectives_c7 CHECK (skill IN ('listening', 'word_recognition', 'oral_reading', 'sentence_comprehension', 'spelling', 'oral_expression'));
ALTER TABLE app.learning_objectives ADD CONSTRAINT learning_objectives_c8 CHECK (modality IN ('audio', 'visual', 'text', 'speech'));
ALTER TABLE app.slice_objectives ADD CONSTRAINT slice_objectives_c1 PRIMARY KEY (id);
ALTER TABLE app.slice_objectives ADD CONSTRAINT slice_objectives_c2 UNIQUE (family_id, id);
ALTER TABLE app.slice_objectives ADD CONSTRAINT slice_objectives_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.slice_objectives ADD CONSTRAINT slice_objectives_c4 FOREIGN KEY (family_id, content_version_id, slice_id) REFERENCES app.source_slices(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.slice_objectives ADD CONSTRAINT slice_objectives_c5 FOREIGN KEY (family_id, objective_id) REFERENCES app.learning_objectives(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.slice_objectives ADD CONSTRAINT slice_objectives_c6 UNIQUE (family_id, slice_id, objective_id);
ALTER TABLE app.import_jobs ADD CONSTRAINT import_jobs_c1 PRIMARY KEY (id);
ALTER TABLE app.import_jobs ADD CONSTRAINT import_jobs_c2 UNIQUE (family_id, id);
ALTER TABLE app.import_jobs ADD CONSTRAINT import_jobs_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.import_jobs ADD CONSTRAINT import_jobs_c4 FOREIGN KEY (family_id, edition_id) REFERENCES app.curriculum_editions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.import_jobs ADD CONSTRAINT import_jobs_c5 FOREIGN KEY (family_id, source_media_id) REFERENCES app.media_assets(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.import_jobs ADD CONSTRAINT import_jobs_c6 FOREIGN KEY (family_id, output_content_version_id) REFERENCES app.content_versions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.import_jobs ADD CONSTRAINT import_jobs_c7 FOREIGN KEY (family_id, requested_by) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.import_jobs ADD CONSTRAINT import_jobs_c8 CHECK (stage IN ('received', 'validated', 'parsing', 'aligning', 'slicing', 'generating', 'qa', 'ready', 'failed'));
ALTER TABLE app.import_jobs ADD CONSTRAINT import_jobs_c9 CHECK (input_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE app.import_jobs ADD CONSTRAINT import_jobs_c10 CHECK (jsonb_typeof(checkpoint)='object');
ALTER TABLE app.generation_runs ADD CONSTRAINT generation_runs_c1 PRIMARY KEY (id);
ALTER TABLE app.generation_runs ADD CONSTRAINT generation_runs_c2 UNIQUE (family_id, id);
ALTER TABLE app.generation_runs ADD CONSTRAINT generation_runs_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.generation_runs ADD CONSTRAINT generation_runs_c4 FOREIGN KEY (family_id, content_version_id) REFERENCES app.content_versions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.generation_runs ADD CONSTRAINT generation_runs_c5 FOREIGN KEY (family_id, requested_by) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.generation_runs ADD CONSTRAINT generation_runs_c6 UNIQUE (family_id, content_version_id, id);
ALTER TABLE app.generation_runs ADD CONSTRAINT generation_runs_c7 CHECK (input_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE app.generation_runs ADD CONSTRAINT generation_runs_c8 CHECK (input_tokens>=0 AND output_tokens>=0 AND cost_microunits>=0 AND retry_count>=0);
ALTER TABLE app.generation_runs ADD CONSTRAINT generation_runs_c9 CHECK (jsonb_typeof(blueprint)='object');
ALTER TABLE app.generation_runs ADD CONSTRAINT generation_runs_c10 CHECK (status IN ('queued', 'running', 'checking', 'completed', 'failed', 'cancelled'));
ALTER TABLE app.generation_inputs ADD CONSTRAINT generation_inputs_c1 PRIMARY KEY (id);
ALTER TABLE app.generation_inputs ADD CONSTRAINT generation_inputs_c2 UNIQUE (family_id, id);
ALTER TABLE app.generation_inputs ADD CONSTRAINT generation_inputs_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.generation_inputs ADD CONSTRAINT generation_inputs_c4 FOREIGN KEY (family_id, content_version_id, generation_run_id) REFERENCES app.generation_runs(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.generation_inputs ADD CONSTRAINT generation_inputs_c5 FOREIGN KEY (family_id, content_version_id, slice_id) REFERENCES app.source_slices(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.generation_inputs ADD CONSTRAINT generation_inputs_c6 UNIQUE (family_id, generation_run_id, slice_id, input_role);
ALTER TABLE app.generation_inputs ADD CONSTRAINT generation_inputs_c7 CHECK (input_role IN ('target', 'context', 'allowed_distractor'));
ALTER TABLE app.question_families ADD CONSTRAINT question_families_c1 PRIMARY KEY (id);
ALTER TABLE app.question_families ADD CONSTRAINT question_families_c2 UNIQUE (family_id, id);
ALTER TABLE app.question_families ADD CONSTRAINT question_families_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.question_families ADD CONSTRAINT question_families_c4 FOREIGN KEY (family_id, objective_id) REFERENCES app.learning_objectives(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.question_families ADD CONSTRAINT question_families_c5 UNIQUE (family_id, stable_key);
ALTER TABLE app.question_families ADD CONSTRAINT question_families_c6 UNIQUE (family_id, objective_id, id);
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c1 PRIMARY KEY (id);
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c2 UNIQUE (family_id, id);
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c4 FOREIGN KEY (family_id, objective_id, question_family_id) REFERENCES app.question_families(family_id, objective_id, id) ON DELETE RESTRICT;
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c5 FOREIGN KEY (family_id, content_version_id) REFERENCES app.content_versions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c6 FOREIGN KEY (family_id, content_version_id, generation_run_id) REFERENCES app.generation_runs(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c7 FOREIGN KEY (family_id, image_media_id) REFERENCES app.media_assets(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c8 FOREIGN KEY (family_id, audio_media_id) REFERENCES app.media_assets(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c9 UNIQUE (family_id, content_version_id, id);
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c10 UNIQUE (family_id, objective_id, id);
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c11 UNIQUE (family_id, question_family_id, version_no);
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c12 CHECK (version_no>0 AND difficulty BETWEEN 1 AND 5 AND estimated_seconds BETWEEN 1 AND 600);
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c13 CHECK (question_type IN ('audio_to_picture', 'word_to_picture', 'picture_to_word', 'oral_reading', 'sentence_choice', 'cloze_choice', 'cloze_text', 'matching', 'word_order', 'reading_choice', 'retell'));
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c14 CHECK (status IN ('draft', 'machine_checked', 'review_required', 'ready'));
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c15 CHECK (published_at IS NULL OR status='ready');
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c16 CHECK (payload_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c17 CHECK (jsonb_typeof(public_payload)='object');
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c18 CHECK (public_payload_schema_version>0);
ALTER TABLE app.question_versions ADD CONSTRAINT question_versions_c19 CHECK (NOT (public_payload ?| ARRAY['answer_spec','correct_answer','correct_answers','correct_option_ids','accepted_option_ids','accepted_texts','explanation','rubric','source_quotes','source_slice_ids','context_slice_ids']));
ALTER TABLE app.question_sources ADD CONSTRAINT question_sources_c1 PRIMARY KEY (id);
ALTER TABLE app.question_sources ADD CONSTRAINT question_sources_c2 UNIQUE (family_id, id);
ALTER TABLE app.question_sources ADD CONSTRAINT question_sources_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.question_sources ADD CONSTRAINT question_sources_c4 FOREIGN KEY (family_id, content_version_id, question_version_id) REFERENCES app.question_versions(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.question_sources ADD CONSTRAINT question_sources_c5 FOREIGN KEY (family_id, content_version_id, slice_id) REFERENCES app.source_slices(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.question_sources ADD CONSTRAINT question_sources_c6 UNIQUE (family_id, question_version_id, slice_id, source_role);
ALTER TABLE app.question_sources ADD CONSTRAINT question_sources_c7 CHECK (source_role IN ('assessed', 'context', 'distractor'));
ALTER TABLE app.question_options ADD CONSTRAINT question_options_c1 PRIMARY KEY (id);
ALTER TABLE app.question_options ADD CONSTRAINT question_options_c2 UNIQUE (family_id, id);
ALTER TABLE app.question_options ADD CONSTRAINT question_options_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.question_options ADD CONSTRAINT question_options_c4 FOREIGN KEY (family_id, question_version_id) REFERENCES app.question_versions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.question_options ADD CONSTRAINT question_options_c5 FOREIGN KEY (family_id, image_media_id) REFERENCES app.media_assets(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.question_options ADD CONSTRAINT question_options_c6 FOREIGN KEY (family_id, audio_media_id) REFERENCES app.media_assets(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.question_options ADD CONSTRAINT question_options_c7 UNIQUE (family_id, question_version_id, id);
ALTER TABLE app.question_options ADD CONSTRAINT question_options_c8 UNIQUE (family_id, question_version_id, option_key);
ALTER TABLE app.question_options ADD CONSTRAINT question_options_c9 CHECK (ordinal>=0);
ALTER TABLE app.question_options ADD CONSTRAINT question_options_c10 CHECK (num_nonnulls(text,image_media_id,audio_media_id)>0);
ALTER TABLE app.question_options ADD CONSTRAINT question_options_c11 CHECK (side IN ('choice', 'left', 'right', 'token'));
ALTER TABLE private.question_answers ADD CONSTRAINT question_answers_c1 PRIMARY KEY (id);
ALTER TABLE private.question_answers ADD CONSTRAINT question_answers_c2 UNIQUE (family_id, id);
ALTER TABLE private.question_answers ADD CONSTRAINT question_answers_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE private.question_answers ADD CONSTRAINT question_answers_c4 FOREIGN KEY (family_id, question_version_id) REFERENCES app.question_versions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE private.question_answers ADD CONSTRAINT question_answers_c5 FOREIGN KEY (family_id, question_version_id, option_id) REFERENCES app.question_options(family_id, question_version_id, id) ON DELETE RESTRICT;
ALTER TABLE private.question_answers ADD CONSTRAINT question_answers_c6 FOREIGN KEY (family_id, question_version_id, match_option_id) REFERENCES app.question_options(family_id, question_version_id, id) ON DELETE RESTRICT;
ALTER TABLE private.question_answers ADD CONSTRAINT question_answers_c7 UNIQUE (family_id, question_version_id, answer_key);
ALTER TABLE private.question_answers ADD CONSTRAINT question_answers_c8 CHECK (answer_kind IN ('option', 'text', 'match', 'order', 'rubric'));
ALTER TABLE private.question_answers ADD CONSTRAINT question_answers_c9 CHECK (punctuation_mode IN ('strict', 'ignore'));
ALTER TABLE private.question_answers ADD CONSTRAINT question_answers_c10 CHECK (score_units>0);
ALTER TABLE private.question_answers ADD CONSTRAINT question_answers_c11 CHECK ((answer_kind='option' AND option_id IS NOT NULL AND num_nonnulls(match_option_id,expected_text,ordering_position,rubric_text)=0) OR (answer_kind='text' AND expected_text IS NOT NULL AND num_nonnulls(option_id,match_option_id,ordering_position,rubric_text)=0) OR (answer_kind='match' AND option_id IS NOT NULL AND match_option_id IS NOT NULL AND option_id<>match_option_id AND num_nonnulls(expected_text,ordering_position,rubric_text)=0) OR (answer_kind='order' AND option_id IS NOT NULL AND ordering_position IS NOT NULL AND ordering_position>=0 AND num_nonnulls(match_option_id,expected_text,rubric_text)=0) OR (answer_kind='rubric' AND rubric_text IS NOT NULL AND num_nonnulls(option_id,match_option_id,expected_text,ordering_position)=0));
ALTER TABLE app.asset_packages ADD CONSTRAINT asset_packages_c1 PRIMARY KEY (id);
ALTER TABLE app.asset_packages ADD CONSTRAINT asset_packages_c2 UNIQUE (family_id, id);
ALTER TABLE app.asset_packages ADD CONSTRAINT asset_packages_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.asset_packages ADD CONSTRAINT asset_packages_c4 FOREIGN KEY (family_id, manifest_media_id) REFERENCES app.media_assets(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.asset_packages ADD CONSTRAINT asset_packages_c5 UNIQUE (family_id, package_key, version_label);
ALTER TABLE app.asset_packages ADD CONSTRAINT asset_packages_c6 CHECK (package_kind IN ('pet', 'scene', 'item'));
ALTER TABLE app.asset_packages ADD CONSTRAINT asset_packages_c7 CHECK (status IN ('draft', 'checking', 'ready'));
ALTER TABLE app.asset_packages ADD CONSTRAINT asset_packages_c8 CHECK (published_at IS NULL OR status='ready');
ALTER TABLE app.asset_packages ADD CONSTRAINT asset_packages_c9 CHECK (input_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE app.package_assets ADD CONSTRAINT package_assets_c1 PRIMARY KEY (id);
ALTER TABLE app.package_assets ADD CONSTRAINT package_assets_c2 UNIQUE (family_id, id);
ALTER TABLE app.package_assets ADD CONSTRAINT package_assets_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.package_assets ADD CONSTRAINT package_assets_c4 FOREIGN KEY (family_id, asset_package_id) REFERENCES app.asset_packages(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.package_assets ADD CONSTRAINT package_assets_c5 FOREIGN KEY (family_id, media_asset_id) REFERENCES app.media_assets(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.package_assets ADD CONSTRAINT package_assets_c6 UNIQUE (family_id, asset_package_id, asset_key, lod);
ALTER TABLE app.package_assets ADD CONSTRAINT package_assets_c7 CHECK (lod BETWEEN 0 AND 2);
ALTER TABLE app.package_assets ADD CONSTRAINT package_assets_c8 CHECK (asset_role IN ('texture', 'atlas', 'animation', 'manifest', 'preview', 'model', 'sound'));
ALTER TABLE app.quality_reports ADD CONSTRAINT quality_reports_c1 PRIMARY KEY (id);
ALTER TABLE app.quality_reports ADD CONSTRAINT quality_reports_c2 UNIQUE (family_id, id);
ALTER TABLE app.quality_reports ADD CONSTRAINT quality_reports_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.quality_reports ADD CONSTRAINT quality_reports_c4 FOREIGN KEY (family_id, content_version_id) REFERENCES app.content_versions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.quality_reports ADD CONSTRAINT quality_reports_c5 FOREIGN KEY (family_id, question_version_id) REFERENCES app.question_versions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.quality_reports ADD CONSTRAINT quality_reports_c6 FOREIGN KEY (family_id, generation_run_id) REFERENCES app.generation_runs(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.quality_reports ADD CONSTRAINT quality_reports_c7 FOREIGN KEY (family_id, asset_package_id) REFERENCES app.asset_packages(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.quality_reports ADD CONSTRAINT quality_reports_c8 FOREIGN KEY (family_id, reviewer_membership_id) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.quality_reports ADD CONSTRAINT quality_reports_c9 CHECK (num_nonnulls(content_version_id,question_version_id,generation_run_id,asset_package_id)=1);
ALTER TABLE app.quality_reports ADD CONSTRAINT quality_reports_c10 CHECK (check_kind IN ('schema', 'reference', 'semantic', 'media', 'runtime', 'visual'));
ALTER TABLE app.quality_reports ADD CONSTRAINT quality_reports_c11 CHECK (verdict IN ('pass', 'warn', 'fail'));
ALTER TABLE app.quality_reports ADD CONSTRAINT quality_reports_c12 CHECK (jsonb_typeof(details)='object');
ALTER TABLE app.content_releases ADD CONSTRAINT content_releases_c1 PRIMARY KEY (id);
ALTER TABLE app.content_releases ADD CONSTRAINT content_releases_c2 UNIQUE (family_id, id);
ALTER TABLE app.content_releases ADD CONSTRAINT content_releases_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.content_releases ADD CONSTRAINT content_releases_c4 FOREIGN KEY (family_id, content_version_id) REFERENCES app.content_versions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_releases ADD CONSTRAINT content_releases_c5 FOREIGN KEY (family_id, released_by) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_releases ADD CONSTRAINT content_releases_c6 UNIQUE (family_id, content_version_id, release_no);
ALTER TABLE app.content_releases ADD CONSTRAINT content_releases_c7 UNIQUE (family_id, content_version_id, id);
ALTER TABLE app.content_releases ADD CONSTRAINT content_releases_c8 CHECK (release_no>0);
ALTER TABLE app.content_releases ADD CONSTRAINT content_releases_c9 CHECK (qa_digest ~ '^[0-9a-f]{64}$' AND manifest_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE app.release_questions ADD CONSTRAINT release_questions_c1 PRIMARY KEY (id);
ALTER TABLE app.release_questions ADD CONSTRAINT release_questions_c2 UNIQUE (family_id, id);
ALTER TABLE app.release_questions ADD CONSTRAINT release_questions_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.release_questions ADD CONSTRAINT release_questions_c4 FOREIGN KEY (family_id, content_version_id, content_release_id) REFERENCES app.content_releases(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.release_questions ADD CONSTRAINT release_questions_c5 FOREIGN KEY (family_id, content_version_id, question_version_id) REFERENCES app.question_versions(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.release_questions ADD CONSTRAINT release_questions_c6 UNIQUE (family_id, content_release_id, question_version_id);
ALTER TABLE app.weekly_plans ADD CONSTRAINT weekly_plans_c1 PRIMARY KEY (id);
ALTER TABLE app.weekly_plans ADD CONSTRAINT weekly_plans_c2 UNIQUE (family_id, id);
ALTER TABLE app.weekly_plans ADD CONSTRAINT weekly_plans_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.weekly_plans ADD CONSTRAINT weekly_plans_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.weekly_plans ADD CONSTRAINT weekly_plans_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.weekly_plans ADD CONSTRAINT weekly_plans_c6 UNIQUE (family_id, child_id, week_start);
ALTER TABLE app.weekly_plans ADD CONSTRAINT weekly_plans_c7 CHECK (extract(isodow FROM week_start)=1);
ALTER TABLE app.weekly_plans ADD CONSTRAINT weekly_plans_c8 CHECK (status IN ('draft', 'active', 'archived'));
ALTER TABLE app.plan_revisions ADD CONSTRAINT plan_revisions_c1 PRIMARY KEY (id);
ALTER TABLE app.plan_revisions ADD CONSTRAINT plan_revisions_c2 UNIQUE (family_id, id);
ALTER TABLE app.plan_revisions ADD CONSTRAINT plan_revisions_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.plan_revisions ADD CONSTRAINT plan_revisions_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.plan_revisions ADD CONSTRAINT plan_revisions_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.plan_revisions ADD CONSTRAINT plan_revisions_c6 FOREIGN KEY (family_id, child_id, weekly_plan_id) REFERENCES app.weekly_plans(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.plan_revisions ADD CONSTRAINT plan_revisions_c7 FOREIGN KEY (family_id, published_by) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.plan_revisions ADD CONSTRAINT plan_revisions_c8 UNIQUE (family_id, child_id, weekly_plan_id, revision_no);
ALTER TABLE app.plan_revisions ADD CONSTRAINT plan_revisions_c9 CHECK (revision_no>0 AND goal_learning_days BETWEEN 0 AND 7 AND planned_learning_days BETWEEN 0 AND 7 AND goal_learning_days<=planned_learning_days);
ALTER TABLE app.plan_revisions ADD CONSTRAINT plan_revisions_c10 CHECK (status IN ('draft', 'validated'));
ALTER TABLE app.plan_revisions ADD CONSTRAINT plan_revisions_c11 CHECK (published_at IS NULL OR (status='validated' AND published_by IS NOT NULL));
ALTER TABLE app.plan_revisions ADD CONSTRAINT plan_revisions_c12 CHECK (payload_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE app.learning_days ADD CONSTRAINT learning_days_c1 PRIMARY KEY (id);
ALTER TABLE app.learning_days ADD CONSTRAINT learning_days_c2 UNIQUE (family_id, id);
ALTER TABLE app.learning_days ADD CONSTRAINT learning_days_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.learning_days ADD CONSTRAINT learning_days_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.learning_days ADD CONSTRAINT learning_days_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.learning_days ADD CONSTRAINT learning_days_c6 FOREIGN KEY (family_id, child_id, plan_revision_id) REFERENCES app.plan_revisions(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.learning_days ADD CONSTRAINT learning_days_c7 UNIQUE (family_id, child_id, learning_date);
ALTER TABLE app.learning_days ADD CONSTRAINT learning_days_c8 CHECK (day_kind IN ('learning', 'rest', 'leave'));
ALTER TABLE app.learning_days ADD CONSTRAINT learning_days_c9 CHECK (interaction_budget_seconds BETWEEN 0 AND 3600);
ALTER TABLE app.learning_days ADD CONSTRAINT learning_days_c10 CHECK (revision>0);
ALTER TABLE app.learning_days ADD CONSTRAINT learning_days_c11 CHECK ((day_kind='learning' AND num_nonnulls(window_start_at,last_start_at,window_end_at,grace_end_at)=4 AND window_start_at<=last_start_at AND last_start_at<=window_end_at AND window_end_at<=grace_end_at) OR (day_kind IN ('rest','leave') AND num_nonnulls(window_start_at,last_start_at,window_end_at,grace_end_at)=0));
ALTER TABLE app.task_occurrences ADD CONSTRAINT task_occurrences_c1 PRIMARY KEY (id);
ALTER TABLE app.task_occurrences ADD CONSTRAINT task_occurrences_c2 UNIQUE (family_id, id);
ALTER TABLE app.task_occurrences ADD CONSTRAINT task_occurrences_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.task_occurrences ADD CONSTRAINT task_occurrences_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.task_occurrences ADD CONSTRAINT task_occurrences_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.task_occurrences ADD CONSTRAINT task_occurrences_c6 FOREIGN KEY (family_id, child_id, plan_revision_id) REFERENCES app.plan_revisions(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.task_occurrences ADD CONSTRAINT task_occurrences_c7 FOREIGN KEY (family_id, child_id, learning_day_id) REFERENCES app.learning_days(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.task_occurrences ADD CONSTRAINT task_occurrences_c8 FOREIGN KEY (family_id, child_id, supersedes_task_id) REFERENCES app.task_occurrences(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.task_occurrences ADD CONSTRAINT task_occurrences_c9 UNIQUE (family_id, child_id, plan_revision_id, id);
ALTER TABLE app.task_occurrences ADD CONSTRAINT task_occurrences_c10 UNIQUE (family_id, child_id, learning_day_id, plan_revision_id, stable_task_key);
ALTER TABLE app.task_occurrences ADD CONSTRAINT task_occurrences_c11 CHECK (supersedes_task_id IS NULL OR supersedes_task_id<>id);
ALTER TABLE app.task_occurrences ADD CONSTRAINT task_occurrences_c12 CHECK (estimated_seconds BETWEEN 1 AND 7200 AND revision>0);
ALTER TABLE app.task_occurrences ADD CONSTRAINT task_occurrences_c13 CHECK (status IN ('scheduled', 'active', 'pending_review', 'completed', 'cancelled', 'content_blocked'));
ALTER TABLE app.task_scopes ADD CONSTRAINT task_scopes_c1 PRIMARY KEY (id);
ALTER TABLE app.task_scopes ADD CONSTRAINT task_scopes_c2 UNIQUE (family_id, id);
ALTER TABLE app.task_scopes ADD CONSTRAINT task_scopes_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.task_scopes ADD CONSTRAINT task_scopes_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.task_scopes ADD CONSTRAINT task_scopes_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.task_scopes ADD CONSTRAINT task_scopes_c6 FOREIGN KEY (family_id, child_id, plan_revision_id, task_occurrence_id) REFERENCES app.task_occurrences(family_id, child_id, plan_revision_id, id) ON DELETE RESTRICT;
ALTER TABLE app.task_scopes ADD CONSTRAINT task_scopes_c7 FOREIGN KEY (family_id, content_version_id, slice_id) REFERENCES app.source_slices(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.task_scopes ADD CONSTRAINT task_scopes_c8 FOREIGN KEY (family_id, content_version_id, content_release_id) REFERENCES app.content_releases(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.task_scopes ADD CONSTRAINT task_scopes_c9 UNIQUE (family_id, child_id, task_occurrence_id, slice_id, scope_role);
ALTER TABLE app.task_scopes ADD CONSTRAINT task_scopes_c10 CHECK (scope_role IN ('new_learning', 'review', 'context'));
ALTER TABLE app.task_requirements ADD CONSTRAINT task_requirements_c1 PRIMARY KEY (id);
ALTER TABLE app.task_requirements ADD CONSTRAINT task_requirements_c2 UNIQUE (family_id, id);
ALTER TABLE app.task_requirements ADD CONSTRAINT task_requirements_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.task_requirements ADD CONSTRAINT task_requirements_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.task_requirements ADD CONSTRAINT task_requirements_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.task_requirements ADD CONSTRAINT task_requirements_c6 FOREIGN KEY (family_id, child_id, plan_revision_id, task_occurrence_id) REFERENCES app.task_occurrences(family_id, child_id, plan_revision_id, id) ON DELETE RESTRICT;
ALTER TABLE app.task_requirements ADD CONSTRAINT task_requirements_c7 FOREIGN KEY (family_id, objective_id, skill, modality) REFERENCES app.learning_objectives(family_id, id, skill, modality) ON DELETE RESTRICT;
ALTER TABLE app.task_requirements ADD CONSTRAINT task_requirements_c8 UNIQUE (family_id, child_id, task_occurrence_id, objective_id);
ALTER TABLE app.task_requirements ADD CONSTRAINT task_requirements_c9 CHECK (min_evidence_count>0 AND max_score_units>0 AND min_score_units BETWEEN 0 AND max_score_units);
ALTER TABLE app.study_exposures ADD CONSTRAINT study_exposures_c1 PRIMARY KEY (id);
ALTER TABLE app.study_exposures ADD CONSTRAINT study_exposures_c2 UNIQUE (family_id, id);
ALTER TABLE app.study_exposures ADD CONSTRAINT study_exposures_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.study_exposures ADD CONSTRAINT study_exposures_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.study_exposures ADD CONSTRAINT study_exposures_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.study_exposures ADD CONSTRAINT study_exposures_c6 FOREIGN KEY (family_id, child_id, task_occurrence_id) REFERENCES app.task_occurrences(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.study_exposures ADD CONSTRAINT study_exposures_c7 FOREIGN KEY (family_id, device_id) REFERENCES app.devices(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.study_exposures ADD CONSTRAINT study_exposures_c8 FOREIGN KEY (family_id, declared_by) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.study_exposures ADD CONSTRAINT study_exposures_c9 UNIQUE (family_id, child_id, event_key);
ALTER TABLE app.study_exposures ADD CONSTRAINT study_exposures_c10 CHECK (source_kind IN ('self_report', 'parent_report', 'historical', 'authorized_external', 'training'));
ALTER TABLE app.study_exposures ADD CONSTRAINT study_exposures_c11 CHECK (date_precision IN ('instant', 'day', 'approximate'));
ALTER TABLE app.study_exposures ADD CONSTRAINT study_exposures_c12 CHECK (date_precision<>'instant' OR occurred_at IS NOT NULL);
ALTER TABLE app.exposure_slices ADD CONSTRAINT exposure_slices_c1 PRIMARY KEY (id);
ALTER TABLE app.exposure_slices ADD CONSTRAINT exposure_slices_c2 UNIQUE (family_id, id);
ALTER TABLE app.exposure_slices ADD CONSTRAINT exposure_slices_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.exposure_slices ADD CONSTRAINT exposure_slices_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.exposure_slices ADD CONSTRAINT exposure_slices_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.exposure_slices ADD CONSTRAINT exposure_slices_c6 FOREIGN KEY (family_id, child_id, study_exposure_id) REFERENCES app.study_exposures(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.exposure_slices ADD CONSTRAINT exposure_slices_c7 FOREIGN KEY (family_id, content_version_id, slice_id) REFERENCES app.source_slices(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.exposure_slices ADD CONSTRAINT exposure_slices_c8 UNIQUE (family_id, child_id, study_exposure_id, slice_id);
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c1 PRIMARY KEY (id);
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c2 UNIQUE (family_id, id);
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c6 FOREIGN KEY (family_id, child_id, task_occurrence_id) REFERENCES app.task_occurrences(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c7 FOREIGN KEY (family_id, child_id, learning_day_id) REFERENCES app.learning_days(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c8 FOREIGN KEY (family_id, device_id) REFERENCES app.devices(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c9 UNIQUE (family_id, child_id, task_occurrence_id, id);
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c10 CHECK (mode IN ('training', 'verification', 'diagnostic'));
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c11 CHECK (status IN ('created', 'active', 'submitted', 'pending_review', 'completed', 'expired', 'cancelled'));
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c12 CHECK (mode<>'verification' OR task_occurrence_id IS NOT NULL);
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c13 CHECK (lease_epoch>0 AND revision>0 AND submit_deadline_at>=started_at AND lease_expires_at>=started_at);
ALTER TABLE app.challenge_sessions ADD CONSTRAINT challenge_sessions_c14 CHECK (form_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE app.challenge_items ADD CONSTRAINT challenge_items_c1 PRIMARY KEY (id);
ALTER TABLE app.challenge_items ADD CONSTRAINT challenge_items_c2 UNIQUE (family_id, id);
ALTER TABLE app.challenge_items ADD CONSTRAINT challenge_items_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.challenge_items ADD CONSTRAINT challenge_items_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.challenge_items ADD CONSTRAINT challenge_items_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.challenge_items ADD CONSTRAINT challenge_items_c6 FOREIGN KEY (family_id, child_id, challenge_session_id) REFERENCES app.challenge_sessions(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.challenge_items ADD CONSTRAINT challenge_items_c7 FOREIGN KEY (family_id, objective_id, question_version_id) REFERENCES app.question_versions(family_id, objective_id, id) ON DELETE RESTRICT;
ALTER TABLE app.challenge_items ADD CONSTRAINT challenge_items_c8 FOREIGN KEY (family_id, child_id, task_requirement_id) REFERENCES app.task_requirements(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.challenge_items ADD CONSTRAINT challenge_items_c9 UNIQUE (family_id, child_id, challenge_session_id, id);
ALTER TABLE app.challenge_items ADD CONSTRAINT challenge_items_c10 UNIQUE (family_id, child_id, challenge_session_id, ordinal);
ALTER TABLE app.challenge_items ADD CONSTRAINT challenge_items_c11 CHECK (ordinal>=0);
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c1 PRIMARY KEY (id);
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c2 UNIQUE (family_id, id);
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c6 FOREIGN KEY (family_id, child_id, challenge_session_id, challenge_item_id) REFERENCES app.challenge_items(family_id, child_id, challenge_session_id, id) ON DELETE RESTRICT;
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c7 FOREIGN KEY (family_id, child_id, recording_media_id) REFERENCES app.media_assets(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c8 FOREIGN KEY (family_id, device_id) REFERENCES app.devices(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c9 UNIQUE (family_id, child_id, attempt_key);
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c10 UNIQUE (family_id, child_id, challenge_item_id, attempt_no);
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c11 UNIQUE (family_id, child_id, challenge_item_id, id);
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c12 CHECK (response_kind IN ('choice', 'text', 'matching', 'ordering', 'recording'));
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c13 CHECK (machine_result IN ('correct', 'incorrect', 'unrecognized', 'pending_review'));
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c14 CHECK (assistance IN ('independent', 'hinted', 'demonstrated'));
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c15 CHECK (attempt_no>0 AND response_schema_version>0 AND lease_epoch>0 AND max_score_units>0 AND (score_units IS NULL OR score_units BETWEEN 0 AND max_score_units));
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c16 CHECK (jsonb_typeof(response_payload)='object');
ALTER TABLE app.answer_attempts ADD CONSTRAINT answer_attempts_c17 CHECK ((response_kind='recording') = (recording_media_id IS NOT NULL));
ALTER TABLE app.review_requests ADD CONSTRAINT review_requests_c1 PRIMARY KEY (id);
ALTER TABLE app.review_requests ADD CONSTRAINT review_requests_c2 UNIQUE (family_id, id);
ALTER TABLE app.review_requests ADD CONSTRAINT review_requests_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.review_requests ADD CONSTRAINT review_requests_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.review_requests ADD CONSTRAINT review_requests_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.review_requests ADD CONSTRAINT review_requests_c6 FOREIGN KEY (family_id, child_id, answer_attempt_id) REFERENCES app.answer_attempts(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.review_requests ADD CONSTRAINT review_requests_c7 FOREIGN KEY (family_id, reviewed_by) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.review_requests ADD CONSTRAINT review_requests_c8 UNIQUE (family_id, child_id, answer_attempt_id);
ALTER TABLE app.review_requests ADD CONSTRAINT review_requests_c9 CHECK (requested_reason IN ('oral', 'unrecognized', 'late_sync', 'question_error'));
ALTER TABLE app.review_requests ADD CONSTRAINT review_requests_c10 CHECK (status IN ('pending', 'approved', 'needs_help', 'cancelled'));
ALTER TABLE app.review_requests ADD CONSTRAINT review_requests_c11 CHECK ((status='pending' AND reviewed_at IS NULL) OR (status<>'pending' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL));
ALTER TABLE app.review_requests ADD CONSTRAINT review_requests_c12 CHECK (revision>0);
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c1 PRIMARY KEY (id);
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c2 UNIQUE (family_id, id);
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c6 FOREIGN KEY (family_id, objective_id, skill, modality) REFERENCES app.learning_objectives(family_id, id, skill, modality) ON DELETE RESTRICT;
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c7 FOREIGN KEY (family_id, child_id, answer_attempt_id) REFERENCES app.answer_attempts(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c8 FOREIGN KEY (family_id, child_id, review_request_id) REFERENCES app.review_requests(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c9 FOREIGN KEY (family_id, child_id, task_occurrence_id) REFERENCES app.task_occurrences(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c10 FOREIGN KEY (family_id, child_id, supersedes_evidence_id) REFERENCES app.learning_evidence(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c11 UNIQUE (family_id, child_id, evidence_key);
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c12 CHECK (evidence_kind IN ('observation', 'correction', 'retraction'));
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c13 CHECK (outcome IN ('passed', 'needs_help', 'invalid'));
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c14 CHECK (assistance IN ('independent', 'hinted', 'demonstrated', 'parent_confirmed'));
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c15 CHECK (assessment_source IN ('deterministic', 'asr', 'parent', 'calibrated_speech'));
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c16 CHECK ((evidence_kind='observation' AND supersedes_evidence_id IS NULL) OR (evidence_kind IN ('correction','retraction') AND supersedes_evidence_id IS NOT NULL));
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c17 CHECK ((assessment_source='parent') = (review_request_id IS NOT NULL));
ALTER TABLE app.learning_evidence ADD CONSTRAINT learning_evidence_c18 CHECK (evidence_kind<>'retraction' OR outcome='invalid');
ALTER TABLE app.mastery_snapshots ADD CONSTRAINT mastery_snapshots_c1 PRIMARY KEY (id);
ALTER TABLE app.mastery_snapshots ADD CONSTRAINT mastery_snapshots_c2 UNIQUE (family_id, id);
ALTER TABLE app.mastery_snapshots ADD CONSTRAINT mastery_snapshots_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.mastery_snapshots ADD CONSTRAINT mastery_snapshots_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.mastery_snapshots ADD CONSTRAINT mastery_snapshots_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.mastery_snapshots ADD CONSTRAINT mastery_snapshots_c6 FOREIGN KEY (family_id, objective_id, skill, modality) REFERENCES app.learning_objectives(family_id, id, skill, modality) ON DELETE RESTRICT;
ALTER TABLE app.mastery_snapshots ADD CONSTRAINT mastery_snapshots_c7 FOREIGN KEY (family_id, child_id, last_evidence_id) REFERENCES app.learning_evidence(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.mastery_snapshots ADD CONSTRAINT mastery_snapshots_c8 UNIQUE (family_id, child_id, objective_id, skill, modality);
ALTER TABLE app.mastery_snapshots ADD CONSTRAINT mastery_snapshots_c9 CHECK (evidence_count>=0 AND revision>0);
ALTER TABLE app.mastery_snapshots ADD CONSTRAINT mastery_snapshots_c10 CHECK (mastery_level IN ('unassessed', 'introduced', 'practicing', 'emerging', 'retained'));
ALTER TABLE app.item_definitions ADD CONSTRAINT item_definitions_c1 PRIMARY KEY (id);
ALTER TABLE app.item_definitions ADD CONSTRAINT item_definitions_c2 UNIQUE (family_id, id);
ALTER TABLE app.item_definitions ADD CONSTRAINT item_definitions_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.item_definitions ADD CONSTRAINT item_definitions_c4 FOREIGN KEY (family_id, asset_package_id) REFERENCES app.asset_packages(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.item_definitions ADD CONSTRAINT item_definitions_c5 UNIQUE (family_id, stable_key);
ALTER TABLE app.item_definitions ADD CONSTRAINT item_definitions_c6 CHECK (item_kind IN ('food', 'material', 'decoration', 'care'));
ALTER TABLE app.item_definitions ADD CONSTRAINT item_definitions_c7 CHECK (unit IN ('nutrition_point', 'piece'));
ALTER TABLE app.item_definitions ADD CONSTRAINT item_definitions_c8 CHECK ((item_kind='food' AND unit='nutrition_point') OR (item_kind<>'food' AND unit='piece'));
ALTER TABLE app.item_definitions ADD CONSTRAINT item_definitions_c9 CHECK (cardinality(compatible_species)>0);
ALTER TABLE app.reward_entitlements ADD CONSTRAINT reward_entitlements_c1 PRIMARY KEY (id);
ALTER TABLE app.reward_entitlements ADD CONSTRAINT reward_entitlements_c2 UNIQUE (family_id, id);
ALTER TABLE app.reward_entitlements ADD CONSTRAINT reward_entitlements_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.reward_entitlements ADD CONSTRAINT reward_entitlements_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.reward_entitlements ADD CONSTRAINT reward_entitlements_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.reward_entitlements ADD CONSTRAINT reward_entitlements_c6 FOREIGN KEY (family_id, child_id, learning_day_id) REFERENCES app.learning_days(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.reward_entitlements ADD CONSTRAINT reward_entitlements_c7 FOREIGN KEY (family_id, child_id, task_occurrence_id) REFERENCES app.task_occurrences(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.reward_entitlements ADD CONSTRAINT reward_entitlements_c8 FOREIGN KEY (family_id, child_id, weekly_plan_id) REFERENCES app.weekly_plans(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.reward_entitlements ADD CONSTRAINT reward_entitlements_c9 UNIQUE (family_id, child_id, period_kind, period_key, stable_slot);
ALTER TABLE app.reward_entitlements ADD CONSTRAINT reward_entitlements_c10 CHECK (period_kind IN ('day', 'week'));
ALTER TABLE app.reward_entitlements ADD CONSTRAINT reward_entitlements_c11 CHECK (qualification_kind IN ('task_verified', 'day_completed', 'week_goal', 'admin'));
ALTER TABLE app.reward_entitlements ADD CONSTRAINT reward_entitlements_c12 CHECK ((period_kind='day' AND learning_day_id IS NOT NULL) OR (period_kind='week' AND weekly_plan_id IS NOT NULL AND learning_day_id IS NULL AND task_occurrence_id IS NULL AND extract(isodow FROM period_key)=1));
ALTER TABLE app.reward_entitlements ADD CONSTRAINT reward_entitlements_c13 CHECK (qualified_at IS NULL OR cancelled_at IS NULL);
ALTER TABLE app.entitlement_items ADD CONSTRAINT entitlement_items_c1 PRIMARY KEY (id);
ALTER TABLE app.entitlement_items ADD CONSTRAINT entitlement_items_c2 UNIQUE (family_id, id);
ALTER TABLE app.entitlement_items ADD CONSTRAINT entitlement_items_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.entitlement_items ADD CONSTRAINT entitlement_items_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.entitlement_items ADD CONSTRAINT entitlement_items_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.entitlement_items ADD CONSTRAINT entitlement_items_c6 FOREIGN KEY (family_id, child_id, reward_entitlement_id) REFERENCES app.reward_entitlements(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.entitlement_items ADD CONSTRAINT entitlement_items_c7 FOREIGN KEY (family_id, item_definition_id) REFERENCES app.item_definitions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.entitlement_items ADD CONSTRAINT entitlement_items_c8 UNIQUE (family_id, child_id, reward_entitlement_id, item_definition_id);
ALTER TABLE app.entitlement_items ADD CONSTRAINT entitlement_items_c9 CHECK (quantity>0);
ALTER TABLE app.reward_grants ADD CONSTRAINT reward_grants_c1 PRIMARY KEY (id);
ALTER TABLE app.reward_grants ADD CONSTRAINT reward_grants_c2 UNIQUE (family_id, id);
ALTER TABLE app.reward_grants ADD CONSTRAINT reward_grants_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.reward_grants ADD CONSTRAINT reward_grants_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.reward_grants ADD CONSTRAINT reward_grants_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.reward_grants ADD CONSTRAINT reward_grants_c6 FOREIGN KEY (family_id, child_id, reward_entitlement_id) REFERENCES app.reward_entitlements(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.reward_grants ADD CONSTRAINT reward_grants_c7 FOREIGN KEY (family_id, actor_membership_id) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.reward_grants ADD CONSTRAINT reward_grants_c8 UNIQUE (family_id, child_id, reward_entitlement_id);
ALTER TABLE app.reward_grants ADD CONSTRAINT reward_grants_c9 UNIQUE (family_id, child_id, grant_key);
ALTER TABLE app.reward_grant_items ADD CONSTRAINT reward_grant_items_c1 PRIMARY KEY (id);
ALTER TABLE app.reward_grant_items ADD CONSTRAINT reward_grant_items_c2 UNIQUE (family_id, id);
ALTER TABLE app.reward_grant_items ADD CONSTRAINT reward_grant_items_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.reward_grant_items ADD CONSTRAINT reward_grant_items_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.reward_grant_items ADD CONSTRAINT reward_grant_items_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.reward_grant_items ADD CONSTRAINT reward_grant_items_c6 FOREIGN KEY (family_id, child_id, reward_grant_id) REFERENCES app.reward_grants(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.reward_grant_items ADD CONSTRAINT reward_grant_items_c7 FOREIGN KEY (family_id, item_definition_id) REFERENCES app.item_definitions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.reward_grant_items ADD CONSTRAINT reward_grant_items_c8 UNIQUE (family_id, child_id, reward_grant_id, item_definition_id);
ALTER TABLE app.reward_grant_items ADD CONSTRAINT reward_grant_items_c9 UNIQUE (family_id, child_id, item_definition_id, id);
ALTER TABLE app.reward_grant_items ADD CONSTRAINT reward_grant_items_c10 CHECK (quantity>0);
ALTER TABLE app.inventory_balances ADD CONSTRAINT inventory_balances_c1 PRIMARY KEY (id);
ALTER TABLE app.inventory_balances ADD CONSTRAINT inventory_balances_c2 UNIQUE (family_id, id);
ALTER TABLE app.inventory_balances ADD CONSTRAINT inventory_balances_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.inventory_balances ADD CONSTRAINT inventory_balances_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.inventory_balances ADD CONSTRAINT inventory_balances_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.inventory_balances ADD CONSTRAINT inventory_balances_c6 FOREIGN KEY (family_id, item_definition_id) REFERENCES app.item_definitions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.inventory_balances ADD CONSTRAINT inventory_balances_c7 UNIQUE (family_id, child_id, item_definition_id);
ALTER TABLE app.inventory_balances ADD CONSTRAINT inventory_balances_c8 CHECK (quantity>=0 AND revision>0);
ALTER TABLE app.pets ADD CONSTRAINT pets_c1 PRIMARY KEY (id);
ALTER TABLE app.pets ADD CONSTRAINT pets_c2 UNIQUE (family_id, id);
ALTER TABLE app.pets ADD CONSTRAINT pets_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.pets ADD CONSTRAINT pets_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.pets ADD CONSTRAINT pets_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pets ADD CONSTRAINT pets_c6 FOREIGN KEY (family_id, asset_package_id) REFERENCES app.asset_packages(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pets ADD CONSTRAINT pets_c7 CHECK (species IN ('dog', 'cat', 'rabbit'));
ALTER TABLE app.pets ADD CONSTRAINT pets_c8 CHECK (lifecycle IN ('active', 'retired', 'deceased_reserved'));
ALTER TABLE app.pets ADD CONSTRAINT pets_c9 CHECK (life_mode='companion');
ALTER TABLE app.pets ADD CONSTRAINT pets_c10 CHECK (lifecycle<>'deceased_reserved');
ALTER TABLE app.pet_states ADD CONSTRAINT pet_states_c1 PRIMARY KEY (id);
ALTER TABLE app.pet_states ADD CONSTRAINT pet_states_c2 UNIQUE (family_id, id);
ALTER TABLE app.pet_states ADD CONSTRAINT pet_states_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.pet_states ADD CONSTRAINT pet_states_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.pet_states ADD CONSTRAINT pet_states_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_states ADD CONSTRAINT pet_states_c6 FOREIGN KEY (family_id, child_id, pet_id) REFERENCES app.pets(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_states ADD CONSTRAINT pet_states_c7 UNIQUE (family_id, child_id, pet_id);
ALTER TABLE app.pet_states ADD CONSTRAINT pet_states_c8 CHECK (satiety_cp BETWEEN 0 AND 10000 AND hydration_cp BETWEEN 0 AND 10000 AND energy_cp BETWEEN 0 AND 10000 AND mood_cp BETWEEN 0 AND 10000 AND health_cp BETWEEN 0 AND 10000 AND hygiene_cp BETWEEN 0 AND 10000);
ALTER TABLE app.pet_states ADD CONSTRAINT pet_states_c9 CHECK (growth_points>=0 AND bond_points>=0 AND revision>0 AND decay_remainder_seconds>=0);
ALTER TABLE app.pet_states ADD CONSTRAINT pet_states_c10 CHECK (growth_stage IN ('baby', 'young', 'adult', 'elder_reserved'));
ALTER TABLE app.pet_states ADD CONSTRAINT pet_states_c11 CHECK (care_mode IN ('normal', 'resting', 'hosted'));
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c1 PRIMARY KEY (id);
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c2 UNIQUE (family_id, id);
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c6 FOREIGN KEY (family_id, item_definition_id) REFERENCES app.item_definitions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c7 FOREIGN KEY (family_id, child_id, item_definition_id, reward_grant_item_id) REFERENCES app.reward_grant_items(family_id, child_id, item_definition_id, id) ON DELETE RESTRICT;
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c8 FOREIGN KEY (family_id, child_id, pet_id) REFERENCES app.pets(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c9 FOREIGN KEY (family_id, child_id, reverses_entry_id) REFERENCES app.inventory_ledger(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c10 FOREIGN KEY (family_id, actor_membership_id) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c11 UNIQUE (family_id, child_id, operation_key);
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c12 CHECK (delta<>0);
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c13 CHECK (entry_kind IN ('reward', 'feed', 'craft', 'admin', 'compensation', 'reversal'));
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c14 CHECK ((entry_kind='reward')=(reward_grant_item_id IS NOT NULL));
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c15 CHECK (entry_kind<>'reward' OR delta>0);
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c16 CHECK (entry_kind<>'feed' OR (delta<0 AND pet_id IS NOT NULL));
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c17 CHECK ((entry_kind='reversal')=(reverses_entry_id IS NOT NULL));
ALTER TABLE app.inventory_ledger ADD CONSTRAINT inventory_ledger_c18 CHECK (entry_kind NOT IN ('admin','compensation','reversal') OR actor_membership_id IS NOT NULL);
ALTER TABLE app.pet_events ADD CONSTRAINT pet_events_c1 PRIMARY KEY (id);
ALTER TABLE app.pet_events ADD CONSTRAINT pet_events_c2 UNIQUE (family_id, id);
ALTER TABLE app.pet_events ADD CONSTRAINT pet_events_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.pet_events ADD CONSTRAINT pet_events_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.pet_events ADD CONSTRAINT pet_events_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_events ADD CONSTRAINT pet_events_c6 FOREIGN KEY (family_id, child_id, pet_id) REFERENCES app.pets(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_events ADD CONSTRAINT pet_events_c7 FOREIGN KEY (family_id, item_definition_id) REFERENCES app.item_definitions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_events ADD CONSTRAINT pet_events_c8 FOREIGN KEY (family_id, child_id, inventory_entry_id) REFERENCES app.inventory_ledger(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_events ADD CONSTRAINT pet_events_c9 UNIQUE (family_id, child_id, command_key);
ALTER TABLE app.pet_events ADD CONSTRAINT pet_events_c10 CHECK (requested_units>=0 AND applied_units>=0 AND applied_units<=requested_units AND state_revision_after>0);
ALTER TABLE app.pet_events ADD CONSTRAINT pet_events_c11 CHECK (event_kind IN ('adopt', 'feed', 'drink', 'rest', 'walk', 'clean', 'heal', 'grow', 'host', 'evaluate'));
ALTER TABLE app.pet_events ADD CONSTRAINT pet_events_c12 CHECK (jsonb_typeof(payload)='object');
ALTER TABLE app.pet_events ADD CONSTRAINT pet_events_c13 CHECK (event_kind<>'feed' OR (item_definition_id IS NOT NULL AND inventory_entry_id IS NOT NULL AND applied_units>0));
ALTER TABLE app.pet_daily_records ADD CONSTRAINT pet_daily_records_c1 PRIMARY KEY (id);
ALTER TABLE app.pet_daily_records ADD CONSTRAINT pet_daily_records_c2 UNIQUE (family_id, id);
ALTER TABLE app.pet_daily_records ADD CONSTRAINT pet_daily_records_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.pet_daily_records ADD CONSTRAINT pet_daily_records_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.pet_daily_records ADD CONSTRAINT pet_daily_records_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_daily_records ADD CONSTRAINT pet_daily_records_c6 FOREIGN KEY (family_id, child_id, pet_id) REFERENCES app.pets(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_daily_records ADD CONSTRAINT pet_daily_records_c7 FOREIGN KEY (family_id, child_id, learning_day_id) REFERENCES app.learning_days(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_daily_records ADD CONSTRAINT pet_daily_records_c8 FOREIGN KEY (family_id, outdoor_confirmed_by) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_daily_records ADD CONSTRAINT pet_daily_records_c9 UNIQUE (family_id, child_id, pet_id, learning_date);
ALTER TABLE app.pet_daily_records ADD CONSTRAINT pet_daily_records_c10 CHECK (interaction_used_seconds BETWEEN 0 AND 86400 AND revision>0);
ALTER TABLE app.hospital_cases ADD CONSTRAINT hospital_cases_c1 PRIMARY KEY (id);
ALTER TABLE app.hospital_cases ADD CONSTRAINT hospital_cases_c2 UNIQUE (family_id, id);
ALTER TABLE app.hospital_cases ADD CONSTRAINT hospital_cases_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.hospital_cases ADD CONSTRAINT hospital_cases_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.hospital_cases ADD CONSTRAINT hospital_cases_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.hospital_cases ADD CONSTRAINT hospital_cases_c6 FOREIGN KEY (family_id, child_id, pet_id) REFERENCES app.pets(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.hospital_cases ADD CONSTRAINT hospital_cases_c7 FOREIGN KEY (family_id, child_id, task_occurrence_id) REFERENCES app.task_occurrences(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.hospital_cases ADD CONSTRAINT hospital_cases_c8 CHECK (status IN ('open', 'in_care', 'recovering', 'closed'));
ALTER TABLE app.hospital_cases ADD CONSTRAINT hospital_cases_c9 CHECK (closed_at IS NULL OR closed_at>=opened_at);
ALTER TABLE app.hospital_cases ADD CONSTRAINT hospital_cases_c10 CHECK (revision>0);
ALTER TABLE app.pet_memories ADD CONSTRAINT pet_memories_c1 PRIMARY KEY (id);
ALTER TABLE app.pet_memories ADD CONSTRAINT pet_memories_c2 UNIQUE (family_id, id);
ALTER TABLE app.pet_memories ADD CONSTRAINT pet_memories_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.pet_memories ADD CONSTRAINT pet_memories_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.pet_memories ADD CONSTRAINT pet_memories_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_memories ADD CONSTRAINT pet_memories_c6 FOREIGN KEY (family_id, child_id, pet_id) REFERENCES app.pets(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_memories ADD CONSTRAINT pet_memories_c7 FOREIGN KEY (family_id, child_id, source_evidence_id) REFERENCES app.learning_evidence(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_memories ADD CONSTRAINT pet_memories_c8 FOREIGN KEY (family_id, child_id, source_event_id) REFERENCES app.pet_events(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.pet_memories ADD CONSTRAINT pet_memories_c9 UNIQUE (family_id, child_id, pet_id, memory_key);
ALTER TABLE app.pet_memories ADD CONSTRAINT pet_memories_c10 CHECK (memory_kind IN ('preference', 'milestone', 'short_story'));
ALTER TABLE app.scene_layouts ADD CONSTRAINT scene_layouts_c1 PRIMARY KEY (id);
ALTER TABLE app.scene_layouts ADD CONSTRAINT scene_layouts_c2 UNIQUE (family_id, id);
ALTER TABLE app.scene_layouts ADD CONSTRAINT scene_layouts_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.scene_layouts ADD CONSTRAINT scene_layouts_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.scene_layouts ADD CONSTRAINT scene_layouts_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.scene_layouts ADD CONSTRAINT scene_layouts_c6 FOREIGN KEY (family_id, child_id, pet_id) REFERENCES app.pets(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.scene_layouts ADD CONSTRAINT scene_layouts_c7 FOREIGN KEY (family_id, asset_package_id) REFERENCES app.asset_packages(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.scene_layouts ADD CONSTRAINT scene_layouts_c8 UNIQUE (family_id, child_id, pet_id, scene_key, layout_version);
ALTER TABLE app.scene_layouts ADD CONSTRAINT scene_layouts_c9 CHECK (layout_version>0);
ALTER TABLE app.scene_placements ADD CONSTRAINT scene_placements_c1 PRIMARY KEY (id);
ALTER TABLE app.scene_placements ADD CONSTRAINT scene_placements_c2 UNIQUE (family_id, id);
ALTER TABLE app.scene_placements ADD CONSTRAINT scene_placements_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.scene_placements ADD CONSTRAINT scene_placements_c4 UNIQUE (family_id, child_id, id);
ALTER TABLE app.scene_placements ADD CONSTRAINT scene_placements_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.scene_placements ADD CONSTRAINT scene_placements_c6 FOREIGN KEY (family_id, child_id, scene_layout_id) REFERENCES app.scene_layouts(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.scene_placements ADD CONSTRAINT scene_placements_c7 FOREIGN KEY (family_id, item_definition_id) REFERENCES app.item_definitions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.scene_placements ADD CONSTRAINT scene_placements_c8 UNIQUE (family_id, child_id, scene_layout_id, slot_key);
ALTER TABLE app.scene_placements ADD CONSTRAINT scene_placements_c9 CHECK (position_x BETWEEN 0 AND 1 AND position_y BETWEEN 0 AND 1 AND scale>0 AND scale<=4);
ALTER TABLE app.slice_media_bindings ADD CONSTRAINT slice_media_bindings_c1 PRIMARY KEY (id);
ALTER TABLE app.slice_media_bindings ADD CONSTRAINT slice_media_bindings_c2 UNIQUE (family_id, id);
ALTER TABLE app.slice_media_bindings ADD CONSTRAINT slice_media_bindings_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.slice_media_bindings ADD CONSTRAINT slice_media_bindings_c4 FOREIGN KEY (family_id, content_version_id, slice_id) REFERENCES app.source_slices(family_id, content_version_id, id) ON DELETE RESTRICT;
ALTER TABLE app.slice_media_bindings ADD CONSTRAINT slice_media_bindings_c5 FOREIGN KEY (family_id, media_asset_id) REFERENCES app.media_assets(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.slice_media_bindings ADD CONSTRAINT slice_media_bindings_c6 UNIQUE (family_id, slice_id, binding_role, ordinal);
ALTER TABLE app.slice_media_bindings ADD CONSTRAINT slice_media_bindings_c7 CHECK (binding_role IN ('page_image', 'illustration', 'reference_audio', 'synthetic_audio', 'source_document'));
ALTER TABLE app.slice_media_bindings ADD CONSTRAINT slice_media_bindings_c8 CHECK (ordinal>=0);
ALTER TABLE app.slice_media_bindings ADD CONSTRAINT slice_media_bindings_c9 CHECK ((num_nonnulls(start_ms,end_ms)=0) OR (num_nonnulls(start_ms,end_ms)=2 AND start_ms>=0 AND end_ms>start_ms));
ALTER TABLE app.slice_media_bindings ADD CONSTRAINT slice_media_bindings_c10 CHECK ((num_nonnulls(region_x,region_y,region_w,region_h)=0) OR (num_nonnulls(region_x,region_y,region_w,region_h)=4 AND region_x>=0 AND region_y>=0 AND region_w>0 AND region_h>0 AND region_x+region_w<=1 AND region_y+region_h<=1));
ALTER TABLE app.background_jobs ADD CONSTRAINT background_jobs_c1 PRIMARY KEY (id);
ALTER TABLE app.background_jobs ADD CONSTRAINT background_jobs_c2 UNIQUE (family_id, id);
ALTER TABLE app.background_jobs ADD CONSTRAINT background_jobs_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.background_jobs ADD CONSTRAINT background_jobs_c4 UNIQUE (family_id, job_kind, dedupe_key);
ALTER TABLE app.background_jobs ADD CONSTRAINT background_jobs_c5 CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'));
ALTER TABLE app.background_jobs ADD CONSTRAINT background_jobs_c6 CHECK (attempts>=0 AND max_attempts>0 AND attempts<=max_attempts AND input_schema_version>0);
ALTER TABLE app.background_jobs ADD CONSTRAINT background_jobs_c7 CHECK (jsonb_typeof(payload)='object');
ALTER TABLE app.background_jobs ADD CONSTRAINT background_jobs_c8 CHECK (status<>'running' OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL));
ALTER TABLE app.outbox_events ADD CONSTRAINT outbox_events_c1 PRIMARY KEY (id);
ALTER TABLE app.outbox_events ADD CONSTRAINT outbox_events_c2 UNIQUE (family_id, id);
ALTER TABLE app.outbox_events ADD CONSTRAINT outbox_events_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.outbox_events ADD CONSTRAINT outbox_events_c4 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.outbox_events ADD CONSTRAINT outbox_events_c5 UNIQUE (sequence_no);
ALTER TABLE app.outbox_events ADD CONSTRAINT outbox_events_c6 UNIQUE (family_id, sequence_no);
ALTER TABLE app.outbox_events ADD CONSTRAINT outbox_events_c7 UNIQUE (family_id, event_key);
ALTER TABLE app.outbox_events ADD CONSTRAINT outbox_events_c8 CHECK (aggregate_revision>0 AND schema_version>0);
ALTER TABLE app.outbox_events ADD CONSTRAINT outbox_events_c9 CHECK (jsonb_typeof(payload)='object');
ALTER TABLE app.idempotency_records ADD CONSTRAINT idempotency_records_c1 PRIMARY KEY (id);
ALTER TABLE app.idempotency_records ADD CONSTRAINT idempotency_records_c2 UNIQUE (family_id, id);
ALTER TABLE app.idempotency_records ADD CONSTRAINT idempotency_records_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.idempotency_records ADD CONSTRAINT idempotency_records_c4 FOREIGN KEY (family_id, device_id) REFERENCES app.devices(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.idempotency_records ADD CONSTRAINT idempotency_records_c5 FOREIGN KEY (family_id, membership_id) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.idempotency_records ADD CONSTRAINT idempotency_records_c6 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.idempotency_records ADD CONSTRAINT idempotency_records_c7 UNIQUE (family_id, operation, idempotency_key);
ALTER TABLE app.idempotency_records ADD CONSTRAINT idempotency_records_c8 CHECK (num_nonnulls(device_id,membership_id)>0);
ALTER TABLE app.idempotency_records ADD CONSTRAINT idempotency_records_c9 CHECK (request_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE app.idempotency_records ADD CONSTRAINT idempotency_records_c10 CHECK (status IN ('processing', 'completed'));
ALTER TABLE app.idempotency_records ADD CONSTRAINT idempotency_records_c11 CHECK ((status='processing' AND http_status IS NULL AND response_body IS NULL) OR (status='completed' AND http_status BETWEEN 100 AND 599 AND response_body IS NOT NULL));
ALTER TABLE app.idempotency_records ADD CONSTRAINT idempotency_records_c12 CHECK (expires_at>created_at);
ALTER TABLE app.audit_events ADD CONSTRAINT audit_events_c1 PRIMARY KEY (id);
ALTER TABLE app.audit_events ADD CONSTRAINT audit_events_c2 UNIQUE (family_id, id);
ALTER TABLE app.audit_events ADD CONSTRAINT audit_events_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.audit_events ADD CONSTRAINT audit_events_c4 FOREIGN KEY (family_id, actor_membership_id) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.audit_events ADD CONSTRAINT audit_events_c5 FOREIGN KEY (family_id, device_id) REFERENCES app.devices(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.audit_events ADD CONSTRAINT audit_events_c6 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.audit_events ADD CONSTRAINT audit_events_c7 CHECK (jsonb_typeof(metadata)='object');
ALTER TABLE app.device_pairings ADD CONSTRAINT device_pairings_c1 PRIMARY KEY (id);
ALTER TABLE app.device_pairings ADD CONSTRAINT device_pairings_c2 UNIQUE (family_id, id);
ALTER TABLE app.device_pairings ADD CONSTRAINT device_pairings_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.device_pairings ADD CONSTRAINT device_pairings_c4 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.device_pairings ADD CONSTRAINT device_pairings_c5 FOREIGN KEY (family_id, display_device_id) REFERENCES app.devices(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.device_pairings ADD CONSTRAINT device_pairings_c6 FOREIGN KEY (family_id, companion_device_id) REFERENCES app.devices(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.device_pairings ADD CONSTRAINT device_pairings_c7 FOREIGN KEY (family_id, child_id, challenge_session_id) REFERENCES app.challenge_sessions(family_id, child_id, id) ON DELETE RESTRICT;
ALTER TABLE app.device_pairings ADD CONSTRAINT device_pairings_c8 FOREIGN KEY (family_id, confirmed_by) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.device_pairings ADD CONSTRAINT device_pairings_c9 UNIQUE (code_digest);
ALTER TABLE app.device_pairings ADD CONSTRAINT device_pairings_c10 CHECK (attempts BETWEEN 0 AND 10 AND expires_at>created_at);
ALTER TABLE app.device_pairings ADD CONSTRAINT device_pairings_c11 CHECK (status IN ('pending', 'confirmed', 'expired', 'revoked'));
ALTER TABLE app.device_pairings ADD CONSTRAINT device_pairings_c12 CHECK (status<>'confirmed' OR (companion_device_id IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL));
ALTER TABLE app.device_pairings ADD CONSTRAINT device_pairings_c13 CHECK (companion_device_id IS NULL OR companion_device_id<>display_device_id);
ALTER TABLE app.sync_cursors ADD CONSTRAINT sync_cursors_c1 PRIMARY KEY (id);
ALTER TABLE app.sync_cursors ADD CONSTRAINT sync_cursors_c2 UNIQUE (family_id, id);
ALTER TABLE app.sync_cursors ADD CONSTRAINT sync_cursors_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.sync_cursors ADD CONSTRAINT sync_cursors_c4 FOREIGN KEY (family_id, device_id) REFERENCES app.devices(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.sync_cursors ADD CONSTRAINT sync_cursors_c5 FOREIGN KEY (family_id, child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.sync_cursors ADD CONSTRAINT sync_cursors_c6 FOREIGN KEY (family_id, last_sequence_no) REFERENCES app.outbox_events(family_id, sequence_no) ON DELETE RESTRICT;
ALTER TABLE app.sync_cursors ADD CONSTRAINT sync_cursors_c7 UNIQUE (family_id, device_id);
ALTER TABLE app.sync_cursors ADD CONSTRAINT sync_cursors_c8 CHECK (client_schema_version>0 AND revision>0);
ALTER TABLE app.family_settings ADD CONSTRAINT family_settings_c1 PRIMARY KEY (id);
ALTER TABLE app.family_settings ADD CONSTRAINT family_settings_c2 UNIQUE (family_id, id);
ALTER TABLE app.family_settings ADD CONSTRAINT family_settings_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.family_settings ADD CONSTRAINT family_settings_c4 FOREIGN KEY (family_id, changed_by) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.family_settings ADD CONSTRAINT family_settings_c5 UNIQUE (family_id, version_no);
ALTER TABLE app.family_settings ADD CONSTRAINT family_settings_c6 CHECK (version_no>0 AND schema_version>0);
ALTER TABLE app.family_settings ADD CONSTRAINT family_settings_c7 CHECK (jsonb_typeof(policy)='object');
ALTER TABLE app.family_settings ADD CONSTRAINT family_settings_c8 CHECK (NOT (policy ?| ARRAY['api_key','token','password','secret','script','javascript']));
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c1 PRIMARY KEY (id);
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c2 UNIQUE (family_id, id);
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c4 FOREIGN KEY (family_id, question_version_id) REFERENCES app.question_versions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c5 FOREIGN KEY (family_id, media_asset_id) REFERENCES app.media_assets(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c6 FOREIGN KEY (family_id, source_slice_id) REFERENCES app.source_slices(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c7 FOREIGN KEY (family_id, reporter_child_id) REFERENCES app.children(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c8 FOREIGN KEY (family_id, reporter_membership_id) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c9 FOREIGN KEY (family_id, device_id) REFERENCES app.devices(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c10 FOREIGN KEY (family_id, resolved_by) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c11 FOREIGN KEY (family_id, replacement_question_version_id) REFERENCES app.question_versions(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c12 CHECK (num_nonnulls(question_version_id,media_asset_id,source_slice_id)=1);
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c13 CHECK (num_nonnulls(reporter_child_id,reporter_membership_id,device_id)>0);
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c14 CHECK (revision>0);
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c15 CHECK (issue_kind IN ('wrong_answer', 'ambiguous', 'out_of_scope', 'media_error', 'source_error', 'other'));
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c16 CHECK (status IN ('open', 'triaged', 'resolved', 'dismissed'));
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c17 CHECK ((status IN ('open','triaged') AND resolved_at IS NULL AND resolved_by IS NULL) OR (status IN ('resolved','dismissed') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL));
ALTER TABLE app.content_issues ADD CONSTRAINT content_issues_c18 CHECK (replacement_question_version_id IS NULL OR (question_version_id IS NOT NULL AND replacement_question_version_id<>question_version_id));
ALTER TABLE app.ai_provider_configs ADD CONSTRAINT ai_provider_configs_c1 PRIMARY KEY (id);
ALTER TABLE app.ai_provider_configs ADD CONSTRAINT ai_provider_configs_c2 UNIQUE (family_id, id);
ALTER TABLE app.ai_provider_configs ADD CONSTRAINT ai_provider_configs_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.ai_provider_configs ADD CONSTRAINT ai_provider_configs_c4 FOREIGN KEY (family_id, created_by) REFERENCES app.family_memberships(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.ai_provider_configs ADD CONSTRAINT ai_provider_configs_c5 UNIQUE (family_id, config_key);
ALTER TABLE app.ai_provider_configs ADD CONSTRAINT ai_provider_configs_c6 CHECK (capability IN ('generation', 'qa', 'asr', 'tts', 'pet_dialogue', 'image_generation'));
ALTER TABLE app.ai_provider_configs ADD CONSTRAINT ai_provider_configs_c7 CHECK (status IN ('active', 'disabled'));
ALTER TABLE app.ai_provider_configs ADD CONSTRAINT ai_provider_configs_c8 CHECK (endpoint_url ~ '^https?://' AND position('@' IN endpoint_url)=0 AND position('?' IN endpoint_url)=0 AND position('#' IN endpoint_url)=0);
ALTER TABLE app.ai_provider_configs ADD CONSTRAINT ai_provider_configs_c9 CHECK (secret_ref IS NULL OR secret_ref ~ '^[A-Za-z][A-Za-z0-9_:/.-]{0,199}$');
ALTER TABLE app.ai_provider_configs ADD CONSTRAINT ai_provider_configs_c10 CHECK (daily_budget_microunits>=0 AND timeout_seconds BETWEEN 1 AND 600 AND max_concurrent_calls BETWEEN 1 AND 16 AND revision>0 AND options_schema_version>0);
ALTER TABLE app.ai_provider_configs ADD CONSTRAINT ai_provider_configs_c11 CHECK (jsonb_typeof(options)='object' AND NOT (options ?| ARRAY['api_key','token','password','secret','authorization','script','javascript']));
ALTER TABLE app.ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_c1 PRIMARY KEY (id);
ALTER TABLE app.ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_c2 UNIQUE (family_id, id);
ALTER TABLE app.ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_c4 FOREIGN KEY (family_id, ai_provider_config_id) REFERENCES app.ai_provider_configs(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_c5 FOREIGN KEY (family_id, generation_run_id) REFERENCES app.generation_runs(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_c6 FOREIGN KEY (family_id, background_job_id) REFERENCES app.background_jobs(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_c7 UNIQUE (family_id, reservation_key);
ALTER TABLE app.ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_c8 CHECK (num_nonnulls(generation_run_id,background_job_id)=1);
ALTER TABLE app.ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_c9 CHECK (provider_revision>0 AND reserved_microunits>=0 AND (settled_microunits IS NULL OR settled_microunits BETWEEN 0 AND reserved_microunits) AND revision>0);
ALTER TABLE app.ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_c10 CHECK (status IN ('reserved', 'settled', 'released'));
ALTER TABLE app.ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_c11 CHECK ((status='reserved' AND settled_microunits IS NULL AND resolved_at IS NULL) OR (status='settled' AND settled_microunits IS NOT NULL AND resolved_at IS NOT NULL) OR (status='released' AND settled_microunits=0 AND resolved_at IS NOT NULL));
ALTER TABLE app.ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_c12 CHECK (expires_at>created_at);
ALTER TABLE app.outbox_deliveries ADD CONSTRAINT outbox_deliveries_c1 PRIMARY KEY (id);
ALTER TABLE app.outbox_deliveries ADD CONSTRAINT outbox_deliveries_c2 UNIQUE (family_id, id);
ALTER TABLE app.outbox_deliveries ADD CONSTRAINT outbox_deliveries_c3 FOREIGN KEY (family_id) REFERENCES app.families(id) ON DELETE RESTRICT;
ALTER TABLE app.outbox_deliveries ADD CONSTRAINT outbox_deliveries_c4 FOREIGN KEY (family_id, outbox_event_id) REFERENCES app.outbox_events(family_id, id) ON DELETE RESTRICT;
ALTER TABLE app.outbox_deliveries ADD CONSTRAINT outbox_deliveries_c5 UNIQUE (family_id, consumer_key, outbox_event_id);
ALTER TABLE app.outbox_deliveries ADD CONSTRAINT outbox_deliveries_c6 CHECK (status IN ('queued', 'inflight', 'delivered', 'dead'));
ALTER TABLE app.outbox_deliveries ADD CONSTRAINT outbox_deliveries_c7 CHECK (attempts>=0 AND max_attempts>0 AND attempts<=max_attempts AND revision>0);
ALTER TABLE app.outbox_deliveries ADD CONSTRAINT outbox_deliveries_c8 CHECK (status<>'inflight' OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL));
ALTER TABLE app.outbox_deliveries ADD CONSTRAINT outbox_deliveries_c9 CHECK ((status='delivered')=(delivered_at IS NOT NULL));
CREATE INDEX settings_active_version ON app.family_settings (family_id, effective_from, version_no) WHERE published_at IS NOT NULL AND retired_at IS NULL;
CREATE INDEX content_issue_inbox ON app.content_issues (family_id, status, created_at) WHERE status IN ('open','triaged');
CREATE UNIQUE INDEX budget_one_run ON app.ai_budget_reservations (family_id, ai_provider_config_id, generation_run_id) WHERE generation_run_id IS NOT NULL;
CREATE UNIQUE INDEX budget_one_job ON app.ai_budget_reservations (family_id, ai_provider_config_id, background_job_id) WHERE background_job_id IS NOT NULL;
CREATE INDEX budget_daily_usage ON app.ai_budget_reservations (family_id, ai_provider_config_id, budget_date, status);
CREATE INDEX delivery_ready ON app.outbox_deliveries (family_id, consumer_key, available_at, id) WHERE status='queued';
CREATE INDEX delivery_expired ON app.outbox_deliveries (family_id, lease_until) WHERE status='inflight';
CREATE INDEX members_active ON app.family_memberships (family_id, account_id) WHERE status='active';
CREATE UNIQUE INDEX import_active_digest ON app.import_jobs (family_id, edition_id, input_digest) WHERE stage<>'failed';
CREATE INDEX question_live_objective ON app.question_versions (family_id, objective_id, question_type) WHERE published_at IS NOT NULL AND retired_at IS NULL;
CREATE UNIQUE INDEX active_verification_task ON app.challenge_sessions (family_id, child_id, task_occurrence_id) WHERE mode='verification' AND status IN ('created','active','submitted','pending_review');
CREATE UNIQUE INDEX evidence_one_observation ON app.learning_evidence (family_id, child_id, answer_attempt_id, objective_id) WHERE evidence_kind='observation';
CREATE UNIQUE INDEX pet_event_one_ledger ON app.pet_events (family_id, child_id, inventory_entry_id) WHERE inventory_entry_id IS NOT NULL;
CREATE UNIQUE INDEX evidence_one_successor ON app.learning_evidence (family_id, child_id, supersedes_evidence_id) WHERE supersedes_evidence_id IS NOT NULL;
CREATE UNIQUE INDEX reward_one_ledger ON app.inventory_ledger (family_id, child_id, reward_grant_item_id) WHERE reward_grant_item_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_one_reversal ON app.inventory_ledger (family_id, child_id, reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE UNIQUE INDEX one_active_pet ON app.pets (family_id, child_id) WHERE lifecycle='active';
CREATE UNIQUE INDEX one_open_hospital ON app.hospital_cases (family_id, child_id, pet_id) WHERE status<>'closed';
CREATE UNIQUE INDEX one_current_layout ON app.scene_layouts (family_id, child_id, pet_id, scene_key) WHERE is_current;
CREATE INDEX ledger_history ON app.inventory_ledger (family_id, child_id, item_definition_id, occurred_at, id);
CREATE INDEX evidence_objective ON app.learning_evidence (family_id, child_id, objective_id, observed_at);
CREATE INDEX exposure_lookup ON app.exposure_slices (family_id, child_id, slice_id);
CREATE INDEX review_inbox ON app.review_requests (family_id, status, created_at) WHERE status='pending';
CREATE INDEX job_ready ON app.background_jobs (family_id, available_at, id) WHERE status='queued';
CREATE INDEX job_expired ON app.background_jobs (family_id, lease_until) WHERE status='running';
CREATE INDEX outbox_pending ON app.outbox_events (family_id, sequence_no) WHERE delivered_at IS NULL;
CREATE INDEX task_day ON app.task_occurrences (family_id, child_id, learning_day_id, status);
CREATE INDEX media_retention ON app.media_assets (family_id, retention_until) WHERE status<>'deleted' AND retention_until IS NOT NULL;
CREATE INDEX family_memberships_fk1 ON app.family_memberships (account_id);
CREATE INDEX devices_fk1 ON app.devices (family_id, bound_child_id);
CREATE INDEX auth_sessions_fk1 ON app.auth_sessions (family_id, device_id);
CREATE INDEX auth_sessions_fk2 ON app.auth_sessions (family_id, membership_id);
CREATE INDEX auth_sessions_fk3 ON app.auth_sessions (family_id, child_id);
CREATE INDEX media_assets_fk1 ON app.media_assets (family_id, child_id);
CREATE INDEX curriculum_editions_fk1 ON app.curriculum_editions (family_id, series_id);
CREATE INDEX content_versions_fk1 ON app.content_versions (family_id, edition_id);
CREATE INDEX content_versions_fk2 ON app.content_versions (family_id, source_media_id);
CREATE INDEX content_nodes_fk1 ON app.content_nodes (family_id, content_version_id);
CREATE INDEX content_nodes_fk2 ON app.content_nodes (family_id, content_version_id, parent_id);
CREATE INDEX source_slices_fk1 ON app.source_slices (family_id, content_version_id, node_id);
CREATE INDEX source_slices_fk2 ON app.source_slices (family_id, source_media_id);
CREATE INDEX source_slices_fk3 ON app.source_slices (family_id, image_media_id);
CREATE INDEX source_slices_fk4 ON app.source_slices (family_id, audio_media_id);
CREATE INDEX slice_contexts_fk1 ON app.slice_contexts (family_id, content_version_id, slice_id);
CREATE INDEX slice_contexts_fk2 ON app.slice_contexts (family_id, content_version_id, context_slice_id);
CREATE INDEX learning_objectives_fk1 ON app.learning_objectives (family_id, vocabulary_sense_id);
CREATE INDEX slice_objectives_fk1 ON app.slice_objectives (family_id, content_version_id, slice_id);
CREATE INDEX slice_objectives_fk2 ON app.slice_objectives (family_id, objective_id);
CREATE INDEX import_jobs_fk1 ON app.import_jobs (family_id, edition_id);
CREATE INDEX import_jobs_fk2 ON app.import_jobs (family_id, source_media_id);
CREATE INDEX import_jobs_fk3 ON app.import_jobs (family_id, output_content_version_id);
CREATE INDEX import_jobs_fk4 ON app.import_jobs (family_id, requested_by);
CREATE INDEX generation_runs_fk1 ON app.generation_runs (family_id, content_version_id);
CREATE INDEX generation_runs_fk2 ON app.generation_runs (family_id, requested_by);
CREATE INDEX generation_inputs_fk1 ON app.generation_inputs (family_id, content_version_id, generation_run_id);
CREATE INDEX generation_inputs_fk2 ON app.generation_inputs (family_id, content_version_id, slice_id);
CREATE INDEX question_families_fk1 ON app.question_families (family_id, objective_id);
CREATE INDEX question_versions_fk1 ON app.question_versions (family_id, objective_id, question_family_id);
CREATE INDEX question_versions_fk2 ON app.question_versions (family_id, content_version_id);
CREATE INDEX question_versions_fk3 ON app.question_versions (family_id, content_version_id, generation_run_id);
CREATE INDEX question_versions_fk4 ON app.question_versions (family_id, image_media_id);
CREATE INDEX question_versions_fk5 ON app.question_versions (family_id, audio_media_id);
CREATE INDEX question_sources_fk1 ON app.question_sources (family_id, content_version_id, question_version_id);
CREATE INDEX question_sources_fk2 ON app.question_sources (family_id, content_version_id, slice_id);
CREATE INDEX question_options_fk1 ON app.question_options (family_id, question_version_id);
CREATE INDEX question_options_fk2 ON app.question_options (family_id, image_media_id);
CREATE INDEX question_options_fk3 ON app.question_options (family_id, audio_media_id);
CREATE INDEX question_answers_fk1 ON private.question_answers (family_id, question_version_id);
CREATE INDEX question_answers_fk2 ON private.question_answers (family_id, question_version_id, option_id);
CREATE INDEX question_answers_fk3 ON private.question_answers (family_id, question_version_id, match_option_id);
CREATE INDEX asset_packages_fk1 ON app.asset_packages (family_id, manifest_media_id);
CREATE INDEX package_assets_fk1 ON app.package_assets (family_id, asset_package_id);
CREATE INDEX package_assets_fk2 ON app.package_assets (family_id, media_asset_id);
CREATE INDEX quality_reports_fk1 ON app.quality_reports (family_id, content_version_id);
CREATE INDEX quality_reports_fk2 ON app.quality_reports (family_id, question_version_id);
CREATE INDEX quality_reports_fk3 ON app.quality_reports (family_id, generation_run_id);
CREATE INDEX quality_reports_fk4 ON app.quality_reports (family_id, asset_package_id);
CREATE INDEX quality_reports_fk5 ON app.quality_reports (family_id, reviewer_membership_id);
CREATE INDEX content_releases_fk1 ON app.content_releases (family_id, content_version_id);
CREATE INDEX content_releases_fk2 ON app.content_releases (family_id, released_by);
CREATE INDEX release_questions_fk1 ON app.release_questions (family_id, content_version_id, content_release_id);
CREATE INDEX release_questions_fk2 ON app.release_questions (family_id, content_version_id, question_version_id);
CREATE INDEX weekly_plans_fk1 ON app.weekly_plans (family_id, child_id);
CREATE INDEX plan_revisions_fk1 ON app.plan_revisions (family_id, child_id);
CREATE INDEX plan_revisions_fk2 ON app.plan_revisions (family_id, child_id, weekly_plan_id);
CREATE INDEX plan_revisions_fk3 ON app.plan_revisions (family_id, published_by);
CREATE INDEX learning_days_fk1 ON app.learning_days (family_id, child_id);
CREATE INDEX learning_days_fk2 ON app.learning_days (family_id, child_id, plan_revision_id);
CREATE INDEX task_occurrences_fk1 ON app.task_occurrences (family_id, child_id);
CREATE INDEX task_occurrences_fk2 ON app.task_occurrences (family_id, child_id, plan_revision_id);
CREATE INDEX task_occurrences_fk3 ON app.task_occurrences (family_id, child_id, learning_day_id);
CREATE INDEX task_occurrences_fk4 ON app.task_occurrences (family_id, child_id, supersedes_task_id);
CREATE INDEX task_scopes_fk1 ON app.task_scopes (family_id, child_id);
CREATE INDEX task_scopes_fk2 ON app.task_scopes (family_id, child_id, plan_revision_id, task_occurrence_id);
CREATE INDEX task_scopes_fk3 ON app.task_scopes (family_id, content_version_id, slice_id);
CREATE INDEX task_scopes_fk4 ON app.task_scopes (family_id, content_version_id, content_release_id);
CREATE INDEX task_requirements_fk1 ON app.task_requirements (family_id, child_id);
CREATE INDEX task_requirements_fk2 ON app.task_requirements (family_id, child_id, plan_revision_id, task_occurrence_id);
CREATE INDEX task_requirements_fk3 ON app.task_requirements (family_id, objective_id, skill, modality);
CREATE INDEX study_exposures_fk1 ON app.study_exposures (family_id, child_id);
CREATE INDEX study_exposures_fk2 ON app.study_exposures (family_id, child_id, task_occurrence_id);
CREATE INDEX study_exposures_fk3 ON app.study_exposures (family_id, device_id);
CREATE INDEX study_exposures_fk4 ON app.study_exposures (family_id, declared_by);
CREATE INDEX exposure_slices_fk1 ON app.exposure_slices (family_id, child_id);
CREATE INDEX exposure_slices_fk2 ON app.exposure_slices (family_id, child_id, study_exposure_id);
CREATE INDEX exposure_slices_fk3 ON app.exposure_slices (family_id, content_version_id, slice_id);
CREATE INDEX challenge_sessions_fk1 ON app.challenge_sessions (family_id, child_id);
CREATE INDEX challenge_sessions_fk2 ON app.challenge_sessions (family_id, child_id, task_occurrence_id);
CREATE INDEX challenge_sessions_fk3 ON app.challenge_sessions (family_id, child_id, learning_day_id);
CREATE INDEX challenge_sessions_fk4 ON app.challenge_sessions (family_id, device_id);
CREATE INDEX challenge_items_fk1 ON app.challenge_items (family_id, child_id);
CREATE INDEX challenge_items_fk2 ON app.challenge_items (family_id, child_id, challenge_session_id);
CREATE INDEX challenge_items_fk3 ON app.challenge_items (family_id, objective_id, question_version_id);
CREATE INDEX challenge_items_fk4 ON app.challenge_items (family_id, child_id, task_requirement_id);
CREATE INDEX answer_attempts_fk1 ON app.answer_attempts (family_id, child_id);
CREATE INDEX answer_attempts_fk2 ON app.answer_attempts (family_id, child_id, challenge_session_id, challenge_item_id);
CREATE INDEX answer_attempts_fk3 ON app.answer_attempts (family_id, child_id, recording_media_id);
CREATE INDEX answer_attempts_fk4 ON app.answer_attempts (family_id, device_id);
CREATE INDEX review_requests_fk1 ON app.review_requests (family_id, child_id);
CREATE INDEX review_requests_fk2 ON app.review_requests (family_id, child_id, answer_attempt_id);
CREATE INDEX review_requests_fk3 ON app.review_requests (family_id, reviewed_by);
CREATE INDEX learning_evidence_fk1 ON app.learning_evidence (family_id, child_id);
CREATE INDEX learning_evidence_fk2 ON app.learning_evidence (family_id, objective_id, skill, modality);
CREATE INDEX learning_evidence_fk3 ON app.learning_evidence (family_id, child_id, answer_attempt_id);
CREATE INDEX learning_evidence_fk4 ON app.learning_evidence (family_id, child_id, review_request_id);
CREATE INDEX learning_evidence_fk5 ON app.learning_evidence (family_id, child_id, task_occurrence_id);
CREATE INDEX learning_evidence_fk6 ON app.learning_evidence (family_id, child_id, supersedes_evidence_id);
CREATE INDEX mastery_snapshots_fk1 ON app.mastery_snapshots (family_id, child_id);
CREATE INDEX mastery_snapshots_fk2 ON app.mastery_snapshots (family_id, objective_id, skill, modality);
CREATE INDEX mastery_snapshots_fk3 ON app.mastery_snapshots (family_id, child_id, last_evidence_id);
CREATE INDEX item_definitions_fk1 ON app.item_definitions (family_id, asset_package_id);
CREATE INDEX reward_entitlements_fk1 ON app.reward_entitlements (family_id, child_id);
CREATE INDEX reward_entitlements_fk2 ON app.reward_entitlements (family_id, child_id, learning_day_id);
CREATE INDEX reward_entitlements_fk3 ON app.reward_entitlements (family_id, child_id, task_occurrence_id);
CREATE INDEX reward_entitlements_fk4 ON app.reward_entitlements (family_id, child_id, weekly_plan_id);
CREATE INDEX entitlement_items_fk1 ON app.entitlement_items (family_id, child_id);
CREATE INDEX entitlement_items_fk2 ON app.entitlement_items (family_id, child_id, reward_entitlement_id);
CREATE INDEX entitlement_items_fk3 ON app.entitlement_items (family_id, item_definition_id);
CREATE INDEX reward_grants_fk1 ON app.reward_grants (family_id, child_id);
CREATE INDEX reward_grants_fk2 ON app.reward_grants (family_id, child_id, reward_entitlement_id);
CREATE INDEX reward_grants_fk3 ON app.reward_grants (family_id, actor_membership_id);
CREATE INDEX reward_grant_items_fk1 ON app.reward_grant_items (family_id, child_id);
CREATE INDEX reward_grant_items_fk2 ON app.reward_grant_items (family_id, child_id, reward_grant_id);
CREATE INDEX reward_grant_items_fk3 ON app.reward_grant_items (family_id, item_definition_id);
CREATE INDEX inventory_balances_fk1 ON app.inventory_balances (family_id, child_id);
CREATE INDEX inventory_balances_fk2 ON app.inventory_balances (family_id, item_definition_id);
CREATE INDEX pets_fk1 ON app.pets (family_id, child_id);
CREATE INDEX pets_fk2 ON app.pets (family_id, asset_package_id);
CREATE INDEX pet_states_fk1 ON app.pet_states (family_id, child_id);
CREATE INDEX pet_states_fk2 ON app.pet_states (family_id, child_id, pet_id);
CREATE INDEX inventory_ledger_fk1 ON app.inventory_ledger (family_id, child_id);
CREATE INDEX inventory_ledger_fk2 ON app.inventory_ledger (family_id, item_definition_id);
CREATE INDEX inventory_ledger_fk3 ON app.inventory_ledger (family_id, child_id, item_definition_id, reward_grant_item_id);
CREATE INDEX inventory_ledger_fk4 ON app.inventory_ledger (family_id, child_id, pet_id);
CREATE INDEX inventory_ledger_fk5 ON app.inventory_ledger (family_id, child_id, reverses_entry_id);
CREATE INDEX inventory_ledger_fk6 ON app.inventory_ledger (family_id, actor_membership_id);
CREATE INDEX pet_events_fk1 ON app.pet_events (family_id, child_id);
CREATE INDEX pet_events_fk2 ON app.pet_events (family_id, child_id, pet_id);
CREATE INDEX pet_events_fk3 ON app.pet_events (family_id, item_definition_id);
CREATE INDEX pet_events_fk4 ON app.pet_events (family_id, child_id, inventory_entry_id);
CREATE INDEX pet_daily_records_fk1 ON app.pet_daily_records (family_id, child_id);
CREATE INDEX pet_daily_records_fk2 ON app.pet_daily_records (family_id, child_id, pet_id);
CREATE INDEX pet_daily_records_fk3 ON app.pet_daily_records (family_id, child_id, learning_day_id);
CREATE INDEX pet_daily_records_fk4 ON app.pet_daily_records (family_id, outdoor_confirmed_by);
CREATE INDEX hospital_cases_fk1 ON app.hospital_cases (family_id, child_id);
CREATE INDEX hospital_cases_fk2 ON app.hospital_cases (family_id, child_id, pet_id);
CREATE INDEX hospital_cases_fk3 ON app.hospital_cases (family_id, child_id, task_occurrence_id);
CREATE INDEX pet_memories_fk1 ON app.pet_memories (family_id, child_id);
CREATE INDEX pet_memories_fk2 ON app.pet_memories (family_id, child_id, pet_id);
CREATE INDEX pet_memories_fk3 ON app.pet_memories (family_id, child_id, source_evidence_id);
CREATE INDEX pet_memories_fk4 ON app.pet_memories (family_id, child_id, source_event_id);
CREATE INDEX scene_layouts_fk1 ON app.scene_layouts (family_id, child_id);
CREATE INDEX scene_layouts_fk2 ON app.scene_layouts (family_id, child_id, pet_id);
CREATE INDEX scene_layouts_fk3 ON app.scene_layouts (family_id, asset_package_id);
CREATE INDEX scene_placements_fk1 ON app.scene_placements (family_id, child_id);
CREATE INDEX scene_placements_fk2 ON app.scene_placements (family_id, child_id, scene_layout_id);
CREATE INDEX scene_placements_fk3 ON app.scene_placements (family_id, item_definition_id);
CREATE INDEX slice_media_bindings_fk1 ON app.slice_media_bindings (family_id, content_version_id, slice_id);
CREATE INDEX slice_media_bindings_fk2 ON app.slice_media_bindings (family_id, media_asset_id);
CREATE INDEX outbox_events_fk1 ON app.outbox_events (family_id, child_id);
CREATE INDEX idempotency_records_fk1 ON app.idempotency_records (family_id, device_id);
CREATE INDEX idempotency_records_fk2 ON app.idempotency_records (family_id, membership_id);
CREATE INDEX idempotency_records_fk3 ON app.idempotency_records (family_id, child_id);
CREATE INDEX audit_events_fk1 ON app.audit_events (family_id, actor_membership_id);
CREATE INDEX audit_events_fk2 ON app.audit_events (family_id, device_id);
CREATE INDEX audit_events_fk3 ON app.audit_events (family_id, child_id);
CREATE INDEX device_pairings_fk1 ON app.device_pairings (family_id, child_id);
CREATE INDEX device_pairings_fk2 ON app.device_pairings (family_id, display_device_id);
CREATE INDEX device_pairings_fk3 ON app.device_pairings (family_id, companion_device_id);
CREATE INDEX device_pairings_fk4 ON app.device_pairings (family_id, child_id, challenge_session_id);
CREATE INDEX device_pairings_fk5 ON app.device_pairings (family_id, confirmed_by);
CREATE INDEX sync_cursors_fk1 ON app.sync_cursors (family_id, device_id);
CREATE INDEX sync_cursors_fk2 ON app.sync_cursors (family_id, child_id);
CREATE INDEX sync_cursors_fk3 ON app.sync_cursors (family_id, last_sequence_no);
CREATE INDEX family_settings_fk1 ON app.family_settings (family_id, changed_by);
CREATE INDEX content_issues_fk1 ON app.content_issues (family_id, question_version_id);
CREATE INDEX content_issues_fk2 ON app.content_issues (family_id, media_asset_id);
CREATE INDEX content_issues_fk3 ON app.content_issues (family_id, source_slice_id);
CREATE INDEX content_issues_fk4 ON app.content_issues (family_id, reporter_child_id);
CREATE INDEX content_issues_fk5 ON app.content_issues (family_id, reporter_membership_id);
CREATE INDEX content_issues_fk6 ON app.content_issues (family_id, device_id);
CREATE INDEX content_issues_fk7 ON app.content_issues (family_id, resolved_by);
CREATE INDEX content_issues_fk8 ON app.content_issues (family_id, replacement_question_version_id);
CREATE INDEX ai_provider_configs_fk1 ON app.ai_provider_configs (family_id, created_by);
CREATE INDEX ai_budget_reservations_fk1 ON app.ai_budget_reservations (family_id, ai_provider_config_id);
CREATE INDEX ai_budget_reservations_fk2 ON app.ai_budget_reservations (family_id, generation_run_id);
CREATE INDEX ai_budget_reservations_fk3 ON app.ai_budget_reservations (family_id, background_job_id);
CREATE INDEX outbox_deliveries_fk1 ON app.outbox_deliveries (family_id, outbox_event_id);

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

CREATE TRIGGER api_revision BEFORE UPDATE ON app.families FOR EACH ROW EXECUTE FUNCTION app.guard_api_revision();
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.family_memberships FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.family_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.family_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.family_memberships USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.children FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER api_revision BEFORE UPDATE ON app.children FOR EACH ROW EXECUTE FUNCTION app.guard_api_revision();
ALTER TABLE app.children ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.children FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.children USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.devices FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER api_revision BEFORE UPDATE ON app.devices FOR EACH ROW EXECUTE FUNCTION app.guard_api_revision();
ALTER TABLE app.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.devices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.devices USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.auth_sessions FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.auth_sessions USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.media_assets FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.media_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.media_assets USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.curriculum_series FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER api_revision BEFORE UPDATE ON app.curriculum_series FOR EACH ROW EXECUTE FUNCTION app.guard_api_revision();
ALTER TABLE app.curriculum_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.curriculum_series FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.curriculum_series USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.curriculum_editions FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.curriculum_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.curriculum_editions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.curriculum_editions USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.content_versions FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_payload BEFORE UPDATE OR DELETE ON app.content_versions FOR EACH ROW EXECUTE FUNCTION app.guard_published_row();
ALTER TABLE app.content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.content_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.content_versions USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.content_nodes FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON app.content_nodes FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('app.content_versions','content_version_id','');
ALTER TABLE app.content_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.content_nodes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.content_nodes USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.source_slices FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON app.source_slices FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('app.content_versions','content_version_id','');
ALTER TABLE app.source_slices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.source_slices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.source_slices USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.slice_contexts FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON app.slice_contexts FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('app.content_versions','content_version_id','');
ALTER TABLE app.slice_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.slice_contexts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.slice_contexts USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.vocabulary_senses FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER immutable_definition BEFORE UPDATE OR DELETE ON app.vocabulary_senses FOR EACH ROW EXECUTE FUNCTION app.guard_definition();
ALTER TABLE app.vocabulary_senses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.vocabulary_senses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.vocabulary_senses USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.learning_objectives FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER immutable_definition BEFORE UPDATE OR DELETE ON app.learning_objectives FOR EACH ROW EXECUTE FUNCTION app.guard_definition();
ALTER TABLE app.learning_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.learning_objectives FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.learning_objectives USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.slice_objectives FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON app.slice_objectives FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('app.content_versions','content_version_id','');
ALTER TABLE app.slice_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.slice_objectives FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.slice_objectives USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.import_jobs FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.import_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.import_jobs USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.generation_runs FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.generation_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.generation_runs USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.generation_inputs FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.generation_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.generation_inputs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.generation_inputs USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.question_families FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER immutable_definition BEFORE UPDATE OR DELETE ON app.question_families FOR EACH ROW EXECUTE FUNCTION app.guard_definition();
ALTER TABLE app.question_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.question_families FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.question_families USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.question_versions FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_payload BEFORE UPDATE OR DELETE ON app.question_versions FOR EACH ROW EXECUTE FUNCTION app.guard_published_row();
ALTER TABLE app.question_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.question_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.question_versions USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.question_sources FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON app.question_sources FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('app.question_versions','question_version_id','');
ALTER TABLE app.question_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.question_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.question_sources USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.question_options FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON app.question_options FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('app.question_versions','question_version_id','');
ALTER TABLE app.question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.question_options FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.question_options USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON private.question_answers FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON private.question_answers FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('app.question_versions','question_version_id','');
ALTER TABLE private.question_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.question_answers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON private.question_answers USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.asset_packages FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_payload BEFORE UPDATE OR DELETE ON app.asset_packages FOR EACH ROW EXECUTE FUNCTION app.guard_published_row();
ALTER TABLE app.asset_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.asset_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.asset_packages USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.package_assets FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON app.package_assets FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('app.asset_packages','asset_package_id','');
ALTER TABLE app.package_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.package_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.package_assets USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.quality_reports FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.quality_reports FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
ALTER TABLE app.quality_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.quality_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.quality_reports USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.content_releases FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_payload BEFORE UPDATE OR DELETE ON app.content_releases FOR EACH ROW EXECUTE FUNCTION app.guard_published_row();
ALTER TABLE app.content_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.content_releases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.content_releases USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.release_questions FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON app.release_questions FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('app.content_releases','content_release_id','');
ALTER TABLE app.release_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.release_questions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.release_questions USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.weekly_plans FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.weekly_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.weekly_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.weekly_plans USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.plan_revisions FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_payload BEFORE UPDATE OR DELETE ON app.plan_revisions FOR EACH ROW EXECUTE FUNCTION app.guard_published_row();
ALTER TABLE app.plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.plan_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.plan_revisions USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.learning_days FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.learning_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.learning_days FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.learning_days USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.task_occurrences FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON app.task_occurrences FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('app.plan_revisions','plan_revision_id','status,completed_at,cancelled_at,revision,updated_at');
ALTER TABLE app.task_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_occurrences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.task_occurrences USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.task_scopes FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON app.task_scopes FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('app.plan_revisions','plan_revision_id','');
ALTER TABLE app.task_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.task_scopes USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.task_requirements FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON app.task_requirements FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('app.plan_revisions','plan_revision_id','');
ALTER TABLE app.task_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.task_requirements USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.study_exposures FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.study_exposures ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.study_exposures FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.study_exposures USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.exposure_slices FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.exposure_slices FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
ALTER TABLE app.exposure_slices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.exposure_slices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.exposure_slices USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.challenge_sessions FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.challenge_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.challenge_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.challenge_sessions USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.challenge_items FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.challenge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.challenge_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.challenge_items USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.answer_attempts FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.answer_attempts FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
ALTER TABLE app.answer_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.answer_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.answer_attempts USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.review_requests FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.review_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.review_requests USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.learning_evidence FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.learning_evidence FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
ALTER TABLE app.learning_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.learning_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.learning_evidence USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.mastery_snapshots FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.mastery_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.mastery_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.mastery_snapshots USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.item_definitions FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER immutable_definition BEFORE UPDATE OR DELETE ON app.item_definitions FOR EACH ROW EXECUTE FUNCTION app.guard_definition();
ALTER TABLE app.item_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.item_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.item_definitions USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.reward_entitlements FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.reward_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reward_entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.reward_entitlements USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.entitlement_items FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.entitlement_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.entitlement_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.entitlement_items USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.reward_grants FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.reward_grants FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
ALTER TABLE app.reward_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reward_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.reward_grants USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.reward_grant_items FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.reward_grant_items FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
ALTER TABLE app.reward_grant_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reward_grant_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.reward_grant_items USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.inventory_balances FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.inventory_balances USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.pets FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.pets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.pets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.pets USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.pet_states FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.pet_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.pet_states FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.pet_states USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.inventory_ledger FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.inventory_ledger FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
ALTER TABLE app.inventory_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.inventory_ledger USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.pet_events FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.pet_events FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
ALTER TABLE app.pet_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.pet_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.pet_events USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.pet_daily_records FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.pet_daily_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.pet_daily_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.pet_daily_records USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.hospital_cases FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.hospital_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.hospital_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.hospital_cases USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.pet_memories FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.pet_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.pet_memories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.pet_memories USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.scene_layouts FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.scene_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.scene_layouts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.scene_layouts USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.scene_placements FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.scene_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.scene_placements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.scene_placements USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.slice_media_bindings FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_parent BEFORE INSERT OR UPDATE OR DELETE ON app.slice_media_bindings FOR EACH ROW EXECUTE FUNCTION app.guard_published_parent('app.content_versions','content_version_id','');
ALTER TABLE app.slice_media_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.slice_media_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.slice_media_bindings USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.background_jobs FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.background_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.background_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.background_jobs USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.outbox_events FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.outbox_events USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.idempotency_records FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.idempotency_records USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.audit_events FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app.audit_events FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
ALTER TABLE app.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.audit_events USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.device_pairings FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.device_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.device_pairings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.device_pairings USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.sync_cursors FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
ALTER TABLE app.sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sync_cursors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.sync_cursors USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.family_settings FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER published_payload BEFORE UPDATE OR DELETE ON app.family_settings FOR EACH ROW EXECUTE FUNCTION app.guard_published_row();
ALTER TABLE app.family_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.family_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.family_settings USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.content_issues FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER api_revision BEFORE UPDATE ON app.content_issues FOR EACH ROW EXECUTE FUNCTION app.guard_api_revision();
ALTER TABLE app.content_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.content_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.content_issues USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.ai_provider_configs FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER api_revision BEFORE UPDATE ON app.ai_provider_configs FOR EACH ROW EXECUTE FUNCTION app.guard_api_revision();
ALTER TABLE app.ai_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_provider_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.ai_provider_configs USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.ai_budget_reservations FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER api_revision BEFORE UPDATE ON app.ai_budget_reservations FOR EACH ROW EXECUTE FUNCTION app.guard_api_revision();
ALTER TABLE app.ai_budget_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_budget_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.ai_budget_reservations USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
CREATE TRIGGER tenant_owner BEFORE UPDATE ON app.outbox_deliveries FOR EACH ROW EXECUTE FUNCTION app.guard_tenant_and_owner();
CREATE TRIGGER api_revision BEFORE UPDATE ON app.outbox_deliveries FOR EACH ROW EXECUTE FUNCTION app.guard_api_revision();
ALTER TABLE app.outbox_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outbox_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON app.outbox_deliveries USING (family_id = nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (family_id = nullif(current_setting('app.family_id',true),'')::uuid);
ALTER TABLE app.families ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.families FORCE ROW LEVEL SECURITY;
CREATE POLICY family_root_scope ON app.families USING (id=nullif(current_setting('app.family_id',true),'')::uuid) WITH CHECK (id=nullif(current_setting('app.family_id',true),'')::uuid);
ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY account_member_scope ON app.accounts FOR SELECT USING (EXISTS(SELECT 1 FROM app.family_memberships fm WHERE fm.account_id=accounts.id AND fm.family_id=nullif(current_setting('app.family_id',true),'')::uuid AND fm.status='active'));
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC;
-- Provision non-owner API/auth/worker roles separately. Never grant child clients direct SQL access.
-- API SELECT grant uses public_question_forms/options; private.question_answers only to grader/admin connection.
-- Do not grant UPDATE/INSERT/DELETE on inventory_balances; ledger trigger is the sole balance writer.
COMMIT;

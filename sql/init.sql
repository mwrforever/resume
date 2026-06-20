-- ==========================================================
-- 基础规范设定
-- 主键：统一使用 id BIGINT AUTO_INCREMENT
-- 索引：严禁联合主键，通过联合索引(最左前缀)优化高频查询
-- 字符集：utf8mb4 (支持简历中的生僻字和Emoji)
-- 审计字段：统一包含 create_time, update_time, is_deleted
-- ==========================================================

-- 1. 统一用户账号表
CREATE TABLE `sys_user`
(
    `id`            BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '用户ID',
    `email`         VARCHAR(100) NOT NULL COMMENT '邮箱(统一登录凭证)',
    `real_name`     VARCHAR(50)  NOT NULL COMMENT '真实姓名',
    `password_hash` VARCHAR(255) NOT NULL COMMENT '密码哈希(验证码注册时存默认值)',
    `status`        TINYINT      NOT NULL DEFAULT 1 COMMENT '账号状态：1正常，0禁用',
    `is_deleted`    TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删除，1已删除',
    `create_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
    `update_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    UNIQUE KEY `uk_email` (`email`),
    KEY             `idx_type_status` (`status`) COMMENT '按用户类型和状态筛选'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='统一用户账号表';

-- 2. 企业员工信息表
CREATE TABLE `sys_employee`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '员工ID',
    `emp_no`      VARCHAR(30)          DEFAULT NULL COMMENT '员工工号',
    `real_name`   VARCHAR(50) NOT NULL COMMENT '真实姓名',
    `email`       VARCHAR(100) NOT NULL COMMENT '邮箱',
    `password_hash` VARCHAR(255) NOT NULL COMMENT '密码哈希(验证码注册时存默认值)',
    `phone`       VARCHAR(20)          DEFAULT NULL COMMENT '手机号',
    `status`      TINYINT     NOT NULL DEFAULT 1 COMMENT '在职状态：1在职，0离职',
    `is_deleted`  TINYINT     NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删除，1已删除',
    `create_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    KEY           `idx_en_phone` (emp_no,  phone, status, is_deleted) COMMENT '员工登录'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='企业员工信息表';

-- 3. 部门表
CREATE TABLE `sys_dept`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '部门ID',
    `parent_id`   BIGINT      NOT NULL DEFAULT 0 COMMENT '父部门ID(0为顶级)',
    `dept_code`   VARCHAR(20)          DEFAULT NULL COMMENT '部门编码',
    `dept_name`   VARCHAR(50) NOT NULL COMMENT '部门名称',
    `leader_id`   BIGINT               DEFAULT NULL COMMENT '部门负责人员工ID',
    `sort_order`  INT         NOT NULL DEFAULT 0 COMMENT '显示排序',
    `status`      TINYINT     NOT NULL DEFAULT 1 COMMENT '状态：1正常，0停用',
    `is_deleted`  TINYINT     NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    `create_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    KEY           `idx_parent_status` (`parent_id`, `status`) COMMENT '查询某父节点下的有效子部门'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='部门表';

-- ==========================================================
-- 业务模块表结构
-- ==========================================================

-- 8.5 投递申请表
CREATE TABLE `job_application`
(
    `id`           BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '投递ID',
    `user_id`      BIGINT   NOT NULL COMMENT '投递用户ID',
    `job_id`       BIGINT   NOT NULL COMMENT '岗位ID',
    `resume_id`    BIGINT   NOT NULL COMMENT '关联简历ID',
    `status`       TINYINT  NOT NULL DEFAULT 0 COMMENT '状态：0待评估，1待处理，2已查看，3面试中，4已拒绝，5已录用，6已结束',
    `job_snapshot` JSON COMMENT '投递时岗位与评估模板快照',
    `is_deleted`   TINYINT  NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    `create_time`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '投递时间',
    `update_time`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    KEY            `idx_user_time` (`user_id`, `create_time`) COMMENT '用户查看自己的投递记录(按时间排序)',
    KEY            `idx_job_status` (`job_id`, `status`) COMMENT 'HR查看岗位投递情况',
    KEY            `idx_user_job_status` (`user_id`, `job_id`, `status`, `is_deleted`) COMMENT '校验用户同岗位有效投递'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='投递申请表';

-- 8. 岗位表
CREATE TABLE `job_position`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '岗位ID',
    `employee_id` BIGINT       NOT NULL COMMENT '发布人(员工ID)',
    `dept_id`     BIGINT       NOT NULL COMMENT '所属招聘部门',
    `template_id` BIGINT                DEFAULT NULL COMMENT '评估模板ID',
    `name`        VARCHAR(100) NOT NULL COMMENT '岗位名称',
    `description` TEXT COMMENT '岗位简要描述(用于AI生成技能)',
    `status`      TINYINT      NOT NULL DEFAULT 2 COMMENT '状态：1招聘中，0已下架，2待发布',
    `is_deleted`  TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发布时间',
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    KEY           `idx_dept_status` (`dept_id`, `status`, `create_time`) COMMENT 'HR查看本部门有效岗位(支持按时间排序)',
    KEY           `idx_emp_status` (`employee_id`, `status`) COMMENT '查看我发布的岗位',
    KEY           `idx_template_status` (`template_id`, `status`) COMMENT '查询模板绑定岗位'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='岗位表';

-- 9. 全局评估维度表
CREATE TABLE `eval_dimension`
(
    `id`                      BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '维度ID',
    `dimension_name`          VARCHAR(50) NOT NULL COMMENT '维度名称',
    `description`             VARCHAR(255)         DEFAULT NULL COMMENT '维度说明',
    `default_prompt_template` TEXT        NOT NULL COMMENT '默认提示词模板',
    `sort_order`              INT         NOT NULL DEFAULT 0 COMMENT '排序',
    `status`                  TINYINT     NOT NULL DEFAULT 1 COMMENT '状态：1正常，0停用',
    `is_deleted`              TINYINT     NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    `create_time`             DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`             DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    KEY                       `idx_status_sort` (`status`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='全局评估维度表';

-- 10. 评估模板表
CREATE TABLE `eval_template`
(
    `id`            BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '模板ID',
    `template_name` VARCHAR(100) NOT NULL COMMENT '模板名称',
    `description`   VARCHAR(255)          DEFAULT NULL COMMENT '模板说明',
    `status`        TINYINT      NOT NULL DEFAULT 1 COMMENT '状态：1启用，0停用',
    `is_deleted`    TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    `create_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    KEY             `idx_status_time` (`status`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='评估模板表';

-- 10.1 评估模板维度表
CREATE TABLE `eval_template_dimension`
(
    `id`              BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    `template_id`     BIGINT        NOT NULL COMMENT '模板ID',
    `dimension_id`    BIGINT        NOT NULL COMMENT '全局维度ID',
    `weight`          DECIMAL(5, 2) NOT NULL COMMENT '权重',
    `prompt_template` TEXT          NOT NULL COMMENT '提示词模板',
    `sort_order`      INT           NOT NULL DEFAULT 0 COMMENT '排序',
    `create_time`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    UNIQUE KEY `uk_template_dimension` (`template_id`, `dimension_id`),
    KEY               `idx_template_sort` (`template_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='评估模板维度表';

-- 10.2 评估模板技能表
CREATE TABLE `eval_template_skill`
(
    `id`              BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '技能ID',
    `template_id`     BIGINT       NOT NULL COMMENT '模板ID',
    `skill_name`      VARCHAR(100) NOT NULL COMMENT '技能名称',
    `skill_type`      TINYINT      NOT NULL COMMENT '技能类型：1必须满足，2优先匹配，3普通技能',
    `match_label`     VARCHAR(20)           DEFAULT NULL COMMENT '命中标签',
    `is_ai_generated` TINYINT      NOT NULL DEFAULT 0 COMMENT '是否AI生成',
    `create_time`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    KEY               `idx_template_type` (`template_id`, `skill_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='评估模板技能表';

-- 11. 简历基础表 (存储策略模式解耦)
CREATE TABLE `resume`
(
    `id`           BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '简历ID',
    `user_id`      BIGINT                DEFAULT NULL COMMENT '上传者ID(C端用户上传时关联，批量导入时可为空)',
    `file_name`    VARCHAR(255) NOT NULL COMMENT '原始文件名',
    `file_path`    VARCHAR(500) NOT NULL COMMENT '文件相对路径',
    `storage_type` VARCHAR(20)  NOT NULL DEFAULT 'LOCAL' COMMENT '存储类型策略：LOCAL/OSS/COS',
    `raw_text`     LONGTEXT COMMENT 'AI解析后的纯文本内容',
    `status`       TINYINT      NOT NULL DEFAULT 0 COMMENT '状态：0正常 1异常',
    `is_deleted`   TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    `create_time`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
    `update_time`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    KEY            `idx_user_status` (`user_id`, `status`) COMMENT 'C端用户查看自己简历的处理状态',
    KEY            `idx_status_time` (`status`, `create_time`) COMMENT '后台定时任务拉取待处理的简历'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='简历表';

-- 12. 简历岗位匹配表 (核心可视化表)
CREATE TABLE `resume_job_match`
(
    `id`                  BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '匹配记录ID',
    `application_id`      BIGINT        NOT NULL COMMENT '投递记录ID',
    `resume_id`           BIGINT        NOT NULL COMMENT '简历ID',
    `job_id`              BIGINT        NOT NULL COMMENT '岗位ID',
    `final_score`         DECIMAL(5, 2) NOT NULL DEFAULT 0.00 COMMENT '最终得分',
    `final_label`         VARCHAR(20)   NOT NULL DEFAULT '未达标' COMMENT '最终标签',
    `advantage_comment`    VARCHAR(500) COMMENT '整体优点',
    `disadvantage_comment` VARCHAR(500) COMMENT '整体缺点',
    `is_direct_preferred` TINYINT       NOT NULL DEFAULT 0 COMMENT '是否直接优选',
    `error_message`       VARCHAR(500)           DEFAULT NULL COMMENT '评估失败时的错误信息',
    `evaluated_at`        DATETIME               DEFAULT NULL COMMENT '评估完成时间',
    `create_time`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    UNIQUE KEY `uk_application` (`application_id`) COMMENT '一条投递对应一条评估记录',
    KEY                   `idx_job_score` (`job_id`, `final_score` DESC) COMMENT '按岗位匹配度降序查询',
    KEY                   `idx_job_label` (`job_id`, `final_label`) COMMENT '用于可视化饼图按标签分组统计'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='简历岗位匹配表';

-- 13. 简历维度评估详情表
CREATE TABLE `resume_eval_detail`
(
    `id`                    BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '详情ID',
    `match_id`              BIGINT        NOT NULL COMMENT '关联匹配记录ID',
    `dimension_id`          BIGINT        NOT NULL COMMENT '关联维度ID',
    `dimension_score`       DECIMAL(5, 2) NOT NULL COMMENT '该维度AI打分(0-100)',
    `dimension_advantage`    VARCHAR(500) COMMENT '该维度的具体优点(AI生成,精简,无优点时为空字符串)',
    `dimension_disadvantage` VARCHAR(500) COMMENT '该维度的具体缺点(AI生成,精简,无缺点时为空字符串)',
    `ai_reasoning`          TEXT COMMENT 'AI给出的打分理由',
    `is_completed`          TINYINT       NOT NULL DEFAULT 1 COMMENT '是否成功完成评估：1成功，0失败',
    `error_message`         VARCHAR(500) COMMENT '评估失败时的错误信息',
    `create_time`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    KEY                     `idx_match_dim` (`match_id`, `dimension_id`) COMMENT '查询某次匹配下的所有维度得分(覆盖索引)'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='简历维度评估详情表';

-- 14. 简历技能命中记录表
CREATE TABLE `resume_skill_hit`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '命中记录ID',
    `match_id`    BIGINT   NOT NULL COMMENT '关联匹配记录ID',
    `skill_id`    BIGINT   NOT NULL COMMENT '关联岗位技能ID',
    `is_hit`      TINYINT  NOT NULL COMMENT '是否命中：0未命中，1命中',
    `hit_context` VARCHAR(500)      DEFAULT NULL COMMENT '命中时的原文上下文',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    KEY           `idx_match_skill` (`match_id`, `skill_id`) COMMENT '查询某次匹配下各项技能命中情况(覆盖索引)',
    KEY           `idx_match_hit` (`match_id`, `is_hit`) COMMENT '仅筛选命中的技能用于前端高亮展示'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='简历技能命中记录表';

CREATE TABLE `sys_dept_employee`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    `dept_id`     BIGINT   NOT NULL COMMENT '部门ID',
    `employee_id` BIGINT   NOT NULL COMMENT '员工ID',
    `is_primary`  TINYINT  NOT NULL DEFAULT 0 COMMENT '是否主部门：0否，1是(业务层需保证一个员工只有一个主部门)',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入部门时间',
    UNIQUE KEY `uk_dept_employee` (`dept_id`, `employee_id`) COMMENT '防止同一部门重复加入同一员工',
    KEY           `idx_emp_primary` (`employee_id`, `is_primary`) COMMENT '极速查询员工的主部门',
    KEY           `idx_dept_id` (`dept_id`) COMMENT '用于查询部门下的所有员工(包含兼职)'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='部门员工关联表';

CREATE TABLE `sys_tag`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '标签ID',
    `tag_name`    VARCHAR(50) NOT NULL COMMENT '标签名称',
    `tag_type`    TINYINT     NOT NULL DEFAULT 1 COMMENT '标签分类：1岗位特性，2福利待遇，3技能加分(与模板技能区分，此处偏向泛标签)',
    `sort_order`  INT         NOT NULL DEFAULT 0 COMMENT '排序',
    `status`      TINYINT     NOT NULL DEFAULT 1 COMMENT '状态：1正常，0停用',
    `color`       VARCHAR(20) NOT NULL DEFAULT 'default' COMMENT '标签颜色',
    `is_deleted`  TINYINT     NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    `create_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    UNIQUE KEY `uk_tag_name` (`tag_name`),
    KEY           `idx_type_status` (`tag_type`, `status`) COMMENT '按分类筛选可用标签'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标签字典表';

CREATE TABLE `eval_template_tag`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    `template_id` BIGINT   NOT NULL COMMENT '模板ID',
    `tag_id`      BIGINT   NOT NULL COMMENT '标签ID',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    UNIQUE KEY `uk_template_tag` (`template_id`, `tag_id`) COMMENT '防止重复打标签',
    KEY           `idx_tag_id` (`tag_id`) COMMENT '用于反向查询引用某标签的模板'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='评估模板标签关联表';


CREATE TABLE IF NOT EXISTS `llm_model_config`
(
    `id`                   BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '模型配置ID',
    `biz_type`             VARCHAR(30)  NOT NULL COMMENT '业务类型：employee/dept',
    `biz_id`               BIGINT       NOT NULL COMMENT '业务ID：员工ID/部门ID',
    `config_name`          VARCHAR(50)  NOT NULL COMMENT '配置名称',
    `protocol`             VARCHAR(20)  NOT NULL DEFAULT 'openai' COMMENT '协议',
    `base_url`             VARCHAR(500) NOT NULL COMMENT 'OpenAI兼容Base URL',
    `api_key_ciphertext`   TEXT         NOT NULL COMMENT '加密后的API Key',
    `api_key_mask`         VARCHAR(50)  NOT NULL COMMENT '脱敏展示值',
    `model_name`           VARCHAR(100) NOT NULL COMMENT '模型名称',
    `fallback_model_name`  VARCHAR(100)          DEFAULT NULL COMMENT '兜底模型名称',
    `extra_body`           JSON                  DEFAULT NULL COMMENT '扩展参数',
    `enable_thinking`      TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否开启思考模式',
    `enable_tools`         TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '是否启用工具调用',
    `enable_prompt_cache`  TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否启用LLM前缀缓存',
    `enable_memory`        TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '是否启用上下文记忆',
    `temperature`          DECIMAL(4, 2) NOT NULL DEFAULT 0.70 COMMENT '生成随机性',
    `top_p`                DECIMAL(4, 2) NOT NULL DEFAULT 0.90 COMMENT '核采样参数',
    `max_tokens`           INT          NOT NULL DEFAULT 2048 COMMENT '最大输出Token',
    `presence_penalty`     DECIMAL(4, 2) NOT NULL DEFAULT 0.00 COMMENT '话题出现惩罚',
    `frequency_penalty`    DECIMAL(4, 2) NOT NULL DEFAULT 0.00 COMMENT '频率惩罚',
    `timeout_seconds`      SMALLINT     NOT NULL DEFAULT 120 COMMENT '请求超时时间',
    `max_retries`          SMALLINT     NOT NULL DEFAULT 2 COMMENT '最大重试次数',
    `status`               SMALLINT     NOT NULL DEFAULT 1 COMMENT '状态：1启用，0停用',
    `is_deleted`            BIGINT       NOT NULL DEFAULT 0 COMMENT '软删除标记：0未删除，删除时写入Unix微秒时间戳',
    `last_test_at`         DATETIME              DEFAULT NULL COMMENT '最近测试时间',
    `last_test_status`     SMALLINT              DEFAULT NULL COMMENT '最近测试状态',
    `last_test_message`    VARCHAR(500)          DEFAULT NULL COMMENT '最近测试结果',
    `create_time`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    UNIQUE KEY `uk_biz_model_deleted` (`biz_type`, `biz_id`, `model_name`, `is_deleted`),
    KEY `idx_biz` (`biz_type`, `biz_id`, `status`, `is_deleted`),
    KEY `idx_model_name` (`model_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='LLM模型配置表';

DROP TABLE IF EXISTS agent_message;
DROP TABLE IF EXISTS agent_memory;
DROP TABLE IF EXISTS agent_session;

CREATE TABLE IF NOT EXISTS `agent_session`
(
    `id`                    BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '会话ID',
    `session_key`           VARCHAR(64)  NOT NULL COMMENT '会话唯一标识',
    `current_task_id`       VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '当前运行任务的thread_id（模型上下文隔离）',
    `employee_id`           BIGINT       NOT NULL COMMENT '员工ID',
    `title`                 VARCHAR(80)           DEFAULT NULL COMMENT '会话标题',
    `selected_model_name`   VARCHAR(80)           DEFAULT NULL COMMENT '选中模型名称',
    `enable_thinking`       TINYINT      NOT NULL DEFAULT 0 COMMENT '是否开启思考模式：0否，1是',
    `status`                TINYINT      NOT NULL DEFAULT 1 COMMENT '状态：1正常，0删除',
    `last_message_time`     DATETIME              DEFAULT NULL COMMENT '最近消息时间',
    `last_block_index`      INT          NOT NULL DEFAULT 0 COMMENT '本会话已分配的最大block index（跨run递增）',
    `progress`              JSON                  DEFAULT NULL COMMENT '累积步骤进度（支撑进度栏持久化展示）',
    `create_time`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    UNIQUE KEY `uk_session_key` (`session_key`),
    KEY `idx_employee` (`employee_id`, `status`, `last_message_time` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent会话表';

CREATE TABLE IF NOT EXISTS `agent_message`
(
    `id`                BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '消息ID',
    `session_id`        BIGINT      NOT NULL COMMENT '会话ID',
    `parent_message_id` BIGINT               DEFAULT NULL COMMENT '父消息ID',
    `role`              VARCHAR(16) NOT NULL COMMENT '消息角色：user | agent',
    `workflow_type`     VARCHAR(32) NOT NULL COMMENT '工作流类型：interview_questions | resume_evaluation',
    `run_id`            VARCHAR(64)          DEFAULT NULL COMMENT 'Agent运行ID',
    `content`           JSON        NOT NULL COMMENT '消息内容（blocks结构）',
    `model_name`        VARCHAR(80)          DEFAULT NULL COMMENT '模型名称',
    `token_count`       INT                  DEFAULT NULL COMMENT 'Token数量',
    `sort_order`        INT         NOT NULL DEFAULT 0 COMMENT '排序号',
    `create_time`       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    KEY `idx_session_order` (`session_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent消息表';

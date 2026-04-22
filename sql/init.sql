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
    `dept_name`   VARCHAR(50) NOT NULL COMMENT '部门名称',
    `leader_id`   BIGINT               DEFAULT NULL COMMENT '部门负责人员工ID',
    `sort_order`  INT         NOT NULL DEFAULT 0 COMMENT '显示排序',
    `status`      TINYINT     NOT NULL DEFAULT 1 COMMENT '状态：1正常，0停用',
    `is_deleted`  TINYINT     NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    `create_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    KEY           `idx_parent_status` (`parent_id`, `status`) COMMENT '查询某父节点下的有效子部门'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='部门表';

-- 4. 角色表
CREATE TABLE `sys_role`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '角色ID',
    `role_name`   VARCHAR(50) NOT NULL COMMENT '角色名称(如：超级管理员、普通HR、求职者)',
    `role_code`   VARCHAR(50) NOT NULL COMMENT '角色权限标识(如：SUPER_ADMIN、CANDIDATE)',
    `data_scope`  TINYINT     NOT NULL DEFAULT 1 COMMENT '数据权限范围：1全部，2本部门，3仅本人',
    `status`      TINYINT     NOT NULL DEFAULT 1 COMMENT '状态：1正常，0停用',
    `is_deleted`  TINYINT     NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    `create_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    UNIQUE KEY `uk_role_code` (`role_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色表';

-- 5. 菜单/资源权限表 (包含前端路由和后端API接口)
CREATE TABLE `sys_menu`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '菜单ID',
    `parent_id`   BIGINT      NOT NULL DEFAULT 0 COMMENT '父菜单ID',
    `menu_name`   VARCHAR(50) NOT NULL COMMENT '菜单/按钮名称',
    `menu_type`   TINYINT     NOT NULL COMMENT '类型：1目录，2菜单，3按钮/API',
    `path`        VARCHAR(200)         DEFAULT NULL COMMENT '前端路由路径',
    `perm`        VARCHAR(100)         DEFAULT NULL COMMENT '后端权限标识(如:resume:batch:upload)',
    `sort_order`  INT         NOT NULL DEFAULT 0 COMMENT '排序',
    `status`      TINYINT     NOT NULL DEFAULT 1 COMMENT '状态：1显示，0隐藏',
    `is_deleted`  TINYINT     NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    `create_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    KEY           `idx_parent_status` (`parent_id`, `status`) COMMENT '获取子菜单树'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='菜单权限表';

-- 6. 员工-角色关联表 (严禁联合主键，使用单列主键+联合唯一索引)
CREATE TABLE `sys_employee_role`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    `employee_id` BIGINT   NOT NULL COMMENT '员工ID',
    `role_id`     BIGINT   NOT NULL COMMENT '角色ID',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '分配时间',
    UNIQUE KEY `uk_employee_role` (`employee_id`, `role_id`) COMMENT '保证同一员工不重复分配同一角色',
    KEY           `idx_role_id` (`role_id`) COMMENT '用于反向查询某角色下的所有员工'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='员工角色关联表';

-- 7. 角色-菜单关联表 (严禁联合主键，使用单列主键+联合唯一索引)
CREATE TABLE `sys_role_menu`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    `role_id`     BIGINT   NOT NULL COMMENT '角色ID',
    `menu_id`     BIGINT   NOT NULL COMMENT '菜单ID',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '分配时间',
    UNIQUE KEY `uk_role_menu` (`role_id`, `menu_id`) COMMENT '保证同一角色不重复分配同一菜单',
    KEY           `idx_menu_id` (`menu_id`) COMMENT '用于反向查询某菜单被哪些角色拥有'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色菜单关联表';

-- ==========================================================
-- 业务模块表结构
-- ==========================================================

-- 8.5 投递申请表
CREATE TABLE `job_application`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '投递ID',
    `user_id`     BIGINT      NOT NULL COMMENT '投递用户ID',
    `job_id`      BIGINT      NOT NULL COMMENT '岗位ID',
    `resume_id`   BIGINT      NOT NULL COMMENT '关联简历ID',
    `status`      TINYINT     NOT NULL DEFAULT 0 COMMENT '状态：0待处理，1已查看，2评估完成，3面试邀请',
    `is_deleted`  TINYINT     NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    `create_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '投递时间',
    `update_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    KEY           `idx_user_time` (`user_id`, `create_time`) COMMENT '用户查看自己的投递记录(按时间排序)',
    KEY           `idx_job_status` (`job_id`, `status`) COMMENT 'HR查看岗位投递情况'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='投递申请表';

-- 8. 岗位表
CREATE TABLE `job_position`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '岗位ID',
    `employee_id` BIGINT       NOT NULL COMMENT '发布人(员工ID)',
    `dept_id`     BIGINT       NOT NULL COMMENT '所属招聘部门',
    `name`        VARCHAR(100) NOT NULL COMMENT '岗位名称',
    `description` TEXT COMMENT '岗位简要描述(用于AI生成技能)',
    `status`      TINYINT      NOT NULL DEFAULT 1 COMMENT '状态：1招聘中，0已下架',
    `is_deleted`  TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发布时间',
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    KEY           `idx_dept_status` (`dept_id`, `status`, `create_time`) COMMENT 'HR查看本部门有效岗位(支持按时间排序)',
    KEY           `idx_emp_status` (`employee_id`, `status`) COMMENT '查看我发布的岗位'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='岗位表';

-- 9. 岗位评估维度表 (高度自定义评分机制)
CREATE TABLE `job_eval_dimension`
(
    `id`              BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '维度ID',
    `job_id`          BIGINT        NOT NULL COMMENT '关联岗位ID',
    `dimension_name`  VARCHAR(50)   NOT NULL COMMENT '维度名称(如：项目经验)',
    `weight`          DECIMAL(5, 2) NOT NULL COMMENT '权重占比(如0.30)',
    `prompt_template` TEXT          NOT NULL COMMENT 'LangChain提示词模板',
    `sort_order`      INT           NOT NULL DEFAULT 0 COMMENT '排序',
    `create_time`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    KEY               `idx_job_sort` (`job_id`, `sort_order`) COMMENT '按岗位查询维度并按顺序展示'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='岗位评估维度表';

-- 10. 岗位技能要求表 (必须技能与优选技能及标签)
CREATE TABLE `job_skill`
(
    `id`              BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '技能ID',
    `job_id`          BIGINT       NOT NULL COMMENT '关联岗位ID',
    `skill_name`      VARCHAR(100) NOT NULL COMMENT '技能名称',
    `skill_type`      TINYINT      NOT NULL COMMENT '技能类型：1必须满足，2优先匹配，3普通技能',
    `match_label`     VARCHAR(20)           DEFAULT NULL COMMENT '命中标签(优秀/良好/一般，仅type=2有效)',
    `is_ai_generated` TINYINT      NOT NULL DEFAULT 0 COMMENT '是否AI自动生成',
    `create_time`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    KEY               `idx_job_type` (`job_id`, `skill_type`) COMMENT '按岗位筛选必须技能或优选技能'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='岗位技能要求表';

-- 11. 简历基础表 (存储策略模式解耦)
CREATE TABLE `resume`
(
    `id`           BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '简历ID',
    `user_id`      BIGINT                DEFAULT NULL COMMENT '上传者ID(C端用户上传时关联，批量导入时可为空)',
    `file_name`    VARCHAR(255) NOT NULL COMMENT '原始文件名',
    `file_path`    VARCHAR(500) NOT NULL COMMENT '文件相对路径',
    `storage_type` VARCHAR(20)  NOT NULL DEFAULT 'LOCAL' COMMENT '存储类型策略：LOCAL/OSS/COS',
    `raw_text`     LONGTEXT COMMENT 'AI解析后的纯文本内容',
    `status`       TINYINT      NOT NULL DEFAULT 0 COMMENT '状态：0待处理，2评估完成，3处理失败',
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
    `resume_id`           BIGINT        NOT NULL COMMENT '简历ID',
    `job_id`              BIGINT        NOT NULL COMMENT '岗位ID',
    `final_score`         DECIMAL(5, 2) NOT NULL DEFAULT 0.00 COMMENT '最终加权匹配得分(0-100)',
    `final_label`         VARCHAR(20)   NOT NULL DEFAULT '未达标' COMMENT '最终标签',
    `advantage_comment`    VARCHAR(500) COMMENT '简历对该岗位的整体优点评价(AI生成,精简)',
    `disadvantage_comment` VARCHAR(500) COMMENT '简历对该岗位的整体缺点评价(AI生成,精简,无缺点时为空字符串)',
    `is_direct_preferred` TINYINT       NOT NULL DEFAULT 0 COMMENT '是否直接优选命中',
    `evaluated_at`        DATETIME               DEFAULT NULL COMMENT '评估完成时间',
    `create_time`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    UNIQUE KEY `uk_resume_job` (`resume_id`, `job_id`) COMMENT '防止同一简历重复适配同一岗位',
    KEY                   `idx_job_score` (`job_id`, `final_score` DESC) COMMENT '最核心索引：HR查看某岗位简历按匹配度降序(避免filesort)',
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
    `tag_type`    TINYINT     NOT NULL DEFAULT 1 COMMENT '标签分类：1岗位特性，2福利待遇，3技能加分(与job_skill区分，此处偏向泛标签)',
    `sort_order`  INT         NOT NULL DEFAULT 0 COMMENT '排序',
    `status`      TINYINT     NOT NULL DEFAULT 1 COMMENT '状态：1正常，0停用',
    `color`       VARCHAR(20) NOT NULL DEFAULT 'default' COMMENT '标签颜色',
    `is_deleted`  TINYINT     NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    `create_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    UNIQUE KEY `uk_tag_name` (`tag_name`),
    KEY           `idx_type_status` (`tag_type`, `status`) COMMENT '按分类筛选可用标签'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标签字典表';

CREATE TABLE `job_position_tag`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
    `job_id`      BIGINT   NOT NULL COMMENT '岗位ID',
    `tag_id`      BIGINT   NOT NULL COMMENT '标签ID',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '关联时间',
    UNIQUE KEY `uk_job_tag` (`job_id`, `tag_id`) COMMENT '防止重复打标签',
    KEY           `idx_tag_id` (`tag_id`) COMMENT '用于反向查询带有某标签的所有岗位'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='岗位标签关联表';


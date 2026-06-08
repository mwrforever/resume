# ── verification ──────────────────────────────────────────────────────────

VERIFY_COUNT_TTL = 60
VERIFY_COUNT_LIMIT = 5

# ── user ──────────────────────────────────────────────────────────────────

USER_KEY = "user:{user_id}"
USER_TTL = 300

USER_EMAIL_KEY = "user:email:{email}"
USER_EMAIL_TTL = 300

# ── employee ────────────────────────────────────────────────────────────────

EMPLOYEE_KEY = "employee:{employee_id}"
EMPLOYEE_TTL = 300

EMPLOYEE_EMAIL_KEY = "employee:email:{email}"
EMPLOYEE_EMAIL_TTL = 300

EMPLOYEE_EMP_NO_KEY = "employee:emp_no:{emp_no}"
EMPLOYEE_EMP_NO_TTL = 300

# ── dept ─────────────────────────────────────────────────────────────────

DEPT_LIST_KEY = "dept:list"
DEPT_LIST_TTL = 1800

DEPT_LEADERS_KEY = "dept:leaders"
DEPT_LEADERS_TTL = 1800

# ── tag ──────────────────────────────────────────────────────────────────

TAG_LIST_KEY = "tag:list:{tag_type}"
TAG_LIST_TTL = 1800

# ── job ───────────────────────────────────────────────────────────────────

JOB_DETAIL_KEY = "job:detail:{job_id}"
JOB_DETAIL_TTL = 300

JOB_SKILLS_KEY = "job:skills:{job_id}"
JOB_SKILLS_TTL = 300

JOB_COUNT_ACTIVE_KEY = "job:count_active"
JOB_COUNT_ACTIVE_TTL = 300

JOB_LIST_KEY = "job:list:p{page}:s{size}"
JOB_LIST_TTL = 120

# ── eval_template ─────────────────────────────────────────────────────────

TEMPLATE_DETAIL_KEY = "template:{template_id}:detail"
TEMPLATE_DETAIL_TTL = 600

DIMENSION_LIST_KEY = "dimension:list"
DIMENSION_LIST_TTL = 1800

# ── evaluation ─────────────────────────────────────────────────────────────

EVAL_RECENT_KEY = "eval:recent"
EVAL_RECENT_TTL = 120

EVAL_PENDING_COUNT_KEY = "eval:pending_count"
EVAL_PENDING_COUNT_TTL = 120

EVAL_AVG_SCORE_KEY = "eval:avg_score"
EVAL_AVG_SCORE_TTL = 120

EVAL_MATCH_DIST_KEY = "eval:match_dist:{job_id}"
EVAL_MATCH_DIST_TTL = 120

# ── resume ────────────────────────────────────────────────────────────────

RESUME_BY_USER_KEY = "resume:user:{user_id}"
RESUME_BY_USER_TTL = 300

RESUME_COUNT_ALL_KEY = "resume:count_all"
RESUME_COUNT_ALL_TTL = 300

# ── application ──────────────────────────────────────────────────────────

APPLICATION_EXISTS_KEY = "application:exists:{user_id}:{job_id}"
APPLICATION_EXISTS_TTL = 300

# ── llm / agent ───────────────────────────────────────────────────────────

LLM_MODEL_OPTIONS_KEY = "llm:model_options:employee:{employee_id}"
LLM_MODEL_OPTIONS_TTL = 300

AGENT_PROMPT_PREFIX_KEY = "agent:prompt_prefix:{prefix_hash}"
AGENT_PROMPT_PREFIX_TTL = 21600

AGENT_TOOL_CACHE_KEY = "agent:tool:{tool}:{cache_hash}"
AGENT_TOOL_CACHE_TTL = 1800

# -- agent session resume --

AGENT_SESSION_RESUME_REF_KEY = "agent:session:{session_id}:resume_ref"
AGENT_SESSION_RESUME_REF_TTL = 86400

AGENT_RESUME_TEXT_KEY = "agent:resume_text:{resume_id}"
AGENT_RESUME_TEXT_TTL = 7200

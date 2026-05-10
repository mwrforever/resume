from app.llm.prompts.manager import prompt_manager

SKILL_SUGGEST_PROMPT = prompt_manager.get_template("skill_suggest")
JOB_AI_SUGGEST_PROMPT = prompt_manager.get_template("job_ai_suggest")
JOB_TEMPLATE_AI_SUGGEST_PROMPT = prompt_manager.get_template("job_template_ai_suggest")
EVAL_DIMENSION_AI_SUGGEST_PROMPT = prompt_manager.get_template("eval_dimension_ai_suggest")
TEMPLATE_SKILL_AI_SUGGEST_PROMPT = prompt_manager.get_template("template_skill_ai_suggest")
DIMENSION_EVAL_PROMPT = prompt_manager.get_template("dimension_eval")
RESUME_EVAL_PROMPT = prompt_manager.get_template("resume_eval")
SKILL_MATCH_PROMPT = prompt_manager.get_template("skill_match")
DIMENSION_EVAL_WITH_SKILLS_PROMPT = prompt_manager.get_template("dimension_eval_with_skills")
COMPREHENSIVE_EVAL_PROMPT = prompt_manager.get_template("comprehensive_eval")

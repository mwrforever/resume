import { employeeEvalTemplatesApi } from '@/api/employee/eval-templates';
import type { IDimension, IEvalTemplate, ISkill } from '@/types/employee';

const getResponseData = <T,>(res: any, fallback: T): T => res?.data?.data ?? res?.data ?? fallback;

interface ICreateTemplateDraft {
  templateName: string;
  description?: string;
  dimensions: IDimension[];
  skills?: ISkill[];
  tagIds?: number[];
}

export async function createTemplateFromDraft(draft: ICreateTemplateDraft): Promise<IEvalTemplate> {
  const createdDimensions = await Promise.all(
    draft.dimensions.map((dimension, index) =>
      employeeEvalTemplatesApi.createDimension({
        dimension_name: dimension.dimension_name,
        default_prompt_template: dimension.prompt_template || undefined,
        sort_order: dimension.sort_order ?? index,
        status: 1,
      }).then(res => getResponseData<{ id: number } | null>(res, null))
    )
  );
  if (createdDimensions.some(dimension => !dimension?.id)) {
    throw new Error('创建评估维度失败');
  }
  const validDimensions = createdDimensions as Array<{ id: number }>;

  const templateRes = await employeeEvalTemplatesApi.create({
    template_name: draft.templateName,
    description: draft.description,
    status: 1,
    dimensions: validDimensions.map((dimension, index) => ({
      dimension_id: dimension.id,
      weight: draft.dimensions[index].weight,
      prompt_template: draft.dimensions[index].prompt_template || undefined,
      sort_order: draft.dimensions[index].sort_order ?? index,
    })),
    skills: (draft.skills ?? []).map(skill => ({
      skill_name: skill.skill_name,
      skill_type: skill.skill_type,
      match_label: skill.match_label,
      is_ai_generated: 0,
    })),
    tag_ids: draft.tagIds ?? [],
  });
  const template = getResponseData<IEvalTemplate | null>(templateRes, null);
  if (!template) throw new Error('创建评估模板失败');
  return template;
}

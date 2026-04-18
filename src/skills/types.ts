export interface SkillDefinition {
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  entryPoint: string;
  systemPrompt?: string;
  dependencies?: string[];
  configSchema?: Record<string, any>;
}

export interface Skill {
  definition: SkillDefinition;
  enabled: boolean;
  installedAt: Date;
  config: Record<string, any>;
}

export interface InstalledSkill extends Skill {
  id: string;
  path: string;
}

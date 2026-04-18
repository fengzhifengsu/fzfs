export interface SkillExperience {
  id: string;
  prompt: string;
  solution: string;
  toolCalls: string[];
  successCount: number;
  failureCount: number;
  firstUsed: Date;
  lastUsed: Date;
  category: string;
}

export interface AutoSkillResult {
  created: boolean;
  skillName?: string;
  reason: string;
}

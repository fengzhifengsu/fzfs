import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SkillExperience, AutoSkillResult } from './types';
import { SkillDefinition } from '../types';
import { SkillsRegistry } from '../registry';
import { Agent } from '../../agent';
import { MemorySystem } from '../../memory';
import { getLogger } from '../../utils/logger';

export class AutoSkillCreator {
  private experiences: Map<string, SkillExperience> = new Map();
  private skillsRegistry: SkillsRegistry;
  private agent: Agent;
  private memory: MemorySystem;
  private logger: any;
  private experienceStorePath: string;
  private minSuccessCount: number = 3;
  private similarityThreshold: number = 0.7;

  constructor(
    skillsRegistry: SkillsRegistry,
    agent: Agent,
    memory: MemorySystem,
    storePath: string = './data/experiences.json'
  ) {
    this.skillsRegistry = skillsRegistry;
    this.agent = agent;
    this.memory = memory;
    this.logger = getLogger();
    this.experienceStorePath = storePath;
    this.loadExperiences();
  }

  private loadExperiences(): void {
    if (!fs.existsSync(this.experienceStorePath)) {
      fs.ensureDirSync(path.dirname(this.experienceStorePath));
      return;
    }

    try {
      const data = fs.readJsonSync(this.experienceStorePath);
      for (const exp of data) {
        this.experiences.set(exp.id, {
          ...exp,
          firstUsed: new Date(exp.firstUsed),
          lastUsed: new Date(exp.lastUsed),
        });
      }
    } catch (error) {
      this.logger.error('Failed to load experiences:', error);
    }
  }

  saveExperiences(): void {
    const data = Array.from(this.experiences.values());
    fs.writeJsonSync(this.experienceStorePath, data, { spaces: 2 });
  }

  recordExperience(
    prompt: string,
    solution: string,
    toolCalls: string[],
    success: boolean,
    category: string = 'general'
  ): void {
    const normalizedPrompt = this.normalizePrompt(prompt);

    let existing = this.findSimilarExperience(normalizedPrompt);

    if (existing) {
      existing.successCount += success ? 1 : 0;
      existing.failureCount += success ? 0 : 1;
      existing.lastUsed = new Date();
      existing.toolCalls = [...new Set([...existing.toolCalls, ...toolCalls])];
      existing.solution = solution;
    } else {
      const exp: SkillExperience = {
        id: uuidv4(),
        prompt: normalizedPrompt,
        solution,
        toolCalls,
        successCount: success ? 1 : 0,
        failureCount: success ? 0 : 1,
        firstUsed: new Date(),
        lastUsed: new Date(),
        category,
      };
      this.experiences.set(exp.id, exp);
      existing = exp;
    }

    this.logger.info(`Recorded experience: ${normalizedPrompt.substring(0, 50)}... (success: ${success})`);

    this.saveExperiences();
  }

  private normalizePrompt(prompt: string): string {
    return prompt
      .replace(/[0-9]+/g, 'N')
      .replace(/https?:\/\/\S+/g, '[URL]')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .substring(0, 200);
  }

  private findSimilarExperience(prompt: string): SkillExperience | undefined {
    for (const exp of this.experiences.values()) {
      const similarity = this.calculateSimilarity(prompt, exp.prompt);
      if (similarity >= this.similarityThreshold) {
        return exp;
      }
    }
    return undefined;
  }

  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0.0;

    const wordsA = new Set(a.split(' '));
    const wordsB = new Set(b.split(' '));

    let overlap = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) overlap++;
    }

    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? overlap / union : 0;
  }

  async checkAndCreateSkill(exp: SkillExperience): Promise<AutoSkillResult> {
    if (exp.successCount < this.minSuccessCount) {
      return { created: false, reason: `Need ${this.minSuccessCount} successes, got ${exp.successCount}` };
    }

    const existingSkill = this.skillsRegistry.getSkillByName(exp.prompt.substring(0, 30));
    if (existingSkill) {
      return { created: false, reason: 'Skill already exists' };
    }

    this.logger.info(`Creating auto skill from experience: ${exp.prompt.substring(0, 50)}`);

    const generated = await this.generateSkillDefinition(exp);
    if (!generated) {
      return { created: false, reason: 'Failed to generate skill definition' };
    }

    const installed = await this.skillsRegistry.installSkill(generated);
    
    this.memory.storeMemory({
      key: `skill:${generated.name}`,
      value: `Auto-created skill from experience: ${exp.prompt}`,
      category: 'skills',
      tags: ['auto-created', generated.category],
      importance: 0.7,
    });

    this.logger.info(`Auto skill created: ${generated.name}`);

    return {
      created: true,
      skillName: generated.name,
      reason: `Created from ${exp.successCount} successful executions`,
    };
  }

  private async generateSkillDefinition(exp: SkillExperience): Promise<SkillDefinition | null> {
    try {
      const prompt = `Based on the following successful task execution pattern, generate a reusable skill definition in JSON format.

Pattern: ${exp.prompt}
Solution used: ${exp.solution}
Tools called: ${exp.toolCalls.join(', ')}
Success count: ${exp.successCount}

Generate a JSON object with these fields:
- name: short unique skill name (kebab-case)
- description: what this skill does
- version: "1.0.0"
- author: "KeleAgent-AutoCreator"
- category: the category (productivity, dev, research, automation, etc)
- tags: array of relevant tags
- systemPrompt: a system prompt that guides the agent to execute this type of task
- entryPoint: "index.js"

Return ONLY the JSON object, no markdown, no explanation.`;

      const response = await this.agent.generateResponse([
        { role: 'user' as const, content: prompt, timestamp: new Date(), id: 'temp' },
      ]);

      const jsonStr = response.content.replace(/```json\n?|\n?```/g, '').trim();
      const definition = JSON.parse(jsonStr) as SkillDefinition;

      definition.systemPrompt = `You are executing a skill for: ${exp.prompt}\n\n${definition.systemPrompt || ''}\n\nAlways follow this pattern:\n${exp.solution}`;

      return definition;
    } catch (error) {
      this.logger.error('Failed to generate skill definition:', error);
      return null;
    }
  }

  async reviewAllExperiences(): Promise<AutoSkillResult[]> {
    const results: AutoSkillResult[] = [];

    for (const exp of this.experiences.values()) {
      if (exp.successCount >= this.minSuccessCount) {
        const result = await this.checkAndCreateSkill(exp);
        results.push(result);
      }
    }

    this.saveExperiences();
    return results;
  }

  getExperienceStats(): any {
    let totalExperiences = 0;
    let totalSuccesses = 0;
    const categories: Record<string, number> = {};

    for (const exp of this.experiences.values()) {
      totalExperiences++;
      totalSuccesses += exp.successCount;
      categories[exp.category] = (categories[exp.category] || 0) + 1;
    }

    return {
      totalExperiences,
      totalSuccesses,
      categories,
      uniquePatterns: this.experiences.size,
    };
  }

  setMinSuccessCount(count: number): void {
    this.minSuccessCount = count;
  }

  setSimilarityThreshold(threshold: number): void {
    this.similarityThreshold = threshold;
  }
}

import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SkillDefinition, InstalledSkill, Skill } from './types';
import { getLogger } from '../utils/logger';

export class SkillsRegistry {
  private skillsPath: string;
  private skills: Map<string, InstalledSkill> = new Map();
  private logger: any;

  constructor(workspacePath: string = './skills') {
    this.skillsPath = workspacePath;
    this.logger = getLogger();
    fs.ensureDirSync(this.skillsPath);
    this.loadSkills();
  }

  private loadSkills(): void {
    const skillsDir = path.join(this.skillsPath, 'installed');
    if (!fs.existsSync(skillsDir)) {
      fs.ensureDirSync(skillsDir);
      return;
    }

    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (dir.isDirectory()) {
        try {
          const skillPath = path.join(skillsDir, dir.name);
          const manifestPath = path.join(skillPath, 'skill.json');
          
          if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            const skill: InstalledSkill = {
              id: dir.name,
              path: skillPath,
              definition: manifest,
              enabled: true,
              installedAt: new Date(),
              config: {},
            };
            this.skills.set(dir.name, skill);
          }
        } catch (error) {
          this.logger.warn(`Failed to load skill from ${dir.name}:`, error);
        }
      }
    }
  }

  async installSkill(definition: SkillDefinition, skillPath?: string): Promise<InstalledSkill> {
    const id = uuidv4();
    const installDir = path.join(this.skillsPath, 'installed', id);
    
    fs.ensureDirSync(installDir);

    const manifestPath = path.join(installDir, 'skill.json');
    fs.writeFileSync(manifestPath, JSON.stringify(definition, null, 2));

    if (skillPath && fs.existsSync(skillPath)) {
      const entryFileName = path.basename(definition.entryPoint);
      const destPath = path.join(installDir, entryFileName);
      await fs.copy(skillPath, destPath);
    }

    const skill: InstalledSkill = {
      id,
      path: installDir,
      definition,
      enabled: true,
      installedAt: new Date(),
      config: {},
    };

    this.skills.set(id, skill);
    this.logger.info(`Installed skill: ${definition.name} (${id})`);
    return skill;
  }

  uninstallSkill(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    try {
      fs.removeSync(skill.path);
      this.skills.delete(skillId);
      this.logger.info(`Uninstalled skill: ${skill.definition.name}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to uninstall skill ${skillId}:`, error);
      return false;
    }
  }

  getSkill(skillId: string): InstalledSkill | undefined {
    return this.skills.get(skillId);
  }

  getSkillByName(name: string): InstalledSkill | undefined {
    for (const skill of this.skills.values()) {
      if (skill.definition.name === name) {
        return skill;
      }
    }
    return undefined;
  }

  getAllSkills(): InstalledSkill[] {
    return Array.from(this.skills.values());
  }

  getEnabledSkills(): InstalledSkill[] {
    return Array.from(this.skills.values()).filter(s => s.enabled);
  }

  toggleSkill(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    skill.enabled = !skill.enabled;
    this.skills.set(skillId, skill);
    return true;
  }

  async updateSkillConfig(skillId: string, config: Record<string, any>): Promise<boolean> {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    skill.config = { ...skill.config, ...config };
    this.skills.set(skillId, skill);

    const manifestPath = path.join(skill.path, 'config.json');
    await fs.writeJson(manifestPath, skill.config, { spaces: 2 });

    return true;
  }

  getSkillsByCategory(category: string): InstalledSkill[] {
    return Array.from(this.skills.values()).filter(
      s => s.definition.category === category
    );
  }

  searchSkills(query: string): InstalledSkill[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.skills.values()).filter(s => {
      return (
        s.definition.name.toLowerCase().includes(lowerQuery) ||
        s.definition.description.toLowerCase().includes(lowerQuery) ||
        s.definition.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      );
    });
  }

  getSkillStats(): any {
    const categories: Record<string, number> = {};
    for (const skill of this.skills.values()) {
      const cat = skill.definition.category;
      categories[cat] = (categories[cat] || 0) + 1;
    }

    return {
      total: this.skills.size,
      enabled: this.getEnabledSkills().length,
      categories,
    };
  }
}

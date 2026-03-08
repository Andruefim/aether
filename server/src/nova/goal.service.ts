import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NovaGoal } from './entities/nova-goal.entity';

@Injectable()
export class GoalService {
  constructor(
    @InjectRepository(NovaGoal)
    private readonly repo: Repository<NovaGoal>,
  ) {}

  async findAll(): Promise<NovaGoal[]> {
    return this.repo.find({ order: { priority: 'DESC', createdAt: 'ASC' } });
  }

  async findActive(): Promise<NovaGoal[]> {
    return this.repo.find({
      where: { active: true },
      order: { priority: 'DESC', createdAt: 'ASC' },
    });
  }

  async create(text: string, priority = 0): Promise<NovaGoal> {
    const goal = this.repo.create({ text: text.trim(), priority, active: true });
    return this.repo.save(goal);
  }

  async remove(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  async setActive(id: string, active: boolean): Promise<NovaGoal | null> {
    await this.repo.update(id, { active });
    return this.repo.findOneBy({ id });
  }

  /** Returns a single string summarising all active goals for prompt injection */
  async getGoalContext(): Promise<string> {
    const goals = await this.findActive();
    if (goals.length === 0) {
      return 'aging biology, telomeres, cellular senescence, longevity research';
    }
    return goals.map((g) => g.text).join('; ');
  }
}

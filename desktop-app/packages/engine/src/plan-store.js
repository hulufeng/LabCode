/**
 * 计划存储 - AI 执行计划的暂存
 */
class PlanStore {
  constructor() { this.plans = new Map(); }
  save(planId, plan) { this.plans.set(planId, plan); }
  get(planId) { return this.plans.get(planId); }
  delete(planId) { this.plans.delete(planId); }
}
module.exports = PlanStore;

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IncomeGoal1759900000000 implements MigrationInterface {
  name = 'IncomeGoal1759900000000';

  async up(q: QueryRunner): Promise<void> {
    // P2: gasto mensual objetivo a cubrir con dividendos, en la moneda que elija el usuario.
    await q.query(`
      ALTER TABLE users
        ADD COLUMN monthly_income_goal_amount numeric(20,4) CHECK (monthly_income_goal_amount > 0),
        ADD COLUMN monthly_income_goal_currency char(3) CHECK (monthly_income_goal_currency IN ('CLP', 'USD', 'EUR')),
        ADD CONSTRAINT users_income_goal_complete
          CHECK ((monthly_income_goal_amount IS NULL) = (monthly_income_goal_currency IS NULL))
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users DROP CONSTRAINT users_income_goal_complete, DROP COLUMN monthly_income_goal_currency, DROP COLUMN monthly_income_goal_amount`);
  }
}

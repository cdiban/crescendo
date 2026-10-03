import type { MigrationInterface, QueryRunner } from 'typeorm';

const CURRENCY = `IN ('CLP', 'USD', 'EUR')`;

export class PortfolioCore1759600000000 implements MigrationInterface {
  name = 'PortfolioCore1759600000000';

  async up(q: QueryRunner): Promise<void> {
    // ── Catálogo global ──
    await q.query(`
      CREATE TABLE markets (
        code text PRIMARY KEY,
        name text NOT NULL,
        country char(2) NOT NULL,
        currency text NOT NULL CHECK (currency ${CURRENCY}),
        timezone text NOT NULL,
        default_withholding_rate numeric(7,6) NOT NULL CHECK (default_withholding_rate BETWEEN 0 AND 1)
      )
    `);
    await q.query(`
      INSERT INTO markets (code, name, country, currency, timezone, default_withholding_rate) VALUES
        ('XSGO', 'Bolsa de Santiago', 'CL', 'CLP', 'America/Santiago', 0),
        ('US', 'Estados Unidos', 'US', 'USD', 'America/New_York', 0.15)
    `);
    await q.query(`
      CREATE TABLE instruments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        symbol text NOT NULL CHECK (symbol ~ '^[A-Z0-9.-]{1,20}$'),
        market_code text NOT NULL REFERENCES markets (code),
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        type text NOT NULL CHECK (type IN ('STOCK', 'ETF', 'FUND', 'REIT')),
        currency text NOT NULL CHECK (currency ${CURRENCY}),
        sector text,
        industry text,
        withholding_rate numeric(7,6) CHECK (withholding_rate BETWEEN 0 AND 1),
        annual_dividend_per_share numeric(28,10) CHECK (annual_dividend_per_share >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT instruments_symbol_market_unique UNIQUE (symbol, market_code)
      )
    `);

    // ── Datos del usuario: toda fila lleva user_id, y las FK compuestas (id, user_id)
    //    impiden que una fila apunte a la cuenta/operación de otro usuario. ──
    await q.query(`
      CREATE TABLE accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
        broker text NOT NULL CHECK (length(broker) BETWEEN 1 AND 60),
        base_currency text NOT NULL CHECK (base_currency ${CURRENCY}),
        archived boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT accounts_user_name_unique UNIQUE (user_id, name),
        CONSTRAINT accounts_id_user_unique UNIQUE (id, user_id)
      )
    `);
    await q.query(`
      CREATE TABLE trades (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        account_id uuid NOT NULL,
        instrument_id uuid NOT NULL REFERENCES instruments (id),
        side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
        trade_date date NOT NULL,
        quantity numeric(28,10) NOT NULL CHECK (quantity > 0),
        price numeric(28,10) NOT NULL CHECK (price > 0),
        commission numeric(20,4) NOT NULL DEFAULT 0 CHECK (commission >= 0),
        commission_tax numeric(20,4) NOT NULL DEFAULT 0 CHECK (commission_tax >= 0),
        currency text NOT NULL CHECK (currency ${CURRENCY}),
        needs_review boolean NOT NULL DEFAULT false,
        notes text CHECK (length(notes) <= 200),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT trades_account_fk FOREIGN KEY (account_id, user_id) REFERENCES accounts (id, user_id) ON DELETE CASCADE,
        CONSTRAINT trades_id_user_unique UNIQUE (id, user_id)
      )
    `);
    await q.query(`CREATE INDEX trades_user_date_idx ON trades (user_id, trade_date DESC)`);
    await q.query(`CREATE INDEX trades_user_account_instrument_idx ON trades (user_id, account_id, instrument_id)`);

    await q.query(`
      CREATE TABLE dividends (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        account_id uuid NOT NULL,
        instrument_id uuid NOT NULL REFERENCES instruments (id),
        status text NOT NULL CHECK (status IN ('ANNOUNCED', 'PAID')),
        kind text NOT NULL CHECK (kind IN ('REGULAR', 'PROVISIONAL', 'FINAL', 'ADDITIONAL', 'SPECIAL', 'OTHER')),
        ex_date date,
        payment_date date NOT NULL,
        currency text NOT NULL CHECK (currency ${CURRENCY}),
        per_share numeric(28,10) CHECK (per_share > 0),
        quantity numeric(28,10) CHECK (quantity > 0),
        gross_amount numeric(20,4) NOT NULL CHECK (gross_amount > 0),
        withholding_rate numeric(7,6) NOT NULL CHECK (withholding_rate BETWEEN 0 AND 1),
        withholding_amount numeric(20,4) NOT NULL CHECK (withholding_amount >= 0),
        net_amount numeric(20,4) NOT NULL CHECK (net_amount >= 0),
        notes text CHECK (length(notes) <= 200),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT dividends_net_check CHECK (net_amount = gross_amount - withholding_amount),
        CONSTRAINT dividends_account_fk FOREIGN KEY (account_id, user_id) REFERENCES accounts (id, user_id) ON DELETE CASCADE,
        CONSTRAINT dividends_id_user_unique UNIQUE (id, user_id)
      )
    `);
    await q.query(`CREATE INDEX dividends_user_payment_idx ON dividends (user_id, payment_date DESC)`);

    await q.query(`
      CREATE TABLE cash_movements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        account_id uuid NOT NULL,
        date date NOT NULL,
        type text NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL', 'FEE', 'INTEREST', 'ADJUSTMENT',
                                           'TRADE', 'DIVIDEND', 'TRANSFER_IN', 'TRANSFER_OUT')),
        amount numeric(20,4) NOT NULL,
        currency text NOT NULL CHECK (currency ${CURRENCY}),
        description text CHECK (length(description) <= 200),
        source text NOT NULL CHECK (source IN ('MANUAL', 'AUTOMATIC', 'IMPORT')),
        trade_id uuid,
        dividend_id uuid,
        transfer_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT cash_movements_account_fk FOREIGN KEY (account_id, user_id) REFERENCES accounts (id, user_id) ON DELETE CASCADE,
        CONSTRAINT cash_movements_trade_fk FOREIGN KEY (trade_id, user_id) REFERENCES trades (id, user_id) ON DELETE CASCADE,
        CONSTRAINT cash_movements_dividend_fk FOREIGN KEY (dividend_id, user_id) REFERENCES dividends (id, user_id) ON DELETE CASCADE,
        CONSTRAINT cash_movements_trade_unique UNIQUE (trade_id),
        CONSTRAINT cash_movements_dividend_unique UNIQUE (dividend_id),
        CONSTRAINT cash_movements_one_reference CHECK (num_nonnulls(trade_id, dividend_id, transfer_id) <= 1),
        CONSTRAINT cash_movements_reference_matches_type CHECK (
          (type = 'TRADE') = (trade_id IS NOT NULL)
          AND (type = 'DIVIDEND') = (dividend_id IS NOT NULL)
          AND (type IN ('TRANSFER_IN', 'TRANSFER_OUT')) = (transfer_id IS NOT NULL)
        ),
        CONSTRAINT cash_movements_source_matches_type CHECK (
          (type IN ('TRADE', 'DIVIDEND', 'TRANSFER_IN', 'TRANSFER_OUT')) = (source = 'AUTOMATIC')
        ),
        CONSTRAINT cash_movements_sign CHECK (CASE
          WHEN type IN ('DEPOSIT', 'INTEREST', 'TRANSFER_IN') THEN amount > 0
          WHEN type IN ('WITHDRAWAL', 'FEE', 'TRANSFER_OUT') THEN amount < 0
          WHEN type = 'ADJUSTMENT' THEN amount <> 0
          WHEN type = 'DIVIDEND' THEN amount >= 0
          ELSE true
        END)
      )
    `);
    await q.query(`CREATE INDEX cash_movements_user_date_idx ON cash_movements (user_id, date DESC)`);
    await q.query(`CREATE INDEX cash_movements_user_account_currency_idx ON cash_movements (user_id, account_id, currency)`);
    await q.query(`CREATE INDEX cash_movements_transfer_idx ON cash_movements (transfer_id) WHERE transfer_id IS NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const table of ['cash_movements', 'dividends', 'trades', 'accounts', 'instruments', 'markets']) {
      await q.query(`DROP TABLE ${table}`);
    }
  }
}

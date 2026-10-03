import { MANUAL_MOVEMENT_TYPES, CASH_MOVEMENT_TYPES } from '../../domain/cash-movement.ts';
import type { Currency, Money } from '../../domain/currency.ts';
import { Decimal } from '../../domain/decimal.ts';
import { DIVIDEND_KINDS, DIVIDEND_STATUSES } from '../../domain/dividend.ts';
import { FX_CURRENCIES } from '../../domain/fx.ts';
import { INSTRUMENT_TYPES } from '../../domain/instrument.ts';
import { TRADE_SIDES } from '../../domain/trade.ts';
import type { User } from '../../domain/user.ts';
import type { Accounts } from '../../application/use-cases/accounts.ts';
import type { Cash } from '../../application/use-cases/cash.ts';
import type { Catalog } from '../../application/use-cases/catalog.ts';
import type { DividendInput, Dividends } from '../../application/use-cases/dividends.ts';
import type { FxRates } from '../../application/use-cases/fx-rates.ts';
import type { Preferences } from '../../application/use-cases/preferences.ts';
import type { Prices } from '../../application/use-cases/prices.ts';
import type { Portfolio } from '../../application/use-cases/portfolio.ts';
import type { TradeInput, Trades } from '../../application/use-cases/trades.ts';
import { HttpError } from './problem.ts';
import {
  presentAccount,
  presentCashMovement,
  presentDividend,
  presentHistoryPoint,
  presentInstrument,
  presentMarket,
  presentPage,
  presentPortfolioSummary,
  presentPreferences,
  presentDividendsMonthly,
  presentCalendar,
  presentAllocation,
  presentSnowball,
  presentPositions,
  presentSummary,
  presentTrade,
  presentTransfer,
} from './presenters.ts';
import type { HttpRequest, HttpResponse, Router } from './router.ts';
import { isUuid, Reader } from './schema.ts';

export type PortfolioUseCases = {
  catalog: Catalog;
  accounts: Accounts;
  trades: Trades;
  dividends: Dividends;
  cash: Cash;
  portfolio: Portfolio;
  preferences: Preferences;
  fxRates: FxRates;
  prices: Prices;
};

type Authed = (handler: (req: HttpRequest, user: User) => Promise<HttpResponse>) => (req: HttpRequest) => Promise<HttpResponse>;

const API = '/api/v1';
const ok = (body: unknown): HttpResponse => ({ status: 200, body });
const created = (body: unknown): HttpResponse => ({ status: 201, body });
const noContent: HttpResponse = { status: 204 };

/** Un id de ruta mal formado no puede existir: 404, igual que uno ajeno. */
function idParam(req: HttpRequest, name: string): string {
  const id = req.params[name]!;
  if (!isUuid(id)) throw new HttpError(404, 'NOT_FOUND');
  return id;
}

function readTradeInput(body: unknown): TradeInput {
  const r = Reader.body(body, ['accountId', 'instrumentId', 'side', 'tradeDate', 'quantity', 'price', 'commission', 'commissionTax', 'needsReview', 'notes']);
  const input = {
    accountId: r.uuid('accountId'),
    instrumentId: r.uuid('instrumentId'),
    side: r.enumOf('side', TRADE_SIDES),
    tradeDate: r.date('tradeDate'),
    quantity: r.decimal('quantity'),
    price: r.decimal('price'),
    commission: r.decimal('commission', { optional: true }),
    commissionTax: r.decimal('commissionTax', { optional: true }),
    needsReview: r.boolean('needsReview', { optional: true }),
    notes: r.nullableString('notes', { max: 200 }),
  };
  r.finish();
  return {
    accountId: input.accountId!,
    instrumentId: input.instrumentId!,
    side: input.side!,
    tradeDate: input.tradeDate!,
    quantity: input.quantity!,
    price: input.price!,
    commission: input.commission ?? Decimal.ZERO,
    commissionTax: input.commissionTax ?? Decimal.ZERO,
    needsReview: input.needsReview ?? false,
    notes: input.notes ?? null,
  };
}

function readDividendInput(body: unknown): DividendInput {
  const r = Reader.body(body, ['accountId', 'instrumentId', 'status', 'kind', 'exDate', 'paymentDate', 'grossAmount', 'perShare', 'quantity', 'withholdingRate', 'netAmount', 'notes']);
  const input = {
    accountId: r.uuid('accountId'),
    instrumentId: r.uuid('instrumentId'),
    status: r.enumOf('status', DIVIDEND_STATUSES),
    kind: r.enumOf('kind', DIVIDEND_KINDS),
    exDate: r.nullableDate('exDate'),
    paymentDate: r.date('paymentDate'),
    grossAmount: r.decimal('grossAmount', { optional: true }),
    perShare: r.decimal('perShare', { optional: true }),
    quantity: r.decimal('quantity', { optional: true }),
    withholdingRate: r.decimal('withholdingRate', { optional: true }),
    netAmount: r.decimal('netAmount', { optional: true }),
    notes: r.nullableString('notes', { max: 200 }),
  };
  if (r.has('grossAmount') === r.has('perShare')) {
    r.errors.push({ field: 'grossAmount', message: 'Se envía grossAmount o perShare (exactamente uno)' });
  }
  if (r.has('quantity') && !r.has('perShare')) r.errors.push({ field: 'quantity', message: 'Sólo junto a perShare' });
  for (const field of ['grossAmount', 'perShare', 'quantity'] as const) {
    if (input[field] && !input[field].isPositive()) r.errors.push({ field, message: 'Debe ser mayor que 0' });
  }
  r.finish();
  return {
    accountId: input.accountId!,
    instrumentId: input.instrumentId!,
    status: input.status!,
    kind: input.kind!,
    exDate: input.exDate ?? null,
    paymentDate: input.paymentDate!,
    grossAmount: input.grossAmount,
    perShare: input.perShare,
    quantity: input.quantity,
    withholdingRate: input.withholdingRate,
    netAmount: input.netAmount,
    notes: input.notes ?? null,
  };
}

export function registerPortfolioRoutes(router: Router, useCases: PortfolioUseCases, authed: Authed): void {
  const { catalog, accounts, trades, dividends, cash, portfolio, preferences, fxRates, prices } = useCases;

  // ── Preferencias y tipos de cambio (v0.3) ──
  router.add('GET', `${API}/me/preferences`, authed(async (_req, user) => ok(presentPreferences(await preferences.get(user.id)))));
  router.add('PATCH', `${API}/me/preferences`, authed(async (req, user) => {
    const r = Reader.body(req.body, ['reportingCurrency', 'monthlyIncomeGoal'], { minProperties: 1 });
    const changes: { reportingCurrency?: Currency | undefined; monthlyIncomeGoal?: Money | null | undefined } = {
      reportingCurrency: r.currency('reportingCurrency', { optional: true }),
    };
    const goal = (req.body as Record<string, unknown>).monthlyIncomeGoal;
    if (goal === null) changes.monthlyIncomeGoal = null;
    else if (goal !== undefined) {
      try {
        const g = Reader.body(goal, ['amount', 'currency']);
        const money = { amount: g.decimal('amount'), currency: g.currency('currency') };
        if (money.amount && !money.amount.isPositive()) g.errors.push({ field: 'amount', message: 'Debe ser mayor que 0' });
        r.errors.push(...g.errors.map((e) => ({ field: `monthlyIncomeGoal.${e.field}`, message: e.message })));
        if (g.errors.length === 0) changes.monthlyIncomeGoal = { amount: money.amount!, currency: money.currency! };
      } catch {
        r.errors.push({ field: 'monthlyIncomeGoal', message: 'Debe ser { amount, currency } o null' });
      }
    }
    r.finish();
    return ok(presentPreferences(await preferences.update(user.id, changes)));
  }));
  router.add('GET', `${API}/fx-rates`, authed(async (req) => {
    const r = Reader.query(req.query);
    const q = {
      base: r.enumOf('base', FX_CURRENCIES),
      quote: r.enumOf('quote', FX_CURRENCIES),
      from: r.date('from', { optional: true }),
      to: r.date('to', { optional: true }),
    };
    r.finish();
    const items = await fxRates.series(q.base!, q.quote!, q.from, q.to);
    return ok({ base: q.base, quote: q.quote, items: items.map((p) => ({ date: p.date, rate: p.rate.toString() })) });
  }));
  router.add('GET', `${API}/fx-rates/latest`, authed(async () =>
    ok({ items: (await fxRates.latest()).map((v) => ({ base: v.base, quote: v.quote, date: v.date, rate: v.rate.toString(), source: v.source })) }),
  ));

  // ── Catálogo ──
  router.add('GET', `${API}/markets`, authed(async () => ok({ items: (await catalog.listMarkets()).map(presentMarket) })));

  router.add('GET', `${API}/instruments`, authed(async (req) => {
    const r = Reader.query(req.query);
    const filter = { q: r.string('q', { optional: true, max: 50 }), marketCode: r.string('marketCode', { optional: true }), ...r.page() };
    r.finish();
    return ok(presentPage(await catalog.searchInstruments(filter), presentInstrument));
  }));

  router.add('POST', `${API}/instruments`, authed(async (req) => {
    const r = Reader.body(req.body, ['symbol', 'marketCode', 'name', 'type', 'currency', 'sector', 'industry', 'withholdingRate', 'annualDividendPerShare', 'priceSymbol']);
    const input = {
      symbol: r.string('symbol', { pattern: /^[A-Za-z0-9.-]{1,20}$/ }),
      marketCode: r.string('marketCode', { min: 1 }),
      name: r.string('name', { min: 1, max: 120 }),
      type: r.enumOf('type', INSTRUMENT_TYPES),
      currency: r.currency('currency', { optional: true }),
      sector: r.nullableString('sector', { max: 60 }),
      industry: r.nullableString('industry', { max: 60 }),
      withholdingRate: r.nullableDecimal('withholdingRate'),
      annualDividendPerShare: r.nullableDecimal('annualDividendPerShare'),
      priceSymbol: r.nullableString('priceSymbol', { max: 30 }),
    };
    r.finish();
    return created(presentInstrument(await catalog.createInstrument({ ...input, symbol: input.symbol!, marketCode: input.marketCode!, name: input.name!, type: input.type! })));
  }));

  router.add('GET', `${API}/instruments/:id`, authed(async (req) => ok(presentInstrument(await catalog.getInstrument(idParam(req, 'id'))))));

  router.add('PATCH', `${API}/instruments/:id`, authed(async (req) => {
    const id = idParam(req, 'id');
    const r = Reader.body(req.body, ['name', 'type', 'sector', 'industry', 'withholdingRate', 'annualDividendPerShare', 'priceSymbol'], { minProperties: 1 });
    const changes = {
      name: r.string('name', { optional: true, min: 1, max: 120 }),
      type: r.enumOf('type', INSTRUMENT_TYPES, { optional: true }),
      sector: r.nullableString('sector', { max: 60 }),
      industry: r.nullableString('industry', { max: 60 }),
      withholdingRate: r.nullableDecimal('withholdingRate'),
      annualDividendPerShare: r.nullableDecimal('annualDividendPerShare'),
      priceSymbol: r.nullableString('priceSymbol', { max: 30 }),
    };
    r.finish();
    const defined = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    return ok(presentInstrument(await catalog.updateInstrument(id, defined)));
  }));

  router.add('GET', `${API}/instruments/:id/prices`, authed(async (req) => {
    const id = idParam(req, 'id');
    const r = Reader.query(req.query);
    const range = { from: r.date('from', { optional: true }), to: r.date('to', { optional: true }) };
    r.finish();
    const { instrument, items } = await prices.list(id, range.from, range.to);
    return ok({
      instrumentId: instrument.id,
      currency: instrument.currency,
      items: items.map((c) => ({ date: c.date, close: c.close.toString(), source: c.source })),
    });
  }));
  router.add('PUT', `${API}/instruments/:id/prices`, authed(async (req) => {
    const id = idParam(req, 'id');
    const r = Reader.body(req.body, ['date', 'price']);
    const input = { date: r.date('date'), price: r.decimal('price') };
    if (input.price && !input.price.isPositive()) r.errors.push({ field: 'price', message: 'Debe ser mayor que 0' });
    r.finish();
    return ok(presentInstrument(await prices.setManual(id, input.date!, input.price!)));
  }));

  // ── Cuentas ──
  router.add('GET', `${API}/accounts`, authed(async (_req, user) => ok({ items: (await accounts.list(user.id)).map(presentAccount) })));

  router.add('POST', `${API}/accounts`, authed(async (req, user) => {
    const r = Reader.body(req.body, ['name', 'broker', 'baseCurrency']);
    const input = { name: r.string('name', { min: 1, max: 60 }), broker: r.string('broker', { min: 1, max: 60 }), baseCurrency: r.currency('baseCurrency') };
    r.finish();
    return created(presentAccount(await accounts.create(user.id, { name: input.name!, broker: input.broker!, baseCurrency: input.baseCurrency! })));
  }));

  router.add('GET', `${API}/accounts/:id`, authed(async (req, user) => ok(presentAccount(await accounts.get(user.id, idParam(req, 'id'))))));

  router.add('PATCH', `${API}/accounts/:id`, authed(async (req, user) => {
    const id = idParam(req, 'id');
    const r = Reader.body(req.body, ['name', 'broker', 'archived'], { minProperties: 1 });
    const changes = {
      name: r.string('name', { optional: true, min: 1, max: 60 }),
      broker: r.string('broker', { optional: true, min: 1, max: 60 }),
      archived: r.boolean('archived', { optional: true }),
    };
    r.finish();
    const defined = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    return ok(presentAccount(await accounts.update(user.id, id, defined)));
  }));

  // ── Operaciones ──
  router.add('GET', `${API}/trades`, authed(async (req, user) => {
    const r = Reader.query(req.query);
    const filter = {
      accountId: r.uuid('accountId', { optional: true }),
      instrumentId: r.uuid('instrumentId', { optional: true }),
      from: r.date('from', { optional: true }),
      to: r.date('to', { optional: true }),
      needsReview: r.boolean('needsReview', { optional: true }),
      ...r.page(),
    };
    r.finish();
    return ok(presentPage(await trades.list(user.id, filter), presentTrade));
  }));
  router.add('POST', `${API}/trades`, authed(async (req, user) => created(presentTrade(await trades.create(user.id, readTradeInput(req.body))))));
  router.add('GET', `${API}/trades/:id`, authed(async (req, user) => ok(presentTrade(await trades.get(user.id, idParam(req, 'id'))))));
  router.add('PUT', `${API}/trades/:id`, authed(async (req, user) => {
    const id = idParam(req, 'id');
    return ok(presentTrade(await trades.replace(user.id, id, readTradeInput(req.body))));
  }));
  router.add('DELETE', `${API}/trades/:id`, authed(async (req, user) => {
    await trades.delete(user.id, idParam(req, 'id'));
    return noContent;
  }));

  // ── Dividendos ──
  router.add('GET', `${API}/dividends`, authed(async (req, user) => {
    const r = Reader.query(req.query);
    const filter = {
      accountId: r.uuid('accountId', { optional: true }),
      instrumentId: r.uuid('instrumentId', { optional: true }),
      status: r.enumOf('status', DIVIDEND_STATUSES, { optional: true }),
      from: r.date('from', { optional: true }),
      to: r.date('to', { optional: true }),
      ...r.page(),
    };
    r.finish();
    return ok(presentPage(await dividends.list(user.id, filter), presentDividend));
  }));
  router.add('GET', `${API}/dividends/monthly`, authed(async (req, user) => {
    const r = Reader.query(req.query);
    const month = /^\d{4}-(0[1-9]|1[0-2])$/;
    const query = {
      reportingCurrency: r.currency('reportingCurrency', { optional: true }),
      from: r.string('from', { optional: true, pattern: month }),
      to: r.string('to', { optional: true, pattern: month }),
    };
    r.finish();
    return ok(presentDividendsMonthly(await portfolio.dividendsMonthly(user.id, query)));
  }));
  router.add('GET', `${API}/dividends/calendar`, authed(async (req, user) => {
    const r = Reader.query(req.query);
    const query = { reportingCurrency: r.currency('reportingCurrency', { optional: true }) };
    r.finish();
    return ok(presentCalendar(await portfolio.dividendCalendar(user.id, query)));
  }));
  router.add('GET', `${API}/dividends/summary`, authed(async (req, user) => {
    const r = Reader.query(req.query);
    const query = {
      year: r.integer('year', { min: 2000, max: 2100 }),
      status: r.enumOf('status', DIVIDEND_STATUSES, { optional: true }),
      accountId: r.uuid('accountId', { optional: true }),
      reportingCurrency: r.currency('reportingCurrency', { optional: true }),
    };
    r.finish();
    return ok(presentSummary(await portfolio.dividendSummary(user.id, { ...query, year: query.year! })));
  }));
  router.add('POST', `${API}/dividends`, authed(async (req, user) => created(presentDividend(await dividends.create(user.id, readDividendInput(req.body))))));
  router.add('GET', `${API}/dividends/:id`, authed(async (req, user) => ok(presentDividend(await dividends.get(user.id, idParam(req, 'id'))))));
  router.add('PUT', `${API}/dividends/:id`, authed(async (req, user) => {
    const id = idParam(req, 'id');
    return ok(presentDividend(await dividends.replace(user.id, id, readDividendInput(req.body))));
  }));
  router.add('DELETE', `${API}/dividends/:id`, authed(async (req, user) => {
    await dividends.delete(user.id, idParam(req, 'id'));
    return noContent;
  }));
  router.add('POST', `${API}/dividends/:id/mark-paid`, authed(async (req, user) => {
    const id = idParam(req, 'id');
    let input = {};
    if (req.body !== undefined) {
      const r = Reader.body(req.body, ['paymentDate', 'netAmount']);
      input = { paymentDate: r.date('paymentDate', { optional: true }), netAmount: r.decimal('netAmount', { optional: true }) };
      r.finish();
    }
    return ok(presentDividend(await dividends.markPaid(user.id, id, input)));
  }));

  // ── Caja ──
  router.add('GET', `${API}/cash-movements`, authed(async (req, user) => {
    const r = Reader.query(req.query);
    const filter = {
      accountId: r.uuid('accountId', { optional: true }),
      currency: r.currency('currency', { optional: true }),
      type: r.enumOf('type', CASH_MOVEMENT_TYPES, { optional: true }),
      from: r.date('from', { optional: true }),
      to: r.date('to', { optional: true }),
      ...r.page(),
    };
    r.finish();
    return ok(presentPage(await cash.list(user.id, filter), presentCashMovement));
  }));
  router.add('POST', `${API}/cash-movements`, authed(async (req, user) => {
    const r = Reader.body(req.body, ['accountId', 'date', 'type', 'amount', 'currency', 'description']);
    const input = {
      accountId: r.uuid('accountId'),
      date: r.date('date'),
      type: r.enumOf('type', MANUAL_MOVEMENT_TYPES),
      amount: r.decimal('amount'),
      currency: r.currency('currency'),
      description: r.nullableString('description', { max: 200 }),
    };
    r.finish();
    return created(presentCashMovement(await cash.create(user.id, {
      accountId: input.accountId!,
      date: input.date!,
      type: input.type!,
      amount: input.amount!,
      currency: input.currency!,
      description: input.description ?? null,
    })));
  }));
  router.add('DELETE', `${API}/cash-movements/:id`, authed(async (req, user) => {
    await cash.delete(user.id, idParam(req, 'id'));
    return noContent;
  }));
  router.add('POST', `${API}/cash-transfers`, authed(async (req, user) => {
    const r = Reader.body(req.body, ['date', 'fromAccountId', 'fromAmount', 'fromCurrency', 'toAccountId', 'toAmount', 'toCurrency', 'description']);
    const input = {
      date: r.date('date'),
      fromAccountId: r.uuid('fromAccountId'),
      fromAmount: r.decimal('fromAmount'),
      fromCurrency: r.currency('fromCurrency'),
      toAccountId: r.uuid('toAccountId'),
      toAmount: r.decimal('toAmount'),
      toCurrency: r.currency('toCurrency'),
      description: r.nullableString('description', { max: 200 }),
    };
    r.finish();
    return created(presentTransfer(await cash.transfer(user.id, {
      date: input.date!,
      fromAccountId: input.fromAccountId!,
      fromAmount: input.fromAmount!,
      fromCurrency: input.fromCurrency!,
      toAccountId: input.toAccountId!,
      toAmount: input.toAmount!,
      toCurrency: input.toCurrency!,
      description: input.description ?? null,
    })));
  }));
  router.add('DELETE', `${API}/cash-transfers/:id`, authed(async (req, user) => {
    await cash.deleteTransfer(user.id, idParam(req, 'id'));
    return noContent;
  }));

  // ── Portafolio ──
  router.add('GET', `${API}/positions`, authed(async (req, user) => {
    const r = Reader.query(req.query);
    const query = {
      groupBy: r.enumOf('groupBy', ['instrument', 'account'] as const, { optional: true }) ?? 'instrument',
      accountId: r.uuid('accountId', { optional: true }),
      includeClosed: r.boolean('includeClosed', { optional: true }) ?? false,
      asOf: r.date('asOf', { optional: true }),
      reportingCurrency: r.currency('reportingCurrency', { optional: true }),
    };
    r.finish();
    return ok(presentPositions(await portfolio.positions(user.id, query)));
  }));

  router.add('GET', `${API}/portfolio/history`, authed(async (req, user) => {
    const r = Reader.query(req.query);
    const query = {
      reportingCurrency: r.currency('reportingCurrency', { optional: true }),
      from: r.date('from', { optional: true }),
      to: r.date('to', { optional: true }),
      interval: r.enumOf('interval', ['day', 'week', 'month'] as const, { optional: true }) ?? 'day',
    };
    r.finish();
    const result = await portfolio.history(user.id, query);
    return ok({ reportingCurrency: result.reportingCurrency, items: result.items.map(presentHistoryPoint) });
  }));

  router.add('GET', `${API}/portfolio/allocation`, authed(async (req, user) => {
    const r = Reader.query(req.query);
    const query = {
      by: r.enumOf('by', ['instrument', 'sector', 'market', 'currency', 'account', 'type'] as const),
      reportingCurrency: r.currency('reportingCurrency', { optional: true }),
      limit: r.integer('limit', { optional: true, min: 1, max: 100 }),
    };
    r.finish();
    return ok(presentAllocation(await portfolio.allocation(user.id, { ...query, by: query.by! })));
  }));

  router.add('GET', `${API}/projections/snowball`, authed(async (req, user) => {
    const r = Reader.query(req.query);
    const growth = (field: string) => {
      const value = r.decimal(field, { optional: true });
      if (value && (value.lt(Decimal.parse('-0.5')) || value.gt(Decimal.parse('0.5')))) r.errors.push({ field, message: 'Debe estar entre -0.5 y 0.5' });
      return value;
    };
    const query = {
      reportingCurrency: r.currency('reportingCurrency', { optional: true }),
      years: r.integer('years', { optional: true, min: 1, max: 50 }),
      monthlyContribution: r.decimal('monthlyContribution', { optional: true }),
      contributionGrowth: growth('contributionGrowth'),
      reinvestDividends: r.boolean('reinvestDividends', { optional: true }),
      dividendGrowth: growth('dividendGrowth'),
      priceGrowth: growth('priceGrowth'),
    };
    if (query.monthlyContribution?.isNegative()) r.errors.push({ field: 'monthlyContribution', message: 'Debe ser >= 0' });
    r.finish();
    return ok(presentSnowball(await portfolio.snowball(user.id, query)));
  }));

  router.add('GET', `${API}/portfolio/summary`, authed(async (req, user) => {
    const r = Reader.query(req.query);
    const query = { reportingCurrency: r.currency('reportingCurrency', { optional: true }), asOf: r.date('asOf', { optional: true }) };
    r.finish();
    return ok(presentPortfolioSummary(await portfolio.summary(user.id, query)));
  }));
}


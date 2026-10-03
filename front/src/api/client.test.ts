import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, createApi } from './client.ts';
import { mockFetch, problem } from '../test/http.ts';

describe('cliente API', () => {
  it('devuelve el cuerpo JSON en una respuesta exitosa', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/auth/me', status: 200, body: { id: 'u1', email: 'a@b.cl' } }]);

    const user = await createApi().getMe();

    expect(user).toEqual({ id: 'u1', email: 'a@b.cl' });
  });

  it('envía cookies del mismo origen y JSON con Content-Type en mutaciones', async () => {
    const fetchMock = mockFetch([{ method: 'POST', path: '/api/v1/auth/login', status: 204 }]);

    await createApi().login({ email: 'a@b.cl', password: 'secreto' });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ email: 'a@b.cl', password: 'secreto' }));
  });

  it('no envía Content-Type en peticiones GET', async () => {
    const fetchMock = mockFetch([{ method: 'GET', path: '/api/v1/auth/me', status: 200, body: { id: 'u1', email: 'a@b.cl' } }]);

    await createApi().getMe();

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
  });

  it('resuelve sin valor en una respuesta 204 sin cuerpo', async () => {
    mockFetch([{ method: 'POST', path: '/api/v1/auth/logout', status: 204 }]);

    await expect(createApi().logout()).resolves.toBeUndefined();
  });

  it('convierte application/problem+json en un ApiError tipado con code', async () => {
    mockFetch([{ method: 'POST', path: '/api/v1/auth/login', ...problem(401, 'INVALID_CREDENTIALS', 'Unauthorized') }]);

    const error = await createApi().login({ email: 'a@b.cl', password: 'x' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect((error as ApiError).problem?.title).toBe('Unauthorized');
  });

  it('produce un ApiError sin code cuando el error no es problem+json (p. ej. 429 de nginx)', async () => {
    mockFetch([{ method: 'POST', path: '/api/v1/auth/login', status: 429, body: '<html>', contentType: 'text/html' }]);

    const error = await createApi().login({ email: 'a@b.cl', password: 'x' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: undefined, problem: undefined });
  });

  it('convierte un fallo de red en NetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(createApi().getMe()).rejects.toBeInstanceOf(NetworkError);
  });

  it('avisa con onUnauthenticated cuando la API responde UNAUTHENTICATED', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/auth/me', ...problem(401, 'UNAUTHENTICATED') }]);
    const onUnauthenticated = vi.fn();

    await createApi({ onUnauthenticated }).getMe().catch(() => {});

    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('no avisa onUnauthenticated ante credenciales inválidas en login', async () => {
    mockFetch([{ method: 'POST', path: '/api/v1/auth/login', ...problem(401, 'INVALID_CREDENTIALS') }]);
    const onUnauthenticated = vi.fn();

    await createApi({ onUnauthenticated }).login({ email: 'a@b.cl', password: 'x' }).catch(() => {});

    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('getHealth devuelve el cuerpo también en 503 (BD caída)', async () => {
    mockFetch([{ method: 'GET', path: '/api/v1/health', status: 503, body: { status: 'degraded', db: 'down' } }]);

    await expect(createApi().getHealth()).resolves.toEqual({ status: 'degraded', db: 'down' });
  });
});

describe('cliente API — endpoints de Fase 1', () => {
  it('serializa la query omitiendo vacíos y convierte booleanos', async () => {
    const fetchMock = mockFetch([{ method: 'GET', path: '/api/v1/trades', status: 200, body: { items: [], total: 0 } }]);

    await createApi().listTrades({ accountId: 'a1', needsReview: true, instrumentId: undefined, from: '' as never, limit: 50 });

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/trades?accountId=a1&needsReview=true&limit=50');
  });

  it('usa PATCH, PUT y DELETE con Content-Type JSON', async () => {
    const fetchMock = mockFetch([
      { method: 'PATCH', path: '/api/v1/accounts/a1', status: 200, body: { id: 'a1' } },
      { method: 'PUT', path: '/api/v1/trades/t1', status: 200, body: { id: 't1' } },
      { method: 'DELETE', path: '/api/v1/trades/t1', status: 204 },
    ]);
    const api = createApi();

    await api.updateAccount('a1', { archived: true });
    await api.replaceTrade('t1', { accountId: 'a1', instrumentId: 'i1', side: 'BUY', tradeDate: '2026-01-02', quantity: '1', price: '10', needsReview: false });
    await api.deleteTrade('t1');

    expect(fetchMock.mock.calls.map(([, init]) => [init?.method, new Headers(init?.headers).get('Content-Type')])).toEqual([
      ['PATCH', 'application/json'],
      ['PUT', 'application/json'],
      ['DELETE', 'application/json'],
    ]);
    expect(fetchMock.mock.calls[0]![1]?.body).toBe('{"archived":true}');
  });

  it('codifica los ids en la ruta', async () => {
    const fetchMock = mockFetch([{ method: 'POST', path: '/api/v1/dividends/a%2Fb/mark-paid', status: 200, body: {} }]);

    await createApi().markDividendPaid('a/b', {});

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/dividends/a%2Fb/mark-paid');
  });

  it('getDividendSummary envía el año requerido', async () => {
    const fetchMock = mockFetch([{ method: 'GET', path: '/api/v1/dividends/summary', status: 200, body: { year: 2026, groups: [] } }]);

    await createApi().getDividendSummary({ year: 2026, status: 'PAID' });

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/dividends/summary?year=2026&status=PAID');
  });
});

describe('cliente API — Fase 2', () => {
  it('lee y actualiza preferencias con PATCH', async () => {
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/me/preferences', status: 200, body: { reportingCurrency: 'USD' } },
      { method: 'PATCH', path: '/api/v1/me/preferences', status: 200, body: { reportingCurrency: 'CLP' } },
    ]);
    const api = createApi();

    await expect(api.getPreferences()).resolves.toEqual({ reportingCurrency: 'USD' });
    await expect(api.updatePreferences({ reportingCurrency: 'CLP' })).resolves.toEqual({ reportingCurrency: 'CLP' });
    expect(fetchMock.mock.calls[1]![1]?.body).toBe('{"reportingCurrency":"CLP"}');
  });

  it('pide el resumen de cartera y los tipos de cambio vigentes', async () => {
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/portfolio/summary', status: 200, body: {} },
      { method: 'GET', path: '/api/v1/fx-rates/latest', status: 200, body: { items: [] } },
    ]);
    const api = createApi();

    await api.getPortfolioSummary({ reportingCurrency: 'CLP' });
    await api.getLatestFxRates();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/portfolio/summary?reportingCurrency=CLP', '/api/v1/fx-rates/latest']);
  });
});

describe('cliente API — Fase 3', () => {
  it('lista los cierres de un instrumento y registra un precio manual con PUT', async () => {
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/instruments/i1/prices', status: 200, body: { instrumentId: 'i1', currency: 'CLP', items: [] } },
      { method: 'PUT', path: '/api/v1/instruments/i1/prices', status: 200, body: { id: 'i1' } },
    ]);
    const api = createApi();

    await api.listInstrumentPrices('i1', { from: '2026-01-01' });
    await api.setManualPrice('i1', { date: '2026-10-03', price: '2701' });

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/instruments/i1/prices?from=2026-01-01');
    expect(fetchMock.mock.calls[1]![1]?.method).toBe('PUT');
    expect(fetchMock.mock.calls[1]![1]?.body).toBe('{"date":"2026-10-03","price":"2701"}');
  });

  it('pide la serie histórica del portafolio con intervalo y moneda', async () => {
    const point = {
      date: '2026-09-30', marketValue: '64000.5', costBasis: '61570.59', cash: '3343.6', contributedCapital: '60436.52',
      dividendsNetCumulative: '4194.05', realizedGainCumulative: '308.44', unpricedAtCost: '0',
    };
    const fetchMock = mockFetch([{ method: 'GET', path: '/api/v1/portfolio/history', status: 200, body: { reportingCurrency: 'USD', items: [point] } }]);

    const history = await createApi().getPortfolioHistory({ reportingCurrency: 'USD', interval: 'month', from: '2025-01-01' });

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/portfolio/history?reportingCurrency=USD&interval=month&from=2025-01-01');
    expect(history.items[0]).toEqual(point);
  });
});

describe('cliente API — Fase 4', () => {
  it('pide dividendos mensuales, calendario, distribución y proyección con sus parámetros', async () => {
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/dividends/monthly', status: 200, body: { reportingCurrency: 'USD', months: [], years: [] } },
      { method: 'GET', path: '/api/v1/dividends/calendar', status: 200, body: { reportingCurrency: 'USD', totalNet: '0', months: [] } },
      { method: 'GET', path: '/api/v1/portfolio/allocation', status: 200, body: { by: 'sector', reportingCurrency: 'USD', total: '0', items: [] } },
      { method: 'GET', path: '/api/v1/projections/snowball', status: 200, body: {} },
    ]);
    const api = createApi();

    await api.getDividendsMonthly({ reportingCurrency: 'USD', from: '2024-11' });
    await api.getDividendCalendar({ reportingCurrency: 'CLP' });
    await api.getPortfolioAllocation({ by: 'sector', reportingCurrency: 'USD' });
    await api.getSnowballProjection({ reportingCurrency: 'USD', years: 20, monthlyContribution: '500', reinvestDividends: false, dividendGrowth: '0.05' });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/dividends/monthly?reportingCurrency=USD&from=2024-11',
      '/api/v1/dividends/calendar?reportingCurrency=CLP',
      '/api/v1/portfolio/allocation?by=sector&reportingCurrency=USD',
      '/api/v1/projections/snowball?reportingCurrency=USD&years=20&monthlyContribution=500&reinvestDividends=false&dividendGrowth=0.05',
    ]);
  });

  it('actualiza y quita la meta de ingreso pasivo con PATCH /me/preferences', async () => {
    const fetchMock = mockFetch([{ method: 'PATCH', path: '/api/v1/me/preferences', status: 200, body: { reportingCurrency: 'USD', monthlyIncomeGoal: null } }]);
    const api = createApi();

    await api.updatePreferences({ monthlyIncomeGoal: { amount: '1500', currency: 'USD' } });
    await api.updatePreferences({ monthlyIncomeGoal: null });

    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toEqual([
      '{"monthlyIncomeGoal":{"amount":"1500","currency":"USD"}}',
      '{"monthlyIncomeGoal":null}',
    ]);
  });
});

describe('cliente API — Fase 5', () => {
  it('pide DPA y año contra año con sus parámetros', async () => {
    const fetchMock = mockFetch([
      { method: 'GET', path: '/api/v1/dividends/per-share', status: 200, body: { asOf: '2026-10-04', cutThreshold: '0.10', items: [] } },
      { method: 'GET', path: '/api/v1/dividends/year-over-year', status: 200, body: { amountCurrency: 'USD', converted: true, availableYears: [], years: [] } },
    ]);
    const api = createApi();

    await api.getDividendsPerShare();
    await api.getDividendsPerShare({ cutThreshold: '0.2' });
    await api.getDividendsYearOverYear({ reportingCurrency: 'USD' });
    await api.getDividendsYearOverYear({ reportingCurrency: 'USD', currency: 'CLP', years: '2024,2025,2026' });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/dividends/per-share',
      '/api/v1/dividends/per-share?cutThreshold=0.2',
      '/api/v1/dividends/year-over-year?reportingCurrency=USD',
      '/api/v1/dividends/year-over-year?reportingCurrency=USD&currency=CLP&years=2024%2C2025%2C2026',
    ]);
  });
});

import { useId, useState, type FormEvent } from 'react';
import type { Account, Api, Currency, Instrument, InstrumentType, Market } from '../../api/client.ts';
import { InputError } from '../../api/errors.ts';
import { ConfirmDialog } from '../../components/Modal.tsx';
import { Badge, ErrorAlert, Loading, Pager, TableWrap } from '../../components/ui.tsx';
import { formatMoney, formatPercent, fractionToPercent, normalizeDecimal, percentToFraction } from '../../lib/format.ts';
import { CURRENCIES, INSTRUMENT_TYPE } from '../../lib/labels.ts';
import { useAsync } from '../../lib/useAsync.ts';

const LIMIT = 100;

export function SettingsScreen({ api }: { api: Api }) {
  return (
    <div className="screen">
      <h1>Configuración</h1>
      <AccountsSection api={api} />
      <InstrumentsSection api={api} />
    </div>
  );
}

// ── Cuentas ──

function AccountsSection({ api }: { api: Api }) {
  const [version, setVersion] = useState(0);
  const [renaming, setRenaming] = useState<Account | null>(null);
  const [toggling, setToggling] = useState<Account | null>(null);
  const accounts = useAsync(() => api.listAccounts(), [api, version]);
  const refresh = () => setVersion((v) => v + 1);

  return (
    <section aria-labelledby="accounts-title">
      <h2 id="accounts-title">Cuentas</h2>
      <ErrorAlert error={accounts.error} />
      {accounts.data ? (
        <TableWrap label="Lista de cuentas">
          <thead>
            <tr>
              <th scope="col">Nombre</th>
              <th scope="col">Broker</th>
              <th scope="col">Moneda base</th>
              <th scope="col">Estado</th>
              <th scope="col">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.data.items.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.broker}</td>
                <td>{a.baseCurrency}</td>
                <td>{a.archived ? <Badge tone="warn">Archivada</Badge> : <Badge tone="ok">Activa</Badge>}</td>
                <td className="row-actions">
                  <button type="button" className="secondary" onClick={() => setRenaming(a)}>
                    Renombrar
                  </button>
                  <button type="button" className="secondary" onClick={() => setToggling(a)}>
                    {a.archived ? 'Reactivar' : 'Archivar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        !accounts.error && <Loading />
      )}

      <div className="card">
        <h3>Nueva cuenta</h3>
        <AccountForm api={api} onSaved={refresh} />
      </div>

      {renaming && <RenameDialog account={renaming} onClose={() => setRenaming(null)} onSave={(name) => api.updateAccount(renaming.id, { name }).then(refresh)} />}
      {toggling && (
        <ConfirmDialog
          title={`${toggling.archived ? 'Reactivar' : 'Archivar'} ${toggling.name}`}
          confirmLabel={toggling.archived ? 'Reactivar' : 'Archivar'}
          onClose={() => setToggling(null)}
          onConfirm={() => api.updateAccount(toggling.id, { archived: !toggling.archived }).then(refresh)}
        >
          <p>
            {toggling.archived
              ? 'La cuenta volverá a aceptar operaciones, dividendos y movimientos.'
              : 'La cuenta no aceptará nuevas operaciones, dividendos ni movimientos. Lo registrado se mantiene.'}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function AccountForm({ api, onSaved }: { api: Api; onSaved: () => void }) {
  const ids = useId();
  const [name, setName] = useState('');
  const [broker, setBroker] = useState('');
  const [baseCurrency, setBaseCurrency] = useState<Currency>('CLP');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !broker.trim()) {
      setError('Indica nombre y broker.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.createAccount({ name: name.trim(), broker: broker.trim(), baseCurrency });
      setName('');
      setBroker('');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="form-grid" aria-label="Nueva cuenta" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor={`${ids}-name`}>Nombre</label>
        <input id={`${ids}-name`} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-broker`}>Broker</label>
        <input id={`${ids}-broker`} maxLength={60} value={broker} onChange={(e) => setBroker(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-currency`}>Moneda base</label>
        <select id={`${ids}-currency`} value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value as Currency)}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="span-all">
        <ErrorAlert error={error} />
      </div>
      <div className="actions span-all">
        <button type="submit" disabled={submitting}>
          {submitting ? 'Guardando…' : 'Crear cuenta'}
        </button>
      </div>
    </form>
  );
}

function RenameDialog({ account, onClose, onSave }: { account: Account; onClose: () => void; onSave: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState(account.name);
  return (
    <ConfirmDialog
      title="Renombrar cuenta"
      confirmLabel="Guardar"
      onClose={onClose}
      onConfirm={() => (name.trim() ? onSave(name.trim()) : Promise.reject(new InputError('El nombre no puede quedar vacío.')))}
    >
      <div className="field">
        <label htmlFor="rename-account">Nombre</label>
        <input id="rename-account" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
    </ConfirmDialog>
  );
}

// ── Instrumentos ──

function InstrumentsSection({ api }: { api: Api }) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Instrument | null>(null);
  const refresh = () => setVersion((v) => v + 1);
  const markets = useAsync(() => api.listMarkets(), [api]);
  const instruments = useAsync(() => api.listInstruments({ q: q || undefined, limit: LIMIT, offset }), [api, q, offset, version]);

  return (
    <section aria-labelledby="instruments-title">
      <h2 id="instruments-title">Instrumentos</h2>
      <form
        className="filters"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search.trim());
          setOffset(0);
        }}
      >
        <div className="field">
          <label htmlFor="instrument-search">Buscar instrumento</label>
          <input id="instrument-search" type="search" maxLength={50} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button type="submit" className="secondary">
          Buscar
        </button>
      </form>
      <ErrorAlert error={instruments.error} />
      {instruments.data ? (
        <>
          <TableWrap label="Lista de instrumentos">
            <thead>
              <tr>
                <th scope="col">Símbolo</th>
                <th scope="col">Mercado</th>
                <th scope="col">Nombre</th>
                <th scope="col">Tipo</th>
                <th scope="col">Moneda</th>
                <th scope="col">Sector / industria</th>
                <th scope="col" className="num">Retención</th>
                <th scope="col" className="num">Dividendo anual</th>
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {instruments.data.items.map((i) => (
                <tr key={i.id}>
                  <td className="strong">{i.symbol}</td>
                  <td>{i.marketCode}</td>
                  <td>{i.name}</td>
                  <td>{INSTRUMENT_TYPE[i.type]}</td>
                  <td>{i.currency}</td>
                  <td>{[i.sector, i.industry].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="num">
                    {formatPercent(i.effectiveWithholdingRate)}
                    {i.withholdingRate === null && <small className="muted"> (mercado)</small>}
                  </td>
                  <td className="num">{i.annualDividendPerShare === null ? '—' : formatMoney(i.annualDividendPerShare, i.currency)}</td>
                  <td className="row-actions">
                    <button type="button" className="secondary" onClick={() => setEditing(i)}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pager offset={offset} limit={LIMIT} total={instruments.data.total} onChange={setOffset} />
        </>
      ) : (
        !instruments.error && <Loading />
      )}

      <div className="card">
        <h3>Nuevo instrumento</h3>
        {markets.data ? <InstrumentCreateForm api={api} markets={markets.data.items} onSaved={refresh} /> : <ErrorAlert error={markets.error} />}
      </div>

      {editing && <InstrumentEditDialog api={api} instrument={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </section>
  );
}

type InstrumentDetails = { sector: string; industry: string; withholding: string; annualDividend: string };

/** Campos opcionales comunes a crear y editar: "" → null; retención en % → fracción. */
function detailsToBody(d: InstrumentDetails) {
  const withholdingRate = d.withholding.trim() === '' ? null : percentToFraction(d.withholding);
  if (d.withholding.trim() !== '' && (withholdingRate === null || Number(withholdingRate) > 1))
    throw new InputError('La retención debe ser un porcentaje entre 0 y 100 (vacío = la del mercado).');
  const annualDividendPerShare = d.annualDividend.trim() === '' ? null : normalizeDecimal(d.annualDividend);
  if (d.annualDividend.trim() !== '' && (!annualDividendPerShare || annualDividendPerShare.startsWith('-')))
    throw new InputError('El dividendo anual debe ser un monto ≥ 0.');
  return { sector: d.sector.trim() || null, industry: d.industry.trim() || null, withholdingRate, annualDividendPerShare };
}

function DetailsFields({ ids, value, onChange }: { ids: string; value: InstrumentDetails; onChange: (v: InstrumentDetails) => void }) {
  const set = (key: keyof InstrumentDetails) => (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value });
  return (
    <>
      <div className="field">
        <label htmlFor={`${ids}-sector`}>Sector</label>
        <input id={`${ids}-sector`} maxLength={60} value={value.sector} onChange={set('sector')} />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-industry`}>Industria</label>
        <input id={`${ids}-industry`} maxLength={60} value={value.industry} onChange={set('industry')} />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-wh`}>Retención (%) — vacío usa la del mercado</label>
        <input id={`${ids}-wh`} inputMode="decimal" value={value.withholding} onChange={set('withholding')} />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-div`}>Dividendo anual por acción</label>
        <input id={`${ids}-div`} inputMode="decimal" value={value.annualDividend} onChange={set('annualDividend')} />
      </div>
    </>
  );
}

function TypeSelect({ id, value, onChange }: { id: string; value: InstrumentType; onChange: (t: InstrumentType) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as InstrumentType)}>
      {Object.entries(INSTRUMENT_TYPE).map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

function InstrumentEditDialog({ api, instrument, onClose, onSaved }: { api: Api; instrument: Instrument; onClose: () => void; onSaved: () => void }) {
  const ids = useId();
  const [name, setName] = useState(instrument.name);
  const [type, setType] = useState(instrument.type);
  const [details, setDetails] = useState<InstrumentDetails>({
    sector: instrument.sector ?? '',
    industry: instrument.industry ?? '',
    withholding: instrument.withholdingRate === null ? '' : fractionToPercent(instrument.withholdingRate),
    annualDividend: instrument.annualDividendPerShare ?? '',
  });

  async function save() {
    if (!name.trim()) throw new InputError('El nombre no puede quedar vacío.');
    await api.updateInstrument(instrument.id, { name: name.trim(), type, ...detailsToBody(details) });
    onSaved();
  }

  return (
    <ConfirmDialog title={`Editar ${instrument.symbol}`} confirmLabel="Guardar" onClose={onClose} onConfirm={save}>
      <p className="muted">
        {instrument.marketCode} · {instrument.currency} (símbolo, mercado y moneda no se pueden cambiar)
      </p>
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor={`${ids}-name`}>Nombre</label>
          <input id={`${ids}-name`} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-type`}>Tipo</label>
          <TypeSelect id={`${ids}-type`} value={type} onChange={setType} />
        </div>
        <DetailsFields ids={ids} value={details} onChange={setDetails} />
      </div>
    </ConfirmDialog>
  );
}

function InstrumentCreateForm({ api, markets, onSaved }: { api: Api; markets: Market[]; onSaved: () => void }) {
  const ids = useId();
  const empty: InstrumentDetails = { sector: '', industry: '', withholding: '', annualDividend: '' };
  const [symbol, setSymbol] = useState('');
  const [marketCode, setMarketCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<InstrumentType>('STOCK');
  const [details, setDetails] = useState(empty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalized = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,20}$/.test(normalized)) return setError('El símbolo admite letras, números, punto y guion (hasta 20).');
    if (!marketCode) return setError('Elige el mercado.');
    if (!name.trim()) return setError('Indica el nombre.');
    setSubmitting(true);
    try {
      await api.createInstrument({ symbol: normalized, marketCode, name: name.trim(), type, ...detailsToBody(details) });
      setSymbol('');
      setName('');
      setDetails(empty);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="form-grid" aria-label="Nuevo instrumento" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor={`${ids}-symbol`}>Símbolo</label>
        <input id={`${ids}-symbol`} maxLength={20} value={symbol} onChange={(e) => setSymbol(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-market`}>Mercado</label>
        <select id={`${ids}-market`} value={marketCode} onChange={(e) => setMarketCode(e.target.value)}>
          <option value="">Elige…</option>
          {markets.map((m) => (
            <option key={m.code} value={m.code}>
              {m.code} — {m.name} ({m.currency})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${ids}-name`}>Nombre</label>
        <input id={`${ids}-name`} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-type`}>Tipo</label>
        <TypeSelect id={`${ids}-type`} value={type} onChange={setType} />
      </div>
      <DetailsFields ids={ids} value={details} onChange={setDetails} />
      <div className="span-all">
        <ErrorAlert error={error} />
      </div>
      <div className="actions span-all">
        <button type="submit" disabled={submitting}>
          {submitting ? 'Guardando…' : 'Crear instrumento'}
        </button>
      </div>
    </form>
  );
}

import ExcelJS from 'exceljs';
import { numberToDecimal, type RawDividend, type RawHolding, type RawTrade, type RawWorkbook } from './raw.ts';

// Única pieza que conoce exceljs: convierte el libro en RawWorkbook.

type Cell = ExcelJS.CellValue;

function value(cell: Cell): unknown {
  if (cell && typeof cell === 'object') {
    if (cell instanceof Date) return cell;
    if ('result' in cell) return cell.result;
    if ('richText' in cell) return cell.richText.map((r) => r.text).join('');
    if ('text' in cell) return cell.text;
  }
  return cell;
}

function text(cell: Cell): string | null {
  const v = value(cell);
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function num(cell: Cell, where: string): number {
  const v = value(cell);
  if (typeof v !== 'number') throw new Error(`${where}: se esperaba un número y vino ${JSON.stringify(v)}`);
  return v;
}

/** Fecha de negocio: el día UTC (las horas 01:00 son artefactos del cambio de horario). */
function date(cell: Cell, where: string): string {
  const v = value(cell);
  if (!(v instanceof Date)) throw new Error(`${where}: se esperaba una fecha y vino ${JSON.stringify(v)}`);
  return v.toISOString().slice(0, 10);
}

function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`Falta la hoja "${name}"`);
  return ws;
}

function readTrades(wb: ExcelJS.Workbook, name: string, market: 'CL' | 'US', side: 'BUY' | 'SELL'): RawTrade[] {
  const trades: RawTrade[] = [];
  sheet(wb, name).eachRow((row, n) => {
    if (n < 3 || !text(row.getCell(3).value)) return;
    const where = `${name}!${n}`;
    trades.push({
      sheet: name,
      row: n,
      market,
      side,
      date: date(row.getCell(2).value, where),
      symbol: text(row.getCell(3).value)!,
      price: numberToDecimal(num(row.getCell(4).value, where)),
      quantity: numberToDecimal(num(row.getCell(5).value, where)),
      commission: numberToDecimal(num(row.getCell(6).value, where), 4),
      tax: numberToDecimal(num(row.getCell(7).value, where), 4),
    });
  });
  return trades;
}

function readDividends(wb: ExcelJS.Workbook): RawDividend[] {
  const dividends: RawDividend[] = [];
  sheet(wb, 'Dividends').eachRow((row, n) => {
    if (n < 3 || !text(row.getCell(2).value)) return;
    const where = `Dividends!${n}`;
    const country = text(row.getCell(6).value);
    const currency = text(row.getCell(7).value);
    if ((country !== 'CHILE' && country !== 'USA') || (currency !== 'CLP' && currency !== 'USD')) {
      throw new Error(`${where}: país/moneda inesperados ${country}/${currency}`);
    }
    dividends.push({
      row: n,
      symbol: text(row.getCell(2).value)!,
      date: date(row.getCell(3).value, where),
      country,
      currency,
      amount: numberToDecimal(num(row.getCell(8).value, where)),
      type: text(row.getCell(9).value),
    });
  });
  return dividends;
}

/** "Portafolio Acciones": secciones CHILE y USA con su encabezado; filas hasta "Total". */
function readHoldings(wb: ExcelJS.Workbook): { holdings: RawHolding[]; cash: Record<string, number> } {
  const ws = sheet(wb, 'Portafolio Acciones');
  const holdings: RawHolding[] = [];
  const cash: Record<string, number> = {};
  let section: { market: 'CL' | 'US'; columns: Map<string, number> } | null = null;
  let investedColumn = 5;

  ws.eachRow((row, n) => {
    const b = text(row.getCell(2).value);
    if ((b === 'CHILE' || b === 'USA') && text(row.getCell(3).value) === 'Precio compra') {
      const columns = new Map<string, number>();
      row.eachCell((cell, col) => {
        const header = text(cell.value);
        if (header) columns.set(header, col);
      });
      section = { market: b === 'CHILE' ? 'CL' : 'US', columns };
      investedColumn = columns.get('Monto invertido') ?? investedColumn;
      return;
    }
    if (b?.startsWith('Caja ')) {
      cash[b] = num(row.getCell(investedColumn).value, `Portafolio Acciones!${n}`);
      return;
    }
    if (!section || !b) return;
    if (b === 'Total') {
      section = null;
      return;
    }
    const where = `Portafolio Acciones!${n}`;
    const col = (header: string) => {
      const c = section!.columns.get(header);
      if (c === undefined) throw new Error(`${where}: falta la columna "${header}"`);
      return row.getCell(c).value;
    };
    const theoretical = value(col('Div. teórico'));
    holdings.push({
      market: section.market,
      symbol: b,
      quantity: numberToDecimal(num(col('Acciones'), where)),
      invested: numberToDecimal(num(col('Monto invertido'), where), 4),
      sector: text(col('Sector')),
      industry: text(col('Industry')),
      theoreticalDividend: typeof theoretical === 'number' ? numberToDecimal(theoretical, 10) : null,
    });
  });
  return { holdings, cash };
}

export async function readWorkbook(path: string): Promise<RawWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const { holdings, cash } = readHoldings(wb);
  const cashOf = (label: string) => {
    if (cash[label] === undefined) throw new Error(`Falta "${label}" en Portafolio Acciones`);
    return numberToDecimal(cash[label], 4);
  };
  return {
    trades: [
      ...readTrades(wb, 'Compra Acciones CL', 'CL', 'BUY'),
      ...readTrades(wb, 'Ventas Acciones CL', 'CL', 'SELL'),
      ...readTrades(wb, 'Compra Acciones US', 'US', 'BUY'),
      ...readTrades(wb, 'Ventas Acciones US', 'US', 'SELL'),
    ],
    dividends: readDividends(wb),
    holdings,
    cash: { itau: cashOf('Caja Itau'), ib: cashOf('Caja IB'), zesty: cashOf('Caja Zesty') },
  };
}

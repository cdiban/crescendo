import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../src/interfaces/http/problem.ts';
import { Router } from '../../src/interfaces/http/router.ts';
import { json, startServer, type TestServer } from '../support/http.ts';

class Teapot extends Error {}

describe('Router (node:http)', () => {
  let server: TestServer;

  before(async () => {
    const router = new Router({
      maxBodyBytes: 64,
      mapError: (err) => (err instanceof Teapot ? new HttpError(400, 'VALIDATION_ERROR', 'mapeado') : undefined),
      logError: () => {},
    });
    router.add('GET', '/api/v1/hola', async () => ({ status: 200, body: { hola: 'mundo' } }));
    router.add('POST', '/api/v1/eco', async (req) => ({ status: 200, body: { recibido: req.body ?? null } }));
    router.add('GET', '/api/v1/explota', async () => {
      throw new Error('detalle interno secreto');
    });
    router.add('GET', '/api/v1/mapeado', async () => {
      throw new Teapot();
    });
    router.add('GET', '/api/v1/vacio', async () => ({ status: 204 }));
    server = await startServer(router.listener());
  });

  after(() => server.close());

  const JSON_HEADERS = { 'content-type': 'application/json' };

  test('ruta existente → JSON', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/hola?x=1`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await json(res), { hola: 'mundo' });
  });

  test('204 sin cuerpo', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/vacio`);
    assert.equal(res.status, 204);
    assert.equal(await res.text(), '');
  });

  test('ruta inexistente → 404 problem+json', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/nada`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') ?? '', /^application\/problem\+json/);
    assert.deepEqual(await json(res), { type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND' });
  });

  test('método no registrado en una ruta existente → 405 METHOD_NOT_ALLOWED con Allow', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/hola`, { method: 'DELETE', headers: JSON_HEADERS });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET');
    assert.match(res.headers.get('content-type') ?? '', /^application\/problem\+json/);
    assert.deepEqual(await json(res), {
      type: 'about:blank',
      title: 'Method Not Allowed',
      status: 405,
      code: 'METHOD_NOT_ALLOWED',
    });
  });

  test('parsea el cuerpo JSON', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/eco`, { method: 'POST', headers: JSON_HEADERS, body: '{"a":1}' });
    assert.deepEqual(await json(res), { recibido: { a: 1 } });
  });

  test('cuerpo vacío → undefined', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/eco`, { method: 'POST', headers: JSON_HEADERS });
    assert.deepEqual(await json(res), { recibido: null });
  });

  test('JSON inválido → 400 VALIDATION_ERROR', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/eco`, { method: 'POST', headers: JSON_HEADERS, body: '{"a":' });
    assert.equal(res.status, 400);
    const body = await json(res);
    assert.equal(body.code, 'VALIDATION_ERROR');
    assert.equal(body.status, 400);
  });

  test('cuerpo mayor al límite → 413', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/eco`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ a: 'x'.repeat(100) }),
    });
    assert.equal(res.status, 413);
    assert.match(res.headers.get('content-type') ?? '', /^application\/problem\+json/);
    const problem = await json(res);
    assert.equal(problem.status, 413);
    assert.equal(problem.code, 'PAYLOAD_TOO_LARGE');
  });

  test('cuerpo mayor al límite sin Content-Length (chunked) → 413', async () => {
    const chunks = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 10; i++) controller.enqueue(new TextEncoder().encode('"xxxxxxxxxxxxxxxx"'));
        controller.close();
      },
    });
    const res = await fetch(`${server.baseUrl}/api/v1/eco`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: chunks,
      duplex: 'half',
    } as RequestInit);
    assert.equal(res.status, 413);
    assert.equal((await json(res)).code, 'PAYLOAD_TOO_LARGE');
  });

  test('error no controlado → 500 INTERNAL_ERROR sin filtrar detalles', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/explota`);
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(!text.includes('secreto'));
    assert.equal(JSON.parse(text).code, 'INTERNAL_ERROR');
  });

  test('mapError traduce errores de aplicación', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/mapeado`);
    assert.equal(res.status, 400);
    assert.equal((await json(res)).detail, 'mapeado');
  });
});

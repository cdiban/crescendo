import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';

export type TestServer = { baseUrl: string; close(): Promise<void> };

export async function startServer(listener: RequestListener): Promise<TestServer> {
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** `Response.json()` tipa `unknown`; en los tests se inspecciona libremente. */

export async function json(res: Response): Promise<any> {
  return res.json();
}

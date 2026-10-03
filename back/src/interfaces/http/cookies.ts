export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index !== -1 && pair.slice(0, index).trim() === name) return pair.slice(index + 1).trim();
  }
  return undefined;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds: number; secure: boolean },
): string {
  return [
    `${name}=${value}`,
    'HttpOnly',
    ...(options.secure ? ['Secure'] : []),
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${options.maxAgeSeconds}`,
  ].join('; ');
}

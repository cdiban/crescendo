/**
 * Lee la contraseña desde stdin. En una terminal la pide sin eco; si stdin es
 * un pipe (`printf … | docker compose exec -T api …`) lee la primera línea.
 */
export async function readPassword(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let text = '';
    for await (const chunk of stdin) text += String(chunk);
    return text.split(/\r?\n/)[0] ?? '';
  }

  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise((resolve, reject) => {
    let password = '';
    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stderr.write('\n');
      if (error) reject(error);
      else resolve(password);
    };
    const onData = (data: string) => {
      for (const char of data) {
        if (char === '\r' || char === '\n' || char === '\u0004') return finish();
        if (char === '\u0003') return finish(new Error('Cancelado'));
        if (char === '\u007f' || char === '\b') password = [...password].slice(0, -1).join('');
        else password += char;
      }
    };
    stdin.on('data', onData);
  });
}

import { describe, expect, it } from 'vitest';
import { REDACTED, redactString, redactValue } from '../../src/lib/audit/redact';

/** Valores sintéticos. Nenhum é credencial real. */
const SECRET = 'SYNTH-s3cr3t-value';

describe('redactString: chaves entre aspas em JSON e texto', () => {
  it('JSON com chave e valor entre aspas: troca só o valor', () => {
    const out = redactString(`{"api_key":"${SECRET}","name":"Acme"}`);
    expect(out).not.toContain(SECRET);
    expect(out).toBe(`{"api_key":"${REDACTED}","name":"Acme"}`);
  });

  it('aspas simples: \'token\': \'valor\'', () => {
    const out = redactString(`{'token': '${SECRET}'}`);
    expect(out).not.toContain(SECRET);
    expect(out).toContain(`'token': '${REDACTED}'`);
  });

  it('JSON com espaço antes do separador e valor não textual', () => {
    expect(redactString(`{"password" : "${SECRET}"}`)).not.toContain(SECRET);
    const numeric = redactString('{"token":123456}');
    expect(numeric).not.toContain('123456');
  });

  it('chave composta entre aspas (client_secret, access_token)', () => {
    expect(redactString(`{"client_secret":"${SECRET}"}`)).not.toContain(SECRET);
    expect(redactString(`{"access_token": "${SECRET}"}`)).not.toContain(SECRET);
  });

  it('Authorization com Bearer, sem aspas: mascara o esquema e o token juntos', () => {
    const out = redactString(`Authorization: Bearer ${SECRET}`);
    expect(out).not.toContain(SECRET);
    expect(out).toBe(`Authorization: ${REDACTED}`);
  });

  it('"Authorization": "Bearer x" entre aspas', () => {
    const out = redactString(`{"Authorization": "Bearer ${SECRET}"}`);
    expect(out).not.toContain(SECRET);
    expect(out).toContain(`"Authorization": "${REDACTED}"`);
  });

  it('Bearer solto em texto livre continua mascarado', () => {
    expect(redactString(`falhou com Bearer ${SECRET} na URL`)).not.toContain(SECRET);
  });

  it('parâmetros de URL e chave=valor em texto', () => {
    expect(redactString(`https://x.example/y?api_key=${SECRET}&page=2`)).not.toContain(SECRET);
    expect(redactString(`password=${SECRET}; ok`)).not.toContain(SECRET);
  });

  it('texto sem segredo fica intacto', () => {
    const plain = '{"name":"Acme","module":"tickets","count":3}';
    expect(redactString(plain)).toBe(plain);
  });
});

describe('redactValue: objetos com chaves sensíveis', () => {
  it('troca o valor de chave sensível e preserva o resto', () => {
    const out = redactValue({ api_key: SECRET, note: 'ok', nested: { token: SECRET } }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(out.note).toBe('ok');
  });

  it('string JSON dentro de um campo de mensagem também é mascarada', () => {
    const out = redactValue({ message: `payload {"apiKey":"${SECRET}"}` }) as { message: string };
    expect(out.message).not.toContain(SECRET);
  });
});

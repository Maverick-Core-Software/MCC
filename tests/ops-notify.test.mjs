// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { sendOpsSms } from '../lib/ops-notify.mjs';

const TWILIO_KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'OPS_SMS_TO'];
const saved = Object.fromEntries(TWILIO_KEYS.map(key => [key, process.env[key]]));

function configureEnv() {
  process.env.TWILIO_ACCOUNT_SID = 'ACtest';
  process.env.TWILIO_AUTH_TOKEN = 'token-test';
  process.env.TWILIO_PHONE_NUMBER = '+15550001111';
  process.env.OPS_SMS_TO = '+15552223333';
}

afterEach(() => {
  for (const key of TWILIO_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('sendOpsSms', () => {
  it('reports not sent when Twilio env is not configured', async () => {
    for (const key of TWILIO_KEYS) delete process.env[key];
    const calls = [];
    const result = await sendOpsSms('hello', { fetchImpl: async (...args) => { calls.push(args); } });
    expect(result).toMatchObject({ sent: false });
    expect(calls).toEqual([]);
  });

  it('posts the Twilio message form with basic auth when configured', async () => {
    configureEnv();
    const calls = [];
    const result = await sendOpsSms('Thumbtack review needed', {
      fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true }; },
    });
    expect(result).toMatchObject({ sent: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe(`Basic ${Buffer.from('ACtest:token-test').toString('base64')}`);
    const body = new URLSearchParams(calls[0].init.body);
    expect(body.get('To')).toBe('+15552223333');
    expect(body.get('From')).toBe('+15550001111');
    expect(body.get('Body')).toBe('Thumbtack review needed');
  });

  it('caps the message body at 320 characters', async () => {
    configureEnv();
    const calls = [];
    await sendOpsSms('x'.repeat(500), { fetchImpl: async (url, init) => { calls.push(init); return { ok: true }; } });
    expect(new URLSearchParams(calls[0].body).get('Body')).toHaveLength(320);
  });

  it('never throws when the HTTP call fails', async () => {
    configureEnv();
    const result = await sendOpsSms('hello', { fetchImpl: async () => { throw new Error('network down'); } });
    expect(result).toMatchObject({ sent: false });
  });

  it('reports not sent on a non-2xx Twilio response', async () => {
    configureEnv();
    const result = await sendOpsSms('hello', { fetchImpl: async () => ({ ok: false, status: 401 }) });
    expect(result).toMatchObject({ sent: false });
  });
});

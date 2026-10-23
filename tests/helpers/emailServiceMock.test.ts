import { describe, expect, it, jest } from '@jest/globals';
import type { sendEmail } from '../../src/services/email.service.js';
import { createEmailServiceMock } from './mocks.js';

// The transport is created lazily inside sendEmail(), so importing the real
// module only to read its export names opens no SMTP/SendGrid connection.
const emailService = await import('../../src/services/email.service.js');

describe('createEmailServiceMock', () => {
  it('exposes exactly the named exports of email.service — no missing or stale names', () => {
    expect(Object.keys(createEmailServiceMock()).sort()).toEqual(Object.keys(emailService).sort());
  });

  it('mirrors the runtime kind of every export', () => {
    const mock: Record<string, unknown> = createEmailServiceMock();
    for (const [name, real] of Object.entries(emailService)) {
      expect({ name, kind: typeof mock[name] }).toEqual({ name, kind: typeof real });
    }
  });

  it('defaults are inert: sendEmail resolves without sending and templates embed the link', async () => {
    const mock = createEmailServiceMock();

    await expect(
      mock.sendEmail({ to: 'user@example.test', subject: 'Hi', html: '<p>Hi</p>' })
    ).resolves.toBeUndefined();
    expect(mock.resetPasswordEmailHtml('https://app.example.test/reset')).toContain(
      'https://app.example.test/reset'
    );
    expect(mock.invitationEmailHtml('https://app.example.test/invite')).toContain(
      'https://app.example.test/invite'
    );
  });

  it('applies explicit overrides over the defaults', () => {
    const sendEmailOverride = jest.fn<typeof sendEmail>().mockResolvedValue(undefined);
    const invitationEmailHtml = (link: string) => `<a href="${link}">join</a>`;

    const mock = createEmailServiceMock({ sendEmail: sendEmailOverride, invitationEmailHtml });

    expect(mock.sendEmail).toBe(sendEmailOverride);
    expect(mock.invitationEmailHtml).toBe(invitationEmailHtml);
  });
});

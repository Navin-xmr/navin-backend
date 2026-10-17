import { describe, expect, it, jest } from '@jest/globals';
import * as realEmailService from '../../src/services/email.service.js';
import { createEmailServiceMock } from './mocks.js';

describe('createEmailServiceMock', () => {
  it('matches the exact named export surface of src/services/email.service.js', () => {
    const mock = createEmailServiceMock();
    const realKeys = Object.keys(realEmailService).sort();
    const mockKeys = Object.keys(mock).sort();

    expect(mockKeys).toEqual(realKeys);
  });

  it('provides side-effect-free defaults for sendEmail and HTML builders', async () => {
    const mock = createEmailServiceMock();

    await expect(
      mock.sendEmail({
        to: 'user@example.com',
        subject: 'Welcome',
        html: '<p>Hello</p>',
      })
    ).resolves.toBeUndefined();
    expect(mock.sendEmail).toHaveBeenCalledTimes(1);

    expect(mock.resetPasswordEmailHtml('https://navin.io/reset?token=abc')).toContain(
      'https://navin.io/reset?token=abc'
    );
    expect(mock.invitationEmailHtml('https://navin.io/invite?token=xyz', 'Alice')).toContain(
      'https://navin.io/invite?token=xyz'
    );
  });

  it('accepts explicit overrides for individual exports', async () => {
    const customSendEmail = jest.fn<typeof realEmailService.sendEmail>().mockResolvedValue();
    const mock = createEmailServiceMock({
      sendEmail: customSendEmail,
      resetPasswordEmailHtml: (link: string) => `<custom>${link}</custom>`,
    });

    await mock.sendEmail({ to: 'a@b.com', subject: 'Test', html: '<b>Hi</b>' });
    expect(customSendEmail).toHaveBeenCalledWith({
      to: 'a@b.com',
      subject: 'Test',
      html: '<b>Hi</b>',
    });
    expect(mock.resetPasswordEmailHtml('https://example.com/r')).toBe(
      '<custom>https://example.com/r</custom>'
    );
  });
});

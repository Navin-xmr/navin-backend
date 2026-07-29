describe('sms-otp service module', () => {
  it('imports without Twilio credentials configured', async () => {
    delete process.env.TWILIO_SID;
    delete process.env.TWILIO_TOKEN;
    delete process.env.TWILIO_FROM;

    const service = await import('./sms-otp.service.js');

    expect(typeof service.sendOtpService).toBe('function');
    expect(typeof service.verifyOtpService).toBe('function');
  });
});

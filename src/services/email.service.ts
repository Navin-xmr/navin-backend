import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../config/index.js';
import { logger } from '../shared/logger/logger.js';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (config.sendgridApiKey) {
    transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: {
        user: 'apikey',
        pass: config.sendgridApiKey,
      },
    });
    logger.info('Email transport configured: SendGrid');
  } else if (config.smtp.host) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth:
        config.smtp.user && config.smtp.pass
          ? { user: config.smtp.user, pass: config.smtp.pass }
          : undefined,
    });
    logger.info({ host: config.smtp.host }, 'Email transport configured: SMTP');
  } else {
    logger.warn('No email transport configured — emails will be logged only');
  }

  return transporter!;
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const from = config.smtp.from || 'noreply@navin.io';

  const transport = getTransporter();
  if (!transport) {
    logger.info({ to: params.to, subject: params.subject }, 'Email (no transport configured)');
    return;
  }

  await transport.sendMail({ from, to: params.to, subject: params.subject, html: params.html });
  logger.info({ to: params.to, subject: params.subject }, 'Email sent');
}

export function resetPasswordEmailHtml(resetLink: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2>Reset Your Password</h2>
  <p>You requested a password reset for your Navin account.</p>
  <p>Click the link below to set a new password. This link expires in 1 hour.</p>
  <p style="margin:24px 0">
    <a href="${resetLink}" style="background:#2563eb;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">
      Reset Password
    </a>
  </p>
  <p style="color:#666;font-size:13px">If you did not request this, you can safely ignore this email.</p>
</body>
</html>`;
}

export function invitationEmailHtml(inviteLink: string, inviterName?: string): string {
  const greeting = inviterName
    ? `<p><strong>${inviterName}</strong> has invited you to join Navin.</p>`
    : `<p>You have been invited to join Navin.</p>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2>You're Invited</h2>
  ${greeting}
  <p>Click the link below to create your account. This invitation expires in 48 hours.</p>
  <p style="margin:24px 0">
    <a href="${inviteLink}" style="background:#2563eb;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">
      Accept Invitation
    </a>
  </p>
</body>
</html>`;
}

import type { Request, Response } from 'express';
import { sendResponse } from '../../shared/http/sendResponse.js';
import { sendOtpService, verifyOtpService } from './sms-otp.service.js';
import type { SendOtpInput, VerifyOtpInput } from './sms-otp.validation.js';

export const sendOtpController = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.userId ?? '';
  const data = req.body as SendOtpInput;

  await sendOtpService(userId, data.phone);

  sendResponse(res, 200, true, 'OTP sent successfully', null);
};

export const verifyOtpController = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.userId ?? '';
  const data = req.body as VerifyOtpInput;

  const user = await verifyOtpService(userId, data.phone, data.otp);

  sendResponse(res, 200, true, 'Phone verified successfully', user);
};

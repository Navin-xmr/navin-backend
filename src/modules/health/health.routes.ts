import { Router } from "express";
import { asyncHandler } from "../../shared/http/asyncHandler.js";
import { healthController } from "./health.controller.js";

export const healthRouter = Router();

healthRouter.get("/", asyncHandler(healthController));

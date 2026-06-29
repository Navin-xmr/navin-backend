import type { RequestHandler } from 'express';
import * as organizationsService from './organizations.service.js';
import { sendResponse } from '../../shared/http/sendResponse.js';

export const createOrganizationController: RequestHandler = async (req, res) => {
  const organization = await organizationsService.createOrganizationService({
    name: req.body.name,
    type: req.body.type,
    settings: req.body.settings,
    callerRole: req.user?.role ?? '',
  });
  sendResponse(res, 201, true, 'Organization created successfully', organization);
};

export const listOrganizationsController: RequestHandler = async (req, res) => {
  const organizations = await organizationsService.listOrganizationsService(req.user?.role ?? '');
  sendResponse(res, 200, true, 'Organizations retrieved successfully', organizations);
};

export const getOrganizationController: RequestHandler = async (req, res) => {
  const organization = await organizationsService.getOrganizationService({
    id: req.params.id,
    callerRole: req.user?.role ?? '',
    callerOrganizationId: req.user?.organizationId,
  });
  sendResponse(res, 200, true, 'Organization retrieved successfully', organization);
};

export const updateOrganizationController: RequestHandler = async (req, res) => {
  const organization = await organizationsService.updateOrganizationService({
    id: req.params.id,
    updates: req.body,
    callerRole: req.user?.role ?? '',
    callerOrganizationId: req.user?.organizationId,
  });
  sendResponse(res, 200, true, 'Organization updated successfully', organization);
};

export const deleteOrganizationController: RequestHandler = async (req, res) => {
  const organization = await organizationsService.deleteOrganizationService({
    id: req.params.id,
    callerRole: req.user?.role ?? '',
  });
  sendResponse(res, 200, true, 'Organization deleted successfully', organization);
};
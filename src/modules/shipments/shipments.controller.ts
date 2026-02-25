import { Shipment, ShipmentStatus } from './shipments.model.js';
import { Request, Response } from 'express';
import { UserModel } from '../users/users.model.js';
import { tokenizeShipment } from '../../services/stellar.service.js';
import { mockUploadToStorage } from '../../services/mockStorageService.js';

type ParsedMultipartFile = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
};

const parseMultipartRequest = async (req: Request): Promise<{ fields: Record<string, string>; file?: ParsedMultipartFile }> => {
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('multipart/form-data')) {
    return { fields: {} };
  }

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    throw new Error('Invalid multipart boundary');
  }

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve());
    req.on('error', reject);
  });

  const raw = Buffer.concat(chunks).toString('latin1');
  const parts = raw.split(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: ParsedMultipartFile | undefined;

  for (const part of parts) {
    if (!part || part === '--\r\n' || part === '--' || part === '\r\n') continue;

    const normalized = part.startsWith('\r\n') ? part.slice(2) : part;
    const separatorIndex = normalized.indexOf('\r\n\r\n');
    if (separatorIndex < 0) continue;

    const headerSection = normalized.slice(0, separatorIndex);
    let bodySection = normalized.slice(separatorIndex + 4);
    if (bodySection.endsWith('\r\n')) {
      bodySection = bodySection.slice(0, -2);
    }

    const disposition = headerSection
      .split('\r\n')
      .find((line) => line.toLowerCase().startsWith('content-disposition:'));
    if (!disposition) continue;

    const nameMatch = disposition.match(/name="([^"]+)"/i);
    const filenameMatch = disposition.match(/filename="([^"]*)"/i);
    const fieldName = nameMatch?.[1];
    if (!fieldName) continue;

    if (filenameMatch) {
      const contentTypeLine = headerSection
        .split('\r\n')
        .find((line) => line.toLowerCase().startsWith('content-type:'));
      const mimeType = contentTypeLine?.split(':')[1]?.trim() ?? 'application/octet-stream';
      const fileBuffer = Buffer.from(bodySection, 'latin1');
      file = {
        buffer: fileBuffer,
        originalName: filenameMatch[1] || 'upload.bin',
        mimeType,
        size: fileBuffer.length,
      };
    } else {
      fields[fieldName] = bodySection;
    }
  }

  return { fields, file };
};

export const getShipments = async (req: Request, res: Response) => {
  const { status, page = 1, limit = 10, ...filters } = req.query;
  const query: any = { ...filters };
  if (status) query.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const shipments = await Shipment.find(query)
    .skip(skip)
    .limit(Number(limit));
  const total = await Shipment.countDocuments(query);

  res.json({
    data: shipments,
    page: Number(page),
    limit: Number(limit),
    total,
  });
};

export const createShipment = async (req: Request, res: Response) => {
  const { trackingNumber, origin, destination, enterpriseId, logisticsId, status, milestones, offChainMetadata } = req.body;
  const shipment = new Shipment({ trackingNumber, origin, destination, enterpriseId, logisticsId, status, milestones, offChainMetadata });
  await shipment.save();

  try {
    const stellar = await tokenizeShipment({
      trackingNumber,
      origin,
      destination,
      shipmentId: shipment._id.toString(),
    });
    shipment.stellarTokenId = stellar.stellarTokenId;
    shipment.stellarTxHash = stellar.stellarTxHash;
    await shipment.save();
  } catch (err) {
    console.warn('Stellar tokenization skipped:', (err as Error).message);
  }

  res.status(201).json(shipment);
};

export const patchShipment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { offChainMetadata } = req.body;
  const shipment = await Shipment.findByIdAndUpdate(id, { offChainMetadata }, { new: true });
  if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
  res.json(shipment);
};

export const updateShipmentStatus = async (id: string, status: ShipmentStatus, actor?: { userId?: string; walletAddress?: string }) => {
  const shipment = await Shipment.findById(id);
  if (!shipment) return null;

  if (shipment.status === status) return shipment;

  // Validate status
  if (!Object.values(ShipmentStatus).includes(status)) {
    throw new Error('Invalid status');
  }

  shipment.status = status;

  const milestone: any = {
    name: status,
    timestamp: new Date(),
    description: `Status changed to ${status}`,
  };

  if (actor?.userId) {
    milestone.userId = actor.userId;
  }
  if (actor?.walletAddress) {
    milestone.walletAddress = actor.walletAddress;
  }

  shipment.milestones.push(milestone);

  await shipment.save();
  return shipment;
};

export const patchShipmentStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || typeof status !== 'string') return res.status(400).json({ message: 'Missing status' });

  if (!Object.values(ShipmentStatus).includes(status as ShipmentStatus)) {
    return res.status(400).json({ message: 'Invalid status value' });
  }

  // resolve actor info from authenticated user if present
  const user = (req as any).user;
  let walletAddress: string | undefined;
  if (user?.userId) {
    const found = await UserModel.findById(user.userId);
    walletAddress = found?.walletAddress || undefined;
  }

  try {
    const updated = await updateShipmentStatus(id, status as ShipmentStatus, { userId: user?.userId, walletAddress });
    if (!updated) return res.status(404).json({ message: 'Shipment not found' });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ message: err.message || 'Failed to update status' });
  }
};

export const uploadShipmentProof = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { fields, file } = await parseMultipartRequest(req);
    const recipientSignatureName = fields.recipientSignatureName;

    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const fakeUrl = await mockUploadToStorage(file);
    const shipment = await Shipment.findByIdAndUpdate(
      id,
      {
        deliveryProof: {
          url: fakeUrl,
          recipientSignatureName,
          uploadedAt: new Date(),
        },
      },
      { new: true },
    );

    if (!shipment) {
      return res.status(404).json({ message: 'Shipment not found' });
    }

    return res.status(200).json({ shipment });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error });
  }
};

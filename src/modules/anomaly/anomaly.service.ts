import { Anomaly } from './anomaly.model.js';

interface TelemetryData {
  _id: string;
  shipmentId: string;
  temperature: number;
  humidity: number;
  batteryLevel: number;
}

interface AnomalyResult {
  detected: boolean;
  anomaly?: {
    _id: string;
    shipmentId: string;
    telemetryId: string;
    type: string;
    severity: string;
    message: string;
    detectedValue: number;
    threshold: number;
  };
}

export async function detectAnomaly(data: TelemetryData): Promise<AnomalyResult> {
  if (data.temperature > 25) {
    const anomaly = await Anomaly.create({
      shipmentId: data.shipmentId,
      telemetryId: data._id,
      type: 'temperature',
      severity: data.temperature > 30 ? 'high' : 'medium',
      message: `Temperature exceeded threshold: ${data.temperature}°C`,
      detectedValue: data.temperature,
      threshold: 25,
    });
    return { detected: true, anomaly: anomaly.toObject() };
  }

  if (data.humidity > 80) {
    const anomaly = await Anomaly.create({
      shipmentId: data.shipmentId,
      telemetryId: data._id,
      type: 'humidity',
      severity: data.humidity > 90 ? 'high' : 'medium',
      message: `Humidity exceeded threshold: ${data.humidity}%`,
      detectedValue: data.humidity,
      threshold: 80,
    });
    return { detected: true, anomaly: anomaly.toObject() };
  }

  if (data.batteryLevel < 20) {
    const anomaly = await Anomaly.create({
      shipmentId: data.shipmentId,
      telemetryId: data._id,
      type: 'battery',
      severity: data.batteryLevel < 10 ? 'high' : 'low',
      message: `Battery level critically low: ${data.batteryLevel}%`,
      detectedValue: data.batteryLevel,
      threshold: 20,
    });
    return { detected: true, anomaly: anomaly.toObject() };
  }

  return { detected: false };
}

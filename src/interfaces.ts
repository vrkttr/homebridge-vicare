import type {PlatformConfig as HomebridgePlatformConfig} from 'homebridge';

export interface ViessmannAPIResponse<T> {
  data: T;
}

export interface ViessmannAPIError {
  error: string;
  errorType: string;
  message: string;
  statusCode: number;
  viErrorId: string;
}

export interface ViessmannAuthorization {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: string;
}

export interface ViessmannInstallation {
  accessLevel: string;
  aggregatedStatus: string;
  description: string;
  endUserWlanCommissioned: boolean;
  id: number;
  installationType: string;
  ownedByMaintainer: boolean;
  ownershipType: string;
  registeredAt: string;
  updatedAt: string;
  withoutViCareUser: boolean;
}

export interface ViessmannGateway {
  aggregatedStatus: string;
  autoUpdate: boolean;
  createdAt: string;
  description: string | null;
  firmwareUpdateFailureCounter: number;
  gatewayType: string;
  installationId: number;
  lastStatusChangedAt: string;
  otaOngoing: boolean;
  producedAt: string;
  registeredAt: string;
  serial: string;
  targetRealm: string;
  version: string;
}

export interface ViessmannFeatureCommandParam {
  constraints: {
    max?: number;
    maxLength?: number;
    min?: number;
    minLength?: number;
    stepping?: number;
  };
  required: boolean;
  type: string;
}

export interface ViessmannFeatureCommand {
  uri: string;
  name: string;
  isExecutable: boolean;
  params: Record<string, ViessmannFeatureCommandParam>;
}

export interface ViessmannFeatureProperty<T> {
  type: string;
  value: T;
}

export interface ViessmannFeature<T> {
  apiVersion: number;
  commands: Record<string, ViessmannFeatureCommand>;
  components: ViessmannSmartComponent[];
  deviceId: string;
  feature: string;
  gatewayId: string;
  isEnabled: boolean;
  isReady: boolean;
  properties?: Record<string, ViessmannFeatureProperty<T>>;
  timestamp: string;
  uri: string;
}

export interface ViessmannSmartComponent {
  id: string;
  name: string;
  selected: boolean;
  deleted: boolean;
}

export interface LocalDevice {
  name: string;
  feature: string;
  deviceId: string;
  type: 'thermostat' | 'temperature_sensor';
}

export interface LocalConfig {
  apiEndpoint: string;
  clientId: string;
  devices: Array<HomebridgePlatformConfig & LocalDevice>;
  hostIp?: string;
  maxTemp?: number;
  name: string;
  platform: string;
}

export interface LocalStorage {
  refreshToken?: string;
}

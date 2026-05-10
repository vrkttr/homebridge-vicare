import {describe, it, expect, vi, beforeEach} from 'vitest';

// Mock homebridge index exports before importing the platform
vi.mock('../index.js', () => ({
  Accessory: vi.fn(),
  Characteristic: {
    CurrentHeatingCoolingState: {HEAT: 1},
    Manufacturer: 'Manufacturer',
    Model: 'Model',
    SerialNumber: 'SerialNumber',
    TargetHeatingCoolingState: {HEAT: 1},
  },
  Service: {
    AccessoryInformation: {UUID: 'accessory-info-uuid'},
    Switch: vi.fn(),
    TemperatureSensor: vi.fn(),
    Thermostat: vi.fn(),
  },
  UUIDGen: {generate: vi.fn().mockReturnValue('test-uuid')},
}));

// Mock RequestService
vi.mock('../RequestService.js', () => ({
  RequestService: vi.fn().mockImplementation(function () {
    return {
      accessToken: undefined,
      refreshToken: undefined,
      refreshAuth: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// Mock node:fs to avoid actual file I/O
vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn().mockResolvedValue('{}'),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock internal-ip
vi.mock('internal-ip', () => ({
  internalIpV4: vi.fn().mockResolvedValue('127.0.0.1'),
}));

import {DEFAULT_API_ENDPOINT, ViCareThermostatPlatform} from '../ViCareThermostatPlatform.js';

function createMockLog() {
  const log = Object.assign(vi.fn(), {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  });
  return log;
}

function createMockApi() {
  return {
    on: vi.fn(),
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    updatePlatformAccessories: vi.fn(),
    user: {
      storagePath: vi.fn().mockReturnValue('/tmp/homebridge-vicare-test'),
    },
  };
}

describe('ViCareThermostatPlatform', () => {
  describe('DEFAULT_API_ENDPOINT', () => {
    it('should have the correct Viessmann API endpoint', () => {
      expect(DEFAULT_API_ENDPOINT).toBe('https://api.viessmann-climatesolutions.com/iot/v2');
    });

    it('should be a valid URL', () => {
      expect(() => new URL(DEFAULT_API_ENDPOINT)).not.toThrow();
    });
  });

  describe('constructor', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should use the default API endpoint when apiEndpoint is not provided in config', () => {
      const log = createMockLog();
      const api = createMockApi();
      const config = {
        clientId: 'test-client-id',
        devices: [],
        name: 'ViCareThermostatPlatform',
        platform: 'ViCareThermostatPlatform',
        // apiEndpoint intentionally omitted
      };

      const platform = new ViCareThermostatPlatform(log as any, config as any, api as any);
      expect((platform as any).apiEndpoint).toBe(DEFAULT_API_ENDPOINT);
    });

    it('should use the provided apiEndpoint when specified in config', () => {
      const log = createMockLog();
      const api = createMockApi();
      const customEndpoint = 'https://custom.api.example.com/v2';
      const config = {
        apiEndpoint: customEndpoint,
        clientId: 'test-client-id',
        devices: [],
        name: 'ViCareThermostatPlatform',
        platform: 'ViCareThermostatPlatform',
      };

      const platform = new ViCareThermostatPlatform(log as any, config as any, api as any);
      expect((platform as any).apiEndpoint).toBe(customEndpoint);
    });

    it('should not throw when apiEndpoint is undefined', () => {
      const log = createMockLog();
      const api = createMockApi();
      const config = {
        apiEndpoint: undefined,
        clientId: 'test-client-id',
        devices: [],
        name: 'ViCareThermostatPlatform',
        platform: 'ViCareThermostatPlatform',
      };

      const platform = new ViCareThermostatPlatform(log as any, config as any, api as any);
      expect((platform as any).apiEndpoint).toBe(DEFAULT_API_ENDPOINT);
    });

    it('should register didFinishLaunching event listener', () => {
      const log = createMockLog();
      const api = createMockApi();
      const config = {
        clientId: 'test-client-id',
        devices: [],
        name: 'ViCareThermostatPlatform',
        platform: 'ViCareThermostatPlatform',
      };

      new ViCareThermostatPlatform(log as any, config as any, api as any);

      expect(api.on).toHaveBeenCalledWith('didFinishLaunching', expect.any(Function));
    });
  });
});

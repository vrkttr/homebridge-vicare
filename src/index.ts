import crypto from 'node:crypto';
import http from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {internalIpV4} from 'internal-ip';
import {
  type CharacteristicGetCallback,
  type API as HomebridgeAPI,
  type Characteristic as HomebridgeCharacteristic,
  type CharacteristicSetCallback as HomebridgeCharacteristicSetCallback,
  type CharacteristicValue as HomebridgeCharacteristicValue,
  type Logging as HomebridgeLogging,
  type PlatformAccessory as HomebridgePlatformAccessory,
  type PlatformConfig as HomebridgePlatformConfig,
  type Service as HomebridgeService,
  type uuid,
} from 'homebridge';

import {RequestService} from './RequestService.js';

import type {
  LocalConfig,
  ViessmannAPIResponse,
  ViessmannInstallation,
  ViessmannGateway,
  ViessmannSmartComponent,
  ViessmannFeature,
  LocalDevice,
  ViessmannAuthorization,
  LocalStorage,
} from './interfaces.js';

let Service: typeof HomebridgeService;
let Characteristic: typeof HomebridgeCharacteristic;
let Accessory: typeof HomebridgePlatformAccessory;
let UUIDGen: typeof uuid;

export default (homebridge: HomebridgeAPI) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.platformAccessory;
  UUIDGen = homebridge.hap.uuid;
  homebridge.registerPlatform('homebridge-vicare-2', 'ViCareThermostatPlatform', ViCareThermostatPlatform);
};

class ViCareThermostatPlatform {
  private readonly accessories: HomebridgePlatformAccessory[];
  private readonly apiEndpoint: string;
  private readonly clientId: string;
  private readonly codeChallenge: string;
  private readonly codeVerifier: string;
  private readonly devices: Array<HomebridgePlatformConfig & LocalDevice>;
  private readonly localStoragePath: string;
  private requestService: RequestService;
  private localStorage?: LocalStorage;
  private gatewaySerial?: string;
  private hostIp?: string;
  private installationId?: number;
  private redirectUri?: string;
  private server?: http.Server;

  constructor(
    private readonly log: HomebridgeLogging,
    public readonly config: HomebridgePlatformConfig & LocalConfig,
    private readonly api: HomebridgeAPI
  ) {
    this.clientId = config.clientId;
    this.apiEndpoint = config.apiEndpoint;
    this.devices = config.devices;
    this.accessories = [];
    this.codeVerifier = this.generateCodeVerifier();
    this.codeChallenge = this.generateCodeChallenge(this.codeVerifier);
    this.localStoragePath = path.join(api.user.storagePath(), 'homebridge-vicare-2-settings.json');
    this.requestService = new RequestService(this.log, this.clientId);

    this.log.debug('Loaded config', config);

    this.api.on('didFinishLaunching', async () => {
      const storage = await this.loadLocalStorage();

      if (storage) {
        this.localStorage = storage;
      }

      try {
        if (this.localStorage?.refreshToken) {
          this.log('Found refresh token in storage file 🙌');
          this.requestService.refreshToken = this.localStorage.refreshToken;
          await this.requestService.refreshAuth();
        } else {
          throw new Error('No token found');
        }
      } catch(error) {
        this.log.warn('Refresh token invalid:', error);
        await this.startAuth();
      }

      try {
        const {installationId, gatewaySerial} = await this.retrieveIds();
        this.log('Retrieved installation and gateway IDs.');

        this.installationId = installationId;
        this.gatewaySerial = gatewaySerial;

        for (const deviceConfig of this.devices) {
          this.addAccessory(deviceConfig);
        }

        await this.retrieveSmartComponents();
      } catch (error) {
        this.log.error('Error retrieving installation or gateway IDs:', error);
        throw error;
      }

      this.log('All set up! ✨');
    });
  }
  
  private async startAuth() {
    this.log('Starting authentication process...');
    this.hostIp = config.hostIp || (await internalIpV4());
    this.redirectUri = `http://${this.hostIp}:4200`;
    this.log.debug(`Using redirect URI: ${this.redirectUri}`);

    try {
      const {access_token, refresh_token} = await this.authenticate();
      this.requestService.accessToken = access_token;
      this.requestService.refreshToken = refresh_token;
      await this.saveLocalStorage({...this.localStorage, refreshToken: refresh_token});
    } catch (error) {
      this.log.error('Error during authentication:', error);
      throw error;
    }

    if (this.requestService.accessToken) {
      this.log('Authentication successful, received access token.');
    } else {
      this.log.error('Authentication did not succeed, received no access token.');
      return;
    }
  }

  public configureAccessory(accessory: HomebridgePlatformAccessory) {
    this.accessories.push(accessory);
  }

  private async saveLocalStorage(config: LocalStorage): Promise<void> {
    this.log.debug('Saving local storage ...');

    try {
      await fs.writeFile(this.localStoragePath, JSON.stringify(config), 'utf-8');
    } catch (error) {
      this.log.warn('Error while saving local storage:', error);
      return;
    }

    this.log.debug('Successfully saved local storage.');
  }

  private async loadLocalStorage(): Promise<LocalStorage | null> {
    this.log.debug('Loading local storage ...');

    let storageFileRaw: string | undefined;
    let storage: LocalStorage | undefined;

    try {
      storageFileRaw = await fs.readFile(this.localStoragePath, 'utf-8');
    } catch {
      this.log.debug('No storage file found, creating ...');
      await fs.writeFile(this.localStoragePath, '{}', 'utf-8');
    }

    if (storageFileRaw) {
      try {
        storage = JSON.parse(storageFileRaw);
      } catch {
        this.log.warn(`Storage file "${this.localStoragePath}" is not valid JSON`);
      }
    } else {
      this.log.debug('No storage file found, creating ...');
      await fs.writeFile(this.localStoragePath, '{}', 'utf-8');
    }

    return storage || null;
  }

  private generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(codeVerifier: string) {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  }

  private authenticate(): Promise<ViessmannAuthorization> {
    const params = new URLSearchParams();
    params.set('client_id', this.clientId);
    params.set('redirect_uri', encodeURIComponent(this.redirectUri!));
    params.set('scope', encodeURIComponent('IoT User offline_access'));
    params.set('response_type', 'code');
    params.set('code_challenge_method', 'S256');
    params.set('code_challenge', this.codeChallenge);

    const authUrl = `https://iam.viessmann.com/idp/v3/authorize?${params.toString()}`;

    this.log(`Click this link for authentication: ${authUrl}`);
    return this.getCodeViaServer();
  }

  private getCodeViaServer(): Promise<ViessmannAuthorization> {
    return new Promise((resolve, reject) => {
      this.server = http
        .createServer((req, res) => {
          const url = new URL(req.url!, `http://${req.headers.host}`);
          const authCode = url.searchParams.get('code');
          if (authCode) {
            this.log.debug('Received authorization code:', authCode);
            res.writeHead(200, {'Content-Type': 'text/plain'});
            res.end('Authorization successful. You can close this window.');
            this.exchangeCodeForToken(authCode)
              .then(auth => {
                this.server!.close();
                resolve(auth);
              })
              .catch(reject);
          } else {
            res.writeHead(400, {'Content-Type': 'text/plain'});
            res.end('Authorization code not found.');
          }
        })
        .listen(4200, this.hostIp, () => {
          this.log.debug(`Server is listening on ${this.hostIp}:4200`);
        });
    });
  }

  private async exchangeCodeForToken(authCode: string): Promise<ViessmannAuthorization> {
    const tokenUrl = 'https://iam.viessmann.com/idp/v3/token';

    const params = new URLSearchParams();
    params.set('client_id', this.clientId);
    params.set('redirect_uri', this.redirectUri!);
    params.set('grant_type', 'authorization_code');
    params.set('code_verifier', this.codeVerifier);
    params.set('code', authCode);

    this.log.debug('Exchanging authorization code for access token...');

    try {
      const response = await this.requestService.request(tokenUrl, 'post', {
        body: params,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const tokenResponse = (await response.json()) as ViessmannAuthorization;

      if (!response.ok) {
        throw new Error(JSON.stringify(tokenResponse, null, 2));
      }

      this.log.debug('Successfully exchanged code for access token.');
      return tokenResponse;
    } catch (error) {
      this.log.error('Error exchanging code for token:', error);
      throw error;
    }
  }

  private async retrieveIds(): Promise<{installationId: number; gatewaySerial: string}> {
    this.log.debug('Retrieving installation IDs...');

    let installationId: number | undefined;

    try {
      const response = await this.requestService.authorizedRequest(`${this.apiEndpoint}/equipment/installations`);

      const body = (await response.json()) as ViessmannAPIResponse<ViessmannInstallation[]>;

      if (!response.ok) {
        throw new Error(JSON.stringify(body, null, 2));
      }

      this.log('Successfully retrieved installations.');
      this.log.debug(JSON.stringify(body, null, 2));
      const installation = body.data[0];
      installationId = installation.id;
    } catch (error) {
      this.log.error('Error retrieving installations:', error);
      throw error;
    }

    this.log.debug('Retrieving gateway IDs...');

    try {
      const url = `${this.apiEndpoint}/equipment/installations/${installationId}/gateways`;
      const response = await this.requestService.authorizedRequest(url, 'get');

      const body = (await response.json()) as ViessmannAPIResponse<ViessmannGateway[]>;

      if (!response.ok) {
        throw new Error(JSON.stringify(body, null, 2));
      }

      this.log('Successfully retrieved gateways.');
      this.log.debug(JSON.stringify(body, null, 2));

      if (!body.data || body.data.length === 0) {
        this.log.error('No gateway data available.');
        throw new Error('No gateway data available.');
      }

      const gateway = body.data[0];
      const gatewaySerial = gateway.serial;
      return {installationId, gatewaySerial};
    } catch (error) {
      this.log.error('Error retrieving gateways:', error);
      throw error;
    }
  }

  private async retrieveSmartComponents(): Promise<void> {
    this.log.debug('Retrieving smart components...');
    const url = `${this.apiEndpoint}/equipment/installations/${this.installationId}/smartComponents`;

    try {
      const response = await this.requestService.authorizedRequest(url, 'get');

      const body = (await response.json()) as ViessmannAPIResponse<ViessmannSmartComponent[]>;

      if (!response.ok) {
        throw new Error(JSON.stringify(body, null, 2));
      }

      this.log.debug('Successfully retrieved smart components.');
      this.log.debug(JSON.stringify(body, null, 2));

      for (const component of body.data) {
        this.log.debug(
          `Component ID: ${component.id}, Name: ${component.name}, Selected: ${component.selected}, Deleted: ${component.deleted}`
        );
      }
    } catch (error) {
      this.log.error('Error retrieving smart components:', error);
      throw error;
    }
  }

  private async selectSmartComponents(
    componentIds: string[]
  ): Promise<{result: ViessmannAPIResponse<ViessmannSmartComponent[]>}> {
    this.log.debug('Selecting smart components...');
    const url = `${this.apiEndpoint}/equipment/installations/${this.installationId}/smartComponents`;

    try {
      const response = await this.requestService.authorizedRequest(url, 'put', {
        body: JSON.stringify({selected: componentIds}),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const body = (await response.json()) as ViessmannAPIResponse<ViessmannSmartComponent[]>;

      if (!response.ok) {
        throw new Error(JSON.stringify(body, null, 2));
      }

      this.log('Successfully selected smart components:', body);
      return {result: body};
    } catch (error) {
      this.log.error('Error selecting smart components:', error);
      throw error;
    }
  }

  private addAccessory(deviceConfig: HomebridgePlatformConfig & LocalDevice): void {
    const uuid = UUIDGen.generate(deviceConfig.name!);
    let accessory = this.accessories.find(acc => acc.UUID === uuid);

    if (!accessory) {
      accessory = new Accessory(deviceConfig.name!, uuid);
      this.api.registerPlatformAccessories('homebridge-vicare', 'ViCareThermostatPlatform', [accessory]);
      this.accessories.push(accessory);
      this.log.debug(`Added new accessory: "${deviceConfig.name}"`);
    }

    const vicareAccessory = new ViCareThermostatAccessory(
      this.log,
      this.requestService,
      this.apiEndpoint,
      this.installationId!.toString(),
      this.gatewaySerial!,
      deviceConfig
    );

    accessory.context.deviceConfig = deviceConfig;
    accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'Viessmann')
      .setCharacteristic(Characteristic.Model, 'ViCare')
      .setCharacteristic(Characteristic.SerialNumber, 'Default-Serial');

    for (const service of vicareAccessory.getServices()) {
      const serviceExists = accessory.getServiceById(service.UUID, service.subtype!);
      if (!serviceExists) {
        accessory.addService(service);
      }
    }

    this.api.updatePlatformAccessories([accessory]);
  }
}

class ViCareThermostatAccessory {
  private readonly deviceId: string;
  private readonly feature: string;
  private readonly maxTemp: number;
  private readonly name?: string;
  private readonly services: HomebridgeService[];
  private readonly switchService?: HomebridgeService;
  private readonly temperatureService: HomebridgeService;
  private readonly type: 'temperature_sensor' | 'thermostat';

  constructor(
    private readonly log: HomebridgeLogging,
    private readonly requestService: RequestService,
    private readonly apiEndpoint: string,
    private readonly installationId: string,
    private readonly gatewaySerial: string,
    config: HomebridgePlatformConfig & LocalDevice
  ) {
    this.name = config.name;
    this.feature = config.feature;
    this.deviceId = config.deviceId;
    this.maxTemp = config.maxTemp;
    this.type = config.type || 'temperature_sensor';

    this.temperatureService =
      this.type === 'thermostat'
        ? new Service.Thermostat(
            this.name,
            `thermostatService_${this.name}_${this.feature}_${UUIDGen.generate(`${this.name}${this.feature}`)}`
          )
        : new Service.TemperatureSensor(
            this.name,
            `temperatureService_${this.name}_${this.feature}_${UUIDGen.generate(`${this.name}${this.feature}`)}`
          );

    this.temperatureService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minStep: 1,
      })
      .on('get', this.getTemperature.bind(this));

    this.temperatureService.getCharacteristic(Characteristic.TargetTemperature).setProps({
      minValue: 0,
      maxValue: this.maxTemp,
      minStep: 1,
    });

    // TODO: Once changing to eco mode is enabled, add `Characteristic.TargetHeatingCoolingState.OFF`
    this.temperatureService.getCharacteristic(Characteristic.TargetHeatingCoolingState).setProps({
      minValue: Characteristic.TargetHeatingCoolingState.HEAT,
      maxValue: Characteristic.TargetHeatingCoolingState.HEAT,
      validValues: [Characteristic.TargetHeatingCoolingState.HEAT],
    });

    // TODO: Once changing to eco mode is enabled, add `Characteristic.CurrentHeatingCoolingState.OFF` if eco mode disabled
    this.temperatureService.getCharacteristic(Characteristic.CurrentHeatingCoolingState).setProps({
      minValue: Characteristic.CurrentHeatingCoolingState.HEAT,
      maxValue: Characteristic.CurrentHeatingCoolingState.HEAT,
      validValues: [Characteristic.CurrentHeatingCoolingState.HEAT],
    });

    if (config.feature.includes('burners')) {
      this.switchService = new Service.Switch(
        this.name,
        `switchService_${this.name}_${this.feature}_${UUIDGen.generate(this.name + this.feature)}`
      );
      this.switchService
        .getCharacteristic(Characteristic.On)
        .on('get', this.getBurnerStatus.bind(this))
        .on('set', this.setBurnerStatus.bind(this));
    }

    this.services = [this.temperatureService];
    if (this.switchService) {
      this.services.push(this.switchService);
    }
  }

  public getServices() {
    return this.services;
  }

  private async getTemperature(callback: CharacteristicGetCallback): Promise<void> {
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/${this.feature}`;
    this.log.debug(`Fetching temperature from ${url} ...`);

    try {
      const response = await this.requestService.authorizedRequest(url);

      const body = (await response.json()) as ViessmannAPIResponse<ViessmannFeature<number>>;

      if (!response.ok) {
        throw new Error(JSON.stringify(body, null, 2));
      }

      const data = body.data || body;

      if (data.properties?.value?.value !== undefined) {
        const temp = data.properties.value.value;
        callback(null, temp);
      } else if (data.properties?.temperature?.value !== undefined) {
        const temp = data.properties.temperature.value;
        callback(null, temp);
      } else {
        throw new Error(`Unexpected response structure: ${JSON.stringify(data, null, 2)}`);
      }
    } catch (error) {
      this.log.error('Error fetching temperature:', error);
      callback(error as Error);
    }
  }

  private async getBurnerStatus(callback: CharacteristicGetCallback): Promise<void> {
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/${this.feature}`;
    this.log.debug(`Fetching burner status from ${url} ...`);

    try {
      const response = await this.requestService.authorizedRequest(url);

      const body = (await response.json()) as ViessmannAPIResponse<ViessmannFeature<boolean>>;

      if (!response.ok) {
        throw new Error(JSON.stringify(body, null, 2));
      }

      const data: ViessmannFeature<boolean> = body.data || body;
      if (data.properties?.active?.value !== undefined) {
        const isActive = data.properties.active.value;
        callback(null, isActive);
      } else {
        this.log.error('Unexpected response structure:', data);
        callback(new Error('Unexpected response structure.'));
      }
    } catch (error) {
      this.log.error('Error fetching burner status:', error);
      callback(error as Error);
    }
  }

  private setBurnerStatus(_value: HomebridgeCharacteristicValue, callback: HomebridgeCharacteristicSetCallback) {
    callback(null);
  }
}

import crypto from 'node:crypto';
import http from 'node:http';
import request from 'request';
import {internalIpV4} from 'internal-ip';
import {
  API as HomebridgeAPI,
  Characteristic as HomebridgeCharacteristic,
  CharacteristicSetCallback as HomebridgeCharacteristicSetCallback,
  CharacteristicValue as HomebridgeCharacteristicValue,
  Logging as HomebridgeLogging,
  PlatformAccessory as HomebridgePlatformAccessory,
  PlatformConfig as HomebridgePlatformConfig,
  Service as HomebridgeService,
  uuid,
} from 'homebridge';

import type {
  LocalConfig,
  ViessmannAPIResponse,
  ViessmannInstallation,
  ViessmannGateway,
  ViessmannSmartComponent,
  ViessmannFeature,
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
  homebridge.registerPlatform('homebridge-vicare', 'ViCareThermostatPlatform', ViCareThermostatPlatform);
};

class ViCareThermostatPlatform {
  private readonly accessories: HomebridgePlatformAccessory[];
  private readonly api: HomebridgeAPI;
  private readonly apiEndpoint: string;
  private readonly clientId: string;
  private readonly codeChallenge: string;
  private readonly codeVerifier: string;
  private readonly devices: Array<HomebridgePlatformConfig & LocalConfig>;
  private readonly log: HomebridgeLogging;
  private accessToken?: string;
  private gatewaySerial?: string;
  private hostIp?: string;
  private installationId?: number;
  private redirectUri?: string;
  private server: http.Server | null;
  public config: HomebridgePlatformConfig & LocalConfig;

  constructor(log: HomebridgeLogging, config: HomebridgePlatformConfig & LocalConfig, api: HomebridgeAPI) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.clientId = config.clientId;
    this.apiEndpoint = config.apiEndpoint;
    this.devices = config.devices;
    this.accessories = [];
    this.codeVerifier = this.generateCodeVerifier();
    this.codeChallenge = this.generateCodeChallenge(this.codeVerifier);
    this.server = null;

    this.api.on('didFinishLaunching', async () => {
      this.log('Starting authentication process...');
      this.hostIp = await internalIpV4();
      this.redirectUri = `http://${this.hostIp}:4200`;
      this.log.debug(`Using redirect URI: ${this.redirectUri}`);

      try {
        const {accessToken} = await this.authenticate();
        this.accessToken = accessToken;
      } catch (err) {
        this.log.error('Error during authentication:', err);
        return;
      }

      if (this.accessToken) {
        this.log('Authentication successful, received access token.');
      } else {
        this.log.error('Authentication did not succeed, received no access token.');
        return;
      }

      try {
        const {installationId, gatewaySerial} = await this.retrieveIds();
        this.log('Retrieved installation and gateway IDs.');
        this.installationId = installationId;
        this.gatewaySerial = gatewaySerial;
        for (const deviceConfig of this.devices) {
          this.addAccessory(deviceConfig);
        }
        this.retrieveSmartComponents();
      } catch (err) {
        this.log.error('Error retrieving installation or gateway IDs:', err);
      }
    });
  }

  public configureAccessory(accessory: HomebridgePlatformAccessory) {
    this.accessories.push(accessory);
  }

  private generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(codeVerifier: string) {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  }

  private authenticate(): Promise<{accessToken: string}> {
    const authUrl = `https://iam.viessmann.com/idp/v3/authorize?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(this.redirectUri!)}&scope=IoT%20User%20offline_access&response_type=code&code_challenge_method=S256&code_challenge=${this.codeChallenge}`;

    this.log(`Click this link for authentication: ${authUrl}`);
    return this.startServer();
  }

  private startServer(): Promise<{accessToken: string}> {
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
              .then(({accessToken}) => {
                this.server!.close();
                resolve({accessToken});
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

  private exchangeCodeForToken(authCode: string): Promise<{accessToken: string}> {
    const tokenUrl = 'https://iam.viessmann.com/idp/v3/token';
    const params = {
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: this.codeVerifier,
      code: authCode,
    };

    this.log.debug('Exchanging authorization code for access token...');

    return new Promise((resolve, reject) =>
      request.post(
        {
          url: tokenUrl,
          form: params,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        (error, response, body: string) => {
          if (error || response.statusCode !== 200) {
            this.log.error('Error exchanging code for token:', error || body);
            return reject(error || new Error(JSON.stringify(body, null, 2)));
          }

          this.log.debug('Successfully exchanged code for access token.');
          const tokenResponse: {access_token: string} = JSON.parse(body);
          resolve({accessToken: tokenResponse.access_token});
        }
      )
    );
  }

  private retrieveIds(): Promise<{installationId: number; gatewaySerial: string}> {
    const options = {
      url: `${this.apiEndpoint}/equipment/installations`,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
      json: true,
    };

    this.log.debug('Retrieving installation IDs...');

    return new Promise((resolve, reject) =>
      request.get(options, (error, response, body: ViessmannAPIResponse<ViessmannInstallation[]>) => {
        if (error || response.statusCode !== 200) {
          this.log.error('Error retrieving installations:', error || body);
          return reject(error || new Error(JSON.stringify(body, null, 2)));
        }

        this.log('Successfully retrieved installations.');
        this.log.debug(JSON.stringify(body, null, 2));
        const installation = body.data[0];
        const installationId = installation.id;

        const gatewayOptions = {
          url: `${this.apiEndpoint}/equipment/installations/${installationId}/gateways`,
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
          json: true,
        };

        this.log.debug('Retrieving gateway IDs...');

        request.get(gatewayOptions, (error, response, body: ViessmannAPIResponse<ViessmannGateway[]>) => {
          if (error || response.statusCode !== 200) {
            this.log.error('Error retrieving gateways:', error || body);
            return reject(error || new Error(JSON.stringify(body, null, 2)));
          }

          this.log('Successfully retrieved gateways.');
          this.log.debug(JSON.stringify(body, null, 2));
          if (!body.data || body.data.length === 0) {
            this.log.error('No gateway data available.');
            return reject(new Error('No gateway data available.'));
          }

          const gateway = body.data[0];
          const gatewaySerial = gateway.serial;
          resolve({installationId, gatewaySerial});
        });
      })
    );
  }

  private retrieveSmartComponents() {
    const options = {
      url: `${this.apiEndpoint}/equipment/installations/${this.installationId}/smartComponents`,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
      json: true,
    };

    this.log.debug('Retrieving smart components...');

    request.get(options, (error, response, body: ViessmannAPIResponse<ViessmannSmartComponent[]>) => {
      if (error || response.statusCode !== 200) {
        this.log.error('Error retrieving smart components:', error || body);
        return;
      }

      this.log.debug('Successfully retrieved smart components.');
      this.log.debug(JSON.stringify(body, null, 2));
      for (const component of body.data) {
        this.log.debug(
          `Component ID: ${component.id}, Name: ${component.name}, Selected: ${component.selected}, Deleted: ${component.deleted}`
        );
      }
    });
  }

  private selectSmartComponents(
    componentIds: string[]
  ): Promise<{result: ViessmannAPIResponse<ViessmannSmartComponent[]>}> {
    const options = {
      url: `${this.apiEndpoint}/equipment/installations/${this.installationId}/smartComponents`,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({selected: componentIds}),
    };

    this.log.debug('Selecting smart components...');

    return new Promise((resolve, reject) =>
      request.put(options, (error, response, body: string) => {
        if (error || response.statusCode !== 200) {
          this.log.error('Error selecting smart components:', error || body);
          return reject(error || new Error(body));
        }

        const result: ViessmannAPIResponse<ViessmannSmartComponent[]> = JSON.parse(body);
        this.log('Successfully selected smart components:', result);
        resolve({result});
      })
    );
  }

  private addAccessory(deviceConfig: HomebridgePlatformConfig & LocalConfig): void {
    const uuid = UUIDGen.generate(deviceConfig.name!);
    let accessory = this.accessories.find(acc => acc.UUID === uuid);

    if (!accessory) {
      accessory = new Accessory(deviceConfig.name!, uuid);
      this.api.registerPlatformAccessories('homebridge-vicare', 'ViCareThermostatPlatform', [accessory]);
      this.accessories.push(accessory);
      this.log.debug(`Added new accessory: ${deviceConfig.name}`);
    }

    const vicareAccessory = new ViCareThermostatAccessory(
      this.log,
      deviceConfig,
      this.api,
      this.accessToken!,
      this.apiEndpoint,
      this.installationId!.toString(),
      this.gatewaySerial!
    );

    accessory.context.deviceConfig = deviceConfig;
    accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'Viessmann')
      .setCharacteristic(Characteristic.Model, 'ViCare')
      .setCharacteristic(Characteristic.SerialNumber, 'Default-Serial');

    for (const service of vicareAccessory.getServices()) {
      const existingService = accessory.getServiceById(service.UUID, service.subtype!);
      if (existingService) {
        accessory.removeService(existingService);
      }
      accessory.addService(service);
    }

    this.api.updatePlatformAccessories([accessory]);
  }
}

class ViCareThermostatAccessory {
  private readonly accessToken: string;
  private readonly apiEndpoint: string;
  private readonly deviceId: string;
  private readonly feature: string;
  private readonly gatewaySerial: string;
  private readonly installationId: string;
  private readonly log: HomebridgeLogging;
  private readonly name?: string;
  private readonly services: HomebridgeService[];
  private readonly switchService?: HomebridgeService;
  private readonly temperatureService: HomebridgeService;

  constructor(
    log: HomebridgeLogging,
    config: HomebridgePlatformConfig,
    _api: HomebridgeAPI,
    accessToken: string,
    apiEndpoint: string,
    installationId: string,
    gatewaySerial: string
  ) {
    this.log = log;
    this.name = config.name;
    this.feature = config.feature;
    this.apiEndpoint = apiEndpoint;
    this.accessToken = accessToken;
    this.deviceId = config.deviceId;
    this.installationId = installationId;
    this.gatewaySerial = gatewaySerial;

    this.temperatureService = new Service.TemperatureSensor(
      this.name,
      `temperatureService_${this.name}_${this.feature}_${UUIDGen.generate(this.name + this.feature)}`
    );
    this.temperatureService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', this.getTemperature.bind(this));

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

  private getTemperature(callback: (err: Error | null, temp?: number | string) => void): void {
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/${this.feature}`;
    this.log.debug(`Fetching temperature from ${url}`);

    request.get(
      {
        url: url,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        json: true,
      },
      (error, response, body: ViessmannAPIResponse<ViessmannFeature<number>>) => {
        if (!error && response.statusCode === 200) {
          const data = body.data || body;
          if (data.properties?.value?.value !== undefined) {
            const temp = data.properties.value.value;
            callback(null, temp);
          } else if (data.properties?.temperature?.value !== undefined) {
            const temp = data.properties.temperature.value;
            callback(null, temp);
          } else {
            this.log.error('Unexpected response structure:', data);
            callback(new Error('Unexpected response structure.'));
          }
        } else {
          this.log.error('Error fetching temperature:', error || body);
          callback(error || new Error(JSON.stringify(body, null, 2)));
        }
      }
    );
  }

  private getBurnerStatus(): Promise<{isActive: boolean}> {
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/${this.feature}`;
    this.log.debug(`Fetching burner status from ${url}`);

    return new Promise((resolve, reject) =>
      request.get(
        {
          url: url,
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
          json: true,
        },
        (error, response, body) => {
          if (!error && response.statusCode === 200) {
            const data: ViessmannFeature<boolean> = body.data || body;
            if (data.properties?.active?.value !== undefined) {
              const isActive = data.properties.active.value;
              resolve({isActive});
            } else {
              this.log.error('Unexpected response structure:', data);
              reject(new Error('Unexpected response structure.'));
            }
          } else {
            this.log.error('Error fetching burner status:', error || body);
            reject(error || new Error(body));
          }
        }
      )
    );
  }

  private setBurnerStatus(_value: HomebridgeCharacteristicValue, callback: HomebridgeCharacteristicSetCallback) {
    callback(null);
  }
}

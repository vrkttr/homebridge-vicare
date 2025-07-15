import crypto from 'node:crypto';
import {promises as fs} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {internalIpV4} from 'internal-ip';

import type {
  PlatformAccessory as HomebridgePlatformAccessory,
  PlatformConfig as HomebridgePlatformConfig,
  Logging as HomebridgeLogging,
  API as HomebridgeAPI,
} from 'homebridge';

import {UUIDGen, Accessory, Service, Characteristic} from './index.js';
import {ViCareThermostatAccessory} from './ViCareThermostatAccessory.js';
import type {
  LocalDevice,
  LocalStorage,
  LocalConfig,
  ViessmannAuthorization,
  ViessmannAPIResponse,
  ViessmannInstallation,
  ViessmannGateway,
  ViessmannSmartComponent,
  ViessmannAPIError,
} from './interfaces.js';
import {RequestService} from './RequestService.js';

export class ViCareThermostatPlatform {
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
    this.localStoragePath = path.join(api.user.storagePath(), 'homebridge-vicare-settings.json');
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
      } catch (error) {
        this.log.warn('Refresh token invalid:', error);
        await this.startAuth(config.hostIp);
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

  private async startAuth(hostIp?: string) {
    this.log('Starting authentication process...');
    this.hostIp = hostIp || (await internalIpV4());
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
    if (!this.redirectUri) {
      throw new Error('Redirect URI is not set. Please call startAuth() first.');
    }
    const params = new URLSearchParams();
    params.set('client_id', this.clientId);
    params.set('redirect_uri', this.redirectUri);
    params.set('scope', 'IoT User offline_access');
    params.set('response_type', 'code');
    params.set('code_challenge_method', 'S256');
    params.set('code_challenge', this.codeChallenge);

    const authUrl = `https://iam.viessmann-climatesolutions.com/idp/v3/authorize?${params.toString()}`;

    this.log(`Click this link for authentication: ${authUrl}`);
    return this.getCodeViaServer();
  }

  private getCodeViaServer(): Promise<ViessmannAuthorization> {
    return new Promise((resolve, reject) => {
      this.server = http
        .createServer((req, res) => {
          if (!req.url || !req.headers.host) {
            this.log.error('Invalid request received, missing URL or host header.');
            res.writeHead(400, {'Content-Type': 'text/plain'});
            res.end('Invalid request.');
            return;
          }
          const url = new URL(req.url, `http://${req.headers.host}`);
          const authCode = url.searchParams.get('code');
          if (authCode) {
            this.log.debug('Received authorization code:', authCode);
            res.writeHead(200, {'Content-Type': 'text/plain'});
            res.end('Authorization successful. You can close this window.');
            this.exchangeCodeForToken(authCode)
              .then(auth => {
                this.server?.close();
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
    if (!this.redirectUri) {
      throw new Error('Redirect URI is not set. Please call startAuth() first.');
    }
    const tokenUrl = 'https://iam.viessmann-climatesolutions.com/idp/v3/token';

    const params = new URLSearchParams();
    params.set('client_id', this.clientId);
    params.set('redirect_uri', this.redirectUri);
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
    const url = `${this.apiEndpoint}/equipment/installations`;

    let installationId: number | undefined;

    try {
      const response = await this.requestService.authorizedRequest(url);

      const body = (await response.json()) as ViessmannAPIResponse<ViessmannInstallation[]> | ViessmannAPIError;

      if (!response.ok) {
        return await this.requestService.checkForTokenExpiration(body as ViessmannAPIError, url);
      }

      this.log('Successfully retrieved installations.');
      this.log.debug(JSON.stringify(body, null, 2));
      const [installation] = (body as ViessmannAPIResponse<ViessmannInstallation[]>).data;
      installationId = installation.id;
    } catch (error) {
      this.log.error('Error retrieving installations:', error);
      throw error;
    }

    this.log.debug('Retrieving gateway IDs...');

    try {
      const url = `${this.apiEndpoint}/equipment/installations/${installationId}/gateways`;
      const response = await this.requestService.authorizedRequest(url, 'get');

      const body = (await response.json()) as ViessmannAPIResponse<ViessmannGateway[]> | ViessmannAPIError;

      if (!response.ok) {
        return await this.requestService.checkForTokenExpiration(body as ViessmannAPIError, url);
      }

      this.log('Successfully retrieved gateways.');
      this.log.debug(JSON.stringify(body, null, 2));

      if (
        !(body as ViessmannAPIResponse<ViessmannGateway[]>).data ||
        (body as ViessmannAPIResponse<ViessmannGateway[]>).data.length === 0
      ) {
        this.log.error('No gateway data available.');
        throw new Error('No gateway data available.');
      }

      const [gateway] = (body as ViessmannAPIResponse<ViessmannGateway[]>).data;
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

      const body = (await response.json()) as ViessmannAPIResponse<ViessmannSmartComponent[]> | ViessmannAPIError;

      if (!response.ok) {
        return await this.requestService.checkForTokenExpiration(body as ViessmannAPIError, url);
      }

      this.log.debug('Successfully retrieved smart components.');
      this.log.debug(JSON.stringify(body, null, 2));

      for (const component of (body as ViessmannAPIResponse<ViessmannSmartComponent[]>).data) {
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

      const body = (await response.json()) as ViessmannAPIResponse<ViessmannSmartComponent[]> | ViessmannAPIError;

      if (!response.ok) {
        return await this.requestService.checkForTokenExpiration(body as ViessmannAPIError, url);
      }

      this.log('Successfully selected smart components:', body);
      return {result: body as ViessmannAPIResponse<ViessmannSmartComponent[]>};
    } catch (error) {
      this.log.error('Error selecting smart components:', error);
      throw error;
    }
  }

  private addAccessory(deviceConfig: HomebridgePlatformConfig & LocalDevice): void {
    if (!deviceConfig.name) {
      this.log.error('Device name is not set, skipping accessory creation.');
      return;
    }

    if (!this.installationId || !this.gatewaySerial) {
      this.log.error('Installation ID or gateway serial is not set, cannot add accessory.');
      return;
    }

    const uuid = UUIDGen.generate(deviceConfig.name);
    let accessory = this.accessories.find(acc => acc.UUID === uuid);

    if (accessory) {
      this.log.debug(`Accessory "${deviceConfig.name}" loaded from cache.`);
    } else {
      accessory = new Accessory(deviceConfig.name, uuid);
      this.api.registerPlatformAccessories('homebridge-vicare', 'ViCareThermostatPlatform', [accessory]);
      this.accessories.push(accessory);
      this.log.debug(`Registered new accessory: "${deviceConfig.name}".`);
    }

    accessory.context.deviceConfig = deviceConfig;

    accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'Viessmann')
      .setCharacteristic(Characteristic.Model, 'ViCare')
      .setCharacteristic(Characteristic.SerialNumber, 'Default-Serial');

    const vicareAccessory = new ViCareThermostatAccessory(
      this.log,
      this.requestService,
      this.apiEndpoint,
      this.installationId.toString(),
      this.gatewaySerial,
      deviceConfig
    );

    for (const newService of vicareAccessory.getServices()) {
      if (!newService.subtype) {
        this.log.error(`Subtype not set, cannot add service for accessory "${deviceConfig.name}".`);
        continue;
      }

      let existingService = accessory.getServiceById(newService.UUID, newService.subtype);

      if (existingService) {
        this.log.debug(
          `Service already exists for accessory "${deviceConfig.name}": ${newService.displayName} (${newService.subtype})`
        );
      } else {
        this.log.debug(
          `Adding new service for accessory "${deviceConfig.name}": ${newService.displayName} (${newService.subtype})`
        );
        accessory.addService(newService);
      }
    }

    this.api.updatePlatformAccessories([accessory]);
  }
}

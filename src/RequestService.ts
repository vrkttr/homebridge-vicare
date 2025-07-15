import type {Logging as HomebridgeLogging} from 'homebridge';
import type {ViessmannAPIError, ViessmannAuthorization} from './interfaces.js';

export class RequestService {
  public accessToken?: string;
  public refreshToken?: string;

  constructor(
    private readonly log: HomebridgeLogging,
    private clientId: string
  ) {}

  public async authorizedRequest(
    url: string,
    method: string = 'get',
    config?: RequestInit,
    retries: number = 0
  ): Promise<any> {
    if (retries >= 3) {
      throw new Error('Could not refresh authentication token.');
    }

    try {
      return await this.request(url, method, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          ...config?.headers,
        },
        ...config,
      });
    } catch (error) {
      return await this.checkForTokenExpiration(error as ViessmannAPIError, url, method, config, retries);
    }
  }

  public async checkForTokenExpiration(
    body: ViessmannAPIError,
    url: string,
    method: string = 'get',
    config?: RequestInit,
    retries: number = 1
  ): Promise<any> {
    if (body.error === 'EXPIRED TOKEN') {
      const {access_token} = await this.refreshAuth();
      this.accessToken = access_token;
      return await this.authorizedRequest(url, method, config, ++retries);
    } else {
      throw body;
    }
  }

  public async request(url: string, method: string, config?: RequestInit): Promise<any> {
    return await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...config?.headers,
      },
      method,
      ...config,
    });
  }

  public async refreshAuth(): Promise<ViessmannAuthorization> {
    if (!this.refreshToken) {
      throw new Error('Refresh token is not set. Please authenticate first.');
    }

    const tokenUrl = 'https://iam.viessmann-climatesolutions.com/idp/v3/token';

    const params = new URLSearchParams();
    params.set('client_id', this.clientId);
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', this.refreshToken);

    this.log.debug('Refreshing authorization ...');

    try {
      const response = await this.authorizedRequest(tokenUrl, 'post', {
        body: params,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      let tokenResponse = (await response.json()) as ViessmannAuthorization;

      if (!response.ok) {
        throw new Error(JSON.stringify(tokenResponse, null, 2));
      }

      this.log('Successfully refreshed authorization.');

      this.accessToken = tokenResponse.access_token;
      return tokenResponse;
    } catch (error) {
      this.log.error('Error refreshing authorization:', error);
      throw error;
    }
  }
}

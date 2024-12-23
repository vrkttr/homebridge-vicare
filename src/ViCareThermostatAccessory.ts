import type {
  Service as HomebridgeService,
  CharacteristicGetCallback,
  CharacteristicValue as HomebridgeCharacteristicValue,
  CharacteristicSetCallback as HomebridgeCharacteristicSetCallback,
} from 'hap-nodejs';
import type {Logging as HomebridgeLogging, PlatformConfig as HomebridgePlatformConfig} from 'homebridge';

import {Service, UUIDGen, Characteristic} from './index.js';
import type {LocalDevice, ViessmannAPIResponse, ViessmannFeature} from './interfaces.js';
import {RequestService} from './RequestService.js';

export class ViCareThermostatAccessory {
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

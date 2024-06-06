'use strict';

const request = require('request');
let Service, Characteristic, Accessory, UUIDGen;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.platformAccessory;
  UUIDGen = homebridge.hap.uuid;
  homebridge.registerPlatform('homebridge-vicare', 'ViCareThermostatPlatform', ViCareThermostatPlatform, true);
};

class ViCareThermostatPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessToken = config.accessToken;
    this.apiEndpoint = config.apiEndpoint;
    this.devices = config.devices;
    this.accessories = [];

    this.api.on('didFinishLaunching', () => {
      this.retrieveIds((err, installationId, gatewaySerial) => {
        if (!err) {
          this.installationId = installationId;
          this.gatewaySerial = gatewaySerial;
          this.devices.forEach(deviceConfig => {
            this.addAccessory(deviceConfig);
          });
        } else {
          this.log('Error retrieving installation or gateway IDs:', err);
        }
      });
    });
  }

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }

  retrieveIds(callback) {
    const options = {
      url: `${this.apiEndpoint}/equipment/installations`,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
      },
      json: true
    };

    request.get(options, (error, response, body) => {
      if (error || response.statusCode !== 200) {
        this.log('Error retrieving installations:', error || body);
        callback(error || new Error(body));
        return;
      }

      this.log('Installation data:', body);
      const installation = body.data[0];
      const installationId = installation.id;

      const gatewayOptions = {
        url: `${this.apiEndpoint}/equipment/installations/${installationId}/gateways`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
        json: true
      };

      request.get(gatewayOptions, (error, response, body) => {
        if (error || response.statusCode !== 200) {
          this.log('Error retrieving gateways:', error || body);
          callback(error || new Error(body));
          return;
        }

        this.log('Gateway data:', body);
        if (!body.data || body.data.length === 0) {
          this.log('No gateway data available.');
          callback(new Error('No gateway data available.'));
          return;
        }

        const gateway = body.data[0];
        const gatewaySerial = gateway.serial;
        callback(null, installationId, gatewaySerial);
      });
    });
  }

  addAccessory(deviceConfig) {
    const uuid = UUIDGen.generate(deviceConfig.name);
    let accessory = this.accessories.find(acc => acc.UUID === uuid);

    if (!accessory) {
      accessory = new Accessory(deviceConfig.name, uuid);
      this.api.registerPlatformAccessories('homebridge-vicare', 'ViCareThermostatPlatform', [accessory]);
      this.accessories.push(accessory);
    }

    const vicareAccessory = new ViCareThermostatAccessory(
      this.log,
      deviceConfig,
      this.api,
      this.accessToken,
      this.apiEndpoint,
      this.installationId,
      this.gatewaySerial
    );

    accessory.context.deviceConfig = deviceConfig;
    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'Viessmann')
      .setCharacteristic(Characteristic.Model, 'ViCare')
      .setCharacteristic(Characteristic.SerialNumber, 'Default-Serial');

    vicareAccessory.getServices().forEach(service => {
      const existingService = accessory.getServiceById(service.UUID, service.subtype);
      if (existingService) {
        accessory.removeService(existingService);
      }
      accessory.addService(service);
    });

    this.api.updatePlatformAccessories([accessory]);
  }
}

class ViCareThermostatAccessory {
  constructor(log, config, api, accessToken, apiEndpoint, installationId, gatewaySerial) {
    this.log = log;
    this.name = config.name;
    this.feature = config.feature;
    this.apiEndpoint = apiEndpoint;
    this.accessToken = accessToken;
    this.deviceId = config.deviceId;
    this.installationId = installationId;
    this.gatewaySerial = gatewaySerial;

    this.temperatureService = new Service.TemperatureSensor(this.name, `temperatureService_${this.name}_${this.feature}_${UUIDGen.generate(this.name + this.feature)}`);
    this.temperatureService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', this.getTemperature.bind(this));

    if (config.feature.includes('burners')) {
      this.switchService = new Service.Switch(this.name, `switchService_${this.name}_${this.feature}_${UUIDGen.generate(this.name + this.feature)}`);
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

  getTemperature(callback) {
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/${this.feature}`;
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
          const data = body.data || body;
          if (data.properties && data.properties.value && data.properties.value.value !== undefined) {
            const temp = data.properties.value.value;
            callback(null, temp);
          } else {
            this.log('Unexpected response structure:', data);
            callback(new Error('Unexpected response structure.'));
          }
        } else {
          this.log('Error fetching temperature:', error || body);
          callback(error || new Error(body));
        }
      }
    );
  }

  getBurnerStatus(callback) {
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/${this.feature}`;
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
          const data = body.data || body;
          if (data.properties && data.properties.active && data.properties.active.value !== undefined) {
            const isActive = data.properties.active.value;
            callback(null, isActive);
          } else {
            this.log('Unexpected response structure:', data);
            callback(new Error('Unexpected response structure.'));
          }
        } else {
          this.log('Error fetching burner status:', error || body);
          callback(error || new Error(body));
        }
      }
    );
  }

  setBurnerStatus(value, callback) {
    callback(null);
  }

  getServices() {
    return this.services;
  }
}

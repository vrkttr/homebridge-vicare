const request = require('request');

let Service, Characteristic;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory('homebridge-vicare', 'ViCareThermostat', ViCareThermostat);
};

class ViCareThermostat {
  constructor(log, config) {
    this.log = log;
    this.name = config.name;
    this.apiEndpoint = config.apiEndpoint || 'https://api.viessmann.com/iot/v2';
    this.accessToken = config.accessToken;
    this.debug = config.debug || false; // Debugging aktivieren oder deaktivieren

    this.services = [];

    this.thermostatService = new Service.Thermostat(this.name);

    this.thermostatService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', this.getCurrentTemperature.bind(this));

    this.thermostatService
      .getCharacteristic(Characteristic.TargetTemperature)
      .on('get', this.getTargetTemperature.bind(this))
      .on('set', this.setTargetTemperature.bind(this))
      .setProps({
        minValue: 10,
        maxValue: 82,
        minStep: 1
      });

    this.services.push(this.thermostatService);

    this.retrieveIds().then(() => {
      this.log('Retrieved all necessary IDs.');
      this.listAvailableFeatures();
    }).catch(err => {
      this.log('Error retrieving IDs:', err);
    });
  }

  async retrieveIds() {
    try {
      this.installationId = await this.getInstallationId();
      this.gatewaySerial = await this.getGatewaySerial();
      this.deviceId = await this.getDeviceId();
    } catch (error) {
      throw new Error('Failed to retrieve IDs: ' + error.message);
    }
  }

  getInstallationId() {
    return new Promise((resolve, reject) => {
      request.get({
        url: 'https://api.viessmann.com/iot/v1/equipment/installations',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      }, (error, response, body) => {
        if (error) {
          return reject(error);
        }
        try {
          const data = JSON.parse(body);
          if (this.debug) {
            this.log('Installation data:', data);
          }
          if (data.statusCode === 401) {
            return reject(new Error('Unauthorized: ' + data.message));
          }
          if (data.data && data.data.length > 0) {
            const installationId = data.data[0].id;
            resolve(installationId);
          } else {
            reject(new Error('No installations found'));
          }
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
  }

  getGatewaySerial() {
    return new Promise((resolve, reject) => {
      request.get({
        url: 'https://api.viessmann.com/iot/v1/equipment/gateways',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      }, (error, response, body) => {
        if (error) {
          return reject(error);
        }
        try {
          const data = JSON.parse(body);
          if (this.debug) {
            this.log('Gateway data:', data);
          }
          if (data.statusCode === 401) {
            return reject(new Error('Unauthorized: ' + data.message));
          }
          if (data.data && data.data.length > 0) {
            const gatewaySerial = data.data[0].serial;
            resolve(gatewaySerial);
          } else {
            reject(new Error('No gateways found'));
          }
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
  }

  getDeviceId() {
    return new Promise((resolve, reject) => {
      const url = `https://api.viessmann.com/iot/v1/equipment/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices`;
      request.get({
        url: url,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      }, (error, response, body) => {
        if (error) {
          return reject(error);
        }
        try {
          const data = JSON.parse(body);
          if (this.debug) {
            this.log('Device data:', data);
          }
          if (data.statusCode === 401) {
            return reject(new Error('Unauthorized: ' + data.message));
          }
          if (data.data && data.data.length > 0) {
            const deviceId = data.data[0].id;
            resolve(deviceId);
          } else {
            reject(new Error('No devices found'));
          }
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
  }

  listAvailableFeatures() {
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features`;
    request.get({
      url: url,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      }
    }, (error, response, body) => {
      if (error) {
        this.log('Error listing available features:', error);
      } else {
        try {
          const data = JSON.parse(body).data;
          if (this.debug) {
            this.log('Available features:', data);
          }
          this.createSensors(data);
        } catch (parseError) {
          this.log('Error parsing available features:', parseError);
        }
      }
    });
  }

  createSensors(features) {
    features.forEach(feature => {
      const { feature: featureName, properties } = feature;

      if (properties && properties.value && typeof properties.value.value === 'number') {
        const sensorService = new Service.TemperatureSensor(featureName);

        sensorService
          .getCharacteristic(Characteristic.CurrentTemperature)
          .on('get', (callback) => {
            callback(null, properties.value.value);
          });

        this.services.push(sensorService);
      }

      // Example for Burner active state as switch
      if (featureName === "heating.burners.0" && properties.active) {
        const switchService = new Service.Switch(featureName);

        switchService
          .getCharacteristic(Characteristic.On)
          .on('get', (callback) => {
            callback(null, properties.active.value);
          });

        this.services.push(switchService);
      }
    });
  }

  getCurrentTemperature(callback) {
    if (!this.deviceId) {
      return callback(new Error('Device ID not yet available'));
    }
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/heating.circuits.0.operating.programs.reduced`;
    request.get({
      url: url,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      }
    }, (error, response, body) => {
      if (error) {
        callback(error);
      } else {
        try {
          const data = JSON.parse(body).data;
          const currentTemperature = parseFloat(data.properties.temperature.value);
          if (!isNaN(currentTemperature) && isFinite(currentTemperature)) {
            callback(null, currentTemperature);
          } else {
            callback(new Error('Invalid current temperature value'));
          }
        } catch (parseError) {
          callback(parseError);
        }
      }
    });
  }

  getTargetTemperature(callback) {
    if (!this.deviceId) {
      return callback(new Error('Device ID not yet available'));
    }
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/heating.circuits.0.operating.programs.normal`;
    request.get({
      url: url,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      }
    }, (error, response, body) => {
      if (error) {
        callback(error);
      } else {
        try {
          const data = JSON.parse(body).data;
          const targetTemperature = parseFloat(data.properties.temperature.value);
          if (!isNaN(targetTemperature) && isFinite(targetTemperature)) {
            callback(null, targetTemperature);
          } else {
            callback(new Error('Invalid target temperature value'));
          }
        } catch (parseError) {
          callback(parseError);
        }
      }
    });
  }

  setTargetTemperature(value, callback) {
    if (!this.deviceId) {
      return callback(new Error('Device ID not yet available'));
    }
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/heating.circuits.0.operating.programs.normal/commands/setTemperature`;
    request.post({
      url: url,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      },
      json: {
        targetTemperature: value
      }
    }, (error, response, body) => {
      if (error) {
        callback(error);
      } else {
        callback();
      }
    });
  }

  getServices() {
    return this.services;
  }
}

const request = require('request');

let Service, Characteristic;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory('homebridge-vicare', 'ViCareThermostat', ViCareThermostat);
};

class ViCareThermostat {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;

    this.name = config.name;
    this.apiEndpoint = config.apiEndpoint || 'https://api.viessmann.com/iot/v2';
    this.accessToken = config.accessToken;
    this.debug = config.debug || false;

    this.services = [];

    this.setupInformationService();
    this.setupThermostatService();

    this.retrieveIds().then(() => {
      this.log('Alle notwendigen IDs abgerufen.');
      this.listAvailableFeatures();
    }).catch(err => {
      this.log('Fehler beim Abrufen der IDs:', err);
    });
  }

  setupInformationService() {
    this.informationService = new Service.AccessoryInformation();
    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, 'Viessmann')
      .setCharacteristic(Characteristic.Model, 'ViCare')
      .setCharacteristic(Characteristic.SerialNumber, '123-456-789');

    this.services.push(this.informationService);
  }

  setupThermostatService() {
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
  }

  async retrieveIds() {
    this.installationId = await this.getInstallationId();
    this.gatewaySerial = await this.getGatewaySerial();
    this.deviceId = await this.getDeviceId();
  }

  getInstallationId() {
    return new Promise((resolve, reject) => {
      request.get({
        url: `${this.apiEndpoint}/equipment/installations`,
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      }, (error, response, body) => {
        if (error) return reject(error);
        const data = JSON.parse(body);
        if (this.debug) this.log('Installationsdaten:', data);
        if (data.data && data.data.length > 0) {
          resolve(data.data[0].id);
        } else {
          reject(new Error('Keine Installationen gefunden'));
        }
      });
    });
  }

  getGatewaySerial() {
    return new Promise((resolve, reject) => {
      request.get({
        url: `${this.apiEndpoint}/equipment/gateways`,
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      }, (error, response, body) => {
        if (error) return reject(error);
        const data = JSON.parse(body);
        if (this.debug) this.log('Gateway-Daten:', data);
        if (data.data && data.data.length > 0) {
          resolve(data.data[0].serial);
        } else {
          reject(new Error('Keine Gateways gefunden'));
        }
      });
    });
  }

  getDeviceId() {
    return new Promise((resolve, reject) => {
      const url = `${this.apiEndpoint}/equipment/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices`;
      request.get({
        url: url,
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      }, (error, response, body) => {
        if (error) return reject(error);
        const data = JSON.parse(body);
        if (this.debug) this.log('Gerätedaten:', data);
        if (data.data && data.data.length > 0) {
          resolve(data.data[0].id);
        } else {
          reject(new Error('Keine Geräte gefunden'));
        }
      });
    });
  }

  listAvailableFeatures() {
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features`;
    request.get({
      url: url,
      headers: { 'Authorization': `Bearer ${this.accessToken}` }
    }, (error, response, body) => {
      if (error) {
        this.log('Fehler beim Auflisten der verfügbaren Funktionen:', error);
      } else {
        const data = JSON.parse(body).data;
        if (this.debug) this.log('Verfügbare Funktionen:', data);
        if (Array.isArray(data)) {
          this.createSensorsAndSwitches(data);
        } else {
          this.log('Unerwartetes Datenformat für Funktionen:', data);
        }
      }
    });
  }

  createSensorsAndSwitches(features) {
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
        this.log(`Sensor hinzugefügt: ${featureName}`);
      }

      if (featureName === "heating.burners.0" && properties.active) {
        const switchService = new Service.Switch(featureName);

        switchService
          .getCharacteristic(Characteristic.On)
          .on('get', (callback) => {
            callback(null, properties.active.value);
          });

        this.services.push(switchService);
        this.log(`Schalter hinzugefügt: ${featureName}`);
      }

      // Raumtemperatursensor (Heizkreis 1)
      if (featureName === 'heating.circuits.0.sensors.temperature.room' && properties.value) {
        const roomTemperatureSensor = new Service.TemperatureSensor('Raumtemperatursensor');

        roomTemperatureSensor
          .getCharacteristic(Characteristic.CurrentTemperature)
          .on('get', (callback) => {
            callback(null, properties.value.value);
          });

        this.services.push(roomTemperatureSensor);
        this.log('Sensor hinzugefügt: Raumtemperatursensor');
      }

      // Versorgungstemperatursensor
      if (featureName === 'heating.circuits.0.sensors.temperature.supply' && properties.value) {
        const supplyTemperatureSensor = new Service.TemperatureSensor('Versorgungstemperatursensor');

        supplyTemperatureSensor
          .getCharacteristic(Characteristic.CurrentTemperature)
          .on('get', (callback) => {
            callback(null, properties.value.value);
          });

        this.services.push(supplyTemperatureSensor);
        this.log('Sensor hinzugefügt: Versorgungstemperatursensor');
      }

      // Warmwasserspeichertemperatursensor
      if (featureName === 'heating.dhw.sensors.temperature.dhwCylinder' && properties.value) {
        const hotWaterTemperatureSensor = new Service.TemperatureSensor('Warmwasserspeichertemperatursensor');

        hotWaterTemperatureSensor
          .getCharacteristic(Characteristic.CurrentTemperature)
          .on('get', (callback) => {
            callback(null, properties.value.value);
          });

        this.services.push(hotWaterTemperatureSensor);
        this.log('Sensor hinzugefügt: Warmwasserspeichertemperatursensor');
      }
    });

    this.log(`Hinzugefügte Sensoren und Schalter: ${this.services.length - 1}`);
  }

  getCurrentTemperature(callback) {
    if (!this.deviceId) {
      return callback(new Error('Geräte-ID noch nicht verfügbar'));
    }
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/heating.circuits.0.operating.programs.normal`;
    request.get({
      url: url,
      headers: { 'Authorization': `Bearer ${this.accessToken}` }
    }, (error, response, body) => {
      if (error) {
        callback(error);
      } else {
        const data = JSON.parse(body).data;
        const currentTemperature = parseFloat(data.properties.temperature.value);
        if (!isNaN(currentTemperature) && isFinite(currentTemperature)) {
          callback(null, currentTemperature);
        } else {
          callback(new Error('Ungültiger Wert für die aktuelle Temperatur'));
        }
      }
    });
  }

  getTargetTemperature(callback) {
    if (!this.deviceId) {
      return callback(new Error('Geräte-ID noch nicht verfügbar'));
    }
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/heating.circuits.0.operating.programs.normal`;
    request.get({
      url: url,
      headers: { 'Authorization': `Bearer ${this.accessToken}` }
    }, (error, response, body) => {
      if (error) {
        callback(error);
      } else {
        const data = JSON.parse(body).data;
        const targetTemperature = parseFloat(data.properties.temperature.value);
        if (!isNaN(targetTemperature) && isFinite(targetTemperature)) {
          callback(null, targetTemperature);
        } else {
          callback(new Error('Ungültiger Wert für die Zieltemperatur'));
        }
      }
    });
  }

  setTargetTemperature(value, callback) {
    if (!this.deviceId) {
      return callback(new Error('Geräte-ID noch nicht verfügbar'));
    }
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/heating.circuits.0.operating.programs.normal/commands/setTemperature`;
    request.post({
      url: url,
      headers: { 'Authorization': `Bearer ${this.accessToken}` },
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

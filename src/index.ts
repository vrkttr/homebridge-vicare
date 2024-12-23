import type {
  API as HomebridgeAPI,
  Characteristic as HomebridgeCharacteristic,
  PlatformAccessory as HomebridgePlatformAccessory,
  Service as HomebridgeService,
  uuid,
} from 'homebridge';

import {ViCareThermostatPlatform} from './ViCareThermostatPlatform.js';

export let Service: typeof HomebridgeService;
export let Characteristic: typeof HomebridgeCharacteristic;
export let Accessory: typeof HomebridgePlatformAccessory;
export let UUIDGen: typeof uuid;

export default (homebridge: HomebridgeAPI) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.platformAccessory;
  UUIDGen = homebridge.hap.uuid;
  homebridge.registerPlatform('homebridge-vicare-2', 'ViCareThermostatPlatform', ViCareThermostatPlatform);
};

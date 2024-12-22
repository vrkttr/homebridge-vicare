# Homebridge ViCare Plugin

The Homebridge ViCare Plugin allows you to integrate your Viessmann ViCare heating system with Homebridge, enabling control and monitoring through Apple's HomeKit. This plugin provides real-time temperature readings, control over target temperatures, and access to various sensors and states of your heating system.

## Features

- Current temperature display
- Target temperature control
- Integration with various heating system sensors (burner state, water temperature, etc.)
- Easy configuration through Homebridge

Enhance your smart home setup by seamlessly connecting your Viessmann ViCare system with HomeKit.

## API Key

To use this plugin, you will need to create an API key by following these steps:

1. **Create an Account**: Sign up for an account on the [Viessmann Developer Portal](https://app.developer.viessmann.com/).

2. **Create a new client:**

   - Log in to the Viessmann Developer Portal.
   - Navigate to "Clients" and create a new client.
   - Wait a few minutes for the client to be registered.

3. **Redirect URI Configuration:**

   - Set the Redirect URI in the Developer Portal to `http://YOUR_LOCAL_IP:4200`. Replace `YOUR_LOCAL_IP` with the local IP address of the machine running Homebridge.

4. **Update your Homebridge config.json:**
   - Copy the `client_id` from your registered client in the Developer Portal.
   - Update your `config.json` with the `client_id`:
   - Optional: add your host IP manually
   - Optional: add the device type to appear as a temperature sensor or thermostat (temperature change currently not supported)

## Config

```json
{
  "platforms": [
    {
      "platform": "ViCareThermostatPlatform",
      "name": "ViCareThermostat",
      "clientId": "YOUR CLIENT ID",
      "apiEndpoint": "https://api.viessmann.com/iot/v1",
      "hostIp": "YOUR HOST IP", // optional, default is the detected IP address
      "devices": [
        {
          "name": "Supply temperature",
          "feature": "heating.circuits.0.sensors.temperature.supply",
          "deviceId": "0",
          "type": "temperature_sensor" // optional
        },
        {
          "name": "Main DHW temperature",
          "feature": "heating.dhw.temperature.main",
          "deviceId": "0",
          "type": "thermostat" // optional, default is "temperature_sensor"
        }
      ]
    }
  ]
}
```

## Authentication Process

The plugin will handle the OAuth2 authentication process automatically. Follow these steps:

1. Start Homebridge. The plugin will log a URL for authentication.
2. Open the URL in your browser. You will be prompted to log in to your Viessmann account and authorize the application.
3. After successful login, you will be redirected to the Redirect URI you configured. The plugin will automatically capture the authorization code and exchange it for an access token.

## Available Features

**Heating Circuits**

- heating.circuits.0.sensors.temperature.supply: Supply temperature
- heating.circuits.0.operating.modes.active: Active operating mode
- heating.circuits.0.operating.programs.active: Active program
- heating.circuits.0.operating.programs.normal: Normal program
- heating.circuits.0.operating.programs.reduced: Reduced program
- heating.circuits.0.sensors.temperature.room: Room temperature
- heating.circuits.0.heating.curve: Heating curve

**Domestic Hot Water (DHW)**

- heating.dhw.temperature.main: Main DHW temperature
- heating.dhw.sensors.temperature.dhwCylinder: DHW cylinder temperature
- heating.dhw.oneTimeCharge: One-time DHW charge
- heating.dhw.charging: DHW charging
- heating.dhw.temperature.hysteresis: DHW temperature hysteresis

**Burners**

- heating.burners.0: Burner status
- heating.burners.0.modulation: Burner modulation
- heating.burners.0.statistics: Burner statistics (start count, operating hours)

**General Boiler Data**

- heating.boiler.sensors.temperature.commonSupply: Common supply temperature
- heating.boiler.temperature: Boiler temperature
- heating.boiler.sensors.temperature.return: Return temperature
- heating.boiler.serial: Boiler serial number
- heating.boiler.pressure: Boiler pressure

**Gas Consumption**

- heating.gas.consumption.heating: Heating gas consumption
- heating.gas.consumption.dhw: DHW gas consumption
- heating.gas.consumption.total: Total gas consumption

**Smart Components**

- List of all smart components available in the installation
- Selecting specific smart components for use

**Solar**

- solar.power.production.current: Current solar power production
- solar.power.production.daily: Daily solar power production
- solar.power.production.monthly: Monthly solar power production
- solar.sensors.temperature.collector: Solar collector temperature
- solar.sensors.temperature.dhw: Solar DHW temperature

**Heat Pump**

- heatpump.power.consumption.current: Current heat pump power consumption
- heatpump.power.consumption.daily: Daily heat pump power consumption
- heatpump.power.consumption.monthly: Monthly heat pump power consumption
- heatpump.sensors.temperature.evaporator: Evaporator temperature
- heatpump.sensors.temperature.condensor: Condensor temperature
- heatpump.sensors.temperature.outside: Outside temperature
- heatpump.compressor.starts: Compressor start count
- heatpump.compressor.hours: Compressor operating hours

**Ventilation**

- ventilation.operating.modes.active: Active ventilation mode
- ventilation.operating.modes.normal: Normal ventilation mode
- ventilation.operating.modes.reduced: Reduced ventilation mode
- ventilation.sensors.humidity: Humidity sensor data
- ventilation.sensors.co2: CO2 sensor data
- ventilation.fan.speed: Ventilation fan speed

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests as appropriate.

## License

[MIT](https://choosealicense.com/licenses/mit/)

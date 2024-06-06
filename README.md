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

2. **Generate an Access Token**:
    - Visit [Viessmann Developer Portal](https://app.developer.viessmann.com/).
    - Create a new account or log in if you already have one.
    - Navigate to "Clients" and create a new client.
    - Wait a few minutes for the client to be registered.
    - Go to the "API Keys" section and generate a new Access Token.
    - In the "Select" menu, choose "First Option" and ensure the "IoT" scope is selected.
    - Copy the Access Token and use it in your Homebridge configuration.

3. **Save Your Access Token**: Copy the generated access token and keep it in a safe place. You will need this token to configure the plugin.


## Config

```python
{
    "platforms": [
        {
            "platform": "ViCareThermostatPlatform",
            "name": "ViCareThermostat",
            "accessToken": "YOUR ACCESS TOKEN",
            "apiEndpoint": "https://api.viessmann.com/iot/v1",
            "devices": [
                {
                    "name": "Supply temperature",
                    "feature": "heating.circuits.0.sensors.temperature.supply",
                    "deviceId": "0"
                },
                {
                    "name": "Main DHW temperature",
                    "feature": "heating.dhw.temperature.main",
                    "deviceId": "0"
                }
            ]
        }
    ]
  }
```

## Available Features

**Heating Circuits**

- heating.circuits.0.sensors.temperature.supply: Supply temperature
- heating.circuits.0.operating.modes.active: Active operating mode
- heating.circuits.0.operating.programs.active: Active program
- heating.circuits.0.operating.programs.normal: Normal program
- heating.circuits.0.operating.programs.reduced: Reduced program

**Domestic Hot Water (DHW)**

- heating.dhw.temperature.main: Main DHW temperature
- heating.dhw.sensors.temperature.dhwCylinder: DHW cylinder temperature
- heating.dhw.oneTimeCharge: One-time DHW charge

**Burners**

- heating.burners.0: Burner status
- heating.burners.0.modulation: Burner modulation

**General Boiler Data**

- heating.boiler.sensors.temperature.commonSupply: Common supply temperature
- heating.boiler.temperature: Boiler temperature

**Room Temperature**

- heating.circuits.0.sensors.temperature.room: Room temperature

**Gas Consumption**

- heating.gas.consumption.heating: Heating gas consumption
- heating.gas.consumption.dhw: DHW gas consumption

## Contributing

Pull requests are welcome. For major changes, please open an issue first
to discuss what you would like to change.

Please make sure to update tests as appropriate.

## License

[MIT](https://choosealicense.com/licenses/mit/)

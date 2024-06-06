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
    - After logging in, navigate to the "API Keys" section.
    - Click on "Generate New Key".
    - For the first select option, choose "First Option".
    - Under the scopes section, select "IoT".

3. **Save Your Access Token**: Copy the generated access token and keep it in a safe place. You will need this token to configure the plugin.


## Config

```python
        {
            "accessory": "ViCareThermostat",
            "name": "Viessmann",
            "debug": false,
            "accessToken": "YOUR ACCESS TOKEN"
        }
```

## Contributing

Pull requests are welcome. For major changes, please open an issue first
to discuss what you would like to change.

Please make sure to update tests as appropriate.

## License

[MIT](https://choosealicense.com/licenses/mit/)

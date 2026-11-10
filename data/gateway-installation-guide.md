# Rootline Gateway Installation Guide

The Rootline Gateway (product code RL-GATEWAY) collects readings from Rootline sensors over LoRaWAN radio and forwards them to the cloud dashboard. This guide is for Larkspur Labs (a fictional company) field engineers and customers.

## Choosing a location

Mount the gateway as high as possible, ideally at least 4 meters above ground on a building, mast or tree, with a clear view across the vineyard. Hills and buildings block the radio signal; in hilly terrain, range drops from about 3 km to roughly 1 km. Very large or hilly vineyards may need a second gateway.

The gateway needs power from a standard outlet or from the optional solar kit (RL-SOLAR-KIT). With the solar kit, the built-in battery keeps the gateway running for three days without sun.

## Connecting to the internet

Connect an Ethernet cable if one is available; this is the most reliable option. Otherwise insert a SIM card for 4G. The gateway uses about 300 MB of mobile data per month with 100 sensors. Wi-Fi is not supported.

## Status light

The light on the front of the gateway shows its state:

- Steady green: connected to the internet and the cloud dashboard.
- Blinking green: starting up. Wait up to five minutes.
- Steady orange: no internet connection. Check the Ethernet cable or the SIM card.
- Blinking orange: connected to the internet, but the cloud dashboard rejects the gateway. The gateway is usually not yet registered to the customer's account.
- Blinking red: hardware fault. Contact support and do not open the housing, as this voids the warranty.

## Registering the gateway

Scan the QR code on the bottom of the gateway with the Rootline app and select the vineyard it belongs to. Sensors within range pair with the gateway automatically within 30 minutes.

## Factory reset

Hold the reset button for 15 seconds until the light blinks red and green alternately. A reset removes the network settings and the registration, but not the readings stored on the sensors.

# Rootline Release Notes

Changes to the Rootline sensor firmware, the gateway firmware and the cloud dashboard, newest first. Larkspur Labs is a fictional company.

## Dashboard 2026.9 (September 2026)

- New frost alert: get a push notification when the soil temperature at 10 cm drops below a threshold you choose.
- Readings can be exported as CSV for any date range, not only the last 12 months.
- The irrigation report now groups blocks by grape variety.

## Sensor firmware 3.2.1 (July 2026)

- Fixes the ERR-12 clock drift error that some sensors reported every day after the switch to summer time.
- Electrical conductivity readings are now corrected for soil temperature, which makes them comparable between morning and afternoon.

## Gateway firmware 5.4 (June 2026)

- Firmware updates now install at night between 02:00 and 04:00 local time, instead of immediately.
- Adds support for the solar kit (RL-SOLAR-KIT) and shows its battery level in the dashboard.
- The status light blinks orange instead of red when the gateway is not registered, so it is no longer mistaken for a hardware fault.

## Dashboard 2026.4 (April 2026)

- Shared access: vineyard owners can invite their agronomist or vineyard manager with read-only access.
- Alerts can be sent by email, in addition to the app.

## Sensor firmware 3.1 (February 2026)

- The reading interval can be set between 5 and 60 minutes per sensor in the app. Shorter intervals reduce battery life.
- Sensors buffer 30 days of readings instead of 14 when no gateway is reachable.

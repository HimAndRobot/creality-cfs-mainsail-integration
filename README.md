# K1C CFS Mainsail Integration

This project adds a simple CFS panel directly inside Mainsail or Fluidd on the Creality K1C.

![CFS panel preview](static/preview.png)

It also includes a mobile app for editing CFS filaments and spool colors.

## Requirements

Before using this project, the printer must already have:

- root access enabled
- Creality Helper Script installed
- Mainsail or Fluidd installed and working

With it, you can:
- see the four CFS channels inside Mainsail or Fluidd
- view filament type, humidity, and temperature
- edit filament information
- change purge temperatures for each supported material
- start `Feed`, `Switch`, and `Retract` directly from the panel
- follow printer-side actions with button lock and loading indicators
- use the mobile app to register printers, edit filaments, and capture spool colors

## How It Works

The integration injects a small panel into the Mainsail or Fluidd page already running on the printer.

After installation, the panel appears inside:

- `http://PRINTER_IP:4409/`
- `http://PRINTER_IP:4408/`

If the page is already open, just refresh the browser once.

## Installation

Clone the repository on the printer:

```sh
git clone https://github.com/HimAndRobot/creality-cfs-mainsail-integration.git /usr/data/creality-cfs-mainsail-integration
cd /usr/data/creality-cfs-mainsail-integration
chmod +x ./menu.sh
./menu.sh
```

Then:

1. Press `1` for `Install`
2. Choose `Mainsail`, `Fluidd`, or `Both`
3. Wait for the script to finish
4. Press `Enter`
5. Refresh the selected frontend in the browser

If you previously removed the Creality Web Interface with Guilouz Helper Script and the CFS panel loads but shows no information, run the menu again and:

1. Press `3` for `Reactivate CFS Service`
2. Wait for the script to finish
3. Refresh Mainsail or Fluidd in the browser

## Update

Run the menu again:

```sh
cd creality-cfs-mainsail-integration
./menu.sh
```

Then:

1. Press `4` for `Update`
2. Choose `Mainsail`, `Fluidd`, or `Both`
3. Wait for the script to finish
4. Press `Enter`
5. Refresh the selected frontend in the browser

`Update` will:

- run `git pull --ff-only`
- refresh the injected frontend files
- reinstall the Klipper extra files
- keep the current CFS service state unchanged

## Removal

Run the menu again:

```sh
cd /usr/data/creality-cfs-mainsail-integration
./menu.sh
```

Then:

1. Press `2` for `Remove`
2. Wait for the script to finish
3. Press `Enter`
4. Refresh Mainsail or Fluidd in the browser

If option `3` had reactivated the Creality `web-server` for CFS data, `Remove` will disable it again and restore the previous state.

## Notes

- The panel is loaded directly inside Mainsail or Fluidd
- If you do not see the panel after install or remove, refresh the browser
- If you use Guilouz Helper Script to remove the Creality Web Interface, the CFS socket on port `9999` may be disabled with `/usr/bin/web-server`
- In that case, use menu option `3` to reactivate only the CFS service without restoring the full Creality interface

## Mobile App

The repository also includes an Expo app in:

- `app/`

With the app, you can:

- add multiple printers by name and IP
- connect directly to the printer WebSocket
- view CFS slots in real time
- edit filament information
- choose a color manually or capture it with the camera

To run it:

```sh
cd app
npm install
npm start
```

Then open it in Expo Go on your phone.

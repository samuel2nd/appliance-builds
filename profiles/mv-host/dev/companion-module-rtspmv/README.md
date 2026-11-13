# companion-module-rtspmv

Bitfocus Companion module for RTSPmv. See `companion/HELP.md` for actions, feedbacks,
variables, and presets. Requires RTSPmv 0.1.7 or newer (for preset feedback).

## Build an importable package

Needs Node 22 and internet access (for npm):

```
npm install
npm run package
```

This produces `rtspmv-0.1.0.tgz`. In Companion, go to **Modules → Import module package** and
choose it, then add an **RTSPmv** connection.

## Developer folder (alternative)

Run `npm install` in this folder, put the folder inside your Companion developer modules
directory, and enable developer modules in Companion's launcher settings.

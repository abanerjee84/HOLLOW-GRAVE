# Third-party notices

## Three.js

`vendor/three.module.js` is the Three.js r160 ES module distribution.

- Project: https://threejs.org/
- Source: https://github.com/mrdoob/three.js/tree/r160
- License: MIT
- Copyright: 2010-2023 Three.js authors
- Complete license: [vendor/THREE-LICENSE.txt](vendor/THREE-LICENSE.txt)

The original copyright and SPDX notice remains in the bundled source.

## Fonts

The interface requests Cinzel, IBM Plex Mono, and Barlow Condensed through Google
Fonts. Font files are not bundled in this repository. System fonts are used when
the requests are unavailable. Font licensing information is available from
[Google Fonts](https://fonts.google.com/).

## Development tools

Puppeteer is an optional development dependency for screenshots and browser
integration checks. Its package and transitive dependencies carry their own
licenses. It is not imported by the running game.

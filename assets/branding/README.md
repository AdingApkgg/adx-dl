# AstroDX Branding Assets

This directory stores brand assets prepared for the AstroDX archive site.

## Source

The original icon files in `original/` were extracted from the official AstroDX Android APK release:

- Release: `v2.0.0.beta.5.patch.a`
- APK URL:
  `https://github.com/2394425147/astrodx/releases/download/v2.0.0.beta.5.patch.a/2.0.0.beta.5.patch.a.apk`

These files were identified from the APK manifest and mipmap resources:

- `app_icon`
- `app_icon_round`
- `ic_launcher_foreground`
- `ic_launcher_background`

## Directory Layout

- `original/`
  - Raw extracted Android icon resources
  - Includes adaptive icon XML plus foreground/background layers
- `web/`
  - Web-ready exports for site integration
  - Includes favicon PNGs, Apple touch icon, PWA icons, and an Open Graph image

## Web Asset Map

- `web/favicon-16x16.png`
- `web/favicon-32x32.png`
- `web/favicon-48x48.png`
- `web/apple-touch-icon.png`
- `web/icon-192.png`
- `web/icon-512.png`
- `web/opengraph-image.png`
- `web/og-image.html`
- `web/site.webmanifest`

## Suggested Next.js Usage

When the frontend is initialized, these can be mapped like this:

- `src/app/icon.png` <- `assets/branding/web/favicon-32x32.png` or `icon-192.png`
- `src/app/apple-icon.png` <- `assets/branding/web/apple-touch-icon.png`
- `src/app/opengraph-image.png` <- `assets/branding/web/opengraph-image.png`

## Notes

- The current Open Graph image is a usable branded placeholder for development.
- If you want a more polished social card later, rebuild it after the final UI direction is locked.

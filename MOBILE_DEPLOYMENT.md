# Foreshadow Mobile App Deployment Guide

This guide covers how to deploy Foreshadow to iOS (App Store) and Android (Play Store) using Capacitor.

## Architecture Overview

The mobile app uses the same codebase as the desktop web app, with:
- **Responsive UI**: Automatically adapts between desktop (floating windows) and mobile (bottom tab navigation)
- **Shared Database**: Same Supabase backend for both platforms
- **Native Wrapper**: Capacitor wraps your Next.js app in native iOS/Android shells

## Prerequisites

### For iOS Development
- macOS computer
- Xcode 14+ installed
- Apple Developer Account ($99/year for App Store)
- CocoaPods (`sudo gem install cocoapods`)

### For Android Development
- Android Studio installed
- Android SDK
- Google Play Developer Account ($25 one-time)

## Setup Instructions

### 1. Deploy Your Next.js App

Since Foreshadow uses API routes, you need to deploy the Next.js app first:

```bash
# Deploy to Vercel (recommended)
npx vercel

# Or deploy to your preferred hosting
```

### 2. Update Capacitor Config

Edit `capacitor.config.ts` and set your deployed URL:

```typescript
server: {
  url: 'https://your-app.vercel.app',
  androidScheme: 'https',
},
```

### 3. Add Native Platforms

```bash
# Add iOS platform
npm run cap:add:ios

# Add Android platform
npm run cap:add:android
```

### 4. Sync and Open

```bash
# Sync web assets to native projects
npm run cap:sync

# Open iOS project in Xcode
npm run cap:open:ios

# Open Android project in Android Studio
npm run cap:open:android
```

## iOS Deployment

### 1. Configure Xcode Project

1. Open `ios/App/App.xcworkspace` in Xcode
2. Select the "App" target
3. Set your Bundle Identifier (e.g., `com.yourcompany.foreshadow`)
4. Select your Development Team
5. Configure signing certificates

### 2. App Icons and Splash Screen

Replace the default icons in:
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/`

You can use a tool like [App Icon Generator](https://appicon.co/) to generate all required sizes.

### 3. Build and Submit

```bash
# In Xcode:
# 1. Select "Any iOS Device" as build target
# 2. Product > Archive
# 3. Distribute App > App Store Connect
```

## Android Deployment

### 1. Configure Android Project

1. Open `android/` folder in Android Studio
2. Update `android/app/build.gradle`:
   - `applicationId`: Your unique app ID
   - `versionCode`: Increment for each release
   - `versionName`: Your version string

### 2. App Icons

Replace icons in:
- `android/app/src/main/res/mipmap-*/`

### 3. Generate Signed APK/Bundle

```bash
# In Android Studio:
# 1. Build > Generate Signed Bundle / APK
# 2. Choose Android App Bundle
# 3. Create or use existing keystore
# 4. Build release
```

### 4. Submit to Play Store

1. Go to [Google Play Console](https://play.google.com/console)
2. Create new app
3. Upload your AAB file
4. Complete store listing
5. Submit for review

## Development Workflow

### Local Testing

For development, you can point the app to your local dev server:

1. Find your computer's local IP (e.g., `192.168.1.100`)
2. Update `capacitor.config.ts`:
   ```typescript
   server: {
     url: 'http://192.168.1.100:3000',
     cleartext: true,
   },
   ```
3. Run `npm run dev` on your computer
4. Run the app on your device/simulator

### Live Reload

For iOS Simulator:
```bash
npm run cap:open:ios
# In Xcode, run on simulator
```

For Android Emulator:
```bash
npm run cap:open:android
# In Android Studio, run on emulator
```

## Useful Commands

```bash
# Build and sync for mobile
npm run mobile:ios      # Build + sync + open Xcode
npm run mobile:android  # Build + sync + open Android Studio

# Just sync (after code changes)
npm run cap:sync

# Open native projects
npm run cap:open:ios
npm run cap:open:android
```

## Native Features (Future)

Capacitor allows you to add native functionality. Popular plugins:

```bash
# Push Notifications
npm install @capacitor/push-notifications

# Camera
npm install @capacitor/camera

# Local Notifications
npm install @capacitor/local-notifications

# Geolocation
npm install @capacitor/geolocation
```

## Troubleshooting

### iOS Build Fails
- Ensure CocoaPods is installed: `sudo gem install cocoapods`
- Clean build folder in Xcode: Cmd+Shift+K
- Delete `ios/App/Pods` and run `pod install`

### Android Build Fails
- Sync Gradle files in Android Studio
- Invalidate caches: File > Invalidate Caches
- Check SDK versions match in build.gradle

### App Shows Blank Screen
- Ensure `capacitor.config.ts` has correct `url`
- Check network connectivity
- Verify CORS settings on your deployed API

### API Calls Fail
- Ensure your deployed URL uses HTTPS
- Check Supabase environment variables are set
- Verify the deployed app works in browser first

## Store Submission Checklist

### iOS App Store
- [ ] App icons (all required sizes)
- [ ] Screenshots (6.5", 5.5", 12.9" iPad)
- [ ] App description and keywords
- [ ] Privacy policy URL
- [ ] Support URL
- [ ] Age rating questionnaire
- [ ] App Review Information

### Google Play Store
- [ ] App icons (512x512)
- [ ] Feature graphic (1024x500)
- [ ] Screenshots (phone, 7" tablet, 10" tablet)
- [ ] Short and full description
- [ ] Privacy policy URL
- [ ] Content rating questionnaire
- [ ] Target audience declaration


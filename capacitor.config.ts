import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.foreshadow.ios',
  appName: 'Foreshadow',
  webDir: '.next', // Next.js build output (for static assets)
  server: {
    // Production: TestFlight / App Store builds load the live Vercel deploy,
    // so CSS/React changes flow to installed apps instantly via Vercel.
    // For local dev on a physical device, temporarily swap to your LAN IP
    // (e.g. 'http://192.168.x.x:3000') and uncomment cleartext.
    url: 'https://foreshadow-app.vercel.app',
    // cleartext: true,
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    backgroundColor: '#0a0a0a',
  },
  android: {
    backgroundColor: '#0a0a0a',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0a0a0a',
      showSpinner: false,
    },
    StatusBar: {
      style: 'light',
      backgroundColor: '#0a0a0a',
      overlaysWebView: true,
    },
  },
};

export default config;


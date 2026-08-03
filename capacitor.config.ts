import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.foreshadow.ios',
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
  // The web view is light-mode only, so the native chrome around it is pinned
  // light too: #EDEDF1 is --app-shell-bg, the tone the app shell actually
  // paints behind the card. StatusBar `style: 'dark'` means dark *content*
  // (dark text) — the correct pairing for a light background.
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    backgroundColor: '#EDEDF1',
  },
  android: {
    backgroundColor: '#EDEDF1',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#EDEDF1',
      showSpinner: false,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#EDEDF1',
      overlaysWebView: true,
    },
  },
};

export default config;


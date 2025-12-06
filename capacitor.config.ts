import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.foreshadow.app',
  appName: 'Foreshadow',
  webDir: '.next', // Next.js build output (for static assets)
  server: {
    // IMPORTANT: Set this to your deployed URL for production
    // For local development, uncomment the line below and use your computer's IP
    // url: 'http://YOUR_LOCAL_IP:3000',
    // cleartext: true, // Allow HTTP for local development
    
    // For production, set to your deployed Next.js URL:
    // url: 'https://your-app.vercel.app',
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'automatic',
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
      style: 'dark',
      backgroundColor: '#0a0a0a',
    },
  },
};

export default config;


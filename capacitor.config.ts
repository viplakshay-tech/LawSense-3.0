import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.lawsense.mobile',
  appName: 'LawSense',
  webDir: 'capacitor-shell',
  android: {
    backgroundColor: '#11131a',
    loggingBehavior: 'none',
  },
};

export default config;

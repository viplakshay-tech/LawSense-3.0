
import type { CapacitorConfig } from '@capacitor/cli';

const developmentServerUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: 'in.lawsense.mobile',
  appName: 'LawSense',
  webDir: 'capacitor-shell',
  ...(developmentServerUrl
    ? {
        server: {
          url: developmentServerUrl,
          cleartext: developmentServerUrl.startsWith('http://'),
        },
      }
    : {}),
};

export default config;

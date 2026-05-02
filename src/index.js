import { createApp } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
  const app = createApp({
    alertsUrl: './assets/scenarios/alerts.json',
    incidentsUrl: './assets/scenarios/incidents.json',
    casesUrl: './assets/scenarios/cases.json',
    rulesUrl: './assets/scenarios/rules.json',
  });

  app.init().catch((error) => {
    console.error('Failed to initialize CyberSim SOC:', error);
    const status = document.getElementById('loadingStatus');
    if (status) status.textContent = 'Error loading SOC data. Run from a local web server.';
  });
});

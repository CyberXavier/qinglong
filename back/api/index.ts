import fileBrowser from './fileBrowser';
import panelConfig from '../config';
import { join } from 'path';
import { Router } from 'express';
import user from './user';
import env from './env';
import config from './config';
import log from './log';
import cron from './cron';
import script from './script';
import open from './open';
import dependence from './dependence';
import system from './system';
import subscription from './subscription';
import update from './update';
import dashboard from './dashboard';
import health from './health';
import clientIp from './clientIp';
import retention from './retention';

export default () => {
  const app = Router();
  user(app);
  env(app);
  config(app);
  log(app);
  cron(app);
  script(app);
  app.use(
    '/results',
    fileBrowser({
      root: join(panelConfig.rootPath, 'data', 'res'),
      createRoot: true,
    }),
  );
  open(app);
  dependence(app);
  system(app);
  subscription(app);
  update(app);
  dashboard(app);
  health(app);
  clientIp(app);
  retention(app);

  return app;
};

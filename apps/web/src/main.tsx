import { HttpResumeGateway } from './adapters/resume-gateway';
import { createRoot } from 'react-dom/client';
import { Controller } from '@statecarry/presentation';
import { HttpGateway } from './adapters/http-gateway';
import { LocalBrowserMemory } from './adapters/browser-memory';
import { LocalResumeMemory } from './adapters/resume-memory';
import { Root } from './Root';

const gateway = new HttpGateway();
const controller = new Controller(gateway, new LocalBrowserMemory(() => window.localStorage), () =>
  crypto.randomUUID(),
);
const resumeGateway = new HttpResumeGateway();
const resumeMemory = new LocalResumeMemory(() => window.localStorage);

createRoot(document.getElementById('root')!).render(
  <Root controller={controller} resumeGateway={resumeGateway} resumeMemory={resumeMemory} />,
);

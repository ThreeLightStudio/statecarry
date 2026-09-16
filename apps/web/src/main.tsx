import { HttpResumeGateway } from './adapters/resume-gateway';
import { createRoot } from 'react-dom/client';
import { HttpProjectGateway } from './adapters/project-gateway';
import { LocalResumeMemory } from './adapters/resume-memory';
import { Root } from './Root';

const projectGateway = new HttpProjectGateway();
const resumeGateway = new HttpResumeGateway();
const resumeMemory = new LocalResumeMemory(() => window.localStorage);

createRoot(document.getElementById('root')!).render(
  <Root
    projectGateway={projectGateway}
    resumeGateway={resumeGateway}
    resumeMemory={resumeMemory}
  />,
);

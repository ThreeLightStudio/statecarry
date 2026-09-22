import { HttpAnalysisGateway } from './adapters/analysis-gateway';
import { createRoot } from 'react-dom/client';
import { HttpProjectGateway } from './adapters/project-gateway';
import { LocalProjectDraftMemory } from './adapters/project-draft-memory';
import { Root } from './Root';

const projectGateway = new HttpProjectGateway();
const analysisGateway = new HttpAnalysisGateway();
const analysisMemory = new LocalProjectDraftMemory(() => window.localStorage);

createRoot(document.getElementById('root')!).render(
  <Root
    projectGateway={projectGateway}
    analysisGateway={analysisGateway}
    analysisMemory={analysisMemory}
  />,
);

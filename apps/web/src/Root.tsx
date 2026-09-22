import { useCallback, useEffect, useMemo } from 'react';
import {
  ProjectController,
  parseProjectRoute,
  projectRouteHref,
  type ProjectGateway,
  type AnalysisGateway,
  type AnalysisMemory,
} from '@statecarry/presentation';
import { ProjectWorkspace } from './ui/ProjectWorkspace';

export type RootProps = {
  projectGateway: ProjectGateway;
  analysisGateway: AnalysisGateway;
  analysisMemory?: AnalysisMemory;
};

export function Root({ projectGateway, analysisGateway, analysisMemory }: RootProps) {
  const controller = useMemo(
    () => new ProjectController(projectGateway, analysisGateway, analysisMemory),
    [projectGateway, analysisGateway, analysisMemory],
  );
  useEffect(() => {
    const readRoute = () => {
      const route = parseProjectRoute(window.location.hash);
      const canonical = projectRouteHref(route);
      if (window.location.hash !== canonical) window.history.replaceState(null, '', canonical);
      return route;
    };
    const changed = () => {
      controller.navigate(readRoute());
    };
    let wasAway = document.visibilityState === 'hidden';
    const returned = () => {
      if (!wasAway || document.visibilityState === 'hidden') return;
      wasAway = false;
      void controller.checkForChanges();
    };
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') wasAway = true;
      else returned();
    };
    void controller.start(readRoute());
    window.addEventListener('hashchange', changed);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      window.removeEventListener('hashchange', changed);
      document.removeEventListener('visibilitychange', visibilityChanged);
      controller.stop();
    };
  }, [controller]);
  const navigate = useCallback((href: string) => {
    const canonical = projectRouteHref(parseProjectRoute(href));
    if (window.location.hash === canonical) return;
    window.location.hash = canonical;
  }, []);
  return <ProjectWorkspace controller={controller} onNavigate={navigate} />;
}

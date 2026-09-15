import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  resumeRoute,
  type Controller,
  type ResumeGateway,
  type ResumeMemory,
  type ResumeWork,
} from '@statecarry/presentation';
import { App } from './ui/App';
import { Resume } from './ui/Resume';

export type RootProps = {
  controller: Controller;
  resumeGateway: ResumeGateway;
  resumeMemory?: ResumeMemory;
};

const legacyRoute = (route: string) => route.replace('#/details/', '#/work/');

function LegacyRoot({
  controller,
  resumeGateway,
}: Pick<RootProps, 'controller' | 'resumeGateway'>) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const onAction: Parameters<typeof App>[0]['onAction'] = (action) => {
    if (action.type === 'route') window.location.hash = resumeRoute(action.route);
    else void controller.action(action);
  };
  const onConnect: Parameters<typeof App>[0]['onConnect'] = async (input) => {
    const id = await controller.connect(input);
    if (id) {
      window.location.hash = `#/resume/${encodeURIComponent(id)}`;
      // A brand-new connection keeps the existing explicit first analysis.
      // Revisits and restores never call this path.
      void resumeGateway.refresh(id).catch(() => {});
    }
    return id;
  };
  return (
    <App
      state={state}
      onAction={onAction}
      onConnect={onConnect}
      onDiscover={(cwd) => controller.discover(cwd)}
      onListTurns={(id) => controller.listTurns(id)}
    />
  );
}

export function Root({ controller, resumeGateway, resumeMemory }: RootProps) {
  const controllerState = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [route, setRoute] = useState(() => resumeRoute(window.location.hash));
  const resumeViewCache = useMemo<{ works: ResumeWork[] }>(() => ({ works: [] }), [resumeGateway]);
  const routeRef = useRef(route);
  const legacyStarted = useRef(false);
  const routingFromLocation = useRef(false);

  useEffect(() => {
    let alive = true;
    const changed = () => {
      const next = resumeRoute(window.location.hash);
      routeRef.current = next;
      setRoute(next);
      if (window.location.hash !== next) window.history.replaceState(null, '', next);
      if (next.startsWith('#/resume')) {
        if (legacyStarted.current) {
          controller.stop();
          legacyStarted.current = false;
        }
        routingFromLocation.current = false;
        return;
      }
      routingFromLocation.current = true;
      const target = legacyRoute(next);
      const navigation = legacyStarted.current
        ? controller.navigate(target)
        : (() => {
            legacyStarted.current = true;
            return controller.start(target);
          })();
      void navigation.finally(() => {
        if (alive) routingFromLocation.current = false;
      });
    };
    changed();
    window.addEventListener('hashchange', changed);
    return () => {
      alive = false;
      window.removeEventListener('hashchange', changed);
      if (legacyStarted.current) controller.stop();
    };
  }, [controller]);

  // Legacy detail actions can navigate Controller without changing the browser
  // hash. Keep the public URL canonical once such an action completes.
  useEffect(() => {
    if (!legacyStarted.current || routingFromLocation.current) return;
    const expected = legacyRoute(routeRef.current);
    if (controllerState.route === expected) return;
    const next = resumeRoute(controllerState.route);
    routeRef.current = next;
    setRoute(next);
    if (window.location.hash !== next) window.history.replaceState(null, '', next);
    if (next.startsWith('#/resume')) {
      controller.stop();
      legacyStarted.current = false;
    }
  }, [controllerState.route]);

  if (route.startsWith('#/resume')) {
    return (
      <Resume
        gateway={resumeGateway}
        workId={route.split('/')[2]}
        memory={resumeMemory}
        viewCache={resumeViewCache}
      />
    );
  }
  return <LegacyRoot controller={controller} resumeGateway={resumeGateway} />;
}

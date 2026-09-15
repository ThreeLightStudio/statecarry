import { Resume } from './ui/Resume';
import { HttpResumeGateway } from './adapters/resume-gateway';
import { createRoot } from 'react-dom/client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Controller, resumeRoute } from '@statecarry/presentation';
import { HttpGateway } from './adapters/http-gateway';
import { LocalBrowserMemory } from './adapters/browser-memory';
import { App } from './ui/App';
const controller = new Controller(
  new HttpGateway(),
  new LocalBrowserMemory(() => window.localStorage),
  () => crypto.randomUUID(),
);
const onAction: Parameters<typeof App>[0]['onAction'] = (action) => {
  if (action.type === 'route') location.hash = resumeRoute(action.route);
  else void controller.action(action);
};
const onConnect: Parameters<typeof App>[0]['onConnect'] = async (input) => {
  const id = await controller.connect(input);
  if (id) {
    location.hash = `#/resume/${id}`;
    void resumeGateway.refresh(id).catch(() => {});
  }
  return id;
};
const onDiscover: Parameters<typeof App>[0]['onDiscover'] = (cwd) => controller.discover(cwd);
function LegacyRoot() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <App
      state={state}
      onAction={onAction}
      onConnect={onConnect}
      onDiscover={onDiscover}
      onListTurns={(id) => controller.listTurns(id)}
    />
  );
}
const resumeGateway = new HttpResumeGateway();
let legacyStarted = false;
function Root() {
  const [route, setRoute] = useState(() => resumeRoute(location.hash));
  useEffect(() => {
    const changed = () => {
      const next = resumeRoute(location.hash);
      setRoute(next);
      if (location.hash !== next) history.replaceState(null, '', next);
      if (next.startsWith('#/resume')) return;
      const legacy = next.replace('#/details/', '#/work/');
      if (!legacyStarted) {
        legacyStarted = true;
        void controller.start(legacy);
      } else void controller.navigate(legacy);
    };
    changed();
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return route.startsWith('#/resume') ? (
    <Resume gateway={resumeGateway} workId={route.split('/')[2]} />
  ) : (
    <LegacyRoot />
  );
}
createRoot(document.getElementById('root')!).render(<Root />);

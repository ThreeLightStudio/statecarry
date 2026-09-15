import type { ResumeWork } from '@statecarry/presentation';
import './styles.css';

type SidebarWork = Pick<ResumeWork, 'workId' | 'title' | 'sessionCount'>;

/**
 * The return page and the record detail page share one navigation model.  The
 * sidebar deliberately exposes resume work as the primary destination; the
 * older evidence view remains available as a secondary, explicit detail link.
 */
export function AppSidebar({ works, activeWorkId, activeDetails = false, activeConnect = false }: {
  works?: SidebarWork[];
  activeWorkId?: string;
  activeDetails?: boolean;
  activeConnect?: boolean;
}) {
  return <aside className="sidebar" aria-label="StateCarry navigation">
    <a className="brand" href="#/resume"><span className="brand-mark">S</span>StateCarry</a>
    <p className="sidebar-caption">Return to your work</p>
    <nav aria-label="Projects">
      <a className={!activeWorkId && !activeDetails && !activeConnect ? 'nav-link active' : 'nav-link'} href="#/resume">Resume</a>
      {(works ?? []).map(work => <a key={work.workId} className={activeWorkId === work.workId && !activeDetails ? 'nav-link active' : 'nav-link'} href={`#/resume/${encodeURIComponent(work.workId)}`}>
        {work.title || 'Connected work'}
        <small className="sidebar-work-meta">{work.sessionCount} connected conversation{work.sessionCount === 1 ? '' : 's'}</small>
      </a>)}
      {activeWorkId ? <a className={activeDetails ? 'nav-link active' : 'nav-link'} href={`#/details/${encodeURIComponent(activeWorkId)}`}>Review details</a> : null}
      <a className={`nav-link add-link${activeConnect ? ' active' : ''}`} href="#/connect">＋ Connect records</a>
    </nav>
    <div className="sidebar-footer"><span className="status-dot" />Codex records on this device<p>StateCarry prepares a brief. Continue in Codex when you are ready.</p></div>
  </aside>;
}

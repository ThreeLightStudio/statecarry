import {
  presentResumeNarrative,
  type ResumeCandidateViewModel,
  type ResumeWork,
} from '@statecarry/presentation';

export function ResumeBrief({
  candidate,
  work,
}: {
  candidate: ResumeCandidateViewModel;
  work: ResumeWork;
}) {
  const narrative = presentResumeNarrative(candidate, work);
  return (
    <div className="resume-narrative">
      <h2>Where you left off</h2>
      <p>{narrative.currentState}</p>
      {narrative.evidenceNote ? <p className="small muted">{narrative.evidenceNote}</p> : null}
      {narrative.transitionHeading && narrative.transition ? (
        <>
          <h2>{narrative.transitionHeading}</h2>
          <p>{narrative.transition}</p>
        </>
      ) : null}
      {narrative.nextAction && narrative.doneWhen ? (
        <>
          <h2>Next action</h2>
          <p className="resume-action">{narrative.nextAction}</p>
          <small>
            {work.correctedKeys.includes(candidate.key)
              ? 'Corrected by you'
              : candidate.actionSourceLabel}
          </small>
          <p className="resume-done-when">
            <strong>Complete when:</strong> {narrative.doneWhen}
          </p>
        </>
      ) : null}
    </div>
  );
}

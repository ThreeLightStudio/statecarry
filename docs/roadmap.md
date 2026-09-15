# Roadmap

Status: development preview, 2026-09-15. Automated checks and source cleanup are separate from a completed product workflow.

The product goal is to help someone return to interrupted work, recognize the currently valid task, understand the necessary context and begin one useful action after the required confirmation.

## Release sequence

1. Prepare a reproducible source tree and local initial commit. Preserve private material outside the public candidates, document the supported environment and verify installation, checks, tests and build from only those candidates.
2. Confirm the source license, required notices, repository owner/name and public commit attribution. Publish the reviewed source, then verify anonymous access, cloning and remote commit identity.
3. Fix work-specific state and action validity. A draft from one work must not be saved into another; a changed goal or evidence scope must not reuse an unrelated earlier action; informational inspection limits must not force repeated analysis without a way forward.
4. Complete the resume narrative and navigation lifecycle. Preserve candidate selection across detail navigation, synchronize connection state and the URL, restore the same disconnected connection, and refresh saved results after server reconnection without automatically starting model analysis.
5. Observe real work resumption and a later return. Confirm arrival at the intended conversation, execution of the first useful action and an updated result that does not suggest repeating completed work. Distinguish model output, user reports and independently checked outcomes.
6. Prepare a local MVP build from the validated source commit. Review package contents and notices, verify installation and describe only the capabilities actually demonstrated.

## Known gaps

The following were identified during development and remain outside the source-cleanup task:

- Switching work while editing a goal can mix draft state between works.
- Changing a goal when project inspection fails can leave an older candidate associated with the new goal.
- Limited project inspection can disable an otherwise current candidate's action and lead to repeated rechecks.
- Candidate selection, disconnect/restore, URL synchronization and server reconnection need further integrated verification.
- The resume body can repeat generic progress text without explaining the result that changed the next decision.

Existing automated tests do not establish that these gaps are resolved. A first public source release should retain this development status.

## Validation still needed

Use multiple goals, including different goals in the same folder and work spanning more than one conversation. Check work changes, edited drafts, refreshes, navigation away and back, restarts, disconnection and restoration. Separate time spent waiting for analysis from the user's understanding and first action.

Observe at least three complete real-work returns, including a subsequent return after the action's result arrives. A copied brief, accepted OS open request or synthetic-provider test alone is not a completed work return. A same-account clean directory check is also distinct from installation by another person or on another device.

This scope does not add automatic action execution, message submission, environment restoration, a general project manager or a new model-provider system. Existing auxiliary context features remain available while the main resume flow is completed.

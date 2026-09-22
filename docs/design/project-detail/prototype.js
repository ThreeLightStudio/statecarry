/* Design-only prototype. No product imports, network requests, Git operations, or Codex calls. */
(() => {
  // A separate review session keeps earlier prototype drafts intact.
  const storeKey =
    new URLSearchParams(window.location.search).get('preview') === '03'
      ? 'statecarry.design.project-detail.review03'
      : 'statecarry.design.project-detail.v1';
  const groups = [
    {
      title: '프로젝트 복귀 화면',
      short: '변경 처리 화면',
      summary: '남은 변경을 살펴보고, 이어가거나 논의하는 화면을 추가한 것으로 분석됐습니다.',
      current:
        '이전 분석에서는 작업 선택과 보존, 논의, 요청 복사 화면이 추가된 것으로 해석했습니다. 최신 동작은 재확인이 필요합니다.',
      benefit:
        '프로젝트 상태를 이해하고 다음 행동을 고르는 데 도움이 될 수 있습니다. 제품 정책과 연결한 해석이며, 실제 사용성 개선은 미확인입니다.',
      originalTitle: 'Working-tree recovery and decision flow',
      original:
        'StateCarry now interprets uncommitted changes as selectable work and guides users through review, continuation, discussion, or stopping.',
      originalState:
        'The project workspace presents semantic change groups, preserves selected work across refreshes, and offers scoped handoff copying without starting work. Missing or stopped tasks now retain context and provide explicit next choices.',
      files: [
        'apps/web/src/ui/ProjectWorkspace.tsx',
        'apps/web/src/ui/WorkDiscussion.tsx',
        'packages/presentation/src/project-controller.ts',
        'packages/presentation/src/projects.ts',
        'packages/contracts/src/resume.ts',
      ],
      shared: true,
    },
    {
      title: '논의한 내용과 작성 중인 요청을 보존하는 기능',
      short: '논의 내용 보존·전달',
      summary:
        '작업과 목표에 관한 논의를 준비하고, 내용을 남겨 다시 사용할 수 있도록 바꾼 것으로 분석됐습니다.',
      current:
        '이전 분석에서는 논의 내용을 작성·수정·복사하고 저장하는 경로가 추가됐다고 설명합니다. 서버까지 연결한 전체 동작은 확인되지 않았습니다.',
      benefit:
        '논의를 나중에 이어갈 때 작성하던 내용부터 다시 시작할 수 있습니다. 의도된 효과이며, 실제 복귀 동작의 검증 결과는 연결돼 있지 않습니다.',
      originalTitle: 'Task and goal discussion handoffs',
      original:
        'The application adds explicit task and goal discussion preparation with validated local persistence and HTTP gateway support.',
      originalState:
        'Users can prepare, edit, copy, and retain task or goal discussion context without automatically starting work. Saved discussion data is bounded, validated, copied through an allowlist, and exposed through the resume API.',
      files: [
        'apps/server/src/http.ts',
        'apps/web/src/adapters/resume-memory.ts',
        'packages/presentation/src/project-controller.ts',
        'packages/presentation/src/projects.ts',
        'packages/contracts/src/resume.ts',
      ],
      shared: true,
    },
    {
      title: '앱을 시작할 때 기록을 읽는 방식의 개선',
      short: '기록 읽기 개선',
      summary:
        '기존 기록을 한꺼번에 처리하지 않고 나누어 읽도록 바꾼 것으로 분석됐습니다. 실제 성능 효과는 미확인입니다.',
      current:
        '이전 분석에서는 시작 시 기존 작업의 처리를 미루고, 로컬 기록이 충분하면 중복해서 기록 본문을 읽지 않도록 바꿨다고 설명합니다.',
      benefit:
        '시작 시 기록을 읽는 부담을 줄일 가능성이 있습니다. 실제 속도나 메모리 사용량이 개선됐다는 측정 결과는 없습니다.',
      originalTitle: 'Incremental startup and source observation',
      original:
        'Server startup and Codex reading now defer existing work and prefer metadata plus streamed local JSONL evidence.',
      originalState:
        'Existing connections are scheduled instead of processed immediately, and rollout files are parsed incrementally while provider turn bodies are skipped when local evidence is sufficient. Source manifests now record whether evidence came from provider turns, local JSONL, or fallback behavior.',
      files: [
        'apps/server/src/adapters/codex-reader.ts',
        'apps/server/src/background.ts',
        'apps/server/src/runtime.ts',
        'tests/server-runtime.test.ts',
      ],
      shared: false,
    },
  ];
  const readableWork = [
    {
      title: '프로젝트 복귀 화면',
      short: '복귀 화면',
      summary: '남은 변경을 보고 다음 행동을 고르는 화면입니다.',
      recorded: '작업 선택·논의·요청 복사 화면을 추가했습니다.',
      unknown: '현재 화면 동작은 확인되지 않았습니다.',
      question: '먼저 화면 동작 확인',
      reason: '어디까지 됐는지 확인하면, 마무리할지 더 손볼지 고를 수 있습니다.',
      action: '화면 동작 확인 준비',
      checks: [
        '작업을 바꾸면 설명과 행동도 함께 바뀌는지',
        '다시 열었을 때 선택과 작성 중인 내용이 남는지',
        '요청을 복사하는 것만으로 작업이 실행되지 않는지',
      ],
      remaining: '좁은 화면에서 행동을 찾기 어려운 부분을 다듬어야 합니다.',
    },
    {
      title: '논의 내용 보존',
      short: '논의 보존',
      summary: '이전에 나눈 논의와 작성 중인 요청을 다시 이어 쓰는 기능입니다.',
      recorded: '논의를 작성·수정·복사하고 저장하는 기능을 추가했습니다.',
      unknown: '저장한 내용을 다시 불러오는지는 확인되지 않았습니다.',
      question: '먼저 저장과 복귀 확인',
      reason: '입력한 내용이 돌아오는지 확인해야 안심하고 논의를 이어갈 수 있습니다.',
      action: '저장·복귀 확인 준비',
      checks: [
        '논의 내용이 서버에 저장되는지',
        '다시 열면 작성 중인 요청을 복원하는지',
        '복사한 요청에 선택한 작업만 포함되는지',
      ],
      remaining: '저장에 실패했을 때 다시 시도하는 흐름을 다듬어야 합니다.',
    },
    {
      title: '시작할 때 기록 읽기',
      short: '기록 읽기',
      summary: '기존 기록을 한꺼번에 읽지 않고 나누어 처리하는 변경입니다.',
      recorded: '시작 시 처리를 미루고 기록을 나누어 읽도록 바꿨습니다.',
      unknown: '속도와 메모리 사용량의 변화는 측정되지 않았습니다.',
      question: '먼저 성능 비교',
      reason: '같은 기록으로 변경 전후를 비교하면 개선 효과를 판단할 수 있습니다.',
      action: '성능 비교 준비',
      checks: [
        '같은 기록을 읽었을 때 시작 시간의 차이',
        '메모리 사용량의 차이',
        '나누어 읽어도 빠지는 기록이 없는지',
      ],
      remaining: '기록이 많은 경우의 읽기 방식을 더 조정해야 합니다.',
    },
  ];
  groups.forEach((group, i) => Object.assign(group, readableWork[i]));
  const defaults = {
    version: 1,
    showKept: false,
    recheck: [],
    policyPending: false,
    goalFinished: false,
    scenario: 'actual',
    view: 'overview',
    group: 0,
    scopeConfirmed: false,
    intent: 'continue',
    kept: [],
    drafts: {},
    turns: {},
    requests: {},
    expanded: {},
    basis: 1,
    discussionBasis: {},
    discussionReturn: 'overview',
    discussionKey: 'all',
    proposedGoal: '',
    confirmedGoal: '',
    correction: '',
    narrow: false,
    away: false,
    returnView: 'overview',
    policyChoice: '',
    basisChanged: false,
    scrolls: {},
    returnFocus: {},
    nextScope: '',
    nextDone: '',
  };
  let state = structuredClone(defaults);
  let storageFailed = false;
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey) || 'null');
    if (saved?.version === 1) state = { ...defaults, ...saved };
  } catch {
    storageFailed = true;
  }
  const screen = document.getElementById('screen');
  const notice = document.getElementById('notice');
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const selected = () => groups[state.group] ?? groups[0];
  const btn = (label, action, kind = '', disabled = false) =>
    `<button type="button" class="${kind}" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  const heading = (title, kicker = '') =>
    `${kicker ? `<p class="eyebrow">${kicker}</p>` : ''}<h2>${title}</h2>`;
  const actions = (...items) => `<div class="actions">${items.join('')}</div>`;
  const detail = (key, title, content) =>
    `<details data-detail="${key}" ${state.expanded[`${state.view}:${key}`] ? 'open' : ''}><summary>${title}</summary>${content}</details>`;
  const example = (text) => `<p class="review-only">시나리오 예시 · ${text}</p>`;
  function save() {
    try {
      localStorage.setItem(storeKey, JSON.stringify(state));
      storageFailed = false;
    } catch {
      storageFailed = true;
    }
    document.getElementById('saved').textContent = storageFailed
      ? '이 브라우저에 시안 상태를 저장하지 못했습니다. 현재 입력은 화면에 남아 있습니다. 필요한 내용을 복사해 보관하세요.'
      : '선택과 초안은 이 시안에 저장됩니다.';
  }
  function message(text) {
    notice.textContent = text;
  }
  function go(view, restore = false) {
    state.scrolls[state.view] = window.scrollY;
    state.returnFocus[state.view] = document.activeElement?.dataset.action || '';
    state.view = view;
    state.away = false;
    save();
    render();
    if (restore) {
      const target = [...screen.querySelectorAll('[data-action]')].find(
        (el) => el.dataset.action === state.returnFocus[view],
      );
      target?.focus({ preventScroll: true });
      window.scrollTo(0, state.scrolls[view] || 0);
    } else {
      const title = screen.querySelector('h2');
      title?.setAttribute('tabindex', '-1');
      title?.focus({ preventScroll: true });
      title?.scrollIntoView({ block: 'start' });
    }
  }
  function original(group = selected()) {
    return `<p class="small">저장 분석 원문 · 2026.09.20 19:54 KST · 영어 원문 유지</p><h3>${escape(group.originalTitle)}</h3><blockquote>${escape(group.original)}</blockquote><blockquote>${escape(group.originalState)}</blockquote><p class="small">분석의 해석이며 사용자 요청이나 독립적인 검증 결과가 아닙니다.</p><p><a href="evidence.json" target="_blank" rel="noopener">전체 분석 원본 열기 ↗</a></p>`;
  }
  function basis(all = false) {
    return detail(
      'basis',
      '분석의 출처와 한계',
      '<div class="basis"><h3>이전 분석입니다</h3><p>9월 20일 19:54에 저장한 분석입니다. 20:22에 읽은 프로젝트 상태와 달라 최신 상태로 볼 수 없습니다.</p><h3>전체 파일을 읽은 결과는 아닙니다</h3><p>선택한 파일 120개를 읽었습니다. 발견한 파일 중 697개는 읽지 않았습니다.</p><h3>시작한 이유는 확인되지 않았습니다</h3><p>작업을 시작한 사용자 요청이나 결정 기록이 연결돼 있지 않습니다.</p>' +
        detail(
          'analysis-original',
          '저장된 분석 원문',
          all ? groups.map(original).join('<hr />') : original(),
        ) +
        '</div>',
    );
  }
  function freshness() {
    if (state.scenario === 'checking')
      return '<div class="update-note"><p>현재 변경 상태를 확인하고 있습니다.</p><p class="small">이전 설명과 선택은 그대로 남아 있습니다. 실행 범위 확정은 확인이 끝난 뒤 가능합니다.</p></div>';
    if (state.scenario === 'failure')
      return `<div class="update-note"><p>최신 변경 상태를 읽지 못했습니다.</p><p class="small">이전 설명과 작성 중인 내용은 그대로 남아 있습니다.</p>${btn('변경 상태 다시 확인', 'retry', 'text')}</div>`;
    if (state.scenario === 'actual' || state.basisChanged)
      return `<div class="update-note"><p>이 설명 이후 논의 이후 프로젝트가 바뀌었습니다.</p><p class="small">19:54 분석은 이전 상태 기준입니다. 20:22 관찰과 근거가 달라 처리 범위를 다시 확인해야 합니다.</p>${btn('변경 상태 확인', 'retry', 'text')}</div>`;
    return '';
  }
  function kept() {
    if (!state.kept.length) return '';
    return detail(
      'kept',
      `그대로 둔 변경 · ${state.kept.length}`,
      `<p>직접 남겨두기로 한 변경입니다. 같은 상태로 돌아왔다고 다시 처리할 필요는 없습니다.</p>${state.kept.map((i) => `<p>${escape(groups[i].short)}</p>`).join('')}${state.basisChanged ? '<p>관련 새 정보가 있습니다. 앞서 남긴 결정은 유지하며 달라진 부분만 재검토합니다.</p>' : ''}${btn('남겨둔 변경 다시 살펴보기', 'reopen', 'text')}`,
    );
  }
  function overview() {
    const visible = groups
      .map((g, i) => ({ ...g, i }))
      .filter((g) => state.showKept || !state.kept.includes(g.i) || state.recheck.includes(g.i));
    if (!visible.length) return direction();
    if (!visible.some((g) => g.i === state.group)) {
      state.group = visible[0].i;
      state.scopeConfirmed = false;
    }
    const g = selected();
    const remaining = state.scenario === 'work-left' && !state.basisChanged;
    const ready = state.scenario === 'work-ready' && !state.basisChanged;
    const sample = remaining || ready;
    const nextTitle = remaining ? '남은 수정 이어가기' : ready ? '커밋할 범위 검토' : g.question;
    const nextReason = remaining
      ? g.remaining
      : ready
        ? '확인한 작업만 포함하고, 다른 작업의 수정은 남깁니다.'
        : g.reason;
    const nextAction = remaining ? '남은 수정 이어가기' : ready ? '커밋 범위 검토' : g.action;
    const nextTarget = remaining ? 'continue-discussion' : ready ? 'review:commit' : 'check-plan';
    const noticeText =
      state.scenario === 'checking'
        ? '최신 상태를 확인하고 있습니다. 이전 설명과 작성한 내용은 그대로 볼 수 있습니다.'
        : state.scenario === 'failure'
          ? '최신 상태를 읽지 못했습니다. 이전 설명은 남아 있습니다.'
          : state.recheck.includes(state.group)
            ? '남겨둔 작업에 새 정보가 생겼습니다. 달라진 부분만 다시 살펴보세요.'
            : '';
    return (
      `<div class="context-line"><span>남아 있는 변경</span><span>${visible.findIndex((item) => item.i === state.group) + 1} / ${visible.length}</span></div>` +
      heading(escape(g.title)) +
      `<p class="work-purpose">${escape(g.summary)}</p>` +
      `<p class="source-note">${sample ? '상태 예시 · 실제 확인 결과가 아닙니다' : '이전 분석 · 9월 20일 19:54'}</p>` +
      `<dl class="fact-sheet"><div><dt>${sample ? '확인한 내용' : '기록된 변경'}</dt><dd>${escape(sample ? '선택한 작업의 확인 항목을 점검했습니다. [예시]' : g.recorded)}</dd></div><div><dt>${remaining ? '남은 수정' : ready ? '다음 확인' : '아직 미확인'}</dt><dd>${escape(remaining ? g.remaining : ready ? '커밋에 포함할 수정 구간을 골라야 합니다.' : g.unknown)}</dd></div></dl>` +
      (noticeText ? `<p class="state-notice">${noticeText}</p>` : '') +
      `<section class="next-action" aria-label="다음 행동"><p class="eyebrow">다음으로</p><h3>${nextTitle}</h3><p>${escape(nextReason)}</p><div class="action-pair">${btn(nextAction, nextTarget, 'primary')}${btn('이 변경 남겨두기', 'keep-group', 'text')}</div></section>` +
      `<div class="alternatives"><span>다른 방법</span>${!remaining ? btn('작업 이어가기', 'continue-discussion', 'text') : ''}${!ready ? btn('커밋 검토', 'review:commit', 'text') : ''}${btn('되돌리기 검토', 'review:revert', 'text')}${btn('이 작업에 질문하기', 'discuss-group', 'text')}</div>` +
      detail(
        'discovered',
        '변경 설명과 판단 근거',
        `<div class="stories"><section><h3>이전 분석의 진행 상태</h3><p>${escape(g.current)}</p></section><section><h3>기대하는 효과</h3><p>${escape(g.benefit)}</p></section></div>` +
          basis() +
          detail(
            'correction',
            '설명이 실제 작업과 다르다면',
            `<label class="field">작업에 관한 내 설명<textarea data-input="correction">${escape(state.correction)}</textarea></label>${btn('내 설명 저장', 'correct')}`,
          ),
      ) +
      (['actual', 'failure'].includes(state.scenario) || state.basisChanged
        ? btn('최신 상태 다시 확인', 'retry', 'text state-retry')
        : '') +
      (visible.length > 1
        ? `<section class="other-work"><h3>함께 남아 있는 작업</h3><div class="work-list">${visible
            .filter((item) => item.i !== state.group)
            .map(
              (item) =>
                `<button type="button" data-action="select:${item.i}"><span><strong>${escape(item.title)}</strong><small>${escape(item.summary)}</small></span><span aria-hidden="true">→</span></button>`,
            )
            .join('')}</div>${btn('모두 남겨두고 다른 작업 보기', 'keep-all', 'text')}</section>`
        : '') +
      kept()
    );
  }
  function checkPlan() {
    const g = selected();
    return (
      heading(escape(g.short) + ' 확인', '확인할 내용') +
      `<p class="work-purpose">${escape(g.unknown)}</p><ol class="check-list">${g.checks.map((item) => `<li>${escape(item)}</li>`).join('')}</ol>` +
      '<p>최신 상태를 읽고, 확인한 결과와 남은 일을 정리하도록 요청합니다.</p>' +
      actions(
        btn('이 내용으로 확인 요청 준비', 'prepare-check', 'primary'),
        btn('확인할 내용 논의', 'discuss-group'),
        btn('작업으로 돌아가기', 'overview', 'text'),
      ) +
      '<p class="small">이 시안에서는 요청문을 준비합니다. 실제 확인은 Codex에서 진행합니다.</p>'
    );
  }
  function chooser() {
    return overview();
  }
  function inspect() {
    return overview();
  }
  function scope() {
    return review();
  }
  function nextReview() {
    return (
      heading('다음 작업의 범위와 완료 조건을 확인하세요') +
      example('다음 작업을 논의한 후 확정하는 장면입니다.') +
      '<p>제안 선택만으로 실행하지 않습니다. 논의한 내용을 수정하고, 남겨둔 변경과 겹치는지도 확인하세요.</p>' +
      `<label class="field">진행할 내용과 범위<textarea data-input="next-scope">${escape(state.nextScope || '실제 분석을 적용한 프로젝트 상세 설명과 선택 순서를 검토한다. 앱 코드는 변경하지 않는다.')}</textarea></label><label class="field">완료 조건<textarea data-input="next-done">${escape(state.nextDone || '사용자가 변경의 의미, 미확인 사항, 처리 방법을 구분할 수 있는지 검토하고 결과를 남긴다.')}</textarea></label>` +
      actions(
        btn(
          '이 내용으로 실행 요청 준비',
          'prepare-next',
          'primary',
          state.basisChanged || ['checking', 'failure'].includes(state.scenario),
        ),
        btn('논의로 돌아가기', 'back-next-discussion'),
        btn('나중에 결정하기', 'defer', 'text'),
      ) +
      (state.basisChanged
        ? '<p class="decision-status">관련 변경이 생겼습니다. 작성한 내용은 보존하고, 요청 전 범위를 다시 확인합니다.</p>'
        : '') +
      kept()
    );
  }
  function treatment() {
    return overview();
  }
  function review() {
    const revert = state.intent === 'revert';
    const confirmed =
      state.scopeConfirmed &&
      !state.basisChanged &&
      !['checking', 'failure'].includes(state.scenario);
    const title = revert
      ? '어떤 수정을 되돌릴까요?'
      : state.intent === 'commit'
        ? '어떤 수정을 커밋할까요?'
        : '무엇을 어디까지 이어갈까요?';
    return (
      heading(title, escape(selected().short)) +
      `<p>${selected().shared ? '다른 작업과 같은 파일을 수정했습니다. 이 작업의 수정과 남길 수정을 구분해야 합니다.' : '작업에 속한 파일 목록은 있지만, 실행할 수정 구간은 아직 확인이 필요합니다.'}</p>` +
      (confirmed
        ? example('범위를 확인한 상태입니다. 실제 수정 구간을 검증한 결과는 아닙니다.')
        : '<p class="decision-status">처리 방법은 선택했습니다. 요청을 준비하려면 정확한 범위를 확인해야 합니다.</p>') +
      `<div class="two-lines"><section><h3>${revert ? '되돌릴 대상' : '포함할 대상'}</h3><p>${confirmed ? '이 작업에 속하는 수정 구간 [예시]' : '이 작업에 속하는 수정 구간 · 아직 미확정'}</p></section><section><h3>남길 대상</h3><p>다른 작업의 수정과 선택하지 않은 구간</p></section><section><h3>확인 결과</h3><p>현재 범위와 일치하는 검증 결과는 연결되지 않았습니다. 실행 전 확인할 항목에 포함합니다.</p></section></div>` +
      (revert
        ? `<fieldset class="revert-options"><legend>되돌리는 방법</legend><label class="choice"><input type="radio" name="revert-mode" value="discard" ${state.revertMode !== 'unstage' ? 'checked' : ''} /><span>선택한 수정 내용 되돌리기<small>해당 수정 내용이 없어집니다.</small></span></label><label class="choice"><input type="radio" name="revert-mode" value="unstage" ${state.revertMode === 'unstage' ? 'checked' : ''} /><span>커밋 준비 상태만 해제하기<small>수정 내용은 그대로 남깁니다.</small></span></label></fieldset>`
        : '') +
      actions(
        btn('범위 확인을 위한 논의', 'discuss-group', confirmed ? '' : 'primary'),
        btn(
          `이 범위로 ${revert ? '되돌리기' : state.intent === 'commit' ? '커밋' : '이어가기'} 요청 준비`,
          'prepare',
          confirmed ? 'primary' : '',
          !confirmed,
        ),
        btn('판단으로 돌아가기', 'overview', 'text'),
      ) +
      detail(
        'scope-files',
        '관련 파일과 범위 확인의 한계',
        `<p>파일 목록은 수정 구간의 확정 범위가 아닙니다. 한 파일에 다른 작업이 섞였다고 파일 전체를 자동 포함하지 않습니다.</p><pre>${escape(selected().files.join('\n'))}</pre>`,
      )
    );
  }
  function startDiscussion(key, intent) {
    state.discussionReturn = state.view;
    state.discussionKey = key;
    state.discussionBasis[key] ??= state.basis;
    if (intent) state.intent = intent;
    else if (['overview', 'choose', 'inspect', 'treatment', 'unknown'].includes(state.view))
      state.intent = 'discuss';
    go('discussion');
  }
  function discussion() {
    const key = state.discussionKey;
    const stale = state.discussionBasis[key] !== state.basis;
    const title =
      key === 'all'
        ? '남아 있는 변경의 필요성과 범위'
        : key === 'next'
          ? '다음 작업의 내용과 범위'
          : selected().title;
    const turns = state.turns[key] ?? [];
    return (
      heading(escape(title), '작업 논의') +
      '<p class="small">이 작업에서 결정하기 어려운 점을 함께 살펴봅니다.</p>' +
      `<div class="turns">${turns.map((t) => `<div class="question"><p class="small">나 · 시안에 작성한 질문</p><p>${escape(t.q)}</p></div><div class="answer"><p class="small">StateCarry · 예시 답변${t.basis !== state.basis ? ' · 이전 상태 기준' : ''}</p><p class="answer-conclusion">${escape(t.answer?.conclusion || t.a)}</p>${t.answer ? `<p>${escape(t.answer.reason)}</p><div class="answer-next"><h3>다음 확인</h3><p>${escape(t.answer.next)}</p></div>` : ''}${detail(`answer-${t.id}`, '답변의 근거와 한계', '<p>질문을 분석해 생성한 답변이 아닙니다. 선택한 작업의 설명 형식을 검토하는 예시이며, 실제 판단은 최신 수정과 검증 결과를 확인해야 합니다.</p>' + detail(`answer-original-${t.id}`, '분석 원문 보기', key === 'all' || key === 'next' ? groups.map(original).join('<hr />') : original()))}</div>`).join('')}</div>` +
      (stale
        ? `<div class="update-note"><p>논의 이후 프로젝트가 바뀌었습니다.</p><p class="small">이전 답변과 작성 중인 질문은 유지됩니다. 새 질문은 현재 상태를 확인한 뒤 이어갈 수 있습니다.</p>${btn('현재 상태로 논의 이어가기', 'rebase')}</div>`
        : '') +
      `<label class="field">논의할 내용<textarea data-input="discussion" maxlength="2000" placeholder="예: 이 작업만 따로 마무리할 수 있나요?">${escape(state.drafts[key] ?? '')}</textarea></label>` +
      actions(
        btn('예시 답변 보기', 'ask', 'primary', stale),
        ['continue', 'commit', 'revert'].includes(state.intent) && turns.length
          ? btn('진행할 범위 확인', `review:${state.intent}`)
          : '',
        btn('작업으로 돌아가기', 'close-discussion', 'text'),
      ) +
      '<p class="small">검토 시안에서는 질문을 전송하지 않고 예시 답변을 보여줍니다.</p>'
    );
  }

  function direction() {
    if (state.goalFinished)
      return (
        heading('현재 방향을 마쳤습니다') +
        '<p>완료로 기록한 결정을 보존했습니다. 새 작업은 아직 정하지 않았습니다.</p>' +
        actions(
          btn('새 방향 논의 요청 준비', 'goal-request'),
          btn('여기서 마치기', 'defer', 'text'),
        ) +
        kept()
      );
    if (state.scenario === 'conflict' && !state.confirmedGoal) return conflict();
    if (state.policyPending)
      return (
        heading('정책 변경부터 진행할까요?', '') +
        '<p>정책 변경을 논의하기로 했습니다. 적용할 범위와 승인 내용을 작업으로 정리해야 합니다.</p><p class="decision-status">정책 반영 전에는 충돌하는 커밋 작업을 진행하지 않습니다.</p>' +
        actions(
          btn('정책 변경 작업 논의하기', 'discuss-next', 'primary'),
          btn('방향 선택 다시 검토', 'reconsider-policy'),
          btn('나중에 결정하기', 'defer', 'text'),
        ) +
        kept()
      );
    if (['complete', 'changed'].includes(state.scenario) && !state.confirmedGoal) {
      const complete = state.scenario === 'complete';
      return (
        heading(complete ? '현재 방향을 마쳤다고 볼까요?' : '현재 방향을 유지할까요?', '') +
        `<p>${complete ? '설명과 선택 화면이 준비됐다는 보고가 있습니다. 사용자 이해도는 아직 확인되지 않았습니다.' : '화면을 정리하던 중 범위 판단에 필요한 근거가 부족하다는 문제가 제기됐습니다.'}</p>` +
        actions(
          btn(
            complete ? '완료 여부 논의 요청 준비' : '방향 재검토 요청 준비',
            'goal-request',
            'primary',
          ),
          btn('나중에 결정하기', 'defer', 'text'),
        ) +
        detail(
          'direction-basis',
          '무엇이 달라졌나요?',
          example('완료 보고 또는 방향 변화는 검토용 예시입니다.') +
            '<p>기존 방향은 돌아온 사용자가 변경을 이해하고 다음 행동을 고를 수 있도록 하는 것입니다. 보고와 실제 검증을 구분해 유지·수정·마무리 여부를 논의합니다.</p>',
        ) +
        kept()
      );
    }
    if (state.scenario === 'valid' || state.confirmedGoal) {
      return (
        heading('다음 작업을 정해볼까요?', '') +
        '<h3 class="decision-title">실제 분석으로 설명과 선택 순서 검토하기</h3><p>변경의 의미와 가능한 행동이 첫 화면에서 이해되는지 확인하는 작업을 제안합니다.</p>' +
        actions(
          btn('이 작업 논의하기', 'discuss-next', 'primary'),
          btn('원하는 작업 직접 적기', 'custom-next'),
          btn('다른 작업 후보 논의하기', 'other-next', 'text'),
        ) +
        detail(
          'next-basis',
          '이 작업을 제안하는 이유와 완료 조건',
          example('확인된 방향과 다음 작업 제안은 예시입니다.') +
            '<p>기술 분류만으로는 작업이 나타난 이유를 알기 어렵습니다. 사용자가 변경의 의미·미확인 사항·가능한 행동을 구분하면 검토를 마칠 수 있습니다.</p>',
        ) +
        kept()
      );
    }
    return (
      heading('다음에 어떤 결과를 원하나요?', '') +
      '<p>StateCarry는 프로젝트에 돌아와 상황을 이해하고 다음 행동을 고르는 도구입니다. 지금 진행할 목표는 아직 정하지 않았습니다.</p>' +
      actions(
        btn('목표 논의 요청 준비', 'goal-request', 'primary'),
        btn('나중에 결정하기', 'defer', 'text'),
      ) +
      detail(
        'purpose',
        '프로젝트 목적의 근거',
        '<p>내부 UI 정책에 적힌 제품 목적입니다. 사용자가 확인한 현재 목표는 아닙니다.</p>' +
          detail(
            'purpose-original',
            '정책 원문 보기',
            '<blockquote lang="en">Return to a project, understand where it stands, and choose what to do next.</blockquote><a href="../../ui-principles.md" target="_blank" rel="noopener">UI 정책 문서 열기 ↗</a>',
          ),
      ) +
      kept()
    );
  }
  function conflict() {
    return (
      heading('작업 방향이 정책과 충돌합니다', '') +
      '<p>관련 파일을 통째로 커밋하려는 방향이 다른 작업의 수정을 자동 포함하지 않는 정책과 충돌합니다.</p><p class="decision-status">방향을 조정하면 수정 구간을 나눠야 합니다. 정책을 바꾸면 함께 처리할 작업의 범위와 영향을 먼저 논의해야 합니다.</p>' +
      actions(
        btn('방향 조정 논의 요청 준비', 'policy:direction', 'primary'),
        btn('정책 변경 논의 요청 준비', 'policy:policy'),
        btn('나중에 결정하기', 'defer', 'text'),
      ) +
      detail(
        'conflict-source',
        '충돌의 근거',
        example('방향은 가상 예시이며, 파일 범위 정책은 확정 흐름을 기준으로 합니다.') +
          detail(
            'conflict-original',
            '정책 원문 보기',
            '<blockquote>한 파일에 다른 작업이 섞였다고 파일 전체를 자동 포함하지 않는다.</blockquote><a href="../../project-detail-entry-flow.md" target="_blank" rel="noopener">확정 흐름 문서 열기 ↗</a>',
          ),
      )
    );
  }
  function goalRequest() {
    const key = `goal:${state.scenario}:${state.policyChoice}`;
    const initial = `StateCarry의 현재 방향을 논의해주세요.\n${state.policyChoice === 'policy' ? '정책 변경의 영향과 적용 범위를 먼저 논의합니다. 충돌하는 코딩 작업은 아직 시작하지 않습니다.' : state.policyChoice === 'direction' ? '다른 작업의 수정을 함께 포함하지 않는 정책을 유지하면서 방향을 조정합니다.' : '목적과 현재 프로젝트 상태를 참고해 지금 이루려는 결과를 정합니다.'}\n논의 결과는 사용자가 확인한 뒤 반영합니다.`;
    return (
      heading('방향 논의 요청을 준비하세요') +
      '<p>Codex에서 논의할 내용을 확인하세요. 복사만으로 목표나 정책이 바뀌지 않습니다.</p>' +
      `<label class="field">논의 요청<textarea data-input="goal-request" data-key="${key}" rows="7">${escape(state.requests[key] ?? initial)}</textarea></label>` +
      actions(
        btn('논의 요청문 복사', 'copy-goal', 'primary'),
        btn('돌아온 논의 결과 검토', 'goal-result'),
        btn('방향 화면으로 돌아가기', 'direction', 'text'),
      )
    );
  }
  function goalResult() {
    return (
      heading('논의 결과를 확인하세요') +
      example('Codex의 실제 응답이 아닌 검토용 결과입니다.') +
      `<label class="field">확인할 방향<textarea data-input="goal">${escape(state.proposedGoal || (state.policyChoice === 'policy' ? '정책 변경의 적용 범위와 승인 내용을 확인하고 반영한다. 충돌하는 커밋은 정책 반영 확인 이후에 판단한다.' : '실제 분석을 읽은 사용자가 변경의 의미와 처리 방법을 구분할 수 있는지 검토한다.'))}</textarea></label>` +
      (state.policyChoice === 'policy'
        ? '<div class="update-note"><p>정책 충돌은 아직 해결되지 않았습니다.</p><p class="small">정책 수정의 범위와 승인 내용을 다음 작업에 포함해야 합니다. 정책 반영을 확인하기 전에는 충돌하는 실행을 시작하지 않습니다.</p></div>'
        : '') +
      actions(
        btn(
          state.policyChoice === 'policy'
            ? '정책 변경을 다음 작업으로 기록하기'
            : '이 방향으로 기록하기',
          'confirm-goal',
          'primary',
        ),
        ['complete', 'changed'].includes(state.scenario)
          ? btn('현재 방향을 마친 것으로 기록하기', 'finish-goal')
          : '',
        btn('결정을 미루고 나가기', 'defer', 'text'),
      )
    );
  }
  function unknown() {
    const unclear = state.scenario === 'unclear';
    return (
      heading(
        unclear ? '무엇을 하던 변경인지 함께 확인할까요?' : '현재 변경 상태를 다시 확인할까요?',
        '',
      ) +
      `<p>${unclear ? '남아 있는 변경은 확인했지만, 어떤 작업에 속하는지 판단할 근거가 부족합니다. 분류를 확정하지 않고 변경 내용부터 살펴볼 수 있습니다.' : '마지막 저장 관찰에는 변경이 남아 있었습니다. 지금도 같은 상태인지는 확인되지 않았습니다.'}</p>` +
      actions(
        btn(
          unclear ? '변경의 맥락 논의하기' : '변경 상태 다시 확인',
          unclear ? 'discuss-all' : 'retry',
          'primary',
        ),
        unclear ? '' : btn('이전 기록으로 논의하기', 'discuss-all'),
        btn('나중에 결정하기', 'defer', 'text'),
      ) +
      basis(true)
    );
  }
  function prepareRequest() {
    if (
      !state.scopeConfirmed ||
      state.basisChanged ||
      ['checking', 'failure'].includes(state.scenario)
    ) {
      message('현재 처리 범위를 먼저 확인해주세요. 작성한 내용은 유지됩니다.');
      return;
    }
    const key =
      state.intent === 'next'
        ? 'next'
        : `${state.group}:${state.intent}:${state.intent === 'revert' ? state.revertMode : ''}`;
    if (!state.requests[key])
      state.requests[key] =
        `작업: ${selected().title}\n처리: ${state.intent === 'commit' ? '선택한 수정 커밋' : state.intent === 'revert' ? (state.revertMode === 'unstage' ? 'staged 상태만 해제하고 내용 유지' : '선택한 수정 내용 되돌리기') : '논의한 범위 이어가기'}\n포함: 사용자가 확인한 수정 구간 [시나리오 예시]\n제외: 다른 작업의 수정과 선택하지 않은 구간\n완료 조건: 요청 범위의 처리 결과와 남은 변경을 확인\n미확인: 최신 범위에 대한 검증 결과\n실제 실행 전 현재 파일과 범위를 다시 대조하고, 불일치하면 중단하여 사용자에게 확인합니다.`;
    go('request');
  }
  function request() {
    const key =
      state.intent === 'next'
        ? 'next'
        : `${state.group}:${state.intent}:${state.intent === 'revert' ? state.revertMode : ''}`;
    return (
      heading(state.intent === 'check' ? '확인 요청문' : '실행 요청문') +
      '<p>내용을 확인하고 Codex에 전달하세요. 복사만으로 실행되지는 않습니다.</p>' +
      example('검토용 요청문입니다. 실제 프로젝트에 전달하지 않습니다.') +
      `<label class="field">요청 내용<textarea data-input="request" data-key="${key}" rows="10">${escape(state.requests[key] ?? '')}</textarea></label>` +
      (state.basisChanged && state.intent !== 'check'
        ? '<p>관련 변경이 생겼습니다. 작성한 요청은 보존했지만 복사 전 범위를 다시 확인해야 합니다.</p>'
        : '<p class="small">복사는 실행을 시작하지 않습니다. 실제 결과는 Codex 실행 후 프로젝트 상태를 다시 읽어 확인합니다.</p>') +
      actions(
        btn(
          '요청문 복사',
          'copy-request',
          'primary',
          state.basisChanged && state.intent !== 'check',
        ),
        btn(
          '범위 검토로 돌아가기',
          state.intent === 'next'
            ? 'next-review'
            : state.intent === 'check'
              ? 'check-plan'
              : 'review',
        ),
        btn('외부 실행 후 확인 화면 보기', 'result-example', 'text'),
      )
    );
  }
  function result() {
    if (state.intent === 'check')
      return (
        heading('확인 결과를 기다리고 있습니다') +
        '<p>요청을 준비한 상태입니다. 실제 확인 결과는 아직 연결되지 않았습니다.</p>' +
        actions(
          btn('확인 요청으로 돌아가기', 'request'),
          btn('작업으로 돌아가기', 'overview', 'text'),
        )
      );
    if (state.policyPending)
      return (
        heading('정책 변경이 반영됐나요?') +
        example('정책 변경 작업 이후의 확인 장면입니다. 실제 문서 수정 결과는 없습니다.') +
        '<p>정책 반영 여부는 아직 확인되지 않았습니다. 실제 문서와 승인 범위를 비교하기 전에는 충돌하는 커밋을 진행하지 않습니다.</p>' +
        actions(
          btn('승인 범위와 실제 정책 비교', 'compare-result', 'primary'),
          btn('정책 변경 작업으로 돌아가기', 'direction'),
          btn('결과 확인을 나중에 하기', 'defer', 'text'),
        )
      );
    return (
      heading('처리된 부분과 남은 변경을 확인하세요') +
      example('외부 실행 후 일부만 처리된 경우입니다. 실제 커밋·검증 결과가 아닙니다.') +
      '<div class="two-lines"><section><h3>처리된 것으로 보고된 내용</h3><p>선택한 화면 변경 일부가 커밋됐다는 보고가 있습니다.</p></section><section><h3>실제 결과 확인</h3><p>요청한 수정이 포함됐는지와 완료 조건의 검증은 아직 확인되지 않았습니다.</p></section><section><h3>남아 있는 변경</h3><p>화면의 나머지 수정과 논의 보존·기록 읽기 변경이 남아 있습니다. 이전에 남겨둔 결정은 해당 범위에만 적용됩니다.</p></section></div>' +
      actions(
        btn('요청 범위와 실제 결과 비교', 'compare-result', 'primary'),
        btn('남은 변경 살펴보기', 'overview'),
        btn('결과 확인을 나중에 하기', 'defer', 'text'),
      )
    );
  }
  function render() {
    notice.textContent = '';
    document.getElementById('scenario').value = state.scenario;
    document.getElementById('frame').classList.toggle('narrow', state.narrow);
    document.getElementById('viewport').setAttribute('aria-pressed', String(state.narrow));
    document.getElementById('viewport').textContent = state.narrow ? '넓은 화면' : '좁은 화면';
    document.getElementById('leave').textContent = state.away
      ? '프로젝트로 돌아오기'
      : '잠시 나가기';
    document.getElementById('resolve').hidden =
      !['scope', 'review', 'next-review'].includes(state.view) ||
      state.away ||
      ['checking', 'failure'].includes(state.scenario);
    document.getElementById('provenance').textContent =
      state.scenario === 'actual' && !state.scopeConfirmed
        ? '실제 자료: 2026.09.20 19:54 분석 / 20:22 관찰(KST). 질문·결정·실행 결과는 예시입니다.'
        : '시나리오 예시를 포함합니다. 작업 설명은 실제 19:54 분석에서 가져왔으며, 확인·결정·결과는 시안에서만 적용됩니다.';
    document.getElementById('direction').textContent =
      state.confirmedGoal ||
      (['valid', 'complete', 'changed'].includes(state.scenario)
        ? '방향 · 돌아온 사용자가 변경을 이해하고 다음 행동을 고를 수 있도록 하기 [예시]'
        : '');
    document.getElementById('direction').hidden = !document.getElementById('direction').textContent;
    const views = {
      overview,
      'check-plan': checkPlan,
      choose: chooser,
      inspect,
      scope,
      treatment,
      review,
      discussion,
      direction,
      'goal-request': goalRequest,
      'goal-result': goalResult,
      'next-review': nextReview,
      unknown,
      request,
      result,
    };
    screen.innerHTML = state.away
      ? `<div class="away">${heading('프로젝트에서 잠시 나왔습니다')}<p>선택, 논의 내용, 작성 중인 초안은 그대로 남아 있습니다.</p>${btn('프로젝트로 돌아오기', 'return', 'primary')}</div>`
      : (views[state.view] || overview)();
    save();
  }
  screen.addEventListener(
    'toggle',
    (event) => {
      if (!event.target.matches('details[data-detail]')) return;
      state.expanded[`${state.view}:${event.target.dataset.detail}`] = event.target.open;
      save();
    },
    true,
  );
  screen.addEventListener('input', (event) => {
    const el = event.target;
    const type = el.dataset.input;
    if (type === 'discussion') state.drafts[state.discussionKey] = el.value;
    if (type === 'correction') state.correction = el.value;
    if (type === 'goal') state.proposedGoal = el.value;
    if (type === 'next-scope') state.nextScope = el.value;
    if (type === 'next-done') state.nextDone = el.value;
    if (type === 'request' || type === 'goal-request') state.requests[el.dataset.key] = el.value;
    save();
  });
  screen.addEventListener('change', (event) => {
    if (event.target.name === 'revert-mode') {
      state.revertMode = event.target.value;
      save();
    }
  });
  screen.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'check-plan') state.intent = 'check';
    if (
      [
        'overview',
        'check-plan',
        'request',
        'choose',
        'inspect',
        'scope',
        'review',
        'treatment',
        'direction',
        'goal-request',
        'goal-result',
        'next-review',
      ].includes(action)
    ) {
      go(action);
      return;
    }
    if (action === 'prepare-check') {
      state.intent = 'check';
      const g = selected();
      const key = `${state.group}:check:`;
      state.requests[key] ??=
        `작업: ${g.title}\n먼저 현재 프로젝트 상태를 다시 읽어주세요.\n확인할 내용:\n${g.checks.map((item) => `- ${item}`).join('\n')}\n파일 수정·커밋·되돌리기는 진행하지 않습니다.\n결과는 확인된 동작, 확인하지 못한 부분, 남은 일로 나누어 정리해주세요.\n이전 분석을 최신 상태로 단정하지 마세요.`;
      go('request');
      return;
    }
    if (action.startsWith('select:') || action.startsWith('inspect:')) {
      state.group = Number(action.split(':')[1]);
      state.scopeConfirmed = false;
      go('overview');
      return;
    }
    if (action.startsWith('review:')) {
      state.intent = action.split(':')[1];
      state.revertMode = 'discard';
      go(state.intent === 'continue' && state.discussionKey === 'next' ? 'next-review' : 'review');
      return;
    }
    if (action.startsWith('policy:')) {
      state.policyChoice = action.split(':')[1];
      go('goal-request');
      return;
    }
    if (action === 'discuss-all') {
      startDiscussion('all');
      return;
    }
    if (action === 'discuss-group' || action === 'continue-discussion') {
      startDiscussion(
        `group:${state.group}`,
        action === 'continue-discussion' ? 'continue' : undefined,
      );
      return;
    }
    if (['discuss-next', 'custom-next', 'other-next'].includes(action)) {
      state.drafts.next ||=
        action === 'other-next' ? '다른 작업 후보와 각각의 이유를 논의하고 싶습니다.' : '';
      startDiscussion('next', 'continue');
      return;
    }
    if (action === 'close-discussion') {
      go(state.discussionReturn, true);
      return;
    }
    if (action === 'ask') {
      const key = state.discussionKey;
      const q = (state.drafts[key] ?? '').trim();
      if (!q) {
        message('논의할 내용을 먼저 적어주세요.');
        return;
      }
      state.turns[key] ??= [];
      state.turns[key].push({
        id: Date.now(),
        q,
        basis: state.basis,
        answer:
          key === 'next'
            ? {
                conclusion: '실행할 내용과 완료 조건을 먼저 정할 수 있습니다.',
                reason: '작업 후보를 골랐지만 이번에 다룰 범위는 별도 확인이 필요합니다.',
                next: '이번 작업의 범위와 완료 조건을 확인하세요.',
              }
            : key !== 'all' && !selected().shared
              ? {
                  conclusion: '기록 읽기 개선의 효과는 아직 확인되지 않았습니다.',
                  reason:
                    '이전 분석에는 읽기 방식 변경이 있지만, 실제 속도와 메모리 측정 결과는 없습니다.',
                  next: '현재 반영 상태와 성능을 확인할 조건을 정하세요.',
                }
              : {
                  conclusion: '이 작업만 따로 마무리할 수 있는지는 아직 모릅니다.',
                  reason:
                    '화면 변경과 논의 보존 기능이 같은 파일에 있습니다. 수정한 부분을 살펴봐야 나눌 수 있는지 알 수 있습니다.',
                  next: '같은 파일에서 두 작업이 바꾼 부분을 비교하세요.',
                },
      });
      state.drafts[key] = '';
      render();
      return;
    }
    if (action === 'rebase') {
      state.discussionBasis[state.discussionKey] = state.basis;
      render();
      message('현재 상태로 논의를 이어가는 예시입니다. 이전 답변과 초안은 유지됐습니다.');
      return;
    }
    if (action === 'keep-all' || action === 'keep-group') {
      state.kept = [
        ...new Set([...state.kept, ...(action === 'keep-all' ? [0, 1, 2] : [state.group])]),
      ];
      state.recheck = state.recheck.filter((i) => action !== 'keep-all' && i !== state.group);
      state.showKept = false;
      go(state.kept.length === groups.length && !state.recheck.length ? 'direction' : 'overview');
      message('시안에서 그대로 두기로 한 범위를 기록했습니다. 실제 파일은 변경하지 않았습니다.');
      return;
    }
    if (action === 'reopen') {
      state.showKept = true;
      go('overview');
      return;
    }
    if (action === 'correct') {
      save();
      message(
        state.correction.trim()
          ? '작성한 설명을 사용자 정정으로 보존했습니다. 원래 분석은 그대로 남아 있습니다.'
          : '정정할 내용을 먼저 적어주세요.',
      );
      return;
    }
    if (action === 'prepare') {
      prepareRequest();
      return;
    }
    if (action === 'back-next-discussion') {
      go('discussion');
      return;
    }
    if (action === 'prepare-next') {
      if (state.basisChanged || ['checking', 'failure'].includes(state.scenario)) {
        message('관련 변경에 맞춰 범위를 다시 확인해주세요. 작성한 내용은 보존됩니다.');
        return;
      }
      const scopeText = screen.querySelector('[data-input="next-scope"]').value.trim();
      const doneText = screen.querySelector('[data-input="next-done"]').value.trim();
      if (!scopeText || !doneText) {
        message('진행할 내용과 완료 조건을 모두 적어주세요.');
        return;
      }
      state.nextScope = scopeText;
      state.nextDone = doneText;
      state.intent = 'next';
      state.requests.next = `다음 작업: ${scopeText}\n완료 조건: ${doneText}\n남겨둔 변경은 별도입니다. 겹치는 범위가 있으면 실행 전에 확인합니다.\n사용자가 확인한 요청 내용을 기준으로 진행하고 실제 결과를 다시 확인합니다.`;
      go('request');
      return;
    }
    if (action === 'result-example') {
      go('result');
      return;
    }
    if (action === 'reconsider-policy') {
      state.confirmedGoal = '';
      state.policyPending = false;
      go('direction');
      return;
    }
    if (action === 'confirm-goal') {
      state.policyPending = state.policyChoice === 'policy';
      state.goalFinished = false;
      if (state.policyPending) {
        state.nextScope =
          '정책 변경의 적용 범위와 승인 내용을 확인하고 정책 문서에 반영한다. 충돌하는 커밋 작업은 진행하지 않는다.';
        state.nextDone = '사용자가 승인한 정책 변경이 실제 문서에 반영됐는지 확인한다.';
      }
      state.confirmedGoal =
        state.proposedGoal ||
        (state.policyPending
          ? '정책 변경의 적용 범위와 승인 내용을 확인하고 반영하기'
          : '실제 분석을 읽은 사용자가 변경의 의미와 처리 방법을 구분할 수 있는지 검토한다.');
      go('direction');
      message('시안에만 방향을 기록했습니다. 실제 프로젝트 목표는 바뀌지 않았습니다.');
      return;
    }
    if (action === 'finish-goal') {
      state.confirmedGoal = '';
      state.scenario = 'missing';
      state.goalFinished = true;
      go('direction');
      message('시안에서 현재 방향의 완료를 기록했습니다. 새 방향은 나중에 정해도 됩니다.');
      return;
    }
    if (action === 'defer') {
      state.returnView = state.view;
      state.away = true;
      render();
      return;
    }
    if (action === 'return') {
      state.away = false;
      render();
      return;
    }
    if (action === 'retry') {
      message(
        '시안에서는 실제 상태를 읽지 않습니다. 위의 ‘진입 장면’에서 갱신 중·실패·범위 확인 가능 상태를 비교할 수 있습니다.',
      );
      return;
    }
    if (action === 'compare-result') {
      message(
        '확인할 입력: 실행 후 실제 수정·커밋, 요청 범위, 검증 결과. 이 시안에는 실제 실행 결과가 없어 완료로 표시하지 않습니다.',
      );
      return;
    }
    if (action === 'copy-request' || action === 'copy-goal') {
      const input = screen.querySelector('textarea');
      try {
        await navigator.clipboard.writeText(
          `[StateCarry 설계 시안 — 실제 실행용 아님]\n${input.value}`,
        );
        message('검토용 요청문을 복사했습니다. 전송하거나 실행하지 않았습니다.');
      } catch {
        input.focus();
        input.select();
        message('자동 복사를 사용할 수 없습니다. 선택된 요청문을 직접 복사하세요.');
      }
    }
  });
  document.getElementById('scenario').addEventListener('change', (event) => {
    state.scenario = event.target.value;
    state.intent = state.scenario === 'result' ? 'commit' : 'continue';
    state.scopeConfirmed = false;
    state.basisChanged = false;
    state.away = false;
    state.confirmedGoal = '';
    state.policyChoice = '';
    state.policyPending = false;
    state.goalFinished = false;
    state.recheck = [];
    state.showKept = false;
    if (['missing', 'valid', 'complete', 'changed', 'conflict'].includes(state.scenario))
      state.view = 'direction';
    else if (['unknown', 'unclear'].includes(state.scenario)) state.view = 'unknown';
    else if (state.scenario === 'result') state.view = 'result';
    else state.view = state.kept.length === groups.length ? 'direction' : 'overview';
    render();
  });
  document.getElementById('viewport').addEventListener('click', () => {
    state.narrow = !state.narrow;
    render();
  });
  document.getElementById('leave').addEventListener('click', () => {
    state.away = !state.away;
    render();
  });
  document.getElementById('refresh').addEventListener('click', () => {
    state.basis++;
    state.basisChanged = true;
    state.recheck = [...new Set([...state.recheck, state.group])];
    state.scopeConfirmed = false;
    if (state.view === 'direction' && !state.away) state.view = 'overview';
    render();
    message(
      '관련 변경이 생긴 예시입니다. 초안과 남겨둔 결정은 유지하며, 영향을 받은 범위를 다시 확인합니다.',
    );
  });
  document.getElementById('resolve').addEventListener('click', () => {
    state.scenario = 'ready';
    state.scopeConfirmed = true;
    state.basisChanged = false;
    render();
    message('범위를 확인한 예시로 전환했습니다. 실제 수정 구간의 검증 결과가 아닙니다.');
  });
  document.getElementById('reset').addEventListener('click', () => {
    state = structuredClone(defaults);
    render();
    message('검토용 선택과 초안을 초기화했습니다. 실제 프로젝트 데이터는 변경하지 않았습니다.');
  });
  render();
})();

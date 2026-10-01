# StateCarry

중단했던 프로젝트로 돌아와 현재 상황을 이해하고 다음에 할 일을 선택하는 macOS 앱입니다.

[English](README.md) · [웹사이트](https://statecarry.threelight-studio.com) · [1분 데모](https://youtu.be/vQpwQ_hr_ew) · [Apple Silicon macOS 베타 다운로드](https://github.com/ThreeLightStudio/statecarry/releases/latest/download/macos-arm64-StateCarry.dmg) · [화면 미리보기](README.md#product-preview) · [MIT](LICENSE)

예를 들어 내보내기 오류를 조사하다 다른 일로 전환한 뒤 며칠 만에 돌아왔다고 가정해 보세요. StateCarry는 선택한 프로젝트 대화와 현재 Git·파일 관찰을 모아 방향, 현재 판단할 일, 다음 선택의 근거를 검토하도록 돕습니다. 에이전트의 “완료” 보고는 검토할 결과로 남으며, 수락 여부는 사용자가 결정합니다.

기록과 수정 사항은 Mac에 저장합니다. **선택한 대화 발췌와 제한된 파일 미리보기를 포함한 프로젝트 관찰은 설정한 분석 제공자에게 전송됩니다. AI 분석은 오프라인으로 처리되지 않습니다.** 현재 공개 소스는 Codex와 OpenRouter를 지원합니다. 영어 README의 스크린샷은 0.1.8 화면입니다.

## 확인할 수 있는 설계 결정

| 결정 | 이유 | 공개 근거 |
| --- | --- | --- |
| 소스 실행과 Electrobun 데스크톱이 React UI 및 HTTP/SSE 계약을 공유하고, 표현 계층·코어 규칙·계약·서버 어댑터의 책임을 나눕니다. | 네이티브 수명주기와 기능이 바뀌어도 제품 규칙을 네이티브 셸로 옮길 필요가 없습니다. | [아키텍처](docs/architecture.md) · [의존성 경계 검사](https://github.com/ThreeLightStudio/statecarry/blob/e793596d99cfcf253caf313f23f407cc43e16057/scripts/check-boundaries.ts) |
| 모델 보고, 검사 근거, 사용자 수락을 구분합니다. | 그럴듯한 결과나 통과한 검사가 사용자의 우선순위를 정하거나 작업을 대신 수락할 수 없습니다. | [동작 계약](docs/product-behavior-contract.md) · [결정 구현](https://github.com/ThreeLightStudio/statecarry/blob/e793596d99cfcf253caf313f23f407cc43e16057/packages/core/src/project-model.ts) · [수락 테스트 사례](https://github.com/ThreeLightStudio/statecarry/blob/e793596d99cfcf253caf313f23f407cc43e16057/tests/project-workspace-core.test.ts) |
| 프로덕션과 개발 프로필을 분리하고, 루프백 서비스와 쓰기 잠금을 사용합니다. | 앱 개발 중 프로덕션 기록을 열거나 별도로 실행 중인 인스턴스에 연결하지 않도록 합니다. | [실행 환경 분리](docs/runtime-isolation.md) · [분리 테스트 사례](https://github.com/ThreeLightStudio/statecarry/blob/e793596d99cfcf253caf313f23f407cc43e16057/tests/runtime-isolation.test.ts) |

동작 계약은 의도한 규칙을 설명하며, 구현과 테스트는 다룬 사례의 근거입니다. 자동 검사가 통과했다고 해서 설명을 사람이 이해했거나 실제 작업 복귀에 성공했다는 뜻은 아닙니다.

## 다운로드와 소스의 상태

**[Apple Silicon macOS 공개 베타 다운로드](https://github.com/ThreeLightStudio/statecarry/releases/latest/download/macos-arm64-StateCarry.dmg)**

DMG에서 앱을 Applications로 복사한 뒤 Finder에서 실행하세요. 서명·공증·Gatekeeper 확인 절차는 [데스크톱 릴리스 문서](docs/desktop-release.md)에 있습니다. 업데이트 다운로드와 적용을 위한 재시작은 명시적인 사용자 동작입니다. [자동 업데이트 계약](docs/auto-update.md)을 참고하세요.

2026년 10월 2일 기준 최신 공개 릴리스는 [v0.3.0](https://github.com/ThreeLightStudio/statecarry/releases/tag/v0.3.0)이며, 소스 기준은 [`6204e71`](https://github.com/ThreeLightStudio/statecarry/commit/6204e719f6fd8ae345674449863da9059fce522b)입니다. 이 README의 코드 근거는 그보다 뒤의 main 버전 [`e793596`](https://github.com/ThreeLightStudio/statecarry/commit/e793596d99cfcf253caf313f23f407cc43e16057)을 가리킵니다. 이후 소스의 모든 동작이 다운로드한 앱에 포함됐다고 볼 수는 없습니다. 해당 소스 버전의 [Verify 실행은 성공](https://github.com/ThreeLightStudio/statecarry/actions/runs/36766925419)했습니다. 릴리스 제공, 자동 검사, 실제 작업에서의 수락은 별개의 근거입니다.

## 처음 사용하기

1. **Add a project**에서 로컬 폴더를 선택하고 알아볼 수 있는 이름을 붙입니다. 프로젝트 파일과 Git을 확인하고 관련 Codex 대화를 찾아 초기 개요를 요청합니다. 대화가 없어도 등록할 수 있습니다.
2. **Project settings**에서 선택된 대화와 자료 범위를 검토합니다. **Home**에서는 집중할 프로젝트를 최대 세 개까지 직접 선택합니다. 최근 활동만으로 우선순위를 정하지 않습니다.
3. **Direction**, **Current decision**, **Your next choice**, 선택 이유와 완료 조건을 읽습니다. 지원되는 경로로 작업 대화를 열거나 인계문을 복사할 수 있습니다. 열기와 복사만으로 작업이 실행되지는 않습니다.
4. 현재 변경 사항이 판단을 바꿀 수 있다면 **Context**와 **What is this based on?**을 확인합니다. 결과를 검토한 뒤 수락하고, 잘못된 제안은 수정·보류하거나 제외합니다.
5. 새 모델 분석이 필요할 때 **Update overview**를 선택합니다. 앱으로 돌아오는 동작은 저장된 상태와 프로젝트 파일을 확인하며 AI 분석을 시작하지 않습니다.

입력 초안 복구, 오래된 근거 처리, 남은 수락 검증은 [복귀 콘텐츠 계약](docs/return-content-contract.md)과 [구현 단계 기록](docs/project-ui-implementation.md)에 있습니다.

## 소스에서 실행하기

Apple Silicon macOS, Node **24.14.1 이상**, pnpm **10.33.2**, 로그인된 [Codex CLI](https://developers.openai.com/codex/cli/) 및 [Codex 데스크톱](https://developers.openai.com/codex/app/)이 필요합니다. 문서에 기록된 개발 CLI는 0.152.0이며, 다른 OS·CLI 조합은 검증되지 않았습니다.

기존 프로젝트 데이터가 있는 상태에서 업데이트한 빌드를 사용하기 전에 [베타 데이터 초기화 안내](docs/project-data-reset.md)를 읽으세요.

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/server.mjs
```

서버가 출력한 루프백 URL을 열고 터미널을 유지하세요. 빌드된 서버는 프로덕션 프로필을 사용합니다. 분리된 개발 프로필은 `pnpm dev` 또는 `pnpm desktop:dev`로 실행합니다. 웹 UI는 `http://127.0.0.1:4311`, 개발 API는 4310 포트이며, 개발 서버는 한 번에 하나만 실행하세요. 세부 검사와 진단은 [개발 문서](docs/development.md)를 참고하세요.

```sh
pnpm verify
```

`verify`는 로컬 Turborepo 캐시를 사용할 수 있습니다. 검사 실행 자체의 새로운 근거가 필요하면 `pnpm verify:fresh`를 사용합니다.

## 분석과 데이터의 경계

- **제공자 선택:** 현재 main 소스는 분석 호출마다 설정된 에이전트를 읽습니다. Codex는 로그인된 계정을 사용하고, OpenRouter는 사용자 API 키가 필요합니다. Codex 오류가 사용량 소진으로 분류되고 설정 또는 `OPENROUTER_API_KEY`에 키가 있으면 분석 호출 전체를 OpenRouter에서 다시 실행합니다. 일정 기간 후속 호출도 OpenRouter를 사용한 뒤 다음 호출에서 Codex를 다시 시도합니다. 다른 Codex 오류는 그대로 전달합니다. 이는 Codex 내부의 모델·effort를 몰래 바꾸는 동작과 다르며, Codex 어댑터는 그런 대체를 거부합니다. [제공자 구현](https://github.com/ThreeLightStudio/statecarry/blob/e793596d99cfcf253caf313f23f407cc43e16057/apps/server/src/adapters/agent-summary.ts), [전환 테스트 사례](https://github.com/ThreeLightStudio/statecarry/blob/e793596d99cfcf253caf313f23f407cc43e16057/tests/agent-summary-failover.test.ts), [Codex 설정 검사](https://github.com/ThreeLightStudio/statecarry/blob/e793596d99cfcf253caf313f23f407cc43e16057/apps/server/src/adapters/codex-summary.ts)를 확인하세요. 대화 수집과 이동은 계속 Codex를 사용합니다.
- **분석 범위:** 연결한 기록과 제한된 프로젝트 관찰을 분석합니다. 없는 기록은 완료의 증거가 아니며, 발췌 예산이 전체 모델 요청의 크기를 제한하지는 않습니다. 원문은 신뢰할 수 없는 근거로 취급합니다. 인용·참조 검증도 해석의 정확성을 보장하지 않습니다.
- **저장:** 프로덕션은 `~/.statecarry`, 개발은 `~/.statecarry-dev`를 사용합니다. 초안과 읽기 설정은 서버 근거·권한과 구분하며 기기 간 동기화하지 않습니다. [실행 환경 분리](docs/runtime-isolation.md)를 참고하세요.
- **로컬 서비스:** 서버는 `127.0.0.1`에 바인딩하고 예상하지 않은 Host/Origin을 거부합니다. 공개 호스팅이나 터널에 노출하지 마세요. 계정 인증 정보, 비공개 기록, `.cache/` 관찰은 공유 소스와 빌드에서 제외합니다.
- **제거:** 연결을 끊어도 등록과 저장된 작업은 남습니다. 별도 제거 미리보기에서 대상 기록과 원문 복사본을 확인합니다. 삭제는 재연결로 되돌릴 수 없습니다. 원래 폴더·대화와 별도 요청 영수증·진단·백업은 유지됩니다. [범위를 지정한 제거 구현](https://github.com/ThreeLightStudio/statecarry/blob/e793596d99cfcf253caf313f23f407cc43e16057/packages/core/src/project-deletion.ts)을 참고하세요.

## 제한과 더 읽을 자료

베타는 자동 작업 실행, 전체 프로젝트 관리, 환경 복원을 약속하지 않습니다. 브라우저 초안은 프로필과 origin에 따라 분리됩니다. 새 탭을 오프라인에서 열면 서버가 돌아와야 저장된 개요를 읽을 수 있습니다. 파일 관찰은 제한된 표본이며 모든 파일을 계속 감시하지 않습니다. 근거가 실패하거나 오래되면 보관된 맥락을 읽을 수 있어도 동작은 차단될 수 있습니다.

의도한 Codex 대화에 실제로 도착했는지, 실제 모델 설명이 적절한지, 사람이 작업에 복귀할 수 있었는지는 [로드맵](docs/roadmap.md)과 [구현 단계 기록](docs/project-ui-implementation.md)의 별도 검증 항목입니다. 선택적인 이동 진단은 사용자가 목적지 대화를 확인해야 하며, OS 요청 수락만으로 도착을 입증하지 않습니다. 문제 해결과 공개 범위는 [개발 문서](docs/development.md), [공개 소스 준비](docs/public-release.md)를 참고하세요.

## 라이선스

[MIT](LICENSE) · Copyright (c) 2026 ThreeLight Studio. 워크스페이스 패키지의 `private: true`는 실수로 npm에 게시하는 것을 막습니다. 외부 구성 요소의 라이선스는 [서드파티 고지](docs/third-party.md)에 있습니다.
